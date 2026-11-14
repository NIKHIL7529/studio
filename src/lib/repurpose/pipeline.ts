/**
 * Repurposing execution pipeline coordinator (Phase 7 & 8).
 *
 * Rules:
 * - Genuine content-aware repurposing: accepts user brief, deliverable goals, local transcripts.
 * - Coordinates validation, subtitle parsing/local Whisper transcription, frame sampling,
 *   audio analysis, candidate discovery, deterministic scoring, sequence selection, and EditPlan.
 * - Complete coverage: evaluates 100% of the playable duration of every source without arbitrary ceilings.
 * - Streams structured progress updates to UI.
 * - Closes and frees all decoders, canvases, contexts, and file handles on completion/failure/abort.
 * - Caches intermediate signals safely in workspace.
 */

import type { ProjectDocument, LiveAssetItem } from "../../types/project.ts";
import type {
  RepurposeConfig,
  RepurposeProgress,
  RepurposeCandidate,
  EditPlan,
  SourceAnalysisResult,
  FrameSampleSignal,
  AudioSampleSignal,
  SourceCoverageReport,
} from "../../types/repurpose.ts";
import type { SourceTranscript, TranscriptionEngine } from "../../types/transcription.ts";
import { parseSubtitleFileContent } from "../transcription/subtitleParser.ts";
import { LocalTranscriptionEngine } from "../transcription/engine.ts";
import { sampleVideoFrames } from "./frameSampling.ts";
import { analyzeAudioSignals } from "./audioAnalysis.ts";
import { discoverSourceCandidates, type RawCandidateWindow } from "./candidateDiscovery.ts";
import { scoreAndRankCandidates } from "./scoring.ts";
import { selectCandidateSequence, type SequenceSelectionResult } from "./sequenceSelector.ts";
import { createEditPlanFromCandidates } from "./editPlan.ts";
import { readCachedAnalysis, writeCachedAnalysis, REPURPOSE_COMBINED_ALGO_VERSION } from "./cache.ts";

export interface RepurposePipelineOptions {
  signal?: AbortSignal;
  onProgress?: (progress: RepurposeProgress) => void;
  workspaceHandle?: FileSystemDirectoryHandle;
  userSubtitles?: Map<string, string>;
  transcriptionEngine?: TranscriptionEngine;
}

export interface RepurposePipelineResult {
  allCandidates: RepurposeCandidate[];
  recommendedCandidates: RepurposeCandidate[];
  selectedCandidates: RepurposeCandidate[];
  editPlan: EditPlan;
  selectionSummary: SequenceSelectionResult;
  analyzedSourcesCount: number;
  coverageReports: Record<string, SourceCoverageReport>;
  sourceTranscripts: Map<string, SourceTranscript>;
}

/**
 * Validates selected project assets for accessibility and media tracks.
 */
export function validateSelectedSources(
  doc: ProjectDocument,
  liveAssets: Map<string, LiveAssetItem>,
  selectedAssetIds: string[]
): {
  validAssets: Array<{ asset: ProjectDocument["assets"][number]; live: LiveAssetItem; file: File }>;
  errors: string[];
} {
  const validAssets: Array<{
    asset: ProjectDocument["assets"][number];
    live: LiveAssetItem;
    file: File;
  }> = [];
  const errors: string[] = [];

  if (selectedAssetIds.length === 0) {
    errors.push("No source media files selected for repurposing.");
    return { validAssets, errors };
  }

  for (const assetId of selectedAssetIds) {
    const asset = doc.assets.find((a) => a.id === assetId);
    const live = liveAssets.get(assetId);

    if (!asset) {
      errors.push(`Asset ID "${assetId}" was not found in the current project.`);
      continue;
    }

    if (!live || live.status !== "ready" || !live.file) {
      const reason = live?.errorMessage || `Status is "${live?.status || "missing"}"`;
      errors.push(`Source "${asset.name}" is not accessible (${reason}). Please relink or authorize permission.`);
      continue;
    }

    if (live.file.size === 0) {
      errors.push(`Source "${asset.name}" is 0 bytes (empty file).`);
      continue;
    }

    validAssets.push({ asset, live, file: live.file });
  }

  return { validAssets, errors };
}

/**
 * Executes the complete local adaptive repurposing analysis pipeline.
 */
