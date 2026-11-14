/**
 * Repurposing execution pipeline coordinator (Phase 7).
 *
 * Rules:
 * - Coordinates validation, frame sampling, audio analysis, candidate discovery,
 *   deterministic scoring, sequence selection, and EditPlan generation.
 * - Streams structured progress updates to UI.
 * - Supports cancellation via AbortSignal at safe stage boundaries.
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
} from "../../types/repurpose.ts";
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
}

export interface RepurposePipelineResult {
  allCandidates: RepurposeCandidate[];
  selectedCandidates: RepurposeCandidate[];
  editPlan: EditPlan;
  selectionSummary: SequenceSelectionResult;
  analyzedSourcesCount: number;
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
 * Executes the complete local non-AI repurposing analysis pipeline.
 */
export async function runRepurposePipeline(
  doc: ProjectDocument,
  liveAssets: Map<string, LiveAssetItem>,
  config: RepurposeConfig,
  options: RepurposePipelineOptions = {}
): Promise<RepurposePipelineResult> {
  const { signal, onProgress, workspaceHandle } = options;

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

  // 2. Process each valid asset (Sampling -> Analysis -> Discovery)
  for (let assetIdx = 0; assetIdx < totalAssets; assetIdx++) {
    if (signal?.aborted) {
      throw new DOMException("Repurposing analysis was cancelled by user.", "AbortError");
    }

    const { asset, file } = validAssets[assetIdx];
    const assetDuration = asset.metadata?.duration || 10;
    const hasVideo = asset.metadata?.videoTracks ? asset.metadata.videoTracks.length > 0 : true;
    const hasAudio = asset.metadata?.audioTracks ? asset.metadata.audioTracks.length > 0 : false;

    // Check cache first
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
      // Step 2A: Video frame sampling (if video present)
      let frameSignals: FrameSampleSignal[] = [];
      let sceneCutTimes: number[] = [];

      if (hasVideo) {
        reportProgress(
          "sampling-video",
          10 + (assetIdx / totalAssets) * 35,
          assetIdx,
          totalAssets,
          asset.name,
          `Sampling video frames for "${asset.name}"...`
        );

        const videoRes = await sampleVideoFrames(file, assetDuration, {
          signal,
          onProgress: (p, text) => {
            const overall = 10 + (assetIdx / totalAssets) * 35 + (p / 100) * (35 / totalAssets);
            reportProgress("sampling-video", overall, assetIdx, totalAssets, asset.name, text);
          },
        });
        frameSignals = videoRes.frameSignals;
        sceneCutTimes = videoRes.sceneCutTimes;
      }

      if (signal?.aborted) {
        throw new DOMException("Repurposing analysis was cancelled by user.", "AbortError");
      }

      // Step 2B: Audio analysis (if audio present)
      let audioSignals: AudioSampleSignal[] = [];
      let silenceIntervals: Array<{ start: number; end: number }> = [];
      let speechActivityIntervals: Array<{ start: number; end: number }> = [];

      if (hasAudio) {
        reportProgress(
          "analyzing-audio",
          45 + (assetIdx / totalAssets) * 35,
          assetIdx,
          totalAssets,
          asset.name,
          `Analyzing audio signals for "${asset.name}"...`
        );

        const audioRes = await analyzeAudioSignals(file, assetDuration, {
          signal,
          onProgress: (p, text) => {
            const overall = 45 + (assetIdx / totalAssets) * 35 + (p / 100) * (35 / totalAssets);
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
        algorithmVersion: REPURPOSE_COMBINED_ALGO_VERSION,
        sampledAt: new Date().toISOString(),
      };

      // Persist to workspace cache
      if (workspaceHandle) {
        await writeCachedAnalysis(workspaceHandle, doc.id, analysisResult, file.size, file.lastModified);
      }
    }

    if (signal?.aborted) {
      throw new DOMException("Repurposing analysis was cancelled by user.", "AbortError");
    }

    // Step 2C: Candidate Discovery for this source
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
  }

  if (signal?.aborted) {
    throw new DOMException("Repurposing analysis was cancelled by user.", "AbortError");
  }

  // 3. Scoring & Ranking
  reportProgress("scoring", 90, totalAssets, totalAssets, "", "Scoring and ranking candidates deterministically...");

  const scoredCandidates = scoreAndRankCandidates(allRawWindows, config, doc.id);

  // 4. Candidate Sequence Selection
  const selectionSummary = selectCandidateSequence(scoredCandidates, config);
  const selectedCandidates = selectionSummary.selectedCandidates;

  // 5. Build EditPlan from selected candidates
  const editPlan = createEditPlanFromCandidates(
    doc.id,
    selectedCandidates,
    config.objective,
    config.targetAspectRatio
  );

  reportProgress("completed", 100, totalAssets, totalAssets, "", "Candidate discovery and sequencing completed!");

  return {
    allCandidates: selectionSummary.allCandidates,
    selectedCandidates,
    editPlan,
    selectionSummary,
    analyzedSourcesCount: totalAssets,
  };
}
