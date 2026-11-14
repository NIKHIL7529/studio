/**
 * Type definitions for Content Studio Repurposing Workflow.
 *
 * Rules:
 * - 100% local-first in-browser processing.
 * - Genuine content-aware repurposing: accepts user brief, deliverable goals, local transcripts.
 * - No arbitrary hard-coded limits: variable durations derived from sentences and thoughts.
 * - All types are JSON-serializable for cache persistence in projects/<id>/cache/repurpose/.
 * - Preserves exact source asset IDs and microsecond-accurate second timestamps.
 */

import type { ExportAspectRatio } from "./export.ts";
import type { ContextDimensionAssessment } from "../lib/repurpose/contextIntegrity.ts";
import type { SourceTranscript } from "./transcription.ts";

export type RepurposeObjective = "highlights" | "educational" | "podcast";

export type DeliverableType = "compilation" | "independent_clips";

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
    limitations: "Measures visual dynamics and acoustic loudness shifts. Pair with transcripts to verify spoken context and complete thoughts.",
  },
  educational: {
    id: "educational",
    label: "Educational",
    description: "Prefers sufficiently long, visually stable intervals with sustained pacing and clear boundary pauses.",
    heuristicsSummary: "Prioritizes speech activity, stable camera/visuals, and boundaries aligned to speech thoughts.",
    limitations: "Evaluates speech pacing and visual stability. Spoken clarity and complete concepts are verified when transcripts are provided.",
  },
  podcast: {
    id: "podcast",
    label: "Podcast / Interview",
    description: "Prioritizes sustained speech activity regions and cuts cleanly at natural speech pauses.",
    heuristicsSummary: "Prioritizes continuous speech activity, penalizes mid-speech truncation, and snaps to low-energy pauses.",
    limitations: "Identifies acoustic speech-like energy patterns. Word and sentence boundaries are verified using local transcription or imported subtitles.",
  },
};

export interface RepurposeConfig {
  objective: RepurposeObjective;
  /** Optional user brief: topic, angle, required ideas, tone */
  userBrief?: string;
  /** Type of output deliverable */
  deliverableType?: DeliverableType;
  /** Soft target total duration for compilation in seconds (optional) */
  targetDuration?: number;
  /** Optional target duration range */
  targetDurationRange?: { min: number; max: number };
  /** Preferred number of outputs/clips when specified by user */
  targetClipCount: number;
  /** Soft guidance bounds (not hard filters) */
  minClipDuration: number;
  maxClipDuration: number;
  targetAspectRatio: ExportAspectRatio;
  keywords: string[];
  selectedAssetIds: string[];
  /** Whether local offline transcription should be enabled if available */
  enableTranscription?: boolean;
  selectedModelName?: string;
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
  transcript?: SourceTranscript;
  algorithmVersion: string;
  sampledAt: string;
  analyzedCoverage?: Array<{ start: number; end: number }>;
}

export interface CandidateScoreBreakdown {
  signalStrength: number;
  durationFit: number;
  boundaryQuality: number;
  pacingOrContinuity: number;
  keywordBonus: number;
  briefRelevance?: number;
  contextCompleteness?: number;
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
  briefMatchReason?: string;
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

  // ── Context Integrity and Speech Dimensions ─────────────────────
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
  deliverableRationale?: string;
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
  captionText?: string;
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
  deliverableType?: DeliverableType;
  sequenceRationale?: string;
}

export interface RepurposeProgress {
  stage:
    | "validating"
    | "transcribing"
    | "sampling-video"
    | "analyzing-audio"
    | "discovering"
    | "scoring"
    | "sequencing"
    | "completed"
    | "error";
  percent: number;
  currentAssetIndex: number;
  totalAssets: number;
  currentAssetName: string;
  statusText: string;
}

export interface SourceCoverageReport {
  assetId: string;
  assetName: string;
  totalDuration: number;
  analyzedDuration: number;
  coveragePercent: number;
  isComplete: boolean;
  ranges: Array<{ start: number; end: number }>;
  skippedRanges?: Array<{ start: number; end: number; reason: string }>;
  transcriptStatus: {
    hasTranscript: boolean;
    engine?: string;
    cueCount: number;
    isWordLevel: boolean;
    errorMessage?: string;
  };
}
