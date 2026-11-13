"use client";

/**
 * ProjectWorkspace — The main workspace view when a project is open (Phase 2).
 *
 * Responsibilities:
 * - Displays project header with title, rename action, and live autosave status.
 * - Displays Media Library containing imported video and audio file references.
 * - Supports importing files without copying bytes to workspace or OPFS.
 * - Supports relinking missing or moved source files with metadata comparison.
 * - Supports removing media references without deleting original files.
 * - Honest Phase 2 indicator: timeline and video playback arrive in later phases.
 */

import * as React from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import type {
  ProjectDocument,
  ProjectAsset,
  LiveAssetItem,
  SaveState,
} from "../types/project.ts";
import { ProjectSaveQueue } from "../lib/projectSaveQueue.ts";
import {
  pickAndImportFiles,
  importFallbackFiles,
  resolveAssetStatus,
  authorizeAssetAccess,
  compareRelinkMetadata,
  relinkAssetHandle,
  removeAssetReference,
  type RelinkComparison,
} from "../lib/mediaImport.ts";
import { formatBytes, sanitizeProjectName } from "../lib/projectValidation.ts";
import {
  Button,
  IconButton,
  Badge,
  Panel,
  PanelHeader,
  EmptyState,
  Modal,
  StatusIndicator,
} from "@/components/ui";

interface ProjectWorkspaceProps {
  project: ProjectDocument;
  workspaceHandle: FileSystemDirectoryHandle;
  onCloseProject: () => void;
  onProjectUpdated: (updatedDoc: ProjectDocument) => void;
}

