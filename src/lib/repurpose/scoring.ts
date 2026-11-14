/**
 * Deterministic scoring and ranking engine for candidate moments (Phase 7 & 8).
 *
 * Rules:
 * - 100% deterministic, explainable scoring across transparent dimensions.
 * - Compares user brief against actual transcript content and audio/visual evidence (NOT just filename!).
 * - Evaluates speech boundary integrity, thought completeness, and context sufficiency.
 * - Score normalized to [0, 100].
 * - Never fabricates quotes, topics, or claims.
 * - Without transcripts, honestly marks context completeness as unverified.
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
  briefRelevance: number;
  contextCompleteness: number;
}

export const OBJECTIVE_WEIGHTS: Record<RepurposeObjective, { withTranscript: ScoringWeights; withoutTranscript: ScoringWeights }> = {
  highlights: {
    withTranscript: {
      signalStrength: 0.30,
      durationFit: 0.15,
      boundaryQuality: 0.15,
      pacingOrContinuity: 0.10,
      briefRelevance: 0.15,
      contextCompleteness: 0.15,
    },
    withoutTranscript: {
      signalStrength: 0.50,
      durationFit: 0.20,
      boundaryQuality: 0.15,
      pacingOrContinuity: 0.10,
      briefRelevance: 0.05,
      contextCompleteness: 0.0,
    },
  },
  educational: {
    withTranscript: {
      signalStrength: 0.15,
      durationFit: 0.15,
      boundaryQuality: 0.15,
      pacingOrContinuity: 0.15,
      briefRelevance: 0.20,
      contextCompleteness: 0.20,
    },
    withoutTranscript: {
      signalStrength: 0.35,
      durationFit: 0.25,
      boundaryQuality: 0.25,
      pacingOrContinuity: 0.15,
      briefRelevance: 0.0,
      contextCompleteness: 0.0,
    },
  },
  podcast: {
    withTranscript: {
      signalStrength: 0.15,
      durationFit: 0.15,
      boundaryQuality: 0.15,
      pacingOrContinuity: 0.10,
      briefRelevance: 0.20,
      contextCompleteness: 0.25,
    },
    withoutTranscript: {
      signalStrength: 0.40,
      durationFit: 0.25,
      boundaryQuality: 0.25,
      pacingOrContinuity: 0.10,
      briefRelevance: 0.0,
      contextCompleteness: 0.0,
    },
  },
};

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "with", "by", "about",
  "against", "between", "into", "through", "during", "before", "after", "above", "below",
  "from", "up", "down", "is", "are", "was", "were", "be", "been", "being", "have", "has",
  "had", "do", "does", "did", "can", "could", "should", "would", "will", "shall", "i", "you",
  "he", "she", "it", "we", "they", "that", "this", "these", "those"
]);

/**
 * Extracts significant search tokens from user brief or keywords.
 */
export function extractKeywordsFromText(text: string): string[] {
  if (!text) return [];
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return Array.from(new Set(tokens));
}

/**
 * Compares candidate transcript and metadata against the user brief.
 */
export function evaluateBriefRelevance(
  userBrief: string | undefined,
  keywords: string[],
  transcriptSnippet: string | undefined,
  assetName: string
): { score: number; matchedWords: string[]; matchExplanation: string } {
  const briefTokens = [
    ...extractKeywordsFromText(userBrief || ""),
    ...keywords.flatMap((k) => extractKeywordsFromText(k)),
  ];

  if (briefTokens.length === 0) {
    return { score: 70, matchedWords: [], matchExplanation: "No specific brief or keywords supplied." };
  }

  const matched = new Set<string>();
  const normalizedSnippet = (transcriptSnippet || "").toLowerCase();
  const normalizedName = assetName.toLowerCase();

  for (const token of briefTokens) {
    if (normalizedSnippet && normalizedSnippet.includes(token)) {
      matched.add(token);
    } else if (normalizedName.includes(token)) {
      matched.add(token);
    }
  }

  const matchedWords = Array.from(matched);
  const matchRatio = matchedWords.length / Math.min(briefTokens.length, 6);
  const score = Math.min(100, Math.round(40 + matchRatio * 60));

  let matchExplanation = "";
  if (matchedWords.length > 0) {
    matchExplanation = `Matches brief topics: ${matchedWords.slice(0, 5).join(", ")}`;
  } else if (!transcriptSnippet) {
    matchExplanation = "No transcript available to verify brief relevance against spoken content.";
  } else {
    matchExplanation = "Spoken content does not directly mention key brief terms.";
  }

  return { score, matchedWords, matchExplanation };
}

