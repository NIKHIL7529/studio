/**
 * Type definitions for Content Studio Repurposing Workflow (Phase 7).
 *
 * Rules:
 * - 100% deterministic, local-first in-browser processing.
 * - Zero AI, zero LLMs, zero cloud APIs, zero transcription models.
 * - All types are JSON-serializable for cache persistence in projects/<id>/cache/repurpose/.
 * - Preserves exact source asset IDs and microsecond-accurate second timestamps.
 */

import type { ExportAspectRatio } from "./export.ts";

export type RepurposeObjective = "highlights" | "educational" | "podcast";

export interface RepurposeObjectiveDefinition {
  id: RepurposeObjective;
  label: string;
  description: string;
  heuristicsSummary: string;
  limitations: string;
}

export const REPURPOSE_OBJECTIVES: Record<RepurposeObjective, RepurposeObjectiveDefinition> = {
  highlights: {
    id: "highlights",
    label: "Highlights",
    description: "Discovers high-activity moments with prominent visual transitions and audio energy shifts.",
    heuristicsSummary: "Prioritizes scene-change candidate density, visual difference peaks, and audio energy transients.",
    limitations: "Measures only luminance/color shifts and acoustic loudness dynamics. Does not understand narrative importance, humor, or subject actions.",
  },
  educational: {
    id: "educational",
    label: "Educational",
    description: "Prefers sufficiently long, visually stable intervals with sustained pacing and clear boundary pauses.",
    heuristicsSummary: "Prioritizes speech-like audio activity, stable camera/visuals (low cut density), and boundaries aligned to speech pauses.",
    limitations: "Evaluates only audio envelope stability and scene pacing. Without transcripts, does not comprehend concepts, clarity, or spoken knowledge.",
  },
  podcast: {
    id: "podcast",
    label: "Podcast / Interview",
    description: "Prioritizes sustained speech activity regions and cuts cleanly at natural speech pauses.",
    heuristicsSummary: "Prioritizes continuous speech-like frequency/envelope activity, penalizes mid-speech truncation, and snaps to low-energy pauses.",
    limitations: "Identifies only acoustic speech-like energy patterns. Does not identify speakers, recognize dialogue, transcribe words, or follow conversational context.",
  },
};

export interface RepurposeConfig {
  objective: RepurposeObjective;
  targetClipCount: number;
  minClipDuration: number;
  maxClipDuration: number;
  targetAspectRatio: ExportAspectRatio;
  keywords: string[];
  selectedAssetIds: string[];
}

export interface FrameSampleSignal {
  /** Timestamp in seconds within source */
  timestamp: number;
  /** Normalized mean absolute luminance difference from preceding frame [0, 1] */
  luminanceDiff: number;
  /** Normalized color histogram distance from preceding frame [0, 1] */
  colorHistDiff: number;
  /** Combined visual difference metric [0, 1] */
  visualDiff: number;
  /** Whether this frame is flagged as a scene-change candidate */
  isSceneCutCandidate: boolean;
}

export interface AudioSampleSignal {
  /** Timestamp in seconds within source */
  timestamp: number;
  /** Short-time root-mean-square loudness [0, 1] */
  rms: number;
  /** Whether the window is classified as acoustic silence */
  isSilence: boolean;
  /** Whether the window satisfies measurable speech-activity heuristics */
  isSpeechLikeActivity: boolean;
  /** Sudden acoustic energy transition */
  isTransient: boolean;
}

export interface SourceAnalysisResult {
  assetId: string;
  assetName: string;
  fingerprint: string;
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  frameSignals: FrameSampleSignal[];
  audioSignals: AudioSampleSignal[];
  sceneCutTimes: number[];
  silenceIntervals: Array<{ start: number; end: number }>;
  speechActivityIntervals: Array<{ start: number; end: number }>;
  algorithmVersion: string;
  sampledAt: string;
}

export interface CandidateScoreBreakdown {
  signalStrength: number;
  durationFit: number;
  boundaryQuality: number;
  pacingOrContinuity: number;
  keywordBonus: number;
  penalty: number;
}

export interface CandidateEvidence {
  hasAudio: boolean;
  hasVideo: boolean;
  sceneCutCount: number;
  avgVisualDiff: number;
  peakVisualDiff: number;
  avgRms: number;
  speechActivityRatio: number;
  startsAtNaturalBoundary: boolean;
  endsAtNaturalBoundary: boolean;
  matchedKeywords?: string[];
}

export interface RepurposeCandidate {
  id: string;
  sourceAssetId: string;
  sourceAssetName: string;
  sourceIn: number;
  sourceOut: number;
  duration: number;
  objective: RepurposeObjective;
  score: number; // 0..100
  scoreBreakdown: CandidateScoreBreakdown;
  contributingEvidence: CandidateEvidence;
  explanation: string;
  selected: boolean;
  cacheKey: string;
}

export interface EditPlanSegment {
  id: string;
  sourceAssetId: string;
  sourceAssetName: string;
  sourceIn: number;
  sourceOut: number;
  duration: number;
  timelineStart: number;
  candidateId: string;
  explanation: string;
}

export interface EditPlan {
  id: string;
  projectId: string;
  objective: RepurposeObjective;
  createdAt: string;
  targetAspectRatio: ExportAspectRatio;
  segments: EditPlanSegment[];
  totalDuration: number;
  isValid: boolean;
  validationErrors: string[];
}

export type RepurposeStage =
  | "idle"
  | "validating"
  | "sampling-video"
  | "analyzing-audio"
  | "discovering"
  | "scoring"
  | "completed"
  | "error"
  | "cancelled";

export interface RepurposeProgress {
  stage: RepurposeStage;
  percent: number; // 0..100
  currentAssetIndex: number;
  totalAssets: number;
  currentAssetName: string;
  statusText: string;
}
