"use client";

/**
 * ExportModal — Export configuration, capability preflight, and render progress dialog.
 *
 * Rules:
 * - Runtime capability preflight checks actual WebCodecs support before starting.
 * - Displays clear, deterministic progress based on real work (frame counter, percentage, elapsed time).
 * - Safe cancellation closes writers and cleans up incomplete temporary files.
 * - Shows export history from ProjectDocument.exports.
 * - Retains source files and previous exports untouched.
 */

import * as React from "react";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { ProjectDocument, LiveAssetItem, ProjectExport } from "../../types/project.ts";
import type { TimelineDocument } from "../../types/timeline.ts";
import type {
  ExportPreset,
  ExportAspectRatio,
  ExportFormat,
  ExportQuality,
  ExportSettings,
  ExportProgress,
  ExportCapabilitiesReport,
} from "../../types/export.ts";
import {
  calculateExportDimensions,
  getDefaultExportSettings,
  buildRenderPlan,
} from "../../lib/export/renderPlan.ts";
import { detectExportCapabilities } from "../../lib/export/capabilities.ts";
import { renderAndExport, type ExportPipelineResult } from "../../lib/export/pipeline.ts";
import {
  checkExportFileStatus,
  renameExport,
  deleteExport,
  type ExportFileStatus,
} from "../../lib/export/history.ts";
import { formatBytes } from "../../lib/projectValidation.ts";
import { formatDuration } from "../../lib/media/inspector.ts";
import { Button, Modal } from "@/components/ui";

export interface ExportModalProps {
  isOpen: boolean;
  project: ProjectDocument;
  timeline: TimelineDocument;
  liveAssets: Map<string, LiveAssetItem>;
  workspaceHandle?: FileSystemDirectoryHandle;
  onClose: () => void;
  onExportSuccess: (exportRecord: ProjectExport) => void;
  onExportsUpdated?: (updatedExports: ProjectExport[]) => void;
}

type ModalTab = "export" | "history";

