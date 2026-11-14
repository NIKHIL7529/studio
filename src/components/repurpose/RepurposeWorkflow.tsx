"use client";

/**
 * RepurposeWorkflow — Dedicated browser-local video repurposing interface (Phase 7).
 *
 * Rules:
 * - 100% deterministic, non-AI local processing in the user's browser.
 * - Allows selecting sources, choosing objective, setting bounds, and running local analysis.
 * - Displays transparent candidate moments with measurable signal explanations.
 * - Allows adjusting selected moments and opens the validated EDL directly as a timeline sequence.
 * - Persists repurposed sequence as a new project version using Phase 6 persistence.
 */

import * as React from "react";
import { useState, useRef } from "react";
import type { ProjectDocument, LiveAssetItem } from "../../types/project.ts";
import type { TimelineDocument } from "../../types/timeline.ts";
import type {
  RepurposeObjective,
  RepurposeConfig,
  RepurposeProgress,
  RepurposeCandidate,
} from "../../types/repurpose.ts";
import { REPURPOSE_OBJECTIVES } from "../../types/repurpose.ts";
import type { ExportAspectRatio } from "../../types/export.ts";
import { runRepurposePipeline } from "../../lib/repurpose/pipeline.ts";
import { applyEditPlanToTimeline, createEditPlanFromCandidates } from "../../lib/repurpose/editPlan.ts";
import { formatDuration } from "../../lib/media/inspector.ts";
import { formatBytes } from "../../lib/projectValidation.ts";
import { CandidateCard } from "./CandidateCard.tsx";
import { CandidatePreviewPlayer } from "./CandidatePreviewPlayer.tsx";
import {
  Button,
  Badge,
  Panel,
  PanelHeader,
  EmptyState,
} from "@/components/ui";

export interface RepurposeWorkflowProps {
  project: ProjectDocument;
  liveAssets: Map<string, LiveAssetItem>;
  workspaceHandle: FileSystemDirectoryHandle;
  currentTimeline?: TimelineDocument;
  onApplyTimelineSequence: (updatedTimeline: TimelineDocument, reason: string) => void;
  onCloseWorkflow: () => void;
}