/**
 * Checks literal keyword presence in asset name or transcript snippet (backwards-compatible helper).
 */
export function checkLiteralKeywords(
  assetName: string,
  keywords: string[],
  transcriptSnippet?: string
): { hasMatch: boolean; matched: string[]; matchedKeywords: string[] } {
  const evalResult = evaluateBriefRelevance(undefined, keywords, transcriptSnippet, assetName);
  return {
    hasMatch: evalResult.matchedWords.length > 0,
    matched: evalResult.matchedWords,
    matchedKeywords: evalResult.matchedWords,
  };
}

/**
 * Calculates duration fit score [0, 100] as a flexible objective.
 */
export function calculateDurationFit(
  duration: number,
  minClipDuration: number,
  maxClipDuration: number,
  _objective: RepurposeObjective
): number {
  void _objective;
  // Coherent moments between 3s and 60s are valid
  if (duration >= minClipDuration && duration <= maxClipDuration) {
    return 95;
  }
  // Soft boundary deviation curve
  if (duration < minClipDuration) {
    const diff = minClipDuration - duration;
    return Math.max(30, 95 - diff * 8);
  }
  const diff = duration - maxClipDuration;
  return Math.max(30, 95 - diff * 4);
}

/**
 * Generates an explainable description of why this candidate was chosen.
 */
export function generateCandidateExplanation(
  raw: RawCandidateWindow,
  objective: RepurposeObjective,
  score: number,
  briefMatchReason: string
): string {
  const parts: string[] = [];

  if (raw.hasTranscriptEvidence) {
    if (raw.thoughtCompleteness?.isSatisfied && raw.contextSufficiency?.isSatisfied) {
      parts.push("complete thought with clear context");
    } else if (raw.speechBoundaryIntegrity?.isSatisfied) {
      parts.push("sentence-bounded excerpt");
    }

    if (raw.contextExpansionApplied) {
      parts.push("expanded to include preceding setup");
    }
  } else {
    parts.push("visual/audio change only (no transcript available)");
  }

  if (!raw.evidence.hasAudio) {
    parts.push("video-only source without audio");
  } else if (objective === "podcast") {
    parts.push("speech activity and natural pause alignment");
  } else if (objective === "educational") {
    parts.push("explanation pacing and visual stability");
  } else if (objective === "highlights") {
    parts.push("visual motion dynamics");
  }

  if (raw.evidence.hasVideo && raw.evidence.sceneCutCount > 0) {
    parts.push(`${raw.evidence.sceneCutCount} scene change${raw.evidence.sceneCutCount > 1 ? "s" : ""}`);
  }

  if (briefMatchReason && !briefMatchReason.startsWith("No specific")) {
    parts.push(briefMatchReason);
  }

  parts.push(`duration ${raw.duration.toFixed(1)}s`);

  return parts.join("; ") + ".";
}

/**
 * Scores and ranks candidate windows deterministically.
 */