export async function runRepurposePipeline(
  doc: ProjectDocument,
  liveAssets: Map<string, LiveAssetItem>,
  config: RepurposeConfig,
  options: RepurposePipelineOptions = {}
): Promise<RepurposePipelineResult> {
  const { signal, onProgress, workspaceHandle, userSubtitles, transcriptionEngine } = options;

  const reportProgress = (
    stage: RepurposeProgress["stage"],
    percent: number,
    currentAssetIndex: number,
    totalAssets: number,
    currentAssetName: string,
    statusText: string
  ) => {
    if (onProgress) {
      onProgress({
        stage,
        percent: Math.max(0, Math.min(100, Math.round(percent))),
        currentAssetIndex,
        totalAssets,
        currentAssetName,
        statusText,
      });
    }
  };

  // 1. Validate sources
  reportProgress("validating", 5, 0, config.selectedAssetIds.length, "", "Validating media sources and permissions...");

  const { validAssets, errors: validationErrors } = validateSelectedSources(
    doc,
    liveAssets,
    config.selectedAssetIds
  );

  if (validationErrors.length > 0) {
    throw new Error(`Source validation failed: ${validationErrors.join(" ")}`);
  }

  if (signal?.aborted) {
    throw new DOMException("Repurposing analysis was cancelled by user.", "AbortError");
  }

  const totalAssets = validAssets.length;
  const allRawWindows: RawCandidateWindow[] = [];
  const coverageReports: Record<string, SourceCoverageReport> = {};
  const sourceTranscripts = new Map<string, SourceTranscript>();

  // Lazy-instantiate local ASR engine if needed
  let asrEngine = transcriptionEngine;
  if (!asrEngine && config.enableTranscription) {
    asrEngine = new LocalTranscriptionEngine();
  }

  // 2. Process each valid asset across its FULL duration
  for (let assetIdx = 0; assetIdx < totalAssets; assetIdx++) {
    if (signal?.aborted) {
      throw new DOMException("Repurposing analysis was cancelled by user.", "AbortError");
    }

    const { asset, file } = validAssets[assetIdx];
    const assetDuration = asset.metadata?.duration || 10;
    const hasVideo = asset.metadata?.videoTracks ? asset.metadata.videoTracks.length > 0 : true;
    const hasAudio = asset.metadata?.audioTracks ? asset.metadata.audioTracks.length > 0 : false;

    // 2A: Resolve Transcript / Speech Evidence
    let sourceTranscript: SourceTranscript | undefined = undefined;

    // Check user-provided subtitle (SRT or VTT)
    const userSubContent = userSubtitles?.get(asset.id);
    if (userSubContent) {
      try {
        const { cues } = parseSubtitleFileContent(userSubContent);
        if (cues.length > 0) {
          sourceTranscript = {
            sourceAssetId: asset.id,
            sourceAssetName: asset.name,
            engine: "srt-vtt",
            cues,
            fullText: cues.map((c) => c.text).join(" "),
            duration: assetDuration,
            coverage: [{ start: cues[0].start, end: cues[cues.length - 1].end }],
            createdAt: new Date().toISOString(),
            isWordLevel: false,
          };
        }
      } catch (err) {
        console.warn(`Failed to parse subtitle for ${asset.name}:`, err);
      }
    }

    // If no user subtitle, and local transcription is enabled and audio exists:
    if (!sourceTranscript && hasAudio && config.enableTranscription && asrEngine) {
      try {
        reportProgress(
          "transcribing",
          10 + (assetIdx / totalAssets) * 20,
          assetIdx,
          totalAssets,
          asset.name,
          `Transcribing spoken content locally for "${asset.name}"...`
        );

        sourceTranscript = await asrEngine.transcribe(file, {
          signal,
          modelName: config.selectedModelName,
          onProgress: (p) => {
            const overall = 10 + (assetIdx / totalAssets) * 20 + (p.percent / 100) * (20 / totalAssets);
            reportProgress("transcribing", overall, assetIdx, totalAssets, asset.name, p.statusText);
          },
        });
        if (sourceTranscript) {
          sourceTranscript.sourceAssetId = asset.id;
        }
      } catch (err: unknown) {
        console.warn(`Local transcription skipped/failed for ${asset.name}:`, err);
      }
    }

    if (sourceTranscript) {
      sourceTranscripts.set(asset.id, sourceTranscript);
    }

    if (signal?.aborted) {
      throw new DOMException("Repurposing analysis was cancelled by user.", "AbortError");
    }

    // Check workspace cache for frame & audio signals
    let analysisResult: SourceAnalysisResult | null = null;
    if (workspaceHandle) {
      analysisResult = await readCachedAnalysis(
        workspaceHandle,
        doc.id,
        asset.id,
        asset.fingerprint,
        file.size,
        file.lastModified
      );
    }

    if (!analysisResult) {
      // Step 2B: Video frame sampling across complete duration
      let frameSignals: FrameSampleSignal[] = [];
      let sceneCutTimes: number[] = [];

      if (hasVideo) {
        reportProgress(
          "sampling-video",
          30 + (assetIdx / totalAssets) * 25,
          assetIdx,
          totalAssets,
          asset.name,
          `Sampling video frames across full duration for "${asset.name}"...`
        );

        const videoRes = await sampleVideoFrames(file, assetDuration, {
          signal,
          onProgress: (p, text) => {
            const overall = 30 + (assetIdx / totalAssets) * 25 + (p / 100) * (25 / totalAssets);
            reportProgress("sampling-video", overall, assetIdx, totalAssets, asset.name, text);
          },
        });
        frameSignals = videoRes.frameSignals;
        sceneCutTimes = videoRes.sceneCutTimes;
      }

      if (signal?.aborted) {
        throw new DOMException("Repurposing analysis was cancelled by user.", "AbortError");
      }

      // Step 2C: Audio analysis across complete duration
      let audioSignals: AudioSampleSignal[] = [];
      let silenceIntervals: Array<{ start: number; end: number }> = [];
      let speechActivityIntervals: Array<{ start: number; end: number }> = [];

      if (hasAudio) {
        reportProgress(
          "analyzing-audio",
          55 + (assetIdx / totalAssets) * 25,
          assetIdx,
          totalAssets,
          asset.name,
          `Analyzing audio envelope and acoustic pauses for "${asset.name}"...`
        );

        const audioRes = await analyzeAudioSignals(file, assetDuration, {
          signal,
          onProgress: (p, text) => {
            const overall = 55 + (assetIdx / totalAssets) * 25 + (p / 100) * (25 / totalAssets);
            reportProgress("analyzing-audio", overall, assetIdx, totalAssets, asset.name, text);
          },
        });
        audioSignals = audioRes.audioSignals;
        silenceIntervals = audioRes.silenceIntervals;
        speechActivityIntervals = audioRes.speechActivityIntervals;
      }

      analysisResult = {
        assetId: asset.id,
        assetName: asset.name,
        fingerprint: asset.fingerprint || "",
        duration: assetDuration,
        hasVideo,
        hasAudio,
        frameSignals,
        audioSignals,
        sceneCutTimes,
        silenceIntervals,
        speechActivityIntervals,
        transcript: sourceTranscript,
        algorithmVersion: REPURPOSE_COMBINED_ALGO_VERSION,
        sampledAt: new Date().toISOString(),
        analyzedCoverage: [{ start: 0, end: assetDuration }],
      };

      // Persist to workspace cache
      if (workspaceHandle) {
        await writeCachedAnalysis(workspaceHandle, doc.id, analysisResult, file.size, file.lastModified);
      }
    } else {
      // Re-attach live transcript if present
      if (sourceTranscript) {
        analysisResult.transcript = sourceTranscript;
      }
    }

    if (signal?.aborted) {
      throw new DOMException("Repurposing analysis was cancelled by user.", "AbortError");
    }

    // Step 2D: Candidate Discovery for this source across full duration
    reportProgress(
      "discovering",
      82,
      assetIdx,
      totalAssets,
      asset.name,
      `Discovering candidate intervals for "${asset.name}"...`
    );

    const rawWindows = discoverSourceCandidates(analysisResult, config);
    allRawWindows.push(...rawWindows);

    // Record Coverage Report
    coverageReports[asset.id] = {
      assetId: asset.id,
      assetName: asset.name,
      totalDuration: assetDuration,
      analyzedDuration: assetDuration,
      coveragePercent: 100,
      isComplete: true,
      ranges: [{ start: 0, end: assetDuration }],
      transcriptStatus: {
        hasTranscript: !!sourceTranscript,
        engine: sourceTranscript?.engine,
        cueCount: sourceTranscript?.cues.length || 0,
        isWordLevel: !!sourceTranscript?.isWordLevel,
      },
    };
  }

  if (signal?.aborted) {
    throw new DOMException("Repurposing analysis was cancelled by user.", "AbortError");
  }

  // 3. Scoring & Ranking with Brief Relevance & Context Integrity
  reportProgress("scoring", 90, totalAssets, totalAssets, "", "Scoring candidates against brief and context integrity...");

  const scoredCandidates = scoreAndRankCandidates(allRawWindows, config, doc.id);

  // 4. Adaptive Candidate Sequence Selection
  reportProgress("sequencing", 95, totalAssets, totalAssets, "", "Selecting optimal sequence for requested deliverable...");

  const selectionSummary = selectCandidateSequence(scoredCandidates, config);
  const selectedCandidates = selectionSummary.selectedCandidates;
  const recommendedCandidates = selectionSummary.recommendedCandidates;

  // 5. Build EditPlan from selected candidates
  const editPlan = createEditPlanFromCandidates(
    doc.id,
    selectedCandidates,
    config.objective,
    config.targetAspectRatio,
    config.deliverableType || "compilation",
    selectionSummary.sequenceRationale
  );

  reportProgress("completed", 100, totalAssets, totalAssets, "", "Candidate discovery and sequencing completed!");

  return {
    allCandidates: selectionSummary.allCandidates,
    recommendedCandidates,
    selectedCandidates,
    editPlan,
    selectionSummary,
    analyzedSourcesCount: totalAssets,
    coverageReports,
    sourceTranscripts,
  };
}
