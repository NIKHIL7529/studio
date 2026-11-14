/**
 * Deterministic scoring and ranking engine for candidate moments (Phase 7).
 *
 * Rules:
 * - 100% deterministic, transparent scoring. No random or black-box rankings.
 * - Clear objective-specific weights and thresholds.
 * - Score is normalized to [0, 100].
 * - Missing evidence is not penalized when the track does not exist (e.g. video-only file).
 * - Keyword matching is strictly literal against local project/asset metadata only,
 *   with an explicit factual note that no transcripts are searched.
 * - Does not claim semantic comprehension or objective quality.
 */

import type {
  RepurposeObjective,
  RepurposeConfig,
  RepurposeCandidate,
  CandidateScoreBreakdown,
} from "../../types/repurpose.ts";
import type { RawCandidateWindow } from "./candidateDiscovery.ts";

export interface ScoringWeights {
  signalStrength: number;
  durationFit: number;
  boundaryQuality: number;
  pacingOrContinuity: number;
}

export const OBJECTIVE_WEIGHTS: Record<RepurposeObjective, { withAudio: ScoringWeights; withoutAudio: ScoringWeights }> = {
  highlights: {
    withAudio: {
      signalStrength: 0.40, // Visual scene cuts + audio energy transients
      durationFit: 0.20,
      boundaryQuality: 0.20,
      pacingOrContinuity: 0.20,
    },
    withoutAudio: {
      signalStrength: 0.55, // Visual scene cuts & visual dynamics carry primary weight
      durationFit: 0.25,
      boundaryQuality: 0.20,
      pacingOrContinuity: 0.0,
    },
  },
  educational: {
    withAudio: {
      signalStrength: 0.25, // Moderate audio, controlled visuals
      durationFit: 0.25, // Prefers longer clips for complete explanations
      boundaryQuality: 0.25, // Natural pause boundaries
      pacingOrContinuity: 0.25, // Stable pacing without chaotic rapid cuts
    },
    withoutAudio: {
      signalStrength: 0.35,
      durationFit: 0.35,
      boundaryQuality: 0.30,
      pacingOrContinuity: 0.0,
    },
  },
  podcast: {
    withAudio: {
      signalStrength: 0.40, // High speech-activity ratio
      durationFit: 0.20,
      boundaryQuality: 0.30, // Strict alignment to speech pauses
      pacingOrContinuity: 0.10,
    },
    withoutAudio: {
      signalStrength: 0.45,
      durationFit: 0.30,
      boundaryQuality: 0.25,
      pacingOrContinuity: 0.0,
    },
  },
};

/**
 * Calculates duration fit score [0, 100].
 */
export function calculateDurationFit(
  duration: number,
  minClipDuration: number,
  maxClipDuration: number,
  objective: RepurposeObjective
): number {
  if (duration < minClipDuration || duration > maxClipDuration) {
    // Penalty for slight snapping boundary bleed
    const deviation = duration < minClipDuration ? minClipDuration - duration : duration - maxClipDuration;
    return Math.max(10, 100 - (deviation / Math.max(1, minClipDuration)) * 100);
  }

  // Ideal target duration within the allowed range
  let idealRatio = 0.5;
  if (objective === "highlights") {
    idealRatio = 0.35; // Snappy
  } else if (objective === "educational") {
    idealRatio = 0.75; // Longer, context-rich
  }

  const idealDuration = minClipDuration + idealRatio * (maxClipDuration - minClipDuration);
  const diff = Math.abs(duration - idealDuration);
  const maxDiff = Math.max(1, (maxClipDuration - minClipDuration) / 2);

  return Math.max(30, 100 - (diff / maxDiff) * 50);
}

/**
 * Checks literal keyword matches against asset metadata.
 */
export function checkLiteralKeywords(
  assetName: string,
  keywords: string[]
): { matched: string[]; hasMatch: boolean } {
  if (!keywords || keywords.length === 0) {
    return { matched: [], hasMatch: false };
  }

  const normalizedName = assetName.toLowerCase();
  const matched: string[] = [];

  for (const kw of keywords) {
    const trimmed = kw.trim().toLowerCase();
    if (trimmed.length > 0 && normalizedName.includes(trimmed)) {
      matched.push(kw.trim());
    }
  }

  return { matched, hasMatch: matched.length > 0 };
}

/**
 * Generates a concise, transparent factual explanation of candidate scoring.
 */
export function generateCandidateExplanation(
  raw: RawCandidateWindow,
  objective: RepurposeObjective,
  score: number,
  matchedKeywords: string[],
  keywordGuidanceProvided: boolean
): string {
  const { evidence, duration } = raw;
  const parts: string[] = [];

  if (evidence.hasAudio) {
    if (objective === "podcast") {
      parts.push(`${Math.round(evidence.speechActivityRatio * 100)}% speech activity`);
      if (evidence.startsAtNaturalBoundary && evidence.endsAtNaturalBoundary) {
        parts.push("clean boundary alignment at speech pauses");
      } else if (evidence.endsAtNaturalBoundary) {
        parts.push("ends at natural pause");
      }
    } else if (objective === "educational") {
      parts.push("stable explanation pacing");
      if (evidence.startsAtNaturalBoundary || evidence.endsAtNaturalBoundary) {
        parts.push("bounded by natural pauses");
      }
    } else {
      // Highlights
      if (evidence.avgRms > 0.1) {
        parts.push(`elevated audio energy (RMS: ${evidence.avgRms.toFixed(2)})`);
      }
    }
  } else {
    parts.push("video-only source (audio unavailable)");
  }

  if (evidence.hasVideo) {
    if (evidence.sceneCutCount > 0) {
      parts.push(`${evidence.sceneCutCount} scene-change candidate${evidence.sceneCutCount > 1 ? "s" : ""}`);
    } else if (objective === "educational") {
      parts.push("continuous visual stability");
    }
  }

  parts.push(`duration ${duration.toFixed(1)}s`);

  if (matchedKeywords.length > 0) {
    parts.push(`source filename matches keyword '${matchedKeywords.join(", ")}'`);
  } else if (keywordGuidanceProvided) {
    parts.push("keyword guidance not applied (no transcript search; filename did not match)");
  }

  return parts.join("; ") + ".";
}