export function scoreAndRankCandidates(
  rawWindows: RawCandidateWindow[],
  config: RepurposeConfig,
  cacheKeyPrefix: string
): RepurposeCandidate[] {
  const { objective, minClipDuration, maxClipDuration, keywords, userBrief } = config;

  const candidates: RepurposeCandidate[] = [];

  for (let i = 0; i < rawWindows.length; i++) {
    const raw = rawWindows[i];
    const { evidence, duration } = raw;
    const hasTranscript = !!raw.hasTranscriptEvidence;
    const weightsConfig = hasTranscript
      ? OBJECTIVE_WEIGHTS[objective].withTranscript
      : OBJECTIVE_WEIGHTS[objective].withoutTranscript;

    // 1. Brief relevance (compares user brief with spoken transcript and metadata)
    const briefEval = evaluateBriefRelevance(userBrief, keywords, raw.transcriptSnippet, raw.sourceAssetName);
    const briefRelevance = briefEval.score;

    // 2. Context completeness (only if transcript available)
    let contextCompleteness = 50;
    if (hasTranscript) {
      const boundary = raw.speechBoundaryIntegrity?.score || 50;
      const thought = raw.thoughtCompleteness?.score || 50;
      const sufficiency = raw.contextSufficiency?.score || 50;
      const clarity = raw.standaloneClarity?.score || 50;
      const closure = raw.endingClosure?.score || 50;
      contextCompleteness = Math.round(
        boundary * 0.2 + thought * 0.25 + sufficiency * 0.25 + clarity * 0.15 + closure * 0.15
      );
    }

    // 3. Duration fit (soft target)
    const durationFit = calculateDurationFit(duration, minClipDuration, maxClipDuration, objective);

    // 4. Boundary quality
    let boundaryQuality = 40;
    if (raw.evidence.startsAtNaturalBoundary) boundaryQuality += 30;
    if (raw.evidence.endsAtNaturalBoundary) boundaryQuality += 30;

    // 5. Signal strength
    let signalStrength = 50;
    if (objective === "highlights") {
      const cutBonus = Math.min(40, evidence.sceneCutCount * 18);
      const visualBonus = Math.min(30, evidence.avgVisualDiff * 100);
      const audioBonus = evidence.hasAudio ? Math.min(30, evidence.avgRms * 150) : 15;
      signalStrength = Math.min(100, cutBonus + visualBonus + audioBonus);
    } else if (objective === "educational") {
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

    // 6. Pacing or continuity
    let pacingOrContinuity = 70;
    if (evidence.hasAudio && evidence.avgRms < 0.02) {
      pacingOrContinuity -= 30;
    }
    if (evidence.sceneCutCount > 5 && objective !== "highlights") {
      pacingOrContinuity -= 25;
    }

    // Keyword bonus
    const keywordBonus = briefEval.matchedWords.length > 0 ? 8 : 0;

    // Weighted aggregate score
    const rawScore =
      weightsConfig.signalStrength * signalStrength +
      weightsConfig.durationFit * durationFit +
      weightsConfig.boundaryQuality * boundaryQuality +
      weightsConfig.pacingOrContinuity * pacingOrContinuity +
      weightsConfig.briefRelevance * briefRelevance +
      weightsConfig.contextCompleteness * contextCompleteness +
      keywordBonus;

    const normalizedScore = Number(Math.max(0, Math.min(100, rawScore)).toFixed(1));

    const breakdown: CandidateScoreBreakdown = {
      signalStrength: Number(signalStrength.toFixed(1)),
      durationFit: Number(durationFit.toFixed(1)),
      boundaryQuality: Number(boundaryQuality.toFixed(1)),
      pacingOrContinuity: Number(pacingOrContinuity.toFixed(1)),
      keywordBonus,
      briefRelevance: Number(briefRelevance.toFixed(1)),
      contextCompleteness: Number(contextCompleteness.toFixed(1)),
      penalty: 0,
    };

    const explanation = generateCandidateExplanation(raw, objective, normalizedScore, briefEval.matchExplanation);

    const candId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `cand-${raw.sourceAssetId}-${i + 1}`;

    const cacheKey = `${cacheKeyPrefix}_${raw.sourceAssetId}_${raw.sourceIn}_${raw.sourceOut}`;

    candidates.push({
      id: candId,
      sourceAssetId: raw.sourceAssetId,
      sourceAssetName: raw.sourceAssetName,
      sourceIn: raw.sourceIn,
      sourceOut: raw.sourceOut,
      duration: raw.duration,
      objective,
      score: normalizedScore,
      scoreBreakdown: breakdown,
      contributingEvidence: {
        ...raw.evidence,
        matchedKeywords: briefEval.matchedWords,
        briefMatchReason: briefEval.matchExplanation,
      },
      explanation,
      selected: false,
      cacheKey,
      hasTranscriptEvidence: raw.hasTranscriptEvidence,
      transcriptSnippet: raw.transcriptSnippet,
      precedingContextText: raw.precedingContextText,
      followingContextText: raw.followingContextText,
      speechBoundaryIntegrity: raw.speechBoundaryIntegrity,
      thoughtCompleteness: raw.thoughtCompleteness,
      contextSufficiency: raw.contextSufficiency,
      standaloneClarity: raw.standaloneClarity,
      endingClosure: raw.endingClosure,
      contextExpansionApplied: raw.contextExpansionApplied,
    });
  }

  // Sort candidates by score descending
  candidates.sort((a, b) => b.score - a.score);

  return candidates;
}
