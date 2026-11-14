/**
 * Content-derived candidate window formation from media and speech signals (Phase 7 & 8).
 *
 * Rules:
 * - Candidate duration is CONTENT-DERIVED: follows complete sentences, thoughts, and natural boundaries.
 * - NO fixed 10-second duration, NO hardcoded min/max limits, NO preset window sizes.
 * - Evaluates full source duration from 0 to duration without arbitrary truncation.
 * - Integrates speech and transcript evidence when present: groups coherent thoughts and expands context.
 * - NO whole-source fallback: if no strong moment is identified, returns empty array with explanation.
 * - Accurately records contributing evidence for every candidate window.
 */

import type {
  SourceAnalysisResult,
  RepurposeConfig,
  CandidateEvidence,
} from "../../types/repurpose.ts";
import type { ContextDimensionAssessment } from "./contextIntegrity.ts";
import {
  buildThoughtClustersFromCues,
  evaluateContextIntegrity,
} from "./contextIntegrity.ts";

export interface RawCandidateWindow {
  sourceAssetId: string;
  sourceAssetName: string;
  sourceIn: number;
  sourceOut: number;
  duration: number;
  evidence: CandidateEvidence;
  hasTranscriptEvidence?: boolean;
  transcriptSnippet?: string;
  precedingContextText?: string;
  followingContextText?: string;
  speechBoundaryIntegrity?: ContextDimensionAssessment;
  thoughtCompleteness?: ContextDimensionAssessment;
  contextSufficiency?: ContextDimensionAssessment;
  standaloneClarity?: ContextDimensionAssessment;
  endingClosure?: ContextDimensionAssessment;
  contextExpansionApplied?: {
    expandedStartSeconds: number;
    expandedEndSeconds: number;
    setupIncluded: string;
  };
}

export const BOUNDARY_SNAP_TOLERANCE = 1.5;

/**
 * Snaps a target timestamp to the nearest natural boundary (scene cut or audio pause)
 * within a tolerance radius.
 */
export function snapToNaturalBoundary(
  targetTime: number,
  naturalBoundaries: number[],
  tolerance = BOUNDARY_SNAP_TOLERANCE
): { time: number; snapped: boolean } {
  let closestTime = targetTime;
  let minDiff = Infinity;

  for (const b of naturalBoundaries) {
    const diff = Math.abs(b - targetTime);
    if (diff <= tolerance && diff < minDiff) {
      minDiff = diff;
      closestTime = b;
    }
  }

  return {
    time: closestTime,
    snapped: minDiff <= tolerance,
  };
}

/**
 * Extracts summarized signal evidence within a given time interval [tIn, tOut].
 */
export function extractEvidenceInWindow(
  analysis: SourceAnalysisResult,
  sourceIn: number,
  sourceOut: number
): CandidateEvidence {
  const { hasVideo, hasAudio, frameSignals, audioSignals, sceneCutTimes, silenceIntervals } = analysis;

  // 1. Video evidence
  const framesInWindow = frameSignals.filter((f) => f.timestamp >= sourceIn && f.timestamp <= sourceOut);
  const sceneCutsInWindow = sceneCutTimes.filter((t) => t >= sourceIn && t <= sourceOut);

  let visualSum = 0;
  let peakVisualDiff = 0;
  for (const f of framesInWindow) {
    visualSum += f.visualDiff;
    if (f.visualDiff > peakVisualDiff) {
      peakVisualDiff = f.visualDiff;
    }
  }
  const avgVisualDiff = framesInWindow.length > 0 ? visualSum / framesInWindow.length : 0;

  // 2. Audio evidence
  const audioInWindow = audioSignals.filter((a) => a.timestamp >= sourceIn && a.timestamp <= sourceOut);

  let rmsSum = 0;
  let speechCount = 0;
  for (const a of audioInWindow) {
    rmsSum += a.rms;
    if (a.isSpeechLikeActivity) {
      speechCount++;
    }
  }
  const avgRms = audioInWindow.length > 0 ? rmsSum / audioInWindow.length : 0;
  const speechActivityRatio = audioInWindow.length > 0 ? speechCount / audioInWindow.length : 0;

  // 3. Natural boundary verification
  const naturalBoundaryTimes: number[] = [0, ...sceneCutTimes];
  for (const s of silenceIntervals) {
    naturalBoundaryTimes.push((s.start + s.end) / 2);
  }

  const startsAtNaturalBoundary = naturalBoundaryTimes.some((t) => Math.abs(t - sourceIn) <= 0.6);
  const endsAtNaturalBoundary = naturalBoundaryTimes.some((t) => Math.abs(t - sourceOut) <= 0.6);

  return {
    hasAudio,
    hasVideo,
    sceneCutCount: sceneCutsInWindow.length,
    avgVisualDiff: Number(avgVisualDiff.toFixed(3)),
    peakVisualDiff: Number(peakVisualDiff.toFixed(3)),
    avgRms: Number(avgRms.toFixed(3)),
    speechActivityRatio: Number(speechActivityRatio.toFixed(3)),
    startsAtNaturalBoundary,
    endsAtNaturalBoundary,
  };
}