/**
 * Scores and ranks a list of discovered raw candidate windows.
 */
export function scoreAndRankCandidates(
  rawWindows: RawCandidateWindow[],
  config: RepurposeConfig,
  cacheKeyPrefix: string
): RepurposeCandidate[] {
  const { objective, minClipDuration, maxClipDuration, keywords } = config;
  const weightsConfig = OBJECTIVE_WEIGHTS[objective];

  const candidates: RepurposeCandidate[] = [];

  for (let i = 0; i < rawWindows.length; i++) {
    const raw = rawWindows[i];
    const { evidence, duration } = raw;
    const weights = evidence.hasAudio ? weightsConfig.withAudio : weightsConfig.withoutAudio;

    // 1. Duration fit (0..100)
    const durationFit = calculateDurationFit(duration, minClipDuration, maxClipDuration, objective);

    // 2. Boundary quality (0..100)
    let boundaryQuality = 40;
    if (raw.evidence.startsAtNaturalBoundary) boundaryQuality += 30;
    if (raw.evidence.endsAtNaturalBoundary) boundaryQuality += 30;

    // 3. Signal strength (0..100)
    let signalStrength = 50;
    if (objective === "highlights") {
      const cutBonus = Math.min(40, evidence.sceneCutCount * 18);
      const visualBonus = Math.min(30, evidence.avgVisualDiff * 100);
      const audioBonus = evidence.hasAudio ? Math.min(30, evidence.avgRms * 150) : 15;
      signalStrength = Math.min(100, cutBonus + visualBonus + audioBonus);
    } else if (objective === "educational") {
      // Reward moderate speech ratio (50-85%), penalize extreme rapid cuts (>3 cuts in 15s)
      const speechScore = evidence.hasAudio
        ? Math.max(30, 100 - Math.abs(evidence.speechActivityRatio - 0.70) * 120)
        : 60;
      const visualStabilityScore = Math.max(20, 100 - Math.max(0, evidence.sceneCutCount - 2) * 25);
      signalStrength = Math.min(100, 0.6 * speechScore + 0.4 * visualStabilityScore);
    } else {
      // Podcast / Interview
      const speechRatioScore = evidence.hasAudio ? Math.min(100, evidence.speechActivityRatio * 125) : 50;
      signalStrength = speechRatioScore;
    }

    // 4. Pacing or continuity (0..100)
    let pacingOrContinuity = 70;
    if (evidence.hasAudio) {
      if (evidence.avgRms < 0.02) {
        // Prolonged silence penalty
        pacingOrContinuity -= 35;
      }
    }
    if (evidence.sceneCutCount > 5) {
      // Excessive rapid cutting penalty for educational and podcast
      if (objective !== "highlights") {
        pacingOrContinuity -= 25;
      }
    }

    // 5. Keyword bonus (literal matching on metadata only)
    const keywordCheck = checkLiteralKeywords(raw.sourceAssetName, keywords);
    const keywordBonus = keywordCheck.hasMatch ? 8 : 0;

    // 6. Penalties
    let penalty = 0;
    if (duration < minClipDuration * 0.9) penalty += 20;
    if (duration > maxClipDuration * 1.1) penalty += 20;

    // Weighted aggregate score
    const rawScore =
      weights.signalStrength * signalStrength +
      weights.durationFit * durationFit +
      weights.boundaryQuality * boundaryQuality +
      weights.pacingOrContinuity * pacingOrContinuity +
      keywordBonus -
      penalty;

    const finalScore = Number(Math.max(0, Math.min(100, rawScore)).toFixed(1));

    const breakdown: CandidateScoreBreakdown = {
      signalStrength: Number(signalStrength.toFixed(1)),
      durationFit: Number(durationFit.toFixed(1)),
      boundaryQuality: Number(boundaryQuality.toFixed(1)),
      pacingOrContinuity: Number(pacingOrContinuity.toFixed(1)),
      keywordBonus,
      penalty,
    };

    const explanation = generateCandidateExplanation(
      raw,
      objective,
      finalScore,
      keywordCheck.matched,
      keywords.length > 0
    );

    const candidateId = `cand-${raw.sourceAssetId.slice(0, 8)}-${raw.sourceIn.toFixed(1)}-${raw.sourceOut.toFixed(1)}`;
    const cacheKey = `${cacheKeyPrefix}-${candidateId}`;

    candidates.push({
      id: candidateId,
      sourceAssetId: raw.sourceAssetId,
      sourceAssetName: raw.sourceAssetName,
      sourceIn: raw.sourceIn,
      sourceOut: raw.sourceOut,
      duration: raw.duration,
      objective,
      score: finalScore,
      scoreBreakdown: breakdown,
      contributingEvidence: {
        ...raw.evidence,
        matchedKeywords: keywordCheck.matched,
      },
      explanation,
      selected: false,
      cacheKey,
    });
  }

  // Sort descending by score
  candidates.sort((a, b) => b.score - a.score);

  return candidates;
}