export function ExportModal({
  isOpen,
  project,
  timeline,
  liveAssets,
  workspaceHandle,
  onClose,
  onExportSuccess,
  onExportsUpdated,
}: ExportModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>("export");

  // Output settings state
  const initialAspectRatio = (timeline.settings.targetAspectRatio || "16:9") as ExportAspectRatio;
  const [aspectRatio, setAspectRatio] = useState<ExportAspectRatio>(initialAspectRatio);
  const [preset, setPreset] = useState<ExportPreset>("1080p");
  const [frameRate, setFrameRate] = useState<number>(30);
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const [quality, setQuality] = useState<ExportQuality>("high");

  const computeDefaultFilename = useCallback(
    (p: ExportPreset, f: ExportFormat) => {
      const cleanName = project.name.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "video";
      const ext = f === "webm" ? "webm" : "mp4";
      return `${cleanName}-${p}.${ext}`;
    },
    [project.name]
  );

  const [filename, setFilename] = useState<string>(() => computeDefaultFilename("1080p", "mp4"));
  const [hasCustomFilename, setHasCustomFilename] = useState<boolean>(false);

  // Preflight capability report
  const [capabilities, setCapabilities] = useState<ExportCapabilitiesReport | null>(null);
  const [checkingCaps, setCheckingCaps] = useState<boolean>(true);

  // Pipeline runtime state
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [completedResult, setCompletedResult] = useState<ExportPipelineResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Handlers for preset/format that update filename if not customized
  const handlePresetChange = (newPreset: ExportPreset) => {
    setPreset(newPreset);
    if (!hasCustomFilename) {
      setFilename(computeDefaultFilename(newPreset, format));
    }
  };

  const handleFormatChange = (newFormat: ExportFormat) => {
    setFormat(newFormat);
    if (!hasCustomFilename) {
      setFilename(computeDefaultFilename(preset, newFormat));
    }
  };

  // Load browser capability report on mount
  useEffect(() => {
    let mounted = true;
    detectExportCapabilities().then((report) => {
      if (mounted) {
        setCapabilities(report);
        setCheckingCaps(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Computed dimensions
  const dimensions = useMemo(() => {
    return calculateExportDimensions(aspectRatio, preset);
  }, [aspectRatio, preset]);

  // Assembled export settings
  const exportSettings: ExportSettings = useMemo(() => {
    const base = getDefaultExportSettings(aspectRatio, preset, project.name);
    return {
      ...base,
      width: dimensions.width,
      height: dimensions.height,
      frameRate,
      format,
      videoCodec: format === "webm" ? "vp9" : "avc",
      audioCodec: format === "webm" ? "opus" : "aac",
      quality,
      filename,
    };
  }, [aspectRatio, preset, dimensions, frameRate, format, quality, filename, project.name]);

  // Render plan preview & validation
  const plan = useMemo(() => {
    return buildRenderPlan(project, timeline, exportSettings, liveAssets);
  }, [project, timeline, exportSettings, liveAssets]);

  // Validate format capability
  const isSelectedFormatSupported = useMemo(() => {
    if (!capabilities) return false;
    if (!capabilities.hasWebCodecs) return false;
    if (format === "webm") return capabilities.canExportWebmOpus;
    return capabilities.canExportMp4AvcAac;
  }, [capabilities, format]);

  // Cancellation handler
  const handleCancelExport = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsExporting(false);
  }, []);

  // Start export handler
  const handleStartExport = async () => {
    if (!plan.isValid || isExporting) return;

    setIsExporting(true);
    setCompletedResult(null);
    setExportError(null);
    setProgress({
      stage: "validating-timeline",
      percent: 0,
      elapsedMs: 0,
      statusText: "Starting local render...",
    });

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const result = await renderAndExport(plan, {
        workspaceHandle,
        signal: abortController.signal,
        onProgress: (p) => setProgress(p),
      });

      setCompletedResult(result);
      setIsExporting(false);

      // Register export in project document
      const exportRecord: ProjectExport = {
        id: crypto.randomUUID(),
        name: result.finalFilename,
        relativePath: result.relativePath,
        createdAt: new Date().toISOString(),
        settings: {
          targetAspectRatio: exportSettings.targetAspectRatio,
          width: result.validation.metadata?.width || exportSettings.width,
          height: result.validation.metadata?.height || exportSettings.height,
          frameRate: exportSettings.frameRate,
          videoCodec: exportSettings.videoCodec,
          audioCodec: exportSettings.audioCodec,
          format: exportSettings.format,
        },
        duration: result.validation.metadata?.duration || plan.totalDurationSeconds,
        width: result.validation.metadata?.width || exportSettings.width,
        height: result.validation.metadata?.height || exportSettings.height,
        fileSize: result.file.size,
        status: "completed",
      };

      onExportSuccess(exportRecord);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setExportError("Export was cancelled.");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setExportError(msg);
      }
      setIsExporting(false);
    } finally {
      abortControllerRef.current = null;
    }
  };

  const [previewFile, setPreviewFile] = useState<{ file: File; name: string } | null>(null);

  // Direct browser file download fallback
  const handleDownloadFile = () => {
    if (!completedResult?.file) return;
    const url = URL.createObjectURL(completedResult.file);
    const a = document.createElement("a");
    a.href = url;
    a.download = completedResult.finalFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!isOpen) return null;

  return (
    <>
      <Modal
        open={isOpen}
        onClose={() => {
          if (!isExporting) onClose();
        }}
        title="Export Video"
      >
      <div className="space-y-4">
        {/* Navigation tabs */}
        <div className="flex border-b border-cs-border-subtle gap-4 text-xs font-medium">
          <button
            onClick={() => setActiveTab("export")}
            className={`pb-2 border-b-2 transition-colors ${
              activeTab === "export"
                ? "border-cs-accent text-cs-accent"
                : "border-transparent text-cs-text-secondary hover:text-cs-text"
            }`}
          >
            Export Configuration
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`pb-2 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "history"
                ? "border-cs-accent text-cs-accent"
                : "border-transparent text-cs-text-secondary hover:text-cs-text"
            }`}
          >
            Export History
            {project.exports && project.exports.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-cs-bg-elevated text-cs-text-secondary">
                {project.exports.length}
              </span>
            )}
          </button>
        </div>

        {activeTab === "history" ? (
          <ExportHistoryView
            exports={project.exports || []}
            projectId={project.id}
            workspaceHandle={workspaceHandle}
            onExportsUpdated={onExportsUpdated}
            onPreview={(file, name) => setPreviewFile({ file, name })}
          />
        ) : isExporting || completedResult || exportError ? (
          /* Active Export / Completed / Error View */
          <div className="space-y-4 py-2">
            {isExporting && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-cs-text">
                    {progress?.statusText || "Rendering video..."}
                  </span>
                  <span className="font-mono text-cs-accent font-semibold">
                    {progress?.percent ?? 0}%
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-2 rounded-full bg-cs-bg-surface overflow-hidden border border-cs-border-subtle">
                  <div
                    className="h-full bg-cs-accent transition-all duration-200"
                    style={{ width: `${progress?.percent ?? 0}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-cs-text-tertiary">
                  <span>
                    {progress?.currentFrame !== undefined && progress?.totalFrames !== undefined
                      ? `Frame ${progress.currentFrame} / ${progress.totalFrames}`
                      : progress?.stage}
                  </span>
                  <span>
                    Elapsed: {Math.floor((progress?.elapsedMs || 0) / 1000)}s
                  </span>
                </div>

                <div className="pt-4 flex justify-end">
                  <Button variant="danger" size="sm" onClick={handleCancelExport}>
                    Cancel Export
                  </Button>
                </div>
              </div>
            )}

            {completedResult && (
              <div className="p-4 rounded border border-emerald-500/20 bg-emerald-500/5 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  Export Complete!
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-cs-text-secondary bg-cs-bg-surface/50 p-3 rounded">
                  <div>
                    <span className="text-cs-text-tertiary">Filename: </span>
                    <span className="font-mono">{completedResult.finalFilename}</span>
                  </div>
                  <div>
                    <span className="text-cs-text-tertiary">Resolution: </span>
                    <span>
                      {completedResult.validation.metadata?.width} ×{" "}
                      {completedResult.validation.metadata?.height}
                    </span>
                  </div>
                  <div>
                    <span className="text-cs-text-tertiary">Duration: </span>
                    <span>
                      {formatDuration(completedResult.validation.metadata?.duration || 0)}
                    </span>
                  </div>
                  <div>
                    <span className="text-cs-text-tertiary">Size: </span>
                    <span>{formatBytes(completedResult.file.size)}</span>
                  </div>
                </div>

                <p className="text-[11px] text-cs-text-tertiary">
                  Saved directly to workspace:{" "}
                  <code className="text-cs-text-secondary font-mono">{completedResult.relativePath}</code>
                </p>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() =>
                      setPreviewFile({
                        file: completedResult.file,
                        name: completedResult.finalFilename,
                      })
                    }
                    className="flex items-center gap-1.5"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Preview Final Video
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleDownloadFile}>
                    Download to Computer
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setCompletedResult(null);
                      onClose();
                    }}
                  >
                    Done
                  </Button>
                </div>
              </div>
            )}

            {exportError && (
              <div className="p-4 rounded border border-red-500/20 bg-red-500/5 space-y-3">
                <div className="flex items-center gap-2 text-red-400 font-medium text-sm">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  Export Interrupted
                </div>
                <p className="text-xs text-red-300">{exportError}</p>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="secondary" size="sm" onClick={() => setExportError(null)}>
                    Back to Settings
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Configuration Form */
          <div className="space-y-4">
            {/* Resolution & Aspect Ratio Grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* Aspect Ratio */}
              <div>
                <label className="block text-xs font-medium text-cs-text-secondary mb-1">
                  Aspect Ratio
                </label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as ExportAspectRatio)}
                  className="w-full bg-cs-bg-surface border border-cs-border-subtle rounded px-2.5 py-1.5 text-xs text-cs-text focus:outline-none focus:border-cs-accent"
                >
                  <option value="16:9">16:9 (Landscape)</option>
                  <option value="9:16">9:16 (Vertical / Reels)</option>
                  <option value="1:1">1:1 (Square)</option>
                  <option value="4:5">4:5 (Portrait)</option>
                </select>
              </div>

              {/* Resolution Preset */}
              <div>
                <label className="block text-xs font-medium text-cs-text-secondary mb-1">
                  Resolution Preset
                </label>
                <select
                  value={preset}
                  onChange={(e) => handlePresetChange(e.target.value as ExportPreset)}
                  className="w-full bg-cs-bg-surface border border-cs-border-subtle rounded px-2.5 py-1.5 text-xs text-cs-text focus:outline-none focus:border-cs-accent"
                >
                  <option value="1080p">1080p Full HD</option>
                  <option value="720p">720p HD</option>
                  <option value="540p">540p SD</option>
                </select>
              </div>
            </div>

            {/* Frame Rate & Quality */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-cs-text-secondary mb-1">
                  Frame Rate
                </label>
                <select
                  value={frameRate}
                  onChange={(e) => setFrameRate(Number(e.target.value))}
                  className="w-full bg-cs-bg-surface border border-cs-border-subtle rounded px-2.5 py-1.5 text-xs text-cs-text focus:outline-none focus:border-cs-accent"
                >
                  <option value={30}>30 fps (Standard)</option>
                  <option value={60}>60 fps (Smooth)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-cs-text-secondary mb-1">
                  Quality
                </label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as ExportQuality)}
                  className="w-full bg-cs-bg-surface border border-cs-border-subtle rounded px-2.5 py-1.5 text-xs text-cs-text focus:outline-none focus:border-cs-accent"
                >
                  <option value="high">High Quality</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low (Fast)</option>
                </select>
              </div>
            </div>

            {/* Format & Codec */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-cs-text-secondary mb-1">
                  Container Format
                </label>
                <select
                  value={format}
                  onChange={(e) => handleFormatChange(e.target.value as ExportFormat)}
                  className="w-full bg-cs-bg-surface border border-cs-border-subtle rounded px-2.5 py-1.5 text-xs text-cs-text focus:outline-none focus:border-cs-accent"
                >
                  <option
                    value="mp4"
                    disabled={capabilities !== null && !capabilities.canExportMp4AvcAac}
                  >
                    MP4 (H.264 + AAC) {capabilities !== null && !capabilities.canExportMp4AvcAac ? "[Unsupported]" : "[Recommended]"}
                  </option>
                  <option
                    value="webm"
                    disabled={capabilities !== null && !capabilities.canExportWebmOpus}
                  >
                    WebM (VP9 + Opus) {capabilities !== null && !capabilities.canExportWebmOpus ? "[Unsupported]" : ""}
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-cs-text-secondary mb-1">
                  Dimensions
                </label>
                <div className="h-[34px] flex items-center px-2.5 text-xs font-mono text-cs-text-secondary bg-cs-bg-surface/50 border border-cs-border-subtle rounded">
                  {dimensions.width} × {dimensions.height}
                </div>
              </div>
            </div>

            {/* Output Filename */}
            <div>
              <label className="block text-xs font-medium text-cs-text-secondary mb-1">
                Output Filename
              </label>
              <input
                type="text"
                value={filename}
                onChange={(e) => {
                  setFilename(e.target.value);
                  setHasCustomFilename(true);
                }}
                className="w-full bg-cs-bg-surface border border-cs-border-subtle rounded px-2.5 py-1.5 text-xs text-cs-text font-mono focus:outline-none focus:border-cs-accent"
              />
            </div>

            {/* Preflight & Capability Status Card */}
            <div className="p-3 rounded border border-cs-border-subtle bg-cs-bg-surface space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-cs-text">Render Preflight</span>
                <span className="text-[11px] text-cs-text-tertiary">
                  Duration: {formatDuration(plan.totalDurationSeconds)} ({plan.totalFrames} frames)
                </span>
              </div>

              {/* Capability status */}
              {checkingCaps ? (
                <div className="text-[11px] text-cs-text-tertiary">
                  Checking browser video encoders...
                </div>
              ) : !capabilities?.hasWebCodecs ? (
                <div className="flex items-center gap-1.5 text-[11px] text-amber-400">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  WebCodecs encoders not supported in this browser. Desktop Chrome or Edge is required to render.
                </div>
              ) : !isSelectedFormatSupported ? (
                <div className="flex items-center gap-1.5 text-[11px] text-amber-400">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  {format === "webm"
                    ? "VP9/Opus encoder is not supported in this browser. Try MP4 format."
                    : "H.264/AAC encoder is not supported in this browser. Try WebM format or use desktop Chrome/Edge."}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  Browser WebCodecs ({format === "webm" ? "VP9/Opus" : "H.264/AAC"}) available
                </div>
              )}

              {/* Missing sources alert */}
              {plan.missingSources.length > 0 && (
                <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px]">
                  {plan.missingSources.length} source file(s) are offline or missing. Please relink them in the library before exporting.
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleStartExport}
                disabled={!plan.isValid || checkingCaps || !isSelectedFormatSupported}
              >
                Start Export
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
      {previewFile && (
        <RenderedVideoModal
          file={previewFile.file}
          filename={previewFile.name}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </>
  );
}

function ExportHistoryView({
  exports,
  projectId,
  workspaceHandle,
  onExportsUpdated,
  onPreview,
}: {
  exports: ProjectExport[];
  projectId: string;
  workspaceHandle?: FileSystemDirectoryHandle;
  onExportsUpdated?: (updated: ProjectExport[]) => void;
  onPreview?: (file: File, name: string) => void;
}) {
  const [fileStatuses, setFileStatuses] = useState<Map<string, ExportFileStatus>>(new Map());

  // Rename state
  const [renamingExport, setRenamingExport] = useState<ProjectExport | null>(null);
  const [newNameInput, setNewNameInput] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);

  // Delete state
  const [deletingExport, setDeletingExport] = useState<ProjectExport | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Check file presence on disk
  useEffect(() => {
    if (!workspaceHandle) return;
    let isCancelled = false;

    async function check() {
      const statuses = new Map<string, ExportFileStatus>();
      for (const exp of exports) {
        try {
          const res = await checkExportFileStatus(workspaceHandle!, projectId, exp.name);
          statuses.set(exp.id, res);
        } catch {
          statuses.set(exp.id, { exists: false, error: "Failed to access file" });
        }
      }
      if (!isCancelled) {
        setFileStatuses(statuses);
      }
    }

    void check();
    return () => {
      isCancelled = true;
    };
  }, [workspaceHandle, projectId, exports]);

  const handleDownload = (exp: ProjectExport) => {
    const status = fileStatuses.get(exp.id);
    if (!status?.file) return;
    const url = URL.createObjectURL(status.file);
    const a = document.createElement("a");
    a.href = url;
    a.download = exp.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleStartRename = (exp: ProjectExport) => {
    setRenamingExport(exp);
    setNewNameInput(exp.name.replace(/\.[^/.]+$/, ""));
    setRenameError(null);
  };

  const handleConfirmRename = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!workspaceHandle || !renamingExport || !onExportsUpdated) return;

    setIsRenaming(true);
    setRenameError(null);
    try {
      const { updatedExports } = await renameExport(
        workspaceHandle,
        projectId,
        renamingExport.id,
        exports,
        newNameInput
      );
      onExportsUpdated(updatedExports);
      setRenamingExport(null);
    } catch (err: unknown) {
      setRenameError(err instanceof Error ? err.message : "Failed to rename export.");
    } finally {
      setIsRenaming(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!workspaceHandle || !deletingExport || !onExportsUpdated) return;

    setIsDeleting(true);
    try {
      const updated = await deleteExport(
        workspaceHandle,
        projectId,
        deletingExport.id,
        exports,
        true
      );
      onExportsUpdated(updated);
      setDeletingExport(null);
    } catch (err: unknown) {
      console.warn("Failed to delete export:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRemoveStaleRecord = (exportId: string) => {
    if (!onExportsUpdated) return;
    const updated = exports.filter((e) => e.id !== exportId);
    onExportsUpdated(updated);
  };

  if (exports.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-cs-text-tertiary">
        No completed exports yet for this project.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {exports.map((exp) => {
          const status = fileStatuses.get(exp.id);
          const isAvailable = status?.exists ?? true;

          return (
            <div
              key={exp.id}
              className="p-3 rounded-lg border border-cs-border-subtle bg-cs-bg-surface flex items-center justify-between text-xs"
            >
              <div className="space-y-1 min-w-0 pr-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-cs-text-primary font-mono truncate max-w-[260px]">
                    {exp.name}
                  </span>
                  {isAvailable ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">
                      Available
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium">
                      Missing file
                    </span>
                  )}
                </div>

                <div className="text-[11px] text-cs-text-secondary flex items-center gap-2 flex-wrap">
                  <span>{exp.width} × {exp.height}</span>
                  <span>•</span>
                  <span>{formatDuration(exp.duration)}</span>
                  <span>•</span>
                  <span>{formatBytes(exp.fileSize)}</span>
                  <span>•</span>
                  <span>{new Date(exp.createdAt).toLocaleDateString()}</span>
                </div>

                {!isAvailable && (
                  <p className="text-[10px] text-amber-400 mt-0.5">
                    File was moved or deleted externally from the exports folder.
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1.5 shrink-0">
                {isAvailable ? (
                  <>
                    {onPreview && status?.file && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => onPreview(status.file!, exp.name)}
                        title="Preview rendered video inside app"
                        className="flex items-center gap-1"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        Preview
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleDownload(exp)}
                      title="Download or save video file"
                    >
                      Download
                    </Button>
                    {workspaceHandle && onExportsUpdated && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleStartRename(exp)}
                        title="Rename output file"
                      >
                        Rename
                      </Button>
                    )}
                    {workspaceHandle && onExportsUpdated && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setDeletingExport(exp)}
                        title="Delete output file"
                      >
                        Delete
                      </Button>
                    )}
                  </>
                ) : (
                  onExportsUpdated && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleRemoveStaleRecord(exp.id)}
                      title="Remove missing entry from history"
                    >
                      Clear Record
                    </Button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Rename Output Modal */}
      <Modal
        open={renamingExport !== null}
        onClose={() => setRenamingExport(null)}
        title="Rename Export Output"
        description="Rename this output file on disk and in your project export history."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setRenamingExport(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleConfirmRename}
              disabled={isRenaming || !newNameInput.trim()}
            >
              {isRenaming ? "Renaming…" : "Rename File"}
            </Button>
          </>
        }
      >
        <form onSubmit={handleConfirmRename} className="space-y-3 text-xs">
          {renameError && (
            <div className="p-2.5 rounded bg-cs-error/10 border border-cs-error/20 text-cs-error">
              {renameError}
            </div>
          )}
          <div>
            <label className="block text-cs-text-secondary mb-1 font-medium">New Filename</label>
            <input
              type="text"
              value={newNameInput}
              onChange={(e) => setNewNameInput(e.target.value)}
              autoFocus
              className="w-full bg-cs-bg-base border border-cs-border-subtle rounded px-2.5 py-1.5 text-xs text-cs-text-primary font-mono focus:outline-none focus:border-cs-accent"
            />
          </div>
        </form>
      </Modal>

      {/* Delete Output Confirmation Modal */}
      <Modal
        open={deletingExport !== null}
        onClose={() => setDeletingExport(null)}
        title="Delete Export Output"
        description="Are you sure you want to delete this finished output from disk?"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDeletingExport(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting…" : "Delete Output File"}
            </Button>
          </>
        }
      >
        {deletingExport && (
          <div className="space-y-3 text-xs text-cs-text-secondary leading-relaxed">
            <div className="p-3 rounded bg-cs-bg-surface border border-cs-border-subtle font-mono text-cs-text-primary">
              {deletingExport.name} ({formatBytes(deletingExport.fileSize)})
            </div>
            <div className="p-3 rounded bg-cs-info/10 border border-cs-info/20 text-cs-text-primary space-y-1">
              <p className="font-semibold text-cs-info">Safety Confirmation</p>
              <p className="text-[11px] text-cs-text-secondary">
                This will delete the rendered file from your workspace <code>exports/</code> directory. Your <strong>original source footage</strong> and project timeline will <strong>not</strong> be touched.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/**
 * Dedicated In-App Player for completed rendered export files.
 */
function RenderedVideoModal({
  file,
  filename,
  onClose,
}: {
  file: File;
  filename: string;
  onClose: () => void;
}) {
  const [videoUrl, setVideoUrl] = useState<string>(() => URL.createObjectURL(file));

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const frameId = requestAnimationFrame(() => {
      setVideoUrl(url);
    });
    return () => {
      cancelAnimationFrame(frameId);
      URL.revokeObjectURL(url);
    };
  }, [file]);

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Rendered Export Preview"
      description={`Playing exported file: ${filename} (${formatBytes(file.size)})`}
    >
      <div className="space-y-4">
        {/* Visual player surface */}
        <div className="relative bg-black rounded-lg overflow-hidden aspect-video flex items-center justify-center border border-cs-border-subtle shadow-inner">
          {videoUrl && (
            <video
              src={videoUrl}
              controls
              autoPlay
              playsInline
              className="w-full h-full object-contain"
            />
          )}
        </div>

        <div className="flex justify-between items-center text-xs text-cs-text-secondary pt-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span className="font-mono text-cs-text-primary">{filename}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close Preview
          </Button>
        </div>
      </div>
    </Modal>
  );
}