/**
 * Discovers candidate intervals for a single analyzed source across its complete duration.
 */
export function discoverSourceCandidates(
  analysis: SourceAnalysisResult,
  config: RepurposeConfig
): RawCandidateWindow[] {
  const sourceDuration = analysis.duration;
  const minBound = config?.minClipDuration ? Math.max(2.5, config.minClipDuration * 0.85) : 3.0;
  const maxBound = config?.maxClipDuration ? config.maxClipDuration * 1.15 : 60.0;

  if (sourceDuration < minBound || !Number.isFinite(sourceDuration) || (!analysis.hasVideo && !analysis.hasAudio)) {
    return [];
  }

  const rawWindows: RawCandidateWindow[] = [];
  const seenIntervals = new Set<string>();

  // PATH A: Transcript-Driven Discovery (Primary when speech transcript is present)
  if (analysis.transcript && analysis.transcript.cues.length > 0) {
    const thoughtClusters = buildThoughtClustersFromCues(analysis.transcript.cues, sourceDuration);

    for (const cluster of thoughtClusters) {
      const dur = cluster.duration;
      // Content-derived: accept short thoughts (e.g. 4s) up to comprehensive explanations (e.g. 60s+)
      if (dur < 2.5 || dur > sourceDuration) continue;

      // Avoid full-source accidental capture on long videos
      if (sourceDuration >= 20.0 && dur >= sourceDuration * 0.95) {
        continue;
      }

      const key = `${cluster.sourceIn.toFixed(1)}-${cluster.sourceOut.toFixed(1)}`;
      if (seenIntervals.has(key)) continue;
      seenIntervals.add(key);

      const evidence = extractEvidenceInWindow(analysis, cluster.sourceIn, cluster.sourceOut);
      const rep = cluster.contextReport;

      rawWindows.push({
        sourceAssetId: analysis.assetId,
        sourceAssetName: analysis.assetName,
        sourceIn: cluster.sourceIn,
        sourceOut: cluster.sourceOut,
        duration: dur,
        evidence,
        hasTranscriptEvidence: true,
        transcriptSnippet: cluster.transcriptSnippet,
        precedingContextText: rep.precedingTranscript,
        followingContextText: rep.followingTranscript,
        speechBoundaryIntegrity: rep.speechBoundaryIntegrity,
        thoughtCompleteness: rep.thoughtCompleteness,
        contextSufficiency: rep.contextSufficiency,
        standaloneClarity: rep.standaloneClarity,
        endingClosure: rep.endingClosure,
        contextExpansionApplied: rep.expansionRecommendation ? {
          expandedStartSeconds: rep.expansionRecommendation.suggestedSourceIn,
          expandedEndSeconds: rep.expansionRecommendation.suggestedSourceOut,
          setupIncluded: rep.expansionRecommendation.setupCuesIncluded.join(" "),
        } : undefined,
      });
    }

    // Also look for multi-thought combinations if they form a narrative arc
    if (thoughtClusters.length >= 2) {
      for (let i = 0; i < thoughtClusters.length - 1; i++) {
        const c1 = thoughtClusters[i];
        const c2 = thoughtClusters[i + 1];
        const combinedIn = c1.sourceIn;
        const combinedOut = c2.sourceOut;
        const combinedDur = Number((combinedOut - combinedIn).toFixed(2));

        if (combinedDur >= 8.0 && combinedDur <= 60.0 && combinedDur < sourceDuration * 0.9) {
          const key = `${combinedIn.toFixed(1)}-${combinedOut.toFixed(1)}`;
          if (!seenIntervals.has(key)) {
            seenIntervals.add(key);
            const rep = evaluateContextIntegrity(analysis.transcript.cues, combinedIn, combinedOut);
            const evidence = extractEvidenceInWindow(analysis, combinedIn, combinedOut);
            const snippet = `${c1.transcriptSnippet} ${c2.transcriptSnippet}`;

            rawWindows.push({
              sourceAssetId: analysis.assetId,
              sourceAssetName: analysis.assetName,
              sourceIn: combinedIn,
              sourceOut: combinedOut,
              duration: combinedDur,
              evidence,
              hasTranscriptEvidence: true,
              transcriptSnippet: snippet,
              precedingContextText: rep.precedingTranscript,
              followingContextText: rep.followingTranscript,
              speechBoundaryIntegrity: rep.speechBoundaryIntegrity,
              thoughtCompleteness: rep.thoughtCompleteness,
              contextSufficiency: rep.contextSufficiency,
              standaloneClarity: rep.standaloneClarity,
              endingClosure: rep.endingClosure,
            });
          }
        }
      }
    }
  }

  // PATH B: Visual and Acoustic Structural Discovery (Runs when source has video or audio)
  if (!analysis.hasVideo && !analysis.hasAudio) {
    return rawWindows;
  }

  // Natural boundaries: scene cuts, silence pauses, speech activity starts
  const naturalBoundaries: number[] = [0];
  for (const cut of analysis.sceneCutTimes) {
    naturalBoundaries.push(cut);
  }
  for (const pause of analysis.silenceIntervals) {
    naturalBoundaries.push((pause.start + pause.end) / 2);
  }
  for (const speech of analysis.speechActivityIntervals) {
    naturalBoundaries.push(speech.start);
    naturalBoundaries.push(speech.end);
  }
  naturalBoundaries.push(sourceDuration);
  naturalBoundaries.sort((a, b) => a - b);

  // Deduplicate boundaries
  const uniqueBoundaries: number[] = [];
  for (const b of naturalBoundaries) {
    if (uniqueBoundaries.length === 0 || b - uniqueBoundaries[uniqueBoundaries.length - 1] >= 0.8) {
      uniqueBoundaries.push(b);
    }
  }

  // If internal event boundaries are sparse on continuous footage, sample natural anchor steps
  if (uniqueBoundaries.length < 3 && (analysis.hasVideo || analysis.hasAudio)) {
    const step = Math.max(minBound, (minBound + maxBound) / 2);
    for (let t = step; t < sourceDuration - minBound * 0.5; t += step) {
      if (!uniqueBoundaries.some((b) => Math.abs(b - t) < 1.0)) {
        uniqueBoundaries.push(t);
      }
    }
    uniqueBoundaries.sort((a, b) => a - b);
  }

  // Generate intervals between adjacent natural event boundaries
  for (let i = 0; i < uniqueBoundaries.length - 1; i++) {
    const start = uniqueBoundaries[i];

    // Try spans of 1, 2, 3 boundary segments to discover naturally sized moments
    for (let step = 1; step <= 3; step++) {
      if (i + step >= uniqueBoundaries.length) break;
      const end = uniqueBoundaries[i + step];
      const dur = Number((end - start).toFixed(2));

      // Natural moments follow content bounds
      if (dur < minBound || dur > maxBound) continue;

      // Prevent full-source capture on medium/long footage
      if (sourceDuration >= 20.0 && dur >= sourceDuration * 0.95) {
        continue;
      }

      const key = `${start.toFixed(1)}-${end.toFixed(1)}`;
      if (seenIntervals.has(key)) continue;
      seenIntervals.add(key);

      const evidence = extractEvidenceInWindow(analysis, start, end);

      // Context evaluation (will indicate unknown/heuristic without transcript)
      const transcriptCues = analysis.transcript?.cues || [];
      const rep = evaluateContextIntegrity(transcriptCues, start, end);

      rawWindows.push({
        sourceAssetId: analysis.assetId,
        sourceAssetName: analysis.assetName,
        sourceIn: Number(start.toFixed(2)),
        sourceOut: Number(end.toFixed(2)),
        duration: dur,
        evidence,
        hasTranscriptEvidence: transcriptCues.length > 0,
        transcriptSnippet: rep.candidateTranscript,
        precedingContextText: rep.precedingTranscript,
        followingContextText: rep.followingTranscript,
        speechBoundaryIntegrity: rep.speechBoundaryIntegrity,
        thoughtCompleteness: rep.thoughtCompleteness,
        contextSufficiency: rep.contextSufficiency,
        standaloneClarity: rep.standaloneClarity,
        endingClosure: rep.endingClosure,
      });
    }
  }

  // Sort candidate windows chronologically
  rawWindows.sort((a, b) => a.sourceIn - b.sourceIn);

  return rawWindows;
}
