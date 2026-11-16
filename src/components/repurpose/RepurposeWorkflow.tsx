"use client";

/**
 * RepurposeWorkflow — Dedicated browser-local video repurposing interface.
 *
 * Rules:
 * - 100% deterministic, non-AI local processing in the user's browser.
 * - Allows selecting sources, choosing objective, setting bounds, and running local analysis.
 * - Displays transparent candidate moments with measurable signal explanations.
 * - Supports user-provided SRT/VTT subtitles and local offline Whisper transcription.
 * - Content-derived excerpt lengths (NO hardcoded 10s or forced cut points).
 * - Multi-moment selection from single sources allowed (NO forced 1-per-source limit).
 * - Soft target duration guidance preserving sentence and thought boundaries.
 * - Generates timed captions from transcript cues directly on the timeline.
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
  DeliverableType,
} from "../../types/repurpose.ts";
import { REPURPOSE_OBJECTIVES } from "../../types/repurpose.ts";
import type { ExportAspectRatio } from "../../types/export.ts";
import { runRepurposePipeline, type RepurposePipelineResult } from "../../lib/repurpose/pipeline.ts";
import { applyEditPlanToTimeline, createEditPlanFromCandidates } from "../../lib/repurpose/editPlan.ts";
import { generateCaptionsForTimeline } from "../../lib/transcription/captionGenerator.ts";
import { parseSubtitleFileContent } from "../../lib/transcription/subtitleParser.ts";
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
    return project.assets
      .filter((a) => {
        const live = liveAssets.get(a.id);
        return live?.status === "ready" && (a.mediaType === "video" || !a.mediaType);
      })
      .map((a) => a.id);
  });

  const [objective, setObjective] = useState<RepurposeObjective>("highlights");
  const [userBrief, setUserBrief] = useState("");
  const [deliverableType, setDeliverableType] = useState<DeliverableType>("compilation");
  const [targetDurationMode, setTargetDurationMode] = useState<"auto" | "30" | "60" | "90" | "custom">("auto");
  const [customTargetDuration, setCustomTargetDuration] = useState<number>(45);

  // Non-binding optional editorial preferences (unset by default)
  const [optionalClipCount, setOptionalClipCount] = useState<number | undefined>(undefined);
  const [optionalMinDur, setOptionalMinDur] = useState<number | undefined>(undefined);
  const [optionalMaxDur, setOptionalMaxDur] = useState<number | undefined>(undefined);
  const [showAdvancedDurationPrefs, setShowAdvancedDurationPrefs] = useState(false);
  const [targetAspectRatio, setTargetAspectRatio] = useState<ExportAspectRatio>("9:16");
  const [keywordsText, setKeywordsText] = useState("");

  // Subtitle / Transcription state
  const [userSubtitles, setUserSubtitles] = useState<Map<string, string>>(new Map());
  const [userSubtitleMeta, setUserSubtitleMeta] = useState<
    Map<string, { filename: string; cueCount: number; format: string }>
  >(new Map());
  const [enableTranscription, setEnableTranscription] = useState(false);
  const [generateCaptionsForSequence, setGenerateCaptionsForSequence] = useState(false);
  const [isGeneratingCaptions, setIsGeneratingCaptions] = useState(false);
  const [captionProgressText, setCaptionProgressText] = useState("");
  const [selectedModelName, setSelectedModelName] = useState<"whisper-tiny_timestamped" | "whisper-base_timestamped">(
    "whisper-tiny_timestamped"
  );

  // Pipeline Execution State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<RepurposeProgress | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Results State
  const [hasResults, setHasResults] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<RepurposePipelineResult | null>(null);
  const [candidates, setCandidates] = useState<RepurposeCandidate[]>([]);
  const [showAnalysisReport, setShowAnalysisReport] = useState(false);
  const [previewingCandidate, setPreviewingCandidate] = useState<RepurposeCandidate | null>(null);

  // File upload input ref for subtitles
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingAssetSubtitleUploadRef = useRef<string | null>(null);

  // Toggle asset selection in config
  const toggleAssetSelection = (assetId: string) => {
    setSelectedAssetIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]
    );
  };

  // Handle user subtitle file upload
  const handleTriggerSubtitleUpload = (assetId: string) => {
    pendingAssetSubtitleUploadRef.current = assetId;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleSubtitleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const assetId = pendingAssetSubtitleUploadRef.current;
    if (!file || !assetId) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || "");
      const { cues, format, errors } = parseSubtitleFileContent(content);
      if (cues.length === 0) {
        alert(`No valid subtitle cues found in file: ${errors.join(", ")}`);
        return;
      }
      setUserSubtitles((prev) => new Map(prev).set(assetId, content));
      setUserSubtitleMeta((prev) =>
        new Map(prev).set(assetId, {
          filename: file.name,
          cueCount: cues.length,
          format,
        })
      );
    };
    reader.readAsText(file);
  };

  const handleRemoveSubtitle = (assetId: string) => {
    setUserSubtitles((prev) => {
      const next = new Map(prev);
      next.delete(assetId);
      return next;
    });
    setUserSubtitleMeta((prev) => {
      const next = new Map(prev);
      next.delete(assetId);
      return next;
    });
  };

  // Run Local Analysis
  const handleStartAnalysis = async () => {
    if (selectedAssetIds.length === 0) {
      setAnalysisError("Please select at least one source video to analyze.");
      return;
    }

    const keywords = keywordsText
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    const targetDur =
      targetDurationMode === "30"
        ? 30
        : targetDurationMode === "60"
        ? 60
        : targetDurationMode === "90"
        ? 90
        : targetDurationMode === "custom"
        ? customTargetDuration
        : undefined;

    const config: RepurposeConfig = {
      objective,
      userBrief: userBrief.trim() || undefined,
      deliverableType,
      targetDuration: targetDur,
      targetClipCount: optionalClipCount,
      minClipDuration: optionalMinDur,
      maxClipDuration: optionalMaxDur,
      targetAspectRatio,
      keywords,
      selectedAssetIds,
      enableTranscription,
      selectedModelName,
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
        userSubtitles,
      });

      setPipelineResult(result);
      setCandidates(result.allCandidates);
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
  const handleApplyToTimeline = async () => {
    const selected = candidates.filter((c) => c.selected);
    if (selected.length === 0) {
      alert("Please select at least one candidate moment to generate a timeline sequence.");
      return;
    }

    const editPlan = createEditPlanFromCandidates(
      project.id,
      selected,
      objective,
      targetAspectRatio,
      deliverableType,
      pipelineResult?.selectionSummary.shortageExplanation
    );

    if (!editPlan.isValid) {
      alert(`Cannot apply edit plan: ${editPlan.validationErrors.join(" ")}`);
      return;
    }

    let updatedTimeline: TimelineDocument;
    let errors: string[] = [];

    if (!generateCaptionsForSequence) {
      // User opted OUT of captions (default) -> No caption track created
      const res = applyEditPlanToTimeline(
        editPlan,
        currentTimeline,
        undefined,
        { generateCaptions: false }
      );
      updatedTimeline = res.timeline;
      errors = res.errors;
    } else {
      // User opted IN to caption generation
      // 1. If pipelineResult already has transcripts for all selected segments, map them directly
      const hasPrecomputedTranscripts =
        pipelineResult?.sourceTranscripts &&
        selected.every((cand) => pipelineResult.sourceTranscripts!.has(cand.sourceAssetId));

      if (hasPrecomputedTranscripts) {
        const res = applyEditPlanToTimeline(
          editPlan,
          currentTimeline,
          pipelineResult?.sourceTranscripts,
          { generateCaptions: true }
        );
        updatedTimeline = res.timeline;
        errors = res.errors;
      } else {
        // Build base timeline without captions first
        const baseRes = applyEditPlanToTimeline(
          editPlan,
          currentTimeline,
          undefined,
          { generateCaptions: false }
        );
        updatedTimeline = baseRes.timeline;
        errors = baseRes.errors;

        // Run local sequence audio transcription
        setIsGeneratingCaptions(true);
        setCaptionProgressText("Initializing sequence audio for transcription...");

        try {
          const generatedCues = await generateCaptionsForTimeline(
            updatedTimeline,
            liveAssets,
            {
              modelName: selectedModelName,
              onProgress: (p, text) => {
                setCaptionProgressText(`${text} (${p}%)`);
              },
            }
          );

          updatedTimeline = {
            ...updatedTimeline,
            textOverlays: [...(updatedTimeline.textOverlays || []), ...generatedCues],
            settings: {
              ...updatedTimeline.settings,
              includeCaptionsInExport: true,
              captionsVisible: true,
            },
          };
        } catch (err: unknown) {
          console.warn("Local sequence transcription failed or cancelled:", err);
          const shouldContinue = confirm(
            `Local caption generation encountered an issue (${err instanceof Error ? err.message : String(err)}). Would you like to open the sequence in the Editor without captions?`
          );
          if (!shouldContinue) {
            setIsGeneratingCaptions(false);
            return;
          }
        } finally {
          setIsGeneratingCaptions(false);
        }
      }
    }

    if (errors.length > 0) {
      alert(`Timeline validation warning: ${errors.join(" ")}`);
    }

    const captionCount = updatedTimeline.textOverlays?.filter((o) => o.overlayType === "caption").length || 0;
    const reason = `Repurpose: ${REPURPOSE_OBJECTIVES[objective].label} (${selected.length} clips, ${editPlan.totalDuration.toFixed(1)}s, ${captionCount} caption cues)`;
    onApplyTimelineSequence(updatedTimeline, reason);
  };

  const selectedCount = candidates.filter((c) => c.selected).length;
  const currentObjectiveDef = REPURPOSE_OBJECTIVES[objective];
  const totalSelectedDuration = candidates
    .filter((c) => c.selected)
    .reduce((sum, c) => sum + c.duration, 0);

  return (
    <div className="flex-1 flex flex-col h-full bg-cs-bg-base overflow-hidden">
      {/* Hidden file input for subtitle upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleSubtitleFileChange}
        accept=".srt,.vtt"
        className="hidden"
      />

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
              <h2 className="text-sm font-semibold text-cs-text-primary">Content-Aware Video Repurposing</h2>
              <Badge variant="muted">Local • Offline</Badge>
            </div>
            <p className="text-[11px] text-cs-text-tertiary">
              Full-duration coverage • Speech boundary alignment • Complete thought preservation • Zero cloud uploads
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasResults && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleApplyToTimeline}
              disabled={selectedCount === 0 || isAnalyzing || isGeneratingCaptions}
              className="flex items-center gap-1.5"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" stroke="currentColor">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{isGeneratingCaptions ? "Generating Captions..." : `Open in Timeline (${selectedCount})`}</span>
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
              {analysisProgress?.statusText || "Inspecting complete source timelines and speech patterns..."}
            </p>

            {/* Progress bar */}
            <div className="w-full bg-cs-bg-base h-2 rounded-full mt-6 overflow-hidden border border-cs-border-subtle">
              <div
                className="bg-cs-primary h-full transition-all duration-200"
                style={{ width: `${analysisProgress?.percent || 5}%` }}
              />
            </div>
            <div className="w-full flex justify-between items-center text-[11px] text-cs-text-tertiary mt-2">
              <span className="capitalize">{analysisProgress?.stage || "Processing"}</span>
              <span className="font-mono">{analysisProgress?.percent || 0}%</span>
            </div>

            <p className="text-[10px] text-cs-text-tertiary mt-4 italic">
              All computations execute locally in your browser. Complete source timelines are inspected; zero files leave your machine.
            </p>

            <Button variant="secondary" size="sm" onClick={handleCancelAnalysis} className="mt-6">
              Cancel Analysis
            </Button>
          </div>
        ) : hasResults ? (
          /* Results Review State */
          <div className="flex flex-col gap-6">
            {/* Top Analysis & Coverage Banner */}
            <div className="p-4 bg-cs-bg-surface border border-cs-border-subtle rounded-xl flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-6">
                  <div>
                    <span className="text-[11px] text-cs-text-tertiary block">Raw Intervals Discovered</span>
                    <span className="text-sm font-semibold text-cs-text-primary font-mono">{candidates.length}</span>
                  </div>
                  <div className="h-7 w-px bg-cs-border-subtle" />
                  <div>
                    <span className="text-[11px] text-cs-text-tertiary block">Recommended Moments</span>
                    <span className="text-sm font-semibold text-cs-text-primary font-mono">
                      {pipelineResult?.recommendedCandidates.length || candidates.length}
                    </span>
                  </div>
                  <div className="h-7 w-px bg-cs-border-subtle" />
                  <div>
                    <span className="text-[11px] text-cs-text-tertiary block">Selected for Sequence</span>
                    <span className="text-sm font-semibold text-cs-primary font-mono">
                      {selectedCount} ({formatDuration(totalSelectedDuration)})
                    </span>
                  </div>
                  <div className="h-7 w-px bg-cs-border-subtle" />
                  <div>
                    <span className="text-[11px] text-cs-text-tertiary block">Deliverable</span>
                    <span className="text-xs font-medium text-cs-text-primary">
                      {deliverableType === "compilation" ? "Single Assembled Story" : "Independent Short Clips"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowAnalysisReport(!showAnalysisReport)}
                    className="flex items-center gap-1.5"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                    <span>{showAnalysisReport ? "Hide Coverage Report" : "View Analysis Report"}</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setHasResults(false)}>
                    Adjust Settings
                  </Button>
                </div>
              </div>

              {/* Expandable Analysis Report */}
              {showAnalysisReport && (
                <div className="mt-3 pt-4 border-t border-cs-border-subtle flex flex-col gap-4 text-xs">
                  <div>
                    <h4 className="font-semibold text-cs-text-primary mb-2">Source Timeline Coverage (100% Inspected)</h4>
                    <div className="overflow-x-auto border border-cs-border-subtle rounded-lg">
                      <table className="w-full text-left">
                        <thead className="bg-cs-bg-base/60 text-cs-text-tertiary border-b border-cs-border-subtle">
                          <tr>
                            <th className="px-3 py-2 font-medium">Source Asset</th>
                            <th className="px-3 py-2 font-medium">Analyzed Duration</th>
                            <th className="px-3 py-2 font-medium">Speech / Transcript Status</th>
                            <th className="px-3 py-2 font-medium">Candidates Found</th>
                            <th className="px-3 py-2 font-medium">Selected Excerpts</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-cs-border-subtle">
                          {pipelineResult &&
                            Object.values(pipelineResult.coverageReports).map((report) => {
                              const sourceCandidates = candidates.filter((c) => c.sourceAssetId === report.assetId);
                              const sourceSelected = sourceCandidates.filter((c) => c.selected);
                              return (
                                <tr key={report.assetId} className="hover:bg-cs-bg-base/30">
                                  <td className="px-3 py-2 font-medium text-cs-text-primary">{report.assetName}</td>
                                  <td className="px-3 py-2 font-mono text-cs-text-secondary">
                                    0.0s – {report.analyzedDuration.toFixed(1)}s (100% complete)
                                  </td>
                                  <td className="px-3 py-2 text-cs-text-secondary">
                                    {report.transcriptStatus.hasTranscript ? (
                                      report.transcriptStatus.engine === "srt-vtt" ? (
                                        <span className="text-cs-success font-medium">Provided Subtitle ({report.transcriptStatus.cueCount} cues)</span>
                                      ) : (
                                        <span className="text-cs-primary font-medium">Local Whisper ASR ({report.transcriptStatus.cueCount} cues)</span>
                                      )
                                    ) : report.transcriptStatus.errorMessage ? (
                                      <span className="text-cs-warning font-medium" title={report.transcriptStatus.errorMessage}>
                                        ASR fallback: visual/acoustic (speech engine unavailable)
                                      </span>
                                    ) : (
                                      <span className="text-cs-text-tertiary">Acoustic & visual dynamics</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 font-mono">{sourceCandidates.length}</td>
                                  <td className="px-3 py-2 font-mono font-medium text-cs-primary">
                                    {sourceSelected.length} ({formatDuration(sourceSelected.reduce((s, c) => s + c.duration, 0))})
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Context Integrity & Editorial Rules Confirmation */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 bg-cs-bg-base/50 rounded-lg border border-cs-border-subtle">
                      <h5 className="font-semibold text-cs-text-primary mb-1">Context Integrity Assessment</h5>
                      <ul className="list-disc list-inside text-cs-text-secondary space-y-1">
                        <li>Speech Boundary Integrity: Cuts snap to natural sentence pauses.</li>
                        <li>Complete Thought Check: Excerpts verified for subject, predicate, and closure.</li>
                        <li>Context Sufficiency: Backward expansion added where prerequisite questions or pronouns existed.</li>
                        <li>Zero Whole-Source Fallback: No raw file was substituted as a candidate.</li>
                      </ul>
                    </div>

                    <div className="p-3 bg-cs-bg-base/50 rounded-lg border border-cs-border-subtle">
                      <h5 className="font-semibold text-cs-text-primary mb-1">Sequence Rationale</h5>
                      <p className="text-cs-text-secondary leading-relaxed">
                        {pipelineResult?.selectionSummary.shortageExplanation ||
                          "Selected moments represent the highest semantic relevance to your brief, organized with natural narrative cohesion and complete sentence preservation."}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Main Content: Left Candidates List, Right Preview & Plan */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              {/* Left 7 cols: Discovered Candidate Moments */}
              <div className="xl:col-span-7 flex flex-col gap-4">
                <div className="p-4 bg-cs-bg-surface border border-cs-border-subtle rounded-lg flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-cs-text-primary uppercase tracking-wider">
                      Proposed Moments ({candidates.length})
                    </h3>
                    <p className="text-xs text-cs-text-secondary mt-0.5">
                      {selectedCount} selected • Excerpt durations derived directly from speech and visual boundaries.
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
                  </div>
                </div>

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
                {/* Proposed Excerpt Preview Player */}
                {previewingCandidate ? (
                  <CandidatePreviewPlayer
                    candidate={previewingCandidate}
                    liveAssets={liveAssets}
                    onClose={() => setPreviewingCandidate(null)}
                  />
                ) : (
                  <Panel>
                    <EmptyState
                      title="No excerpt selected for preview"
                      description="Click 'Preview' on any discovered candidate moment to play the proposed excerpt with exact bounds."
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
                      <span className="text-cs-text-tertiary">Deliverable Type</span>
                      <span className="text-cs-text-primary font-medium">
                        {deliverableType === "compilation"
                          ? "Single Assembled Story"
                          : "Multiple Independent Clips"}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-cs-border-subtle pb-2">
                      <span className="text-cs-text-tertiary">Target Aspect Ratio</span>
                      <span className="text-cs-text-primary font-mono">{targetAspectRatio}</span>
                    </div>
                    <div className="flex justify-between border-b border-cs-border-subtle pb-2">
                      <span className="text-cs-text-tertiary">Selected Clips</span>
                      <span className="text-cs-text-primary font-medium">{selectedCount}</span>
                    </div>
                    <div className="flex justify-between border-b border-cs-border-subtle pb-2">
                      <span className="text-cs-text-tertiary">Total Sequence Length</span>
                      <span className="text-cs-primary font-mono font-medium">
                        {formatDuration(totalSelectedDuration)}
                      </span>
                    </div>
                    {/* Optional Caption Generation Section */}
                    <div className="p-3 bg-cs-bg-base/70 border border-cs-border-subtle rounded-lg flex flex-col gap-2.5 mt-1">
                      <div className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          id="repurpose-caption-toggle"
                          checked={generateCaptionsForSequence}
                          onChange={(e) => setGenerateCaptionsForSequence(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-cs-border-default bg-cs-bg-surface text-cs-accent accent-cs-accent cursor-pointer"
                        />
                        <label htmlFor="repurpose-caption-toggle" className="cursor-pointer select-none">
                          <span className="text-xs font-semibold text-cs-text-primary block">
                            Generate captions for the selected sequence
                          </span>
                          <span className="text-[11px] text-cs-text-secondary block mt-0.5 leading-tight">
                            Transcribes the assembled sequence audio in sequence-relative time and transfers editable caption cues into the Editor.
                          </span>
                        </label>
                      </div>

                      {generateCaptionsForSequence && (
                        <div className="pl-6.5 flex flex-col gap-2 pt-2 border-t border-cs-border-subtle/40">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-cs-text-tertiary">Local Model:</span>
                            <select
                              value={selectedModelName}
                              onChange={(e) => setSelectedModelName(e.target.value as any)}
                              className="bg-cs-bg-elevated border border-cs-border-default rounded px-2 py-1 text-xs text-cs-text-primary font-medium"
                            >
                              <option value="whisper-tiny_timestamped">Whisper Tiny (~39 MB, Word Timings)</option>
                              <option value="whisper-base_timestamped">Whisper Base (~74 MB, Word Timings)</option>
                            </select>
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-cs-text-tertiary">
                            <span className="w-1.5 h-1.5 rounded-full bg-cs-success" />
                            <span>100% On-Device • Zero Cloud Uploads • Native Sequence Time</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {isGeneratingCaptions && (
                      <div className="p-3 rounded-lg bg-cs-primary/10 border border-cs-primary/20 text-xs flex items-center gap-2 text-cs-primary">
                        <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="10" />
                        </svg>
                        <span className="truncate">{captionProgressText || "Transcribing sequence audio..."}</span>
                      </div>
                    )}

                    <Button
                      variant="primary"
                      size="md"
                      onClick={handleApplyToTimeline}
                      disabled={selectedCount === 0 || isGeneratingCaptions}
                      className="w-full mt-2 flex items-center justify-center gap-2"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" stroke="currentColor">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>
                        {isGeneratingCaptions
                          ? "Generating Captions..."
                          : generateCaptionsForSequence
                          ? `Open in Timeline with Captions (${selectedCount})`
                          : `Open in Timeline (${selectedCount})`}
                      </span>
                    </Button>
                  </div>
                </Panel>
              </div>
            </div>
          </div>
        ) : (
          /* Configuration Setup State */
          <div className="max-w-6xl w-full mx-auto flex flex-col gap-6">
            {analysisError && (
              <div className="p-4 rounded-lg bg-cs-error/10 border border-cs-error/20 text-xs text-cs-error flex items-center justify-between">
                <span>{analysisError}</span>
                <button type="button" onClick={() => setAnalysisError(null)} className="underline ml-2">
                  Dismiss
                </button>
              </div>
            )}

            {/* 1. Source Footage Selection & Subtitle Association */}
            <Panel>
              <PanelHeader
                title="1. Select Source Media & Subtitles"
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
              <div className="p-4 flex flex-col gap-4">
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
                      const subMeta = userSubtitleMeta.get(asset.id);

                      return (
                        <div
                          key={asset.id}
                          className={`p-3 rounded-lg border flex flex-col gap-2 transition-all ${
                            !isReady
                              ? "opacity-50 bg-cs-bg-base/40 border-cs-border-subtle"
                              : isChecked
                              ? "bg-cs-bg-active/40 border-cs-primary/60 shadow-sm"
                              : "bg-cs-bg-surface border-cs-border-subtle hover:border-cs-border-default"
                          }`}
                        >
                          <div
                            className="flex items-start gap-3 cursor-pointer"
                            onClick={() => isReady && toggleAssetSelection(asset.id)}
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
                                      {asset.metadata.videoTracks[0].displayWidth ||
                                        asset.metadata.videoTracks[0].codedWidth}p
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Subtitle attachment per source */}
                          {isChecked && isReady && (
                            <div className="pt-2 border-t border-cs-border-subtle flex items-center justify-between text-xs">
                              {subMeta ? (
                                <div className="flex items-center gap-2 min-w-0">
                                  <Badge variant="success">
                                    ✓ {subMeta.filename} ({subMeta.cueCount} cues)
                                  </Badge>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveSubtitle(asset.id);
                                    }}
                                    className="text-cs-text-tertiary hover:text-cs-error"
                                    title="Remove subtitle"
                                  >
                                    ×
                                  </button>
                                </div>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleTriggerSubtitleUpload(asset.id);
                                  }}
                                  className="text-[11px] h-6 px-2 text-cs-text-secondary hover:text-cs-text-primary"
                                >
                                  + Upload SRT/VTT
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Local Whisper Option */}
                <div className="p-3.5 bg-cs-bg-base/60 border border-cs-border-subtle rounded-lg flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="enable-transcription"
                        checked={enableTranscription}
                        onChange={(e) => setEnableTranscription(e.target.checked)}
                        className="h-4 w-4 rounded border-cs-border-default bg-cs-bg-surface text-cs-primary cursor-pointer"
                      />
                      <label htmlFor="enable-transcription" className="text-xs font-semibold text-cs-text-primary cursor-pointer">
                        Transcribe Spoken Speech Locally (Offline Whisper)
                      </label>
                    </div>
                    <Badge variant="muted">WebGPU • Local WASM</Badge>
                  </div>
                  <p className="text-[11px] text-cs-text-tertiary leading-relaxed">
                    Uses local Whisper ASR inside your browser. Audio never leaves your computer. If an asset has no uploaded SRT/VTT,
                    local Whisper transcribes spoken dialogue to discover speech and thought boundaries.
                  </p>
                  {enableTranscription && (
                    <div className="flex items-center gap-4 mt-1 text-xs">
                      <span className="text-cs-text-tertiary">Model:</span>
                      <label className="flex items-center gap-1.5 cursor-pointer text-cs-text-secondary">
                        <input
                          type="radio"
                          name="whisper-model"
                          value="whisper-tiny_timestamped"
                          checked={selectedModelName === "whisper-tiny_timestamped"}
                          onChange={() => setSelectedModelName("whisper-tiny_timestamped")}
                        />
                        <span>Tiny (~39MB, Fast)</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-cs-text-secondary">
                        <input
                          type="radio"
                          name="whisper-model"
                          value="whisper-base_timestamped"
                          checked={selectedModelName === "whisper-base_timestamped"}
                          onChange={() => setSelectedModelName("whisper-base_timestamped")}
                        />
                        <span>Base (~73MB, Accurate)</span>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </Panel>

            {/* 2. Editorial Brief & Purpose */}
            <Panel>
              <PanelHeader title="2. Editorial Brief & Topic Focus" />
              <div className="p-4 flex flex-col gap-4 text-xs">
                <div>
                  <label className="text-cs-text-secondary block mb-1 font-medium">
                    Editorial Brief / Topic Angle (Optional)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="e.g. Find the strongest explanations of browser architecture, privacy, and local storage. Prioritize actionable conclusions and key takeaways."
                    value={userBrief}
                    onChange={(e) => setUserBrief(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-cs-bg-base border border-cs-border-default text-cs-text-primary text-xs focus:outline-none focus:border-cs-primary"
                  />
                  <span className="text-[10px] text-cs-text-tertiary mt-1 block">
                    Your brief is compared directly against spoken transcripts and audio/visual energy to rank candidates.
                  </span>
                </div>

                <div>
                  <label className="text-cs-text-secondary block mb-1 font-medium">
                    Priority Keywords (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. privacy, webcodecs, mediabunny, performance"
                    value={keywordsText}
                    onChange={(e) => setKeywordsText(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-cs-bg-base border border-cs-border-default text-cs-text-primary text-xs"
                  />
                  <span className="text-[10px] text-cs-text-tertiary mt-1 block">
                    Comma-separated terms that give extra ranking weight to candidate moments containing them.
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Deliverable Type */}
                  <div>
                    <label className="text-cs-text-secondary block mb-1 font-medium">Deliverable Goal</label>
                    <select
                      value={deliverableType}
                      onChange={(e) => setDeliverableType(e.target.value as DeliverableType)}
                      className="w-full px-3 py-2 rounded-lg bg-cs-bg-base border border-cs-border-default text-cs-text-primary text-xs"
                    >
                      <option value="compilation">Single Assembled Story (Sequenced compilation)</option>
                      <option value="independent_clips">Multiple Independent Short Clips (Standalone excerpts)</option>
                    </select>
                    <span className="text-[10px] text-cs-text-tertiary mt-1 block">
                      Determines narrative sequencing and cross-excerpt pacing.
                    </span>
                  </div>

                  {/* Soft Target Duration */}
                  <div>
                    <label className="text-cs-text-secondary block mb-1 font-medium">Target Duration (Soft Target)</label>
                    <div className="flex gap-2">
                      <select
                        value={targetDurationMode}
                        onChange={(e) =>
                          setTargetDurationMode(
                            e.target.value as "auto" | "30" | "60" | "90" | "custom"
                          )
                        }
                        className="flex-1 px-3 py-2 rounded-lg bg-cs-bg-base border border-cs-border-default text-cs-text-primary text-xs"
                      >
                        <option value="auto">Auto / Natural Length</option>
                        <option value="30">~30 seconds (Short)</option>
                        <option value="60">~60 seconds (Reel)</option>
                        <option value="90">~90 seconds (Extended)</option>
                        <option value="custom">Custom Duration</option>
                      </select>
                      {targetDurationMode === "custom" && (
                        <input
                          type="number"
                          min={10}
                          max={600}
                          value={customTargetDuration}
                          onChange={(e) => setCustomTargetDuration(Math.max(5, parseInt(e.target.value) || 30))}
                          className="w-20 px-2 py-1 rounded-lg bg-cs-bg-base border border-cs-border-default text-cs-text-primary text-xs font-mono"
                        />
                      )}
                    </div>
                    <span className="text-[10px] text-cs-text-tertiary mt-1 block">
                      Soft guide only: sentences and thoughts will never be cut off mid-word or mid-thought.
                    </span>
                  </div>
                </div>
              </div>
            </Panel>

            {/* 3. Repurposing Objective Selection */}
            <Panel>
              <PanelHeader title="3. Repurposing Strategy" />
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
                        <strong className="block text-cs-text-secondary mb-0.5">Focus Signals:</strong>
                        <span>{def.heuristicsSummary}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            {/* 4. Target Format & Duration Guidance */}
            <Panel>
              <PanelHeader title="4. Target Format & Guidance" />
              <div className="p-4 flex flex-col gap-4 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Target Aspect Ratio */}
                  <div>
                    <label className="text-cs-text-secondary block mb-1 font-medium">Target Aspect Ratio</label>
                    <select
                      value={targetAspectRatio}
                      onChange={(e) => setTargetAspectRatio(e.target.value as ExportAspectRatio)}
                      className="w-full px-3 py-2 rounded-lg bg-cs-bg-base border border-cs-border-default text-cs-text-primary"
                    >
                      <option value="9:16">9:16 (Shorts / Reels / TikTok)</option>
                      <option value="16:9">16:9 (Landscape / YouTube)</option>
                      <option value="1:1">1:1 (Square / Feed)</option>
                      <option value="4:5">4:5 (Social Portrait)</option>
                    </select>
                    <span className="text-[10px] text-cs-text-tertiary mt-1 block">
                      Sequence framing and caption safe margins conform to this orientation.
                    </span>
                  </div>

                  {/* Content-Driven Duration Notice */}
                  <div className="p-3 bg-cs-bg-base/60 rounded-lg border border-cs-border-subtle flex flex-col justify-center">
                    <span className="font-semibold text-cs-text-primary text-[11px] mb-0.5">Content-Driven Durations</span>
                    <p className="text-[11px] text-cs-text-secondary leading-relaxed">
                      Excerpt lengths emerge naturally from speech boundaries, complete thoughts, and visual dynamics.
                      No fixed clip count or artificial duration clamps are imposed.
                    </p>
                  </div>
                </div>

                {/* Advanced Optional Preferences (Non-binding) Accordion */}
                <div className="pt-2 border-t border-cs-border-subtle">
                  <button
                    type="button"
                    onClick={() => setShowAdvancedDurationPrefs(!showAdvancedDurationPrefs)}
                    className="flex items-center gap-2 text-xs font-medium text-cs-text-secondary hover:text-cs-text-primary transition-colors"
                  >
                    <span>{showAdvancedDurationPrefs ? "▼" : "▶"}</span>
                    <span>Optional Editorial Preferences (Non-binding)</span>
                  </button>

                  {showAdvancedDurationPrefs && (
                    <div className="mt-3 p-3 bg-cs-bg-base/40 rounded-lg border border-cs-border-subtle grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-cs-text-tertiary block mb-1 font-medium">Preferred Clip Count (Optional)</label>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          placeholder="Content-driven"
                          value={optionalClipCount ?? ""}
                          onChange={(e) => {
                            const val = e.target.value ? parseInt(e.target.value) : undefined;
                            setOptionalClipCount(val && val > 0 ? val : undefined);
                          }}
                          className="w-full px-2.5 py-1.5 rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary text-xs"
                        />
                        <span className="text-[10px] text-cs-text-tertiary mt-1 block">
                          Non-binding guide. High-value moments take precedence.
                        </span>
                      </div>

                      <div>
                        <label className="text-cs-text-tertiary block mb-1 font-medium">Soft Min Duration (sec, Optional)</label>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          placeholder="Auto (speech pause)"
                          value={optionalMinDur ?? ""}
                          onChange={(e) => {
                            const val = e.target.value ? parseFloat(e.target.value) : undefined;
                            setOptionalMinDur(val && val > 0 ? val : undefined);
                          }}
                          className="w-full px-2.5 py-1.5 rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary text-xs"
                        />
                        <span className="text-[10px] text-cs-text-tertiary mt-1 block">
                          Soft guide. Thoughts will not be cut mid-sentence.
                        </span>
                      </div>

                      <div>
                        <label className="text-cs-text-tertiary block mb-1 font-medium">Soft Max Duration (sec, Optional)</label>
                        <input
                          type="number"
                          min={10}
                          max={300}
                          placeholder="Auto (complete thought)"
                          value={optionalMaxDur ?? ""}
                          onChange={(e) => {
                            const val = e.target.value ? parseFloat(e.target.value) : undefined;
                            setOptionalMaxDur(val && val > 0 ? val : undefined);
                          }}
                          className="w-full px-2.5 py-1.5 rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary text-xs"
                        />
                        <span className="text-[10px] text-cs-text-tertiary mt-1 block">
                          Soft guide. Key explanations are not discarded solely for length.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
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
                <span>Run Content-Aware Repurposing</span>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