export function RepurposeWorkflow({
  project,
  liveAssets,
  workspaceHandle,
  currentTimeline,
  onApplyTimelineSequence,
  onCloseWorkflow,
}: RepurposeWorkflowProps) {
  // Configuration State
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(() => {
    // Default to all accessible video assets
    return project.assets
      .filter((a) => {
        const live = liveAssets.get(a.id);
        return live?.status === "ready" && (a.mediaType === "video" || !a.mediaType);
      })
      .map((a) => a.id);
  });

  const [objective, setObjective] = useState<RepurposeObjective>("highlights");
  const [targetClipCount, setTargetClipCount] = useState(3);
  const [minClipDuration, setMinClipDuration] = useState(10);
  const [maxClipDuration, setMaxClipDuration] = useState(30);
  const [targetAspectRatio, setTargetAspectRatio] = useState<ExportAspectRatio>("9:16");
  const [keywordsText, setKeywordsText] = useState("");

  // Pipeline Execution State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<RepurposeProgress | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Results State
  const [hasResults, setHasResults] = useState(false);
  const [candidates, setCandidates] = useState<RepurposeCandidate[]>([]);
  const [selectionShortageNote, setSelectionShortageNote] = useState<string | null>(null);
  const [previewingCandidate, setPreviewingCandidate] = useState<RepurposeCandidate | null>(null);

  // Toggle asset selection in config
  const toggleAssetSelection = (assetId: string) => {
    setSelectedAssetIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]
    );
  };

  // Run Local Analysis
  const handleStartAnalysis = async () => {
    if (selectedAssetIds.length === 0) {
      setAnalysisError("Please select at least one source video to analyze.");
      return;
    }
    if (minClipDuration <= 0 || maxClipDuration <= minClipDuration) {
      setAnalysisError("Minimum clip duration must be greater than 0 and less than maximum duration.");
      return;
    }

    const keywords = keywordsText
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    const config: RepurposeConfig = {
      objective,
      targetClipCount,
      minClipDuration,
      maxClipDuration,
      targetAspectRatio,
      keywords,
      selectedAssetIds,
    };

    setAnalysisError(null);
    setIsAnalyzing(true);
    setPreviewingCandidate(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result = await runRepurposePipeline(project, liveAssets, config, {
        signal: controller.signal,
        workspaceHandle,
        onProgress: setAnalysisProgress,
      });

      setCandidates(result.allCandidates);
      setSelectionShortageNote(result.selectionSummary.shortageExplanation || null);
      setHasResults(true);

      // Default preview to first selected candidate
      if (result.selectedCandidates.length > 0) {
        setPreviewingCandidate(result.selectedCandidates[0]);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setAnalysisError("Analysis was cancelled.");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setAnalysisError(`Analysis failed: ${msg}`);
      }
    } finally {
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancelAnalysis = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  // Toggle individual candidate selection
  const handleToggleCandidate = (candidate: RepurposeCandidate) => {
    setCandidates((prev) =>
      prev.map((c) => (c.id === candidate.id ? { ...c, selected: !c.selected } : c))
    );
  };

  // Apply selected candidates to timeline sequence
  const handleApplyToTimeline = () => {
    const selected = candidates.filter((c) => c.selected);
    if (selected.length === 0) {
      alert("Please select at least one candidate moment to generate a timeline sequence.");
      return;
    }

    const editPlan = createEditPlanFromCandidates(project.id, selected, objective, targetAspectRatio);
    if (!editPlan.isValid) {
      alert(`Cannot apply edit plan: ${editPlan.validationErrors.join(" ")}`);
      return;
    }

    const { timeline: updatedTimeline, errors } = applyEditPlanToTimeline(editPlan, currentTimeline);
    if (errors.length > 0) {
      alert(`Timeline validation warning: ${errors.join(" ")}`);
    }

    const reason = `Repurpose: ${REPURPOSE_OBJECTIVES[objective].label} (${selected.length} clips, ${editPlan.totalDuration.toFixed(1)}s)`;
    onApplyTimelineSequence(updatedTimeline, reason);
  };

  const selectedCount = candidates.filter((c) => c.selected).length;
  const currentObjectiveDef = REPURPOSE_OBJECTIVES[objective];

  return (
    <div className="flex-1 flex flex-col h-full bg-cs-bg-base overflow-hidden">
      {/* Top Header */}
      <div className="flex items-center justify-between px-6 py-3.5 bg-cs-bg-surface border-b border-cs-border-subtle shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-cs-primary/10 text-cs-primary flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" stroke="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-cs-text-primary">Repurpose Footage</h2>
              <Badge variant="muted">Local • Non-AI</Badge>
            </div>
            <p className="text-[11px] text-cs-text-tertiary">
              Deterministic media analysis: frame difference proxies, audio energy dynamics, and natural pause detection.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasResults && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleApplyToTimeline}
              disabled={selectedCount === 0 || isAnalyzing}
              className="flex items-center gap-1.5"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" stroke="currentColor">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Open in Timeline ({selectedCount})</span>
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onCloseWorkflow}>
            Close
          </Button>
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-auto p-6">
        {isAnalyzing ? (
          /* Analyzing Progress State */
          <div className="max-w-xl mx-auto my-12 p-8 bg-cs-bg-surface border border-cs-border-subtle rounded-xl shadow-lg flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-full bg-cs-primary/10 text-cs-primary flex items-center justify-center mb-4">
              <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="10" />
              </svg>
            </div>
            <h3 className="text-base font-medium text-cs-text-primary">Analyzing Media Locally</h3>
            <p className="text-xs text-cs-text-secondary mt-1 max-w-md">
              {analysisProgress?.statusText || "Inspecting frames and acoustic signals in your browser..."}
            </p>

            {/* Progress bar */}
            <div className="w-full bg-cs-bg-base h-2 rounded-full mt-6 overflow-hidden border border-cs-border-subtle">
              <div
                className="bg-cs-primary h-full transition-all duration-200"
                style={{ width: `${analysisProgress?.percent || 5}%` }}
              />
            </div>
            <div className="w-full flex justify-between items-center text-[11px] text-cs-text-tertiary mt-2">
              <span>{analysisProgress?.stage || "Processing"}</span>
              <span className="font-mono">{analysisProgress?.percent || 0}%</span>
            </div>

            <p className="text-[10px] text-cs-text-tertiary mt-4 italic">
              All computations execute locally via WebCodecs and Mediabunny. No video or audio is uploaded anywhere.
            </p>

            <Button variant="secondary" size="sm" onClick={handleCancelAnalysis} className="mt-6">
              Cancel Analysis
            </Button>
          </div>
        ) : hasResults ? (
          /* Results Review State */
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            {/* Left 7 cols: Discovered Candidate Moments */}
            <div className="xl:col-span-7 flex flex-col gap-4">
              {/* Review summary header */}
              <div className="p-4 bg-cs-bg-surface border border-cs-border-subtle rounded-lg flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h3 className="text-xs font-semibold text-cs-text-primary uppercase tracking-wider">
                    Discovered Moments ({candidates.length})
                  </h3>
                  <p className="text-xs text-cs-text-secondary mt-0.5">
                    {selectedCount} of {candidates.length} selected for timeline sequence.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCandidates((prev) => prev.map((c) => ({ ...c, selected: true })))}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCandidates((prev) => prev.map((c) => ({ ...c, selected: false })))}
                  >
                    Deselect All
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setHasResults(false)}>
                    Adjust Settings
                  </Button>
                </div>
              </div>

              {/* Shortage or limitation explanation banner if applicable */}
              {selectionShortageNote && (
                <div className="p-3.5 bg-cs-info/10 border border-cs-info/20 rounded-lg text-xs text-cs-text-secondary flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-cs-info shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <div className="leading-relaxed">{selectionShortageNote}</div>
                </div>
              )}

              {/* Candidate Cards List */}
              <div className="flex flex-col gap-3">
                {candidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    isSelected={candidate.selected}
                    onToggleSelect={handleToggleCandidate}
                    onPreview={(cand) => setPreviewingCandidate(cand)}
                    isCurrentlyPreviewing={previewingCandidate?.id === candidate.id}
                  />
                ))}
              </div>
            </div>

            {/* Right 5 cols: Candidate Preview & Edit Plan Info */}
            <div className="xl:col-span-5 flex flex-col gap-4">
              {/* Preview Player */}
              {previewingCandidate ? (
                <CandidatePreviewPlayer
                  candidate={previewingCandidate}
                  liveAssets={liveAssets}
                  onClose={() => setPreviewingCandidate(null)}
                />
              ) : (
                <Panel>
                  <EmptyState
                    title="No moment selected for preview"
                    description="Click 'Preview' on any discovered candidate moment to play the exact excerpt."
                  />
                </Panel>
              )}

              {/* Sequence Plan Summary */}
              <Panel>
                <PanelHeader title="Sequence Summary" />
                <div className="p-4 flex flex-col gap-3 text-xs">
                  <div className="flex justify-between border-b border-cs-border-subtle pb-2">
                    <span className="text-cs-text-tertiary">Objective</span>
                    <span className="text-cs-text-primary font-medium">{currentObjectiveDef.label}</span>
                  </div>
                  <div className="flex justify-between border-b border-cs-border-subtle pb-2">
                    <span className="text-cs-text-tertiary">Target Aspect Ratio</span>
                    <span className="text-cs-text-primary font-mono">{targetAspectRatio}</span>
                  </div>
                  <div className="flex justify-between border-b border-cs-border-subtle pb-2">
                    <span className="text-cs-text-tertiary">Selected Clips</span>
                    <span className="text-cs-text-primary font-medium">{selectedCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-cs-text-tertiary">Total Sequence Length</span>
                    <span className="text-cs-text-primary font-mono font-medium">
                      {formatDuration(
                        candidates
                          .filter((c) => c.selected)
                          .reduce((sum, c) => sum + c.duration, 0)
                      )}
                    </span>
                  </div>

                  <Button
                    variant="primary"
                    size="md"
                    onClick={handleApplyToTimeline}
                    disabled={selectedCount === 0}
                    className="w-full mt-2"
                  >
                    Apply to Timeline as New Sequence
                  </Button>
                </div>
              </Panel>
            </div>
          </div>
        ) : (
          /* Configuration Setup State */
          <div className="max-w-4xl mx-auto flex flex-col gap-6">
            {analysisError && (
              <div className="p-4 rounded-lg bg-cs-error/10 border border-cs-error/20 text-xs text-cs-error flex items-center justify-between">
                <span>{analysisError}</span>
                <button type="button" onClick={() => setAnalysisError(null)} className="underline ml-2">
                  Dismiss
                </button>
              </div>
            )}

            {/* 1. Source Footage Selection */}
            <Panel>
              <PanelHeader
                title="1. Select Source Media"
                actions={
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedAssetIds(project.assets.map((a) => a.id))}
                    >
                      Select All
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedAssetIds([])}>
                      Clear
                    </Button>
                  </div>
                }
              />
              <div className="p-4">
                {project.assets.length === 0 ? (
                  <EmptyState
                    title="No imported media"
                    description="Please import one or more video files into your project first."
                  />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {project.assets.map((asset) => {
                      const live = liveAssets.get(asset.id);
                      const isReady = live?.status === "ready";
                      const isChecked = selectedAssetIds.includes(asset.id);
                      const dur = asset.metadata?.duration;

                      return (
                        <div
                          key={asset.id}
                          onClick={() => isReady && toggleAssetSelection(asset.id)}
                          className={`p-3 rounded-lg border flex items-start gap-3 cursor-pointer transition-all ${
                            !isReady
                              ? "opacity-50 cursor-not-allowed bg-cs-bg-base/40 border-cs-border-subtle"
                              : isChecked
                              ? "bg-cs-bg-active/40 border-cs-primary/60 shadow-sm"
                              : "bg-cs-bg-surface border-cs-border-subtle hover:border-cs-border-default"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={!isReady}
                            onChange={() => {}}
                            className="mt-0.5 h-4 w-4 rounded border-cs-border-default bg-cs-bg-surface text-cs-primary cursor-pointer"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1">
                              <p className="font-medium text-xs text-cs-text-primary truncate" title={asset.name}>
                                {asset.name}
                              </p>
                              {!isReady && <Badge variant="error">Missing / Locked</Badge>}
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-[11px] text-cs-text-tertiary">
                              {dur ? <span>{formatDuration(dur)}</span> : null}
                              <span>•</span>
                              <span>{formatBytes(asset.size)}</span>
                              {asset.metadata?.videoTracks && asset.metadata.videoTracks.length > 0 && (
                                <>
                                  <span>•</span>
                                  <span>
                                    {asset.metadata.videoTracks[0].displayWidth || asset.metadata.videoTracks[0].codedWidth}p
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Panel>

            {/* 2. Repurposing Objective Selection */}
            <Panel>
              <PanelHeader title="2. Choose Objective" />
              <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                {(Object.keys(REPURPOSE_OBJECTIVES) as RepurposeObjective[]).map((objKey) => {
                  const def = REPURPOSE_OBJECTIVES[objKey];
                  const isSelected = objective === objKey;

                  return (
                    <div
                      key={objKey}
                      onClick={() => setObjective(objKey)}
                      className={`p-4 rounded-lg border cursor-pointer flex flex-col justify-between transition-all ${
                        isSelected
                          ? "bg-cs-primary/10 border-cs-primary ring-1 ring-cs-primary shadow-sm"
                          : "bg-cs-bg-surface border-cs-border-subtle hover:border-cs-border-default"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-xs text-cs-text-primary">{def.label}</span>
                          {isSelected && <Badge variant="success">Active</Badge>}
                        </div>
                        <p className="text-[11px] text-cs-text-secondary leading-relaxed mb-3">
                          {def.description}
                        </p>
                      </div>

                      <div className="pt-2.5 border-t border-cs-border-subtle text-[10px] text-cs-text-tertiary">
                        <strong className="block text-cs-text-secondary mb-0.5">Measurable Signals:</strong>
                        <span>{def.heuristicsSummary}</span>
                        <strong className="block text-cs-warning/80 mt-2 mb-0.5">Known Limitations:</strong>
                        <span>{def.limitations}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            {/* 3. Output Parameters & Bounds */}
            <Panel>
              <PanelHeader title="3. Configure Bounds & Output" />
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                {/* Target Clip Count */}
                <div>
                  <label className="text-cs-text-tertiary block mb-1 font-medium">Desired Clip Count</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={targetClipCount}
                    onChange={(e) => setTargetClipCount(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                    className="w-full px-3 py-1.5 rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary"
                  />
                  <span className="text-[10px] text-cs-text-tertiary mt-1 block">1 to 10 clips</span>
                </div>

                {/* Min Clip Duration */}
                <div>
                  <label className="text-cs-text-tertiary block mb-1 font-medium">Min Duration (seconds)</label>
                  <input
                    type="number"
                    min={3}
                    max={60}
                    value={minClipDuration}
                    onChange={(e) => setMinClipDuration(Math.max(1, parseInt(e.target.value) || 3))}
                    className="w-full px-3 py-1.5 rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary"
                  />
                  <span className="text-[10px] text-cs-text-tertiary mt-1 block">Shortest accepted clip</span>
                </div>

                {/* Max Clip Duration */}
                <div>
                  <label className="text-cs-text-tertiary block mb-1 font-medium">Max Duration (seconds)</label>
                  <input
                    type="number"
                    min={5}
                    max={180}
                    value={maxClipDuration}
                    onChange={(e) => setMaxClipDuration(Math.max(minClipDuration + 1, parseInt(e.target.value) || 30))}
                    className="w-full px-3 py-1.5 rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary"
                  />
                  <span className="text-[10px] text-cs-text-tertiary mt-1 block">Longest accepted clip</span>
                </div>

                {/* Target Aspect Ratio */}
                <div>
                  <label className="text-cs-text-tertiary block mb-1 font-medium">Target Aspect Ratio</label>
                  <select
                    value={targetAspectRatio}
                    onChange={(e) => setTargetAspectRatio(e.target.value as ExportAspectRatio)}
                    className="w-full px-3 py-1.5 rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary"
                  >
                    <option value="9:16">9:16 (Shorts / Reels)</option>
                    <option value="16:9">16:9 (Landscape)</option>
                    <option value="1:1">1:1 (Square)</option>
                    <option value="4:5">4:5 (Social Portrait)</option>
                  </select>
                  <span className="text-[10px] text-cs-text-tertiary mt-1 block">Supported by renderer</span>
                </div>
              </div>

              {/* Optional keyword metadata guidance */}
              <div className="px-4 pb-4 border-t border-cs-border-subtle pt-3">
                <label className="text-xs text-cs-text-tertiary block mb-1 font-medium">
                  Keyword Guidance (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. interview, intro, demo, highlights"
                  value={keywordsText}
                  onChange={(e) => setKeywordsText(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-cs-bg-base border border-cs-border-default text-xs text-cs-text-primary"
                />
                <span className="text-[10px] text-cs-text-tertiary mt-1 block">
                  Optional keywords match source filenames literally. This phase does not perform speech transcription or semantic search.
                </span>
              </div>
            </Panel>

            {/* Launch Button */}
            <div className="flex justify-end gap-3 pb-8">
              <Button variant="secondary" size="md" onClick={onCloseWorkflow}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={handleStartAnalysis}
                disabled={selectedAssetIds.length === 0}
                className="flex items-center gap-2"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" stroke="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span>Run Local Analysis</span>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