export function ProjectWorkspace({
  project,
  workspaceHandle,
  onCloseProject,
  onProjectUpdated,
}: ProjectWorkspaceProps) {
  const [doc, setDoc] = useState<ProjectDocument>(project);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);

  // Live status of each asset
  const [liveAssets, setLiveAssets] = useState<Map<string, LiveAssetItem>>(new Map());
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Relink modal state
  const [relinkTargetAsset, setRelinkTargetAsset] = useState<ProjectAsset | null>(null);
  const [relinkComparison, setRelinkComparison] = useState<RelinkComparison | null>(null);
  const [pendingRelinkFile, setPendingRelinkFile] = useState<{ handle?: FileSystemFileHandle; file: File } | null>(null);

  // Remove asset modal state
  const [assetToRemove, setAssetToRemove] = useState<ProjectAsset | null>(null);

  // Save queue instance initialized via state initializer
  const [saveQueue] = useState(() => new ProjectSaveQueue(workspaceHandle, 600));

  // Subscribe to save queue state
  useEffect(() => {
    const unsubscribe = saveQueue.subscribe((state, err) => {
      setSaveState(state);
      setSaveError(err);
    });
    return () => unsubscribe();
  }, [saveQueue]);

  // Update save queue and parent when doc changes
  const updateProject = useCallback(
    (newDoc: ProjectDocument) => {
      setDoc(newDoc);
      onProjectUpdated(newDoc);
      saveQueue.enqueue(newDoc);
    },
    [onProjectUpdated, saveQueue]
  );

  // Resolve live status for all assets on load asynchronously
  useEffect(() => {
    let isCancelled = false;

    async function loadStatuses() {
      const statusMap = new Map<string, LiveAssetItem>();
      for (const asset of doc.assets) {
        try {
          const item = await resolveAssetStatus(asset);
          statusMap.set(asset.id, item);
        } catch (err: unknown) {
          statusMap.set(asset.id, {
            asset,
            status: "missing",
            errorMessage: err instanceof Error ? err.message : "Failed to resolve file status.",
          });
        }
      }
      if (!isCancelled) {
        setLiveAssets(statusMap);
      }
    }

    void loadStatuses();

    return () => {
      isCancelled = true;
    };
  }, [doc.assets]);

  // Handle closing project safely
  const handleCloseProject = async () => {
    try {
      await saveQueue.flush();
    } catch (err) {
      console.warn("Save flush failed on close:", err);
    }
    onCloseProject();
  };

  // Submit project rename
  const handleRenameSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const sanitized = sanitizeProjectName(renameValue);
    if (sanitized && sanitized !== doc.name) {
      updateProject({
        ...doc,
        name: sanitized,
      });
    }
    setIsRenaming(false);
  };

  // Import media via File System Access API
  const handleImportMedia = async () => {
    setIsImporting(true);
    setImportError(null);

    const hasPicker = typeof window !== "undefined" && typeof window.showOpenFilePicker === "function";

    if (hasPicker) {
      try {
        const newAssets = await pickAndImportFiles(doc.assets);
        if (newAssets.length > 0) {
          const updated = {
            ...doc,
            assets: [...doc.assets, ...newAssets],
          };
          updateProject(updated);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setImportError(err.message);
        }
      } finally {
        setIsImporting(false);
      }
    } else {
      // Trigger hidden input fallback
      fallbackFileInputRef.current?.click();
      setIsImporting(false);
    }
  };

  // Fallback file input change
  const fallbackFileInputRef = useRef<HTMLInputElement | null>(null);
  const handleFallbackFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const newAssets = await importFallbackFiles(files, doc.assets);
      if (newAssets.length > 0) {
        const updated = {
          ...doc,
          assets: [...doc.assets, ...newAssets],
        };
        updateProject(updated);
      }
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : "Failed to import files.");
    } finally {
      // Reset input value so same files can be chosen again if needed
      if (fallbackFileInputRef.current) {
        fallbackFileInputRef.current.value = "";
      }
    }
  };

  // Authorize asset handle permission
  const handleAuthorizeAsset = async (asset: ProjectAsset) => {
    try {
      const updatedItem = await authorizeAssetAccess(asset);
      setLiveAssets((prev) => new Map(prev).set(asset.id, updatedItem));
    } catch (err: unknown) {
      console.warn("Authorization failed:", err);
    }
  };

  // Open relink flow
  const handleStartRelink = async (asset: ProjectAsset) => {
    setRelinkTargetAsset(asset);
    setRelinkComparison(null);
    setPendingRelinkFile(null);

    const showFiles = typeof window !== "undefined" ? window.showOpenFilePicker : undefined;

    if (typeof showFiles === "function") {
      try {
        const handles = await showFiles({
          multiple: false,
          types: [
            {
              description: "Media Files",
              accept: {
                "video/*": [".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"],
                "audio/*": [".mp3", ".wav", ".aac", ".m4a", ".ogg", ".flac", ".opus"],
              },
            },
          ],
        });
        if (!handles || handles.length === 0) {
          setRelinkTargetAsset(null);
          return;
        }

        const handle = handles[0];
        const file = await handle.getFile();
        const comparison = compareRelinkMetadata(asset, file);

        if (comparison.match) {
          // Exact match on filename, size, and date: apply relink immediately without prompt
          const updatedAsset = await relinkAssetHandle(asset, handle, file);
          const updatedAssets = doc.assets.map((a) => (a.id === asset.id ? updatedAsset : a));
          updateProject({ ...doc, assets: updatedAssets });
          setRelinkTargetAsset(null);
        } else {
          // File attributes differ: display comparison dialog for user confirmation
          setPendingRelinkFile({ handle, file });
          setRelinkComparison(comparison);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          console.warn("Relink file selection error:", err);
        }
        setRelinkTargetAsset(null);
      }
    } else {
      // Use fallback file input for relink
      relinkFileInputRef.current?.click();
    }
  };

  // Fallback relink file input
  const relinkFileInputRef = useRef<HTMLInputElement | null>(null);
  const handleFallbackRelinkChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !relinkTargetAsset) return;
    const file = files[0];
    const comparison = compareRelinkMetadata(relinkTargetAsset, file);

    setPendingRelinkFile({ file });
    setRelinkComparison(comparison);
    if (relinkFileInputRef.current) {
      relinkFileInputRef.current.value = "";
    }
  };

  // Confirm relink replacement
  const handleConfirmRelink = async () => {
    if (!relinkTargetAsset || !pendingRelinkFile) return;

    try {
      let updatedAsset: ProjectAsset;
      if (pendingRelinkFile.handle) {
        updatedAsset = await relinkAssetHandle(
          relinkTargetAsset,
          pendingRelinkFile.handle,
          pendingRelinkFile.file
        );
      } else {
        // Fallback session file
        const sessionAssets = await importFallbackFiles([pendingRelinkFile.file], []);
        updatedAsset = {
          ...relinkTargetAsset,
          name: pendingRelinkFile.file.name,
          size: pendingRelinkFile.file.size,
          lastModified: pendingRelinkFile.file.lastModified,
          handleRefId: sessionAssets[0].handleRefId,
        };
      }

      const updatedAssets = doc.assets.map((a) =>
        a.id === relinkTargetAsset.id ? updatedAsset : a
      );
      updateProject({ ...doc, assets: updatedAssets });
    } catch (err) {
      console.warn("Failed to confirm relink:", err);
    } finally {
      setRelinkTargetAsset(null);
      setRelinkComparison(null);
      setPendingRelinkFile(null);
    }
  };

  // Remove asset from project
  const handleConfirmRemoveAsset = async () => {
    if (!assetToRemove) return;

    try {
      await removeAssetReference(assetToRemove.handleRefId);
      const updatedAssets = doc.assets.filter((a) => a.id !== assetToRemove.id);
      updateProject({ ...doc, assets: updatedAssets });
    } catch (err) {
      console.warn("Failed to remove asset reference:", err);
    } finally {
      setAssetToRemove(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-cs-bg-base">
      {/* Hidden file inputs for fallbacks */}
      <input
        ref={fallbackFileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*"
        className="hidden"
        onChange={handleFallbackFileChange}
      />
      <input
        ref={relinkFileInputRef}
        type="file"
        accept="video/*,audio/*"
        className="hidden"
        onChange={handleFallbackRelinkChange}
      />

      {/* Top Project Bar */}
      <div className="flex items-center justify-between gap-4 h-12 px-4 bg-cs-bg-surface border-b border-cs-border-subtle shrink-0">
        {/* Left: Back button + Project Name */}
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCloseProject}
            title="Return to projects list"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span className="hidden sm:inline">Projects</span>
          </Button>

          <span className="text-cs-border-default">/</span>

          {/* Project Title / Inline Rename */}
          {isRenaming ? (
            <form onSubmit={handleRenameSubmit} className="flex items-center gap-1.5">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
                onBlur={handleRenameSubmit}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setIsRenaming(false);
                    setRenameValue(doc.name);
                  }
                }}
                className="h-7 px-2 text-xs font-semibold rounded bg-cs-bg-base border border-cs-border-focus text-cs-text-primary focus:outline-none"
              />
              <Button type="submit" variant="primary" size="sm">
                Save
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2 group">
              <span className="text-sm font-semibold text-cs-text-primary truncate">
                {doc.name}
              </span>
              <IconButton
                label="Rename project"
                size="sm"
                onClick={() => {
                  setRenameValue(doc.name);
                  setIsRenaming(true);
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </IconButton>
            </div>
          )}
        </div>

        {/* Right: Autosave Status & Close Project */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Save status badge */}
          {saveState === "saving" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-cs-text-secondary">
              <span className="w-1.5 h-1.5 rounded-full bg-cs-info animate-pulse" />
              Saving…
            </span>
          )}
          {saveState === "saved" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-cs-text-tertiary">
              <span className="w-1.5 h-1.5 rounded-full bg-cs-success" />
              Saved to workspace
            </span>
          )}
          {saveState === "error" && (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-cs-error font-medium" title={saveError}>
                <span className="w-1.5 h-1.5 rounded-full bg-cs-error" />
                Save failed
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => saveQueue.retry()}
              >
                Retry
              </Button>
            </div>
          )}

          <Button variant="secondary" size="sm" onClick={handleCloseProject}>
            Close
          </Button>
        </div>
      </div>

      {/* Main Area: Split Pane */}
      <div className="flex-1 overflow-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Media Library */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Panel>
            <PanelHeader
              title="Media Library"
              description={`${doc.assets.length} source file${doc.assets.length === 1 ? "" : "s"} referenced`}
              actions={
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleImportMedia}
                  disabled={isImporting}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Import media
                </Button>
              }
            />

            {importError && (
              <div className="px-4 py-2.5 bg-cs-error/10 border-b border-cs-error/20 flex items-center justify-between text-xs text-cs-error">
                <span>{importError}</span>
                <IconButton label="Dismiss error" size="sm" onClick={() => setImportError(null)}>
                  ×
                </IconButton>
              </div>
            )}

            {doc.assets.length === 0 ? (
              <EmptyState
                icon={
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" strokeWidth="1.3" stroke="currentColor">
                    <rect x="2" y="6" width="20" height="12" rx="2" />
                    <path d="M7 6v12M17 6v12M2 10h20M2 14h20" />
                  </svg>
                }
                title="No media in this project"
                description="Import video and audio files from your computer. Files remain in their original locations — Content Studio references them without copying."
                action={
                  <Button variant="secondary" size="md" onClick={handleImportMedia}>
                    Select video or audio files
                  </Button>
                }
              />
            ) : (
              <ul role="list" className="divide-y divide-cs-border-subtle" aria-label="Project source files">
                {doc.assets.map((asset) => {
                  const live = liveAssets.get(asset.id);
                  const status = live?.status || "ready";

                  return (
                    <li
                      key={asset.id}
                      className="flex items-center justify-between gap-4 p-3 hover:bg-cs-bg-elevated/40 transition-colors"
                    >
                      {/* Left: Icon + File info */}
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Media type icon */}
                        <div className="shrink-0 w-8 h-8 rounded bg-cs-bg-muted flex items-center justify-center text-cs-text-secondary border border-cs-border-subtle">
                          {asset.mediaType === "video" ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
                              <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                          ) : asset.mediaType === "audio" ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
                              <path d="M9 18V5l12-2v13" />
                              <circle cx="6" cy="18" r="3" />
                              <circle cx="18" cy="16" r="3" />
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
                              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                              <polyline points="13 2 13 9 20 9" />
                            </svg>
                          )}
                        </div>

                        {/* File Details */}
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-cs-text-primary truncate" title={asset.name}>
                              {asset.name}
                            </span>
                            <Badge variant={asset.mediaType === "video" ? "default" : asset.mediaType === "audio" ? "info" : "muted"}>
                              {asset.mediaType.toUpperCase()}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-cs-text-tertiary mt-0.5">
                            <span>{formatBytes(asset.size)}</span>
                            {asset.lastModified && (
                              <>
                                <span>·</span>
                                <span>Modified {new Date(asset.lastModified).toLocaleDateString()}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Status badge & Actions */}
                      <div className="flex items-center gap-3 shrink-0">
                        {status === "ready" && (
                          <StatusIndicator level="ok" label="Accessible" />
                        )}
                        {status === "prompt-required" && (
                          <div className="flex items-center gap-2">
                            <StatusIndicator level="warning" label="Re-authorize" />
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleAuthorizeAsset(asset)}
                              title="Click to restore file access permission"
                            >
                              Authorize
                            </Button>
                          </div>
                        )}
                        {status === "missing" && (
                          <div className="flex items-center gap-2">
                            <StatusIndicator level="error" label="Moved or missing" />
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleStartRelink(asset)}
                              title="Locate replacement file"
                            >
                              Relink
                            </Button>
                          </div>
                        )}
                        {status === "session-only" && (
                          <Badge variant="muted" title="File selected via standard file input. It is available during this tab session only.">
                            Session only
                          </Badge>
                        )}

                        {/* Action buttons */}
                        <div className="flex items-center gap-1">
                          <IconButton
                            label="Relink source file"
                            size="sm"
                            onClick={() => handleStartRelink(asset)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                            </svg>
                          </IconButton>
                          <IconButton
                            label="Remove from project"
                            size="sm"
                            onClick={() => setAssetToRemove(asset)}
                            className="hover:text-cs-error"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </IconButton>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        {/* Right Col: Honest Phase 2 Guidance & Project Details */}
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title="Project Details" />
            <div className="p-4 flex flex-col gap-3 text-xs">
              <div>
                <span className="text-cs-text-tertiary block mb-0.5">Project ID (UUID)</span>
                <span className="font-mono text-cs-text-secondary select-all break-all">
                  {doc.id}
                </span>
              </div>
              <div className="flex justify-between border-t border-cs-border-subtle pt-2">
                <span className="text-cs-text-tertiary">Created</span>
                <span className="text-cs-text-secondary">
                  {new Date(doc.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between border-t border-cs-border-subtle pt-2">
                <span className="text-cs-text-tertiary">Last Saved</span>
                <span className="text-cs-text-secondary">
                  {new Date(doc.updatedAt).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between border-t border-cs-border-subtle pt-2">
                <span className="text-cs-text-tertiary">Total Media Size</span>
                <span className="text-cs-text-secondary font-medium">
                  {formatBytes(doc.assets.reduce((sum, a) => sum + a.size, 0))}
                </span>
              </div>
              <div className="flex justify-between border-t border-cs-border-subtle pt-2">
                <span className="text-cs-text-tertiary">On-Disk Document</span>
                <span className="font-mono text-cs-text-secondary text-[10px] truncate" title={`projects/${doc.id}/project.json`}>
                  projects/{doc.id.slice(0, 8)}…/project.json
                </span>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Editor Roadmap" />
            <div className="p-4 flex flex-col gap-2.5 text-xs text-cs-text-secondary leading-relaxed">
              <div className="flex items-center gap-2">
                <Badge variant="success">Phase 2 Active</Badge>
                <span className="font-medium text-cs-text-primary">Workspace & Persistence</span>
              </div>
              <p>
                Your project document and media references are durably saved to your chosen local workspace.
              </p>
              <div className="mt-2 pt-3 border-t border-cs-border-subtle flex flex-col gap-2">
                <div className="flex items-center justify-between text-cs-text-tertiary">
                  <span>Phase 3 — Media Engine</span>
                  <Badge variant="muted">Next</Badge>
                </div>
                <div className="flex items-center justify-between text-cs-text-tertiary">
                  <span>Phase 4 — Timeline Editor</span>
                  <Badge variant="muted">Upcoming</Badge>
                </div>
                <div className="flex items-center justify-between text-cs-text-tertiary">
                  <span>Phase 5 — Local Export</span>
                  <Badge variant="muted">Upcoming</Badge>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      {/* Relink Confirmation Modal */}
      <Modal
        open={relinkComparison !== null}
        onClose={() => {
          setRelinkComparison(null);
          setRelinkTargetAsset(null);
          setPendingRelinkFile(null);
        }}
        title="Confirm File Relink"
        description="The selected file differs from the original reference recorded in the project document."
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setRelinkComparison(null);
                setRelinkTargetAsset(null);
                setPendingRelinkFile(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleConfirmRelink}>
              Confirm Relink
            </Button>
          </>
        }
      >
        {relinkComparison && (
          <div className="flex flex-col gap-3 text-xs">
            <div className="grid grid-cols-2 gap-3 p-3 rounded bg-cs-bg-base border border-cs-border-subtle">
              <div>
                <span className="text-cs-text-tertiary block mb-1 uppercase text-[10px] tracking-wider font-semibold">
                  Original Reference
                </span>
                <p className="font-medium text-cs-text-primary truncate" title={relinkComparison.original.name}>
                  {relinkComparison.original.name}
                </p>
                <p className="text-cs-text-secondary mt-1">
                  Size: {formatBytes(relinkComparison.original.size)}
                </p>
              </div>
              <div>
                <span className="text-cs-text-tertiary block mb-1 uppercase text-[10px] tracking-wider font-semibold">
                  Selected Replacement
                </span>
                <p className="font-medium text-cs-text-primary truncate" title={relinkComparison.replacement.name}>
                  {relinkComparison.replacement.name}
                </p>
                <p className="text-cs-text-secondary mt-1">
                  Size: {formatBytes(relinkComparison.replacement.size)}
                </p>
              </div>
            </div>

            <div className="p-3 rounded bg-cs-warning/10 border border-cs-warning/20 text-cs-warning">
              <p className="font-medium mb-1">Differences detected:</p>
              <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                {relinkComparison.nameDiffers && <li>Filename does not match.</li>}
                {relinkComparison.sizeDiffers && <li>File size differs.</li>}
                {relinkComparison.dateDiffers && <li>Modification date differs.</li>}
              </ul>
            </div>
          </div>
        )}
      </Modal>

      {/* Remove Asset Confirmation Modal */}
      <Modal
        open={assetToRemove !== null}
        onClose={() => setAssetToRemove(null)}
        title="Remove Media Reference"
        description="Are you sure you want to remove this media reference from the project?"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAssetToRemove(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleConfirmRemoveAsset}>
              Remove reference
            </Button>
          </>
        }
      >
        {assetToRemove && (
          <div className="text-xs text-cs-text-secondary leading-relaxed">
            <p>
              Reference for <strong className="text-cs-text-primary">{assetToRemove.name}</strong> will be removed from this project document.
            </p>
            <p className="mt-2 text-cs-text-tertiary">
              The original file on your computer will <strong>not</strong> be deleted or altered in any way.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
