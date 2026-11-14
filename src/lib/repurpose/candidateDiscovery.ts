/**
 * Deterministic candidate window formation from media signals (Phase 7).
 *
 * Rules:
 * - Generates overlapping candidate intervals [sourceIn, sourceOut] anchored to real media events.
 * - Event anchors: likely scene boundaries, speech pauses, speech onset, and energy transients.
 * - Snaps candidate in/out boundaries to natural pauses or scene cuts when within snap tolerance.
 * - Accurately records contributing evidence for every window.
 * - Does NOT fabricate unavailable evidence: missing audio is marked hasAudio: false, NOT silence.
 * - Every candidate references exact source asset ID and exact floating-point timestamps.
 */

import type {
  SourceAnalysisResult,
  RepurposeConfig,
  CandidateEvidence,
} from "../../types/repurpose.ts";

export interface RawCandidateWindow {
  sourceAssetId: string;
  sourceAssetName: string;
  sourceIn: number;
  sourceOut: number;
  duration: number;
  evidence: CandidateEvidence;
}

export const BOUNDARY_SNAP_TOLERANCE = 1.5; // Seconds tolerance to snap window boundary to pause/cut

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
  // A boundary is natural if it coincides with (or is within 0.5s of) a scene cut or silence pause
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
 * Discovers candidate intervals for a single analyzed source.
 */
export function discoverSourceCandidates(
  analysis: SourceAnalysisResult,
  config: RepurposeConfig
): RawCandidateWindow[] {
  const { minClipDuration, maxClipDuration } = config;
  const sourceDuration = analysis.duration;

  if (sourceDuration < minClipDuration * 0.8) {
    return []; // Source too short to form even one valid candidate
  }

  // 1. Assemble natural anchor points
  const naturalBoundaries: number[] = [0];
  for (const cut of analysis.sceneCutTimes) {
    naturalBoundaries.push(cut);
  }
  for (const pause of analysis.silenceIntervals) {
    // Add midpoint of pause
    naturalBoundaries.push((pause.start + pause.end) / 2);
  }
  for (const speech of analysis.speechActivityIntervals) {
    naturalBoundaries.push(speech.start);
  }

  // Sort and deduplicate anchor times
  naturalBoundaries.sort((a, b) => a - b);
  const uniqueAnchors: number[] = [];
  for (const t of naturalBoundaries) {
    if (t < sourceDuration - minClipDuration * 0.5) {
      if (uniqueAnchors.length === 0 || t - uniqueAnchors[uniqueAnchors.length - 1] >= 1.0) {
        uniqueAnchors.push(t);
      }
    }
  }

  // If anchors are too sparse, inject regular grid points
  if (uniqueAnchors.length < 3) {
    const gridStep = Math.max(5, (minClipDuration + maxClipDuration) / 4);
    for (let t = 0; t < sourceDuration - minClipDuration; t += gridStep) {
      if (!uniqueAnchors.some((a) => Math.abs(a - t) < 1.0)) {
        uniqueAnchors.push(t);
      }
    }
    uniqueAnchors.sort((a, b) => a - b);
  }

  // 2. Candidate window generation with multiple target durations
  const candidateDurations: number[] = [
    minClipDuration,
    (minClipDuration + maxClipDuration) / 2,
    maxClipDuration,
  ];

  // Also include 1/3 and 2/3 durations if spread is wide
  if (maxClipDuration - minClipDuration >= 15) {
    candidateDurations.push(minClipDuration + (maxClipDuration - minClipDuration) * 0.25);
    candidateDurations.push(minClipDuration + (maxClipDuration - minClipDuration) * 0.75);
  }

  const rawWindows: RawCandidateWindow[] = [];
  const seenIntervals = new Set<string>();

  for (const anchor of uniqueAnchors) {
    for (const targetDur of candidateDurations) {
      let candidateStart = anchor;
      let candidateEnd = candidateStart + targetDur;

      if (candidateEnd > sourceDuration) {
        // If target extends beyond source end, attempt shifting start backwards or clamping
        candidateEnd = sourceDuration;
        candidateStart = Math.max(0, candidateEnd - targetDur);
      }

      // Snap end point to nearest natural boundary if available
      const snappedEnd = snapToNaturalBoundary(candidateEnd, naturalBoundaries);
      if (snappedEnd.snapped && snappedEnd.time <= sourceDuration && snappedEnd.time > candidateStart) {
        candidateEnd = snappedEnd.time;
      }

      // Also snap start point if near a boundary
      const snappedStart = snapToNaturalBoundary(candidateStart, naturalBoundaries);
      if (snappedStart.snapped && snappedStart.time < candidateEnd) {
        candidateStart = snappedStart.time;
      }

      const dur = candidateEnd - candidateStart;

      // Validate duration bounds (allowing ±10% tolerance for natural snapping)
      if (dur < minClipDuration * 0.85 || dur > maxClipDuration * 1.15 || dur <= 0) {
        continue;
      }

      // Deduplicate overlapping/identical windows on this source
      const key = `${candidateStart.toFixed(1)}-${candidateEnd.toFixed(1)}`;
      if (seenIntervals.has(key)) {
        continue;
      }
      seenIntervals.add(key);

      const evidence = extractEvidenceInWindow(analysis, candidateStart, candidateEnd);

      rawWindows.push({
        sourceAssetId: analysis.assetId,
        sourceAssetName: analysis.assetName,
        sourceIn: Number(candidateStart.toFixed(2)),
        sourceOut: Number(candidateEnd.toFixed(2)),
        duration: Number(dur.toFixed(2)),
        evidence,
      });
    }
  }

  return rawWindows;
}
