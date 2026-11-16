"use client";

/**
 * ProjectWorkspace — The main workspace view when a project is open.
 *
 * Full editor layout:
 * - Mode toggle: "library" (browsing/preview) vs "editor" (timeline editor) vs "repurpose"
 * - Editor mode: media library sidebar, timeline preview, clip inspector, timeline editor
 * - Complete local media workflow: import, relink, remove, inspection, save queue, rename
 * - Timeline state management: undo/redo stack, play/pause, seek, autosave
 */

import * as React from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import type {
  ProjectDocument,
  ProjectAsset,
  LiveAssetItem,
  SaveState,
} from "../types/project.ts";
import type { TimelineDocument, TextOverlay } from "../types/timeline.ts";
import { ProjectSaveQueue } from "../lib/projectSaveQueue.ts";
import {
  pickAndImportFiles,
  importFallbackFiles,
  resolveAssetStatus,
  authorizeAssetAccess,
  compareRelinkWithFingerprint,
  relinkAssetHandle,
  removeAssetReference,
  type RelinkComparison,
} from "../lib/mediaImport.ts";
import { formatBytes, sanitizeProjectName } from "../lib/projectValidation.ts";
import { MediaInspectionQueue } from "../lib/media/inspectionQueue.ts";
import { formatDuration } from "../lib/media/inspector.ts";
import {
  createTimeline,
  addTextOverlay,
  getTimelineDuration,
  resolveTextOverlayCollisions,
} from "../lib/timeline/model.ts";
import { TimelineUndoStack } from "../lib/timeline/undoRedo.ts";
import { SourceMonitor } from "./editor/SourceMonitor.tsx";
import { SequenceSelector } from "./editor/SequenceSelector.tsx";
import {
  ensureSequencesInitialized,
  getActiveSequence,
  setActiveSequence,
  addSequenceToProject,
  duplicateSequence,
  renameSequence,
  deleteSequence,
  updateActiveSequenceTimeline,
} from "../lib/timeline/sequenceManager.ts";
import { insertEdit, overwriteEdit } from "../lib/timeline/editingOperations.ts";
import { generateCaptionsForTimeline } from "../lib/transcription/captionGenerator.ts";
import { MediaPreviewPlayer } from "./MediaPreviewPlayer.tsx";
import { TimelineEditor } from "./editor/TimelineEditor.tsx";
import { TimelinePreview } from "./editor/TimelinePreview.tsx";
import { ClipInspector } from "./editor/ClipInspector.tsx";
import { ExportModal } from "./editor/ExportModal.tsx";
import { ProjectRevisionsModal } from "./ProjectRevisionsModal.tsx";
import { CacheManagerModal } from "./CacheManagerModal.tsx";
import { RepurposeWorkflow } from "./repurpose/RepurposeWorkflow.tsx";
import { createProjectRevision } from "../lib/projectRevisions.ts";
import {
  Button,
  IconButton,
  Badge,
  Panel,
  PanelHeader,
  EmptyState,
  Modal,
} from "@/components/ui";

type EditorMode = "library" | "editor" | "repurpose";

interface ProjectWorkspaceProps {
  project: ProjectDocument;
  workspaceHandle: FileSystemDirectoryHandle;
  onCloseProject: () => void;
  onProjectUpdated: (updatedDoc: ProjectDocument) => void;
}

// Extend ProjectDocument locally to carry optional timeline
type ProjectDocumentWithTimeline = ProjectDocument & { timeline?: TimelineDocument };

export function ProjectWorkspace({
  project,
  workspaceHandle,
  onCloseProject,
  onProjectUpdated,
}: ProjectWorkspaceProps) {
  const [doc, setDoc] = useState<ProjectDocumentWithTimeline>(() =>
    ensureSequencesInitialized(project as ProjectDocumentWithTimeline) as ProjectDocumentWithTimeline
  );
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);

  // Editor mode
  const [editorMode, setEditorMode] = useState<EditorMode>("editor");

  // Selected asset for library preview and source monitor
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(
    project.assets[0]?.id || null
  );
  const [sourceAssetId, setSourceAssetId] = useState<string | null>(
    project.assets[0]?.id || null
  );

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

  // Export modal state
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  // History and cache modals
  const [isRevisionsModalOpen, setIsRevisionsModalOpen] = useState(false);
  const [isCacheModalOpen, setIsCacheModalOpen] = useState(false);

  // ─── Timeline state ─────────────────────────────────────────────────────────

  const [timeline, setTimeline] = useState<TimelineDocument>(() => {
    const p = project as ProjectDocumentWithTimeline;
    return p.timeline ?? createTimeline();
  });

  const [undoStack] = useState(() => {
    const p = project as ProjectDocumentWithTimeline;
    const initial = p.timeline ?? createTimeline();
    return new TimelineUndoStack(initial, 50);
  });
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [isGeneratingCaptions, setIsGeneratingCaptions] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const handleSelectClip = useCallback((clipId: string | null) => {
    setSelectedClipId(clipId);
    if (clipId) {
      setSelectedOverlayId(null);
      setSelectedTrackId(null);
      setSelectedTransitionId(null);
    }
  }, []);

  const handleSelectOverlay = useCallback((overlayId: string | null) => {
    setSelectedOverlayId(overlayId);
    if (overlayId) {
      setSelectedClipId(null);
      setSelectedTrackId(null);
      setSelectedTransitionId(null);
    }
  }, []);

  const handleSelectTrack = useCallback((trackId: string | null) => {
    setSelectedTrackId(trackId);
    if (trackId) {
      setSelectedClipId(null);
      setSelectedOverlayId(null);
      setSelectedTransitionId(null);
    }
  }, []);

  const handleSelectTransition = useCallback((transId: string | null) => {
    setSelectedTransitionId(transId);
    if (transId) {
      setSelectedClipId(null);
      setSelectedOverlayId(null);
      setSelectedTrackId(null);
    }
  }, []);

  const timelineRef = useRef(timeline);
  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  // ─── Save queue & inspection queue ─────────────────────────────────────────

  const [saveQueue] = useState(() => new ProjectSaveQueue(workspaceHandle, 600));
  const [inspectionQueue] = useState(() => new MediaInspectionQueue(1));

  // Ref tracking latest doc
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  // ─── Subscribe to save queue state ─────────────────────────────────────────

  useEffect(() => {
    const unsubscribe = saveQueue.subscribe((state, err) => {
      setSaveState(state);
      setSaveError(err);
    });
    return () => unsubscribe();
  }, [saveQueue]);

  // Clean up inspection queue on unmount
  useEffect(() => {
    return () => {
      inspectionQueue.cancelAll();
    };
  }, [inspectionQueue]);

  // ─── Update project (assets + timeline) ────────────────────────────────────

  const updateProject = useCallback(
    (newDoc: ProjectDocumentWithTimeline) => {
      docRef.current = newDoc;
      setDoc(newDoc);
      onProjectUpdated(newDoc as ProjectDocument);
      saveQueue.enqueue(newDoc as ProjectDocument);
    },
    [onProjectUpdated, saveQueue]
  );

  // ─── Timeline change handler ─────────────────────────────────────────────

  const handleTimelineChange = useCallback((newTimeline: TimelineDocument) => {
    // Record new state in undo stack
    undoStack.push(newTimeline);
    setTimeline(newTimeline);
    setCanUndo(undoStack.canUndo());
    setCanRedo(undoStack.canRedo());

    // Autosave timeline with project and sync active sequence
    const currentDoc = docRef.current;
    const withSeq = updateActiveSequenceTimeline(currentDoc, newTimeline);
    updateProject(withSeq as ProjectDocumentWithTimeline);
  }, [undoStack, updateProject]);

  const handleUndo = useCallback(() => {
    const prev = undoStack.undo();
    if (prev) {
      setTimeline(prev);
      setCanUndo(undoStack.canUndo());
      setCanRedo(undoStack.canRedo());
      const currentDoc = docRef.current;
      const withSeq = updateActiveSequenceTimeline(currentDoc, prev);
      updateProject(withSeq as ProjectDocumentWithTimeline);
    }
  }, [undoStack, updateProject]);

  const handleRedo = useCallback(() => {
    const next = undoStack.redo();
    if (next) {
      setTimeline(next);
      setCanUndo(undoStack.canUndo());
      setCanRedo(undoStack.canRedo());
      const currentDoc = docRef.current;
      const withSeq = updateActiveSequenceTimeline(currentDoc, next);
      updateProject(withSeq as ProjectDocumentWithTimeline);
    }
  }, [undoStack, updateProject]);

  const handleGenerateCaptions = useCallback(async () => {
    if (isGeneratingCaptions) return;
    setIsGeneratingCaptions(true);
    try {
      const newCaptions = await generateCaptionsForTimeline(timeline, liveAssets, {
        modelName: "whisper-tiny_timestamped",
      });
      const nonCaptions = timeline.textOverlays.filter((o) => o.overlayType !== "caption");
      const allOverlays = resolveTextOverlayCollisions([...nonCaptions, ...newCaptions]);
      handleTimelineChange({
        ...timeline,
        textOverlays: allOverlays,
      });
    } catch (err) {
      console.warn("Caption generation failed:", err);
      alert("Caption generation failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsGeneratingCaptions(false);
    }
  }, [isGeneratingCaptions, timeline, liveAssets, handleTimelineChange]);

  // ─── Sequence Management ─────────────────────────────────────────────────

  const handleSelectSequence = useCallback(
    (seqId: string) => {
      const updated = setActiveSequence(docRef.current, seqId);
      updateProject(updated as ProjectDocumentWithTimeline);
      const active = getActiveSequence(updated);
      setTimeline(active.timeline);
      undoStack.clear();
      undoStack.push(active.timeline);
      setCanUndo(false);
      setCanRedo(false);
      setCurrentTime(0);
    },
    [undoStack, updateProject]
  );

  const handleCreateSequence = useCallback(
    (name: string, aspectRatio: "16:9" | "9:16" | "1:1" | "4:5", fps: number) => {
      const updated = addSequenceToProject(docRef.current, { name, aspectRatio, fps });
      updateProject(updated as ProjectDocumentWithTimeline);
      const active = getActiveSequence(updated);
      setTimeline(active.timeline);
      undoStack.clear();
      undoStack.push(active.timeline);
      setCanUndo(false);
      setCanRedo(false);
      setCurrentTime(0);
    },
    [undoStack, updateProject]
  );

  const handleDuplicateSequence = useCallback(
    (seqId: string) => {
      const updated = duplicateSequence(docRef.current, seqId);
      updateProject(updated as ProjectDocumentWithTimeline);
      const active = getActiveSequence(updated);
      setTimeline(active.timeline);
      undoStack.clear();
      undoStack.push(active.timeline);
      setCanUndo(false);
      setCanRedo(false);
    },
    [undoStack, updateProject]
  );

  const handleRenameSequence = useCallback(
    (seqId: string, newName: string) => {
      const updated = renameSequence(docRef.current, seqId, newName);
      updateProject(updated as ProjectDocumentWithTimeline);
    },
    [updateProject]
  );

  const handleDeleteSequence = useCallback(
    (seqId: string) => {
      try {
        const updated = deleteSequence(docRef.current, seqId);
        updateProject(updated as ProjectDocumentWithTimeline);
        const active = getActiveSequence(updated);
        setTimeline(active.timeline);
        undoStack.clear();
        undoStack.push(active.timeline);
        setCanUndo(false);
        setCanRedo(false);
      } catch (err: unknown) {
        console.warn("Failed to delete sequence:", err);
      }
    },
    [undoStack, updateProject]
  );

  // ─── Insert & Overwrite Edits ─────────────────────────────────────────────

  const handleInsertEdit = useCallback(
    (assetId: string, sIn: number, sOut: number, targetTrackId: string) => {
      const targetTrack = timelineRef.current.tracks.find((t) => t.id === targetTrackId);
      const liveItem = liveAssets.get(assetId);
      const hasAudio = (liveItem?.asset.metadata?.audioTracks?.length ?? 0) > 0 || liveItem?.asset.mediaType === "audio";
      const audioTrack = targetTrack?.type === "video" && hasAudio
        ? timelineRef.current.tracks.find((t) => t.type === "audio")
        : undefined;

      const updated = insertEdit(
        timelineRef.current,
        targetTrackId,
        assetId,
        sIn,
        sOut,
        currentTime,
        true,
        audioTrack?.id
      );
      handleTimelineChange(updated);
    },
    [currentTime, handleTimelineChange, liveAssets]
  );

  const handleOverwriteEdit = useCallback(
    (assetId: string, sIn: number, sOut: number, targetTrackId: string) => {
      const targetTrack = timelineRef.current.tracks.find((t) => t.id === targetTrackId);
      const liveItem = liveAssets.get(assetId);
      const hasAudio = (liveItem?.asset.metadata?.audioTracks?.length ?? 0) > 0 || liveItem?.asset.mediaType === "audio";
      const audioTrack = targetTrack?.type === "video" && hasAudio
        ? timelineRef.current.tracks.find((t) => t.type === "audio")
        : undefined;

      const updated = overwriteEdit(
        timelineRef.current,
        targetTrackId,
        assetId,
        sIn,
        sOut,
        currentTime,
        audioTrack?.id
      );
      handleTimelineChange(updated);
    },
    [currentTime, handleTimelineChange, liveAssets]
  );

  const handleSeek = useCallback((time: number) => {
    setCurrentTime(Math.max(0, time));
  }, []);

  const handlePlayPause = useCallback(() => {
    setIsPlaying((playing) => {
      if (!playing) {
        const duration = getTimelineDuration(timelineRef.current);
        if (duration > 0 && currentTime >= duration - 0.05) {
          setCurrentTime(0);
        }
      }
      return !playing;
    });
  }, [currentTime]);

  const handlePlaybackTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleAddTextOverlay = useCallback((overlay: TextOverlay) => {
    const newTimeline = addTextOverlay(timelineRef.current, overlay);
    handleTimelineChange(newTimeline);
    setSelectedOverlayId(overlay.id);
    setSelectedClipId(null);
  }, [handleTimelineChange]);

  const handleApplyRepurposedSequence = useCallback(
    async (updatedTimeline: TimelineDocument, reason: string) => {
      // 1. Create a revision checkpoint
      try {
        await createProjectRevision(workspaceHandle, docRef.current, reason, { force: true });
      } catch (err) {
        console.warn("Failed to create repurpose revision snapshot:", err);
      }

      // 2. Push to undo stack
      undoStack.push(updatedTimeline);
      setCanUndo(undoStack.canUndo());
      setCanRedo(undoStack.canRedo());

      // 3. Update timeline state and active document
      setTimeline(updatedTimeline);
      setCurrentTime(0);
      setSelectedClipId(null);
      setSelectedOverlayId(null);

      const updatedDoc = {
        ...docRef.current,
        updatedAt: new Date().toISOString(),
        timeline: updatedTimeline,
        settings: {
          ...docRef.current.settings,
          targetAspectRatio: updatedTimeline.settings?.targetAspectRatio,
        },
      } as ProjectDocumentWithTimeline;

      updateProject(updatedDoc);

      // 4. Switch to timeline editor
      setEditorMode("editor");
    },
    [undoStack, updateProject, workspaceHandle]
  );

  // ─── Asset status resolution ────────────────────────────────────────────────

  const assetSourcesKey = doc.assets
    .map((a) => `${a.id}:${a.handleRefId}:${a.size}:${a.lastModified || 0}`)
    .join("|");

  useEffect(() => {
    let isCancelled = false;

    async function loadStatuses() {
      const statusMap = new Map<string, LiveAssetItem>();
      for (const asset of docRef.current.assets) {
        try {
          const item = await resolveAssetStatus(asset);
          if (item.status === "ready" && item.file) {
            if (asset.metadata) {
              item.inspection = { status: "ready", metadata: asset.metadata };
            } else {
              item.isInspecting = true;
              inspectionQueue.enqueue(asset.id, item.file, (result) => {
                if (isCancelled) return;
                setLiveAssets((prev) => {
                  const current = prev.get(asset.id);
                  if (!current) return prev;
                  const next = new Map(prev);
                  next.set(asset.id, { ...current, isInspecting: false, inspection: result });
                  return next;
                });
                if (result.status === "ready" && result.metadata) {
                  const currentDoc = docRef.current;
                  const updated = currentDoc.assets.map((a) =>
                    a.id === asset.id ? { ...a, metadata: result.metadata } : a
                  );
                  updateProject({ ...currentDoc, assets: updated } as ProjectDocumentWithTimeline);
                }
              });
            }
          }
          statusMap.set(asset.id, item);
        } catch (err: unknown) {
          statusMap.set(asset.id, {
            asset,
            status: "missing",
            errorMessage: err instanceof Error ? err.message : "Failed to resolve file status.",
          });
        }
      }
      if (!isCancelled) setLiveAssets(statusMap);
    }

    void loadStatuses();
    return () => { isCancelled = true; };
  }, [assetSourcesKey, inspectionQueue, updateProject]);

  // ─── Close project ──────────────────────────────────────────────────────────

  const handleCloseProject = async () => {
    setIsPlaying(false);
    inspectionQueue.cancelAll();
    try {
      await saveQueue.flush();
    } catch (err) {
      console.warn("Save flush failed on close:", err);
    }
    onCloseProject();
  };

  // ─── Rename ─────────────────────────────────────────────────────────────────

  const handleRenameSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const sanitized = sanitizeProjectName(renameValue);
    if (sanitized && sanitized !== doc.name) {
      updateProject({ ...doc, name: sanitized } as ProjectDocumentWithTimeline);
    }
    setIsRenaming(false);
  };

  // ─── Import ─────────────────────────────────────────────────────────────────

  const fallbackFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImportMedia = async () => {
    setIsImporting(true);
    setImportError(null);

    const hasPicker = typeof window !== "undefined" && typeof window.showOpenFilePicker === "function";

    if (hasPicker) {
      try {
        const newAssets = await pickAndImportFiles(doc.assets);
        if (newAssets.length > 0) {
          const updated = { ...doc, assets: [...doc.assets, ...newAssets] };
          updateProject(updated as ProjectDocumentWithTimeline);
          setSelectedAssetId(newAssets[0].id);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setImportError(err.message);
        }
      } finally {
        setIsImporting(false);
      }
    } else {
      fallbackFileInputRef.current?.click();
      setIsImporting(false);
    }
  };

  const handleFallbackFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    try {
      const newAssets = await importFallbackFiles(files, doc.assets);
      if (newAssets.length > 0) {
        const updated = { ...doc, assets: [...doc.assets, ...newAssets] };
        updateProject(updated as ProjectDocumentWithTimeline);
        setSelectedAssetId(newAssets[0].id);
      }
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : "Failed to import files.");
    } finally {
      if (fallbackFileInputRef.current) fallbackFileInputRef.current.value = "";
    }
  };

  // ─── Authorize ──────────────────────────────────────────────────────────────

  const handleAuthorizeAsset = async (asset: ProjectAsset) => {
    try {
      const updatedItem = await authorizeAssetAccess(asset);
      setLiveAssets((prev) => new Map(prev).set(asset.id, updatedItem));

      if (updatedItem.status === "ready" && updatedItem.file && !asset.metadata) {
        inspectionQueue.enqueue(asset.id, updatedItem.file, (result) => {
          setLiveAssets((prev) => {
            const current = prev.get(asset.id);
            if (!current) return prev;
            const next = new Map(prev);
            next.set(asset.id, { ...current, isInspecting: false, inspection: result });
            return next;
          });
          if (result.status === "ready" && result.metadata) {
            const currentDoc = docRef.current;
            const updated = currentDoc.assets.map((a) =>
              a.id === asset.id ? { ...a, metadata: result.metadata } : a
            );
            updateProject({ ...currentDoc, assets: updated } as ProjectDocumentWithTimeline);
          }
        });
      }
    } catch (err: unknown) {
      console.warn("Authorization failed:", err);
    }
  };

  // ─── Relink ─────────────────────────────────────────────────────────────────

  const relinkFileInputRef = useRef<HTMLInputElement | null>(null);

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
        if (!handles || handles.length === 0) { setRelinkTargetAsset(null); return; }

        const handle = handles[0];
        const file = await handle.getFile();
        const comparison = await compareRelinkWithFingerprint(asset, file);

        if (comparison.match) {
          const updatedAsset = await relinkAssetHandle(asset, handle, file);
          const updatedAssets = doc.assets.map((a) => (a.id === asset.id ? updatedAsset : a));
          updateProject({ ...doc, assets: updatedAssets } as ProjectDocumentWithTimeline);
          setRelinkTargetAsset(null);
        } else {
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
      relinkFileInputRef.current?.click();
    }
  };

  const handleFallbackRelinkChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !relinkTargetAsset) return;
    const file = files[0];
    const comparison = await compareRelinkWithFingerprint(relinkTargetAsset, file);
    setPendingRelinkFile({ file });
    setRelinkComparison(comparison);
    if (relinkFileInputRef.current) relinkFileInputRef.current.value = "";
  };

  const handleConfirmRelink = async () => {
    if (!relinkTargetAsset || !pendingRelinkFile) return;
    try {
      let updatedAsset: ProjectAsset;
      if (pendingRelinkFile.handle) {
        updatedAsset = await relinkAssetHandle(relinkTargetAsset, pendingRelinkFile.handle, pendingRelinkFile.file);
      } else {
        const sessionAssets = await importFallbackFiles([pendingRelinkFile.file], []);
        updatedAsset = {
          ...relinkTargetAsset,
          name: pendingRelinkFile.file.name,
          size: pendingRelinkFile.file.size,
          lastModified: pendingRelinkFile.file.lastModified,
          handleRefId: sessionAssets[0].handleRefId,
          metadata: undefined,
        };
      }
      const updatedAssets = doc.assets.map((a) => (a.id === relinkTargetAsset.id ? updatedAsset : a));
      updateProject({ ...doc, assets: updatedAssets } as ProjectDocumentWithTimeline);
    } catch (err) {
      console.warn("Failed to confirm relink:", err);
    } finally {
      setRelinkTargetAsset(null);
      setRelinkComparison(null);
      setPendingRelinkFile(null);
    }
  };

  // ─── Remove asset ───────────────────────────────────────────────────────────

  const handleConfirmRemoveAsset = async () => {
    if (!assetToRemove) return;
    try {
      inspectionQueue.cancel(assetToRemove.id);
      await removeAssetReference(assetToRemove.handleRefId);
      const updatedAssets = doc.assets.filter((a) => a.id !== assetToRemove.id);
      updateProject({ ...doc, assets: updatedAssets } as ProjectDocumentWithTimeline);
      if (selectedAssetId === assetToRemove.id) {
        setSelectedAssetId(updatedAssets[0]?.id || null);
      }
    } catch (err) {
      console.warn("Failed to remove asset reference:", err);
    } finally {
      setAssetToRemove(null);
    }
  };

  const selectedAsset =
    (selectedAssetId ? doc.assets.find((a) => a.id === selectedAssetId) : null) ||
    doc.assets[0] ||
    null;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-cs-bg-base">
      {/* Hidden file inputs */}
      <input ref={fallbackFileInputRef} type="file" multiple accept="video/*,audio/*" className="hidden" onChange={handleFallbackFileChange} />
      <input ref={relinkFileInputRef} type="file" accept="video/*,audio/*" className="hidden" onChange={handleFallbackRelinkChange} />

      {/* Top Project Bar */}
      <div className="flex items-center justify-between gap-4 h-12 px-4 bg-cs-bg-surface border-b border-cs-border-subtle shrink-0">
        {/* Left: Back + Project Name */}
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={handleCloseProject} title="Return to projects list">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span className="hidden sm:inline">Projects</span>
          </Button>

          <span className="text-cs-border-default">/</span>

          {isRenaming ? (
            <form onSubmit={handleRenameSubmit} className="flex items-center gap-1.5">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
                onBlur={handleRenameSubmit}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setIsRenaming(false); setRenameValue(doc.name); }
                }}
                className="h-7 px-2 text-xs font-semibold rounded bg-cs-bg-base border border-cs-border-focus text-cs-text-primary focus:outline-none"
              />
              <Button type="submit" variant="primary" size="sm">Save</Button>
            </form>
          ) : (
            <div className="flex items-center gap-2 group">
              <span className="text-sm font-semibold text-cs-text-primary truncate">{doc.name}</span>
              <IconButton
                label="Rename project"
                size="sm"
                onClick={() => { setRenameValue(doc.name); setIsRenaming(true); }}
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

        {/* Center: Mode toggle */}
        <div className="flex items-center gap-1 bg-cs-bg-elevated rounded p-0.5 border border-cs-border-subtle shrink-0">
          <button
            onClick={() => setEditorMode("library")}
            className={`px-3 h-6 rounded text-xs font-medium transition-colors ${
              editorMode === "library"
                ? "bg-cs-bg-active text-cs-text-primary"
                : "text-cs-text-secondary hover:text-cs-text-primary"
            }`}
          >
            Library
          </button>
          <button
            onClick={() => setEditorMode("editor")}
            className={`px-3 h-6 rounded text-xs font-medium transition-colors ${
              editorMode === "editor"
                ? "bg-cs-bg-active text-cs-text-primary"
                : "text-cs-text-secondary hover:text-cs-text-primary"
            }`}
          >
            Editor
          </button>
          <button
            onClick={() => setEditorMode("repurpose")}
            className={`px-3 h-6 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
              editorMode === "repurpose"
                ? "bg-cs-bg-active text-cs-text-primary"
                : "text-cs-text-secondary hover:text-cs-text-primary"
            }`}
            title="Deterministic local video repurposing workflow"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" stroke="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
            <span>Repurpose</span>
          </button>
        </div>

        {/* Right: Save state + Close */}
        <div className="flex items-center gap-3 shrink-0">
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
              <Button variant="secondary" size="sm" onClick={() => saveQueue.retry()}>Retry</Button>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsRevisionsModalOpen(true)}
            title="Project revisions and snapshots"
            className="flex items-center gap-1.5"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>Revisions</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCacheModalOpen(true)}
            title="Inspect and clean workspace cache"
            className="flex items-center gap-1.5"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
            <span>Cache</span>
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsExportModalOpen(true)}
            title="Export video (Render to file)"
            className="flex items-center gap-1.5"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" stroke="currentColor">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>Export</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={handleCloseProject}>Close</Button>
        </div>
      </div>

      {/* Main content area */}
      {editorMode === "library" ? (
        <LibraryMode
          doc={doc}
          liveAssets={liveAssets}
          selectedAsset={selectedAsset}
          isImporting={isImporting}
          importError={importError}
          onImport={handleImportMedia}
          onSelectAsset={setSelectedAssetId}
          onAuthorize={handleAuthorizeAsset}
          onRelink={handleStartRelink}
          onRemove={setAssetToRemove}
          onDismissImportError={() => setImportError(null)}
        />
      ) : editorMode === "repurpose" ? (
        <RepurposeWorkflow
          project={doc}
          liveAssets={liveAssets}
          workspaceHandle={workspaceHandle}
          currentTimeline={timeline}
          onApplyTimelineSequence={handleApplyRepurposedSequence}
          onCloseWorkflow={() => setEditorMode("editor")}
        />
      ) : (
        <EditorMode
          doc={doc}
          liveAssets={liveAssets}
          timeline={timeline}
          currentTime={currentTime}
          isPlaying={isPlaying}
          selectedClipId={selectedClipId}
          selectedOverlayId={selectedOverlayId}
          selectedTransitionId={selectedTransitionId}
          selectedTrackId={selectedTrackId}
          sourceAssetId={sourceAssetId}
          canUndo={canUndo}
          canRedo={canRedo}
          isImporting={isImporting}
          importError={importError}
          onImport={handleImportMedia}
          onDismissImportError={() => setImportError(null)}
          onRelink={handleStartRelink}
          onRemove={setAssetToRemove}
          onTimelineChange={handleTimelineChange}
          onSeek={handleSeek}
          onPlayPause={handlePlayPause}
          onPlaybackTimeUpdate={handlePlaybackTimeUpdate}
          onSelectClip={handleSelectClip}
          onSelectOverlay={handleSelectOverlay}
          onSelectTransition={handleSelectTransition}
          onSelectTrack={handleSelectTrack}
          onSelectSourceAsset={setSourceAssetId}
          onInsertEdit={handleInsertEdit}
          onOverwriteEdit={handleOverwriteEdit}
          onSelectSequence={handleSelectSequence}
          onCreateSequence={handleCreateSequence}
          onDuplicateSequence={handleDuplicateSequence}
          onRenameSequence={handleRenameSequence}
          onDeleteSequence={handleDeleteSequence}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onAddTextOverlay={handleAddTextOverlay}
          onGenerateCaptions={handleGenerateCaptions}
          isGeneratingCaptions={isGeneratingCaptions}
        />
      )}

      {/* Relink Confirmation Modal */}
      <Modal
        open={relinkComparison !== null}
        onClose={() => { setRelinkComparison(null); setRelinkTargetAsset(null); setPendingRelinkFile(null); }}
        title="Confirm File Relink"
        description="The selected file differs from the original reference recorded in the project document."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => { setRelinkComparison(null); setRelinkTargetAsset(null); setPendingRelinkFile(null); }}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleConfirmRelink}>Confirm Relink</Button>
          </>
        }
      >
        {relinkComparison && (
          <div className="flex flex-col gap-3 text-xs">
            <div className="grid grid-cols-2 gap-3 p-3 rounded bg-cs-bg-base border border-cs-border-subtle">
              <div>
                <span className="text-cs-text-tertiary block mb-1 uppercase text-[10px] tracking-wider font-semibold">Original Reference</span>
                <p className="font-medium text-cs-text-primary truncate" title={relinkComparison.original.name}>{relinkComparison.original.name}</p>
                <p className="text-cs-text-secondary mt-1">Size: {formatBytes(relinkComparison.original.size)}</p>
              </div>
              <div>
                <span className="text-cs-text-tertiary block mb-1 uppercase text-[10px] tracking-wider font-semibold">Selected Replacement</span>
                <p className="font-medium text-cs-text-primary truncate" title={relinkComparison.replacement.name}>{relinkComparison.replacement.name}</p>
                <p className="text-cs-text-secondary mt-1">Size: {formatBytes(relinkComparison.replacement.size)}</p>
              </div>
            </div>
            <div className="p-3 rounded bg-cs-warning/10 border border-cs-warning/20 text-cs-warning">
              <p className="font-medium mb-1">Differences detected:</p>
              <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                {relinkComparison.nameDiffers && <li>Filename does not match.</li>}
                {relinkComparison.sizeDiffers && <li>File size differs.</li>}
                {relinkComparison.dateDiffers && <li>Modification date differs.</li>}
                {relinkComparison.fingerprintDiffers && <li>Content fingerprint differs from original media.</li>}
                {relinkComparison.fingerprintMatched && <li className="text-emerald-400">Content fingerprint confirmed identical.</li>}
              </ul>
            </div>
          </div>
        )}
      </Modal>

      {/* Remove Asset Modal */}
      <Modal
        open={assetToRemove !== null}
        onClose={() => setAssetToRemove(null)}
        title="Remove Media Reference"
        description="Are you sure you want to remove this media reference from the project?"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAssetToRemove(null)}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={handleConfirmRemoveAsset}>Remove reference</Button>
          </>
        }
      >
        {assetToRemove && (
          <div className="text-xs text-cs-text-secondary leading-relaxed">
            <p>Reference for <strong className="text-cs-text-primary">{assetToRemove.name}</strong> will be removed from this project document.</p>
            <p className="mt-2 text-cs-text-tertiary">The original file on your computer will <strong>not</strong> be deleted or altered in any way.</p>
          </div>
        )}
      </Modal>

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        project={doc}
        timeline={timeline}
        liveAssets={liveAssets}
        workspaceHandle={workspaceHandle}
        onClose={() => setIsExportModalOpen(false)}
        onExportSuccess={(newExport) => {
          const existing = doc.exports || [];
          const updated = {
            ...doc,
            exports: [newExport, ...existing],
          } as ProjectDocumentWithTimeline;
          updateProject(updated);
        }}
        onExportsUpdated={(updatedExports) => {
          const updated = {
            ...doc,
            exports: updatedExports,
          } as ProjectDocumentWithTimeline;
          updateProject(updated);
        }}
      />

      {/* Project Revisions Modal */}
      <ProjectRevisionsModal
        isOpen={isRevisionsModalOpen}
        project={doc}
        workspaceHandle={workspaceHandle}
        onClose={() => setIsRevisionsModalOpen(false)}
        onProjectRestored={(restoredDoc) => {
          const withTimeline = restoredDoc as ProjectDocumentWithTimeline;
          setDoc(withTimeline);
          if (withTimeline.timeline) {
            undoStack.push(withTimeline.timeline);
            setTimeline(withTimeline.timeline);
            setCanUndo(undoStack.canUndo());
            setCanRedo(undoStack.canRedo());
          }
          onProjectUpdated(restoredDoc);
        }}
      />

      {/* Cache Management Modal */}
      <CacheManagerModal
        isOpen={isCacheModalOpen}
        workspaceHandle={workspaceHandle}
        projectId={doc.id}
        onClose={() => setIsCacheModalOpen(false)}
      />
    </div>
  );
}

// ─── Library Mode ─────────────────────────────────────────────────────────────

function LibraryMode({
  doc,
  liveAssets,
  selectedAsset,
  isImporting,
  importError,
  onImport,
  onSelectAsset,
  onAuthorize,
  onRelink,
  onRemove,
  onDismissImportError,
}: {
  doc: ProjectDocumentWithTimeline;
  liveAssets: Map<string, LiveAssetItem>;
  selectedAsset: ProjectAsset | null;
  isImporting: boolean;
  importError: string | null;
  onImport: () => void;
  onSelectAsset: (id: string) => void;
  onAuthorize: (asset: ProjectAsset) => void;
  onRelink: (asset: ProjectAsset) => void;
  onRemove: (asset: ProjectAsset) => void;
  onDismissImportError: () => void;
}) {
  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6 grid grid-cols-1 xl:grid-cols-12 gap-6">
      {/* Left 5 Cols: Media Library */}
      <div className="xl:col-span-5 flex flex-col gap-4">
        <MediaLibraryPanel
          doc={doc}
          liveAssets={liveAssets}
          selectedAssetId={selectedAsset?.id ?? null}
          isImporting={isImporting}
          importError={importError}
          onImport={onImport}
          onSelectAsset={onSelectAsset}
          onAuthorize={onAuthorize}
          onRelink={onRelink}
          onRemove={onRemove}
          onDismissImportError={onDismissImportError}
        />
      </div>

      {/* Right 7 Cols: Preview */}
      <div className="xl:col-span-7 flex flex-col gap-6">
        {selectedAsset ? (
          <MediaPreviewPlayer
            asset={selectedAsset}
            liveItem={liveAssets.get(selectedAsset.id)}
            onAuthorize={() => onAuthorize(selectedAsset)}
            onRelink={() => onRelink(selectedAsset)}
          />
        ) : (
          <Panel>
            <EmptyState
              icon={
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" strokeWidth="1.3" stroke="currentColor">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <polygon points="10 8 16 11.5 10 15 10 8" />
                </svg>
              }
              title="No media selected"
              description="Select an imported video or audio file from your library to inspect its metadata and preview playback."
            />
          </Panel>
        )}

        {/* Project details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Panel>
            <PanelHeader title="Project Details" />
            <div className="p-4 flex flex-col gap-3 text-xs">
              <div>
                <span className="text-cs-text-tertiary block mb-0.5">Project ID (UUID)</span>
                <span className="font-mono text-cs-text-secondary select-all break-all">{doc.id}</span>
              </div>
              <div className="flex justify-between border-t border-cs-border-subtle pt-2">
                <span className="text-cs-text-tertiary">Created</span>
                <span className="text-cs-text-secondary">{new Date(doc.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-t border-cs-border-subtle pt-2">
                <span className="text-cs-text-tertiary">Last Saved</span>
                <span className="text-cs-text-secondary">{new Date(doc.updatedAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-t border-cs-border-subtle pt-2">
                <span className="text-cs-text-tertiary">Total Media Size</span>
                <span className="text-cs-text-secondary font-medium">{formatBytes(doc.assets.reduce((sum, a) => sum + a.size, 0))}</span>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Editor Quick Start" />
            <div className="p-4 flex flex-col gap-2.5 text-xs text-cs-text-secondary leading-relaxed">
              <div className="flex items-center gap-2">
                <Badge variant="success">Ready</Badge>
                <span className="font-medium text-cs-text-primary">Timeline & Composition</span>
              </div>
              <p>Switch to Editor mode to arrange clips on the timeline, add text overlays, and preview your edit.</p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ─── Editor Mode & Resizable Workspace ─────────────────────────────────────────

interface WorkspaceLayoutPrefs {
  leftWidth: number;
  rightWidth: number;
  timelineHeight: number;
  leftOpen: boolean;
  rightOpen: boolean;
  monitorView: "dual" | "program" | "source";
}

const DEFAULT_LAYOUT: WorkspaceLayoutPrefs = {
  leftWidth: 260,
  rightWidth: 260,
  timelineHeight: 280,
  leftOpen: true,
  rightOpen: true,
  monitorView: "dual",
};

function EditorMode({
  doc,
  liveAssets,
  timeline,
  currentTime,
  isPlaying,
  selectedClipId,
  selectedOverlayId,
  selectedTransitionId,
  selectedTrackId,
  sourceAssetId,
  canUndo,
  canRedo,
  isImporting,
  importError,
  onImport,
  onDismissImportError,
  onRelink,
  onRemove,
  onTimelineChange,
  onSeek,
  onPlayPause,
  onPlaybackTimeUpdate,
  onSelectClip,
  onSelectOverlay,
  onSelectTransition,
  onSelectTrack,
  onSelectSourceAsset,
  onInsertEdit,
  onOverwriteEdit,
  onSelectSequence,
  onCreateSequence,
  onDuplicateSequence,
  onRenameSequence,
  onDeleteSequence,
  onUndo,
  onRedo,
  onAddTextOverlay,
  onGenerateCaptions,
  isGeneratingCaptions,
}: {
  doc: ProjectDocumentWithTimeline;
  liveAssets: Map<string, LiveAssetItem>;
  timeline: TimelineDocument;
  currentTime: number;
  isPlaying: boolean;
  selectedClipId: string | null;
  selectedOverlayId: string | null;
  selectedTransitionId?: string | null;
  selectedTrackId?: string | null;
  sourceAssetId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  isImporting: boolean;
  importError: string | null;
  onImport: () => void;
  onDismissImportError: () => void;
  onRelink: (asset: ProjectAsset) => void;
  onRemove: (asset: ProjectAsset) => void;
  onTimelineChange: (t: TimelineDocument) => void;
  onSeek: (time: number) => void;
  onPlayPause: () => void;
  onPlaybackTimeUpdate: (time: number) => void;
  onSelectClip: (id: string | null) => void;
  onSelectOverlay: (id: string | null) => void;
  onSelectTransition?: (id: string | null) => void;
  onSelectTrack?: (id: string | null) => void;
  onSelectSourceAsset: (id: string) => void;
  onInsertEdit: (assetId: string, sIn: number, sOut: number, targetTrackId: string) => void;
  onOverwriteEdit: (assetId: string, sIn: number, sOut: number, targetTrackId: string) => void;
  onSelectSequence: (id: string) => void;
  onCreateSequence: (name: string, aspectRatio: "16:9" | "9:16" | "1:1" | "4:5", fps: number) => void;
  onDuplicateSequence: (id: string) => void;
  onRenameSequence: (id: string, newName: string) => void;
  onDeleteSequence: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddTextOverlay: (overlay: TextOverlay) => void;
  onGenerateCaptions?: () => void;
  isGeneratingCaptions?: boolean;
}) {
  const [layoutPrefs, setLayoutPrefs] = useState<WorkspaceLayoutPrefs>(() => {
    if (typeof window === "undefined") return DEFAULT_LAYOUT;
    try {
      const stored = localStorage.getItem("cs_workspace_layout_prefs");
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_LAYOUT, ...parsed };
      }
    } catch { /* ignored */ }
    return DEFAULT_LAYOUT;
  });

  const updateLayout = useCallback((patch: Partial<WorkspaceLayoutPrefs>) => {
    setLayoutPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem("cs_workspace_layout_prefs", JSON.stringify(next));
      } catch { /* ignored */ }
      return next;
    });
  }, []);

  const sourceAsset = (sourceAssetId ? doc.assets.find((a) => a.id === sourceAssetId) : null) || doc.assets[0] || null;

  // Splitter Resize Handlers
  const handleLeftResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = layoutPrefs.leftWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(180, Math.min(480, startWidth + delta));
      updateLayout({ leftWidth: newWidth, leftOpen: true });
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleRightResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = layoutPrefs.rightWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.max(200, Math.min(480, startWidth + delta));
      updateLayout({ rightWidth: newWidth, rightOpen: true });
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleTimelineResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = layoutPrefs.timelineHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const newHeight = Math.max(160, Math.min(550, startHeight + delta));
      updateLayout({ timelineHeight: newHeight });
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-cs-bg-base select-none">
      {/* Sequence Switcher Bar */}
      {doc.sequences && doc.sequences.length > 0 && (
        <SequenceSelector
          sequences={doc.sequences}
          activeSequenceId={doc.activeSequenceId || doc.sequences[0].id}
          onSelectSequence={onSelectSequence}
          onCreateSequence={onCreateSequence}
          onDuplicateSequence={onDuplicateSequence}
          onRenameSequence={onRenameSequence}
          onDeleteSequence={onDeleteSequence}
        />
      )}

      {/* Upper area: sidebar + preview monitors + inspector */}
      <div className="flex flex-1 overflow-hidden min-h-0 relative" style={{ minHeight: 0 }}>
        {/* Left sidebar: Media Library */}
        {layoutPrefs.leftOpen ? (
          <div
            className="shrink-0 flex flex-col border-r border-cs-border-subtle bg-cs-bg-surface overflow-hidden relative"
            style={{ width: layoutPrefs.leftWidth }}
          >
            <div className="absolute top-1.5 right-1.5 z-20">
              <button
                onClick={() => updateLayout({ leftOpen: false })}
                className="w-5 h-5 rounded flex items-center justify-center bg-cs-bg-base hover:bg-cs-bg-elevated text-cs-text-tertiary hover:text-cs-text-primary text-[10px] transition-colors"
                title="Collapse Media Panel"
              >
                ◀
              </button>
            </div>
            <MediaLibraryPanel
              doc={doc}
              liveAssets={liveAssets}
              selectedAssetId={sourceAssetId}
              isImporting={isImporting}
              importError={importError}
              onImport={onImport}
              onSelectAsset={onSelectSourceAsset}
              onAuthorize={() => {}}
              onRelink={onRelink}
              onRemove={onRemove}
              onDismissImportError={onDismissImportError}
              compact
            />
          </div>
        ) : (
          <div
            className="w-6 shrink-0 bg-cs-bg-surface border-r border-cs-border-subtle flex flex-col items-center py-2 cursor-pointer hover:bg-cs-bg-elevated transition-colors"
            onClick={() => updateLayout({ leftOpen: true })}
            title="Expand Media Library"
          >
            <span className="text-[10px] text-cs-text-tertiary font-semibold tracking-widest [writing-mode:vertical-lr] rotate-180 mb-2">
              MEDIA
            </span>
            <span className="text-[10px] text-cs-accent">▶</span>
          </div>
        )}

        {/* Left Resizer Handle */}
        {layoutPrefs.leftOpen && (
          <div
            onMouseDown={handleLeftResizeStart}
            className="w-1 hover:w-1.5 bg-transparent hover:bg-cs-accent/60 cursor-col-resize transition-all shrink-0 z-20"
            title="Drag to resize Media Panel"
          />
        )}

        {/* Center: Dual / Single Monitors */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[#09090b]">
          {/* Monitor View Toggle Header */}
          <div className="flex items-center justify-between px-3 py-1 bg-cs-bg-surface border-b border-cs-border-subtle text-xs shrink-0">
            <span className="text-[11px] text-cs-text-tertiary font-semibold uppercase tracking-wider">
              {layoutPrefs.monitorView === "dual"
                ? "Source & Program Monitors"
                : layoutPrefs.monitorView === "source"
                ? "Source Monitor"
                : "Program Monitor"}
            </span>
            <div className="flex items-center gap-1 bg-cs-bg-elevated rounded p-0.5 border border-cs-border-subtle">
              <button
                onClick={() => updateLayout({ monitorView: "source" })}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  layoutPrefs.monitorView === "source"
                    ? "bg-cs-bg-active text-cs-text-primary"
                    : "text-cs-text-tertiary hover:text-cs-text-primary"
                }`}
                title="Show only Source Monitor"
              >
                Source
              </button>
              <button
                onClick={() => updateLayout({ monitorView: "dual" })}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  layoutPrefs.monitorView === "dual"
                    ? "bg-cs-bg-active text-cs-text-primary"
                    : "text-cs-text-tertiary hover:text-cs-text-primary"
                }`}
                title="Show Source and Program monitors side-by-side"
              >
                Dual Monitor
              </button>
              <button
                onClick={() => updateLayout({ monitorView: "program" })}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  layoutPrefs.monitorView === "program"
                    ? "bg-cs-bg-active text-cs-text-primary"
                    : "text-cs-text-tertiary hover:text-cs-text-primary"
                }`}
                title="Show only Program Monitor"
              >
                Program
              </button>
            </div>
          </div>

          {/* Monitors Workspace */}
          <div className="flex-1 flex overflow-hidden min-h-0 divide-x divide-cs-border-subtle">
            {(layoutPrefs.monitorView === "dual" || layoutPrefs.monitorView === "source") && (
              <div className="flex-1 flex flex-col min-w-0">
                <SourceMonitor
                  asset={sourceAsset}
                  liveItem={sourceAsset ? liveAssets.get(sourceAsset.id) : undefined}
                  timeline={timeline}
                  onInsertEdit={onInsertEdit}
                  onOverwriteEdit={onOverwriteEdit}
                />
              </div>
            )}
            {(layoutPrefs.monitorView === "dual" || layoutPrefs.monitorView === "program") && (
              <div className="flex-1 flex flex-col min-w-0">
                <TimelinePreview
                  timeline={timeline}
                  liveAssets={liveAssets}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                  onPlaybackTimeUpdate={onPlaybackTimeUpdate}
                  onPlayPause={onPlayPause}
                />
              </div>
            )}
          </div>
        </div>

        {/* Right Resizer Handle */}
        {layoutPrefs.rightOpen && (
          <div
            onMouseDown={handleRightResizeStart}
            className="w-1 hover:w-1.5 bg-transparent hover:bg-cs-accent/60 cursor-col-resize transition-all shrink-0 z-20"
            title="Drag to resize Inspector"
          />
        )}

        {/* Right: Inspector */}
        {layoutPrefs.rightOpen ? (
          <div
            className="shrink-0 overflow-hidden border-l border-cs-border-subtle relative flex flex-col"
            style={{ width: layoutPrefs.rightWidth }}
          >
            <div className="absolute top-1.5 right-1.5 z-20">
              <button
                onClick={() => updateLayout({ rightOpen: false })}
                className="w-5 h-5 rounded flex items-center justify-center bg-cs-bg-base hover:bg-cs-bg-elevated text-cs-text-tertiary hover:text-cs-text-primary text-[10px] transition-colors"
                title="Collapse Inspector"
              >
                ▶
              </button>
            </div>
            <ClipInspector
              timeline={timeline}
              selectedClipId={selectedClipId}
              selectedOverlayId={selectedOverlayId}
              selectedTransitionId={selectedTransitionId}
              selectedTrackId={selectedTrackId}
              liveAssets={liveAssets}
              currentTime={currentTime}
              onTimelineChange={onTimelineChange}
              onAddTextOverlay={onAddTextOverlay}
              onSelectTrack={onSelectTrack}
              onSelectTransition={onSelectTransition}
              onGenerateCaptions={onGenerateCaptions}
              isGeneratingCaptions={isGeneratingCaptions}
            />
          </div>
        ) : (
          <div
            className="w-6 shrink-0 bg-cs-bg-surface border-l border-cs-border-subtle flex flex-col items-center py-2 cursor-pointer hover:bg-cs-bg-elevated transition-colors"
            onClick={() => updateLayout({ rightOpen: true })}
            title="Expand Inspector"
          >
            <span className="text-[10px] text-cs-text-tertiary font-semibold tracking-widest [writing-mode:vertical-lr] rotate-180 mb-2">
              INSPECTOR
            </span>
            <span className="text-[10px] text-cs-accent">◀</span>
          </div>
        )}
      </div>

      {/* Horizontal Timeline Resizer Handle */}
      <div
        onMouseDown={handleTimelineResizeStart}
        className="h-1 hover:h-1.5 bg-transparent hover:bg-cs-accent/60 cursor-row-resize transition-all shrink-0 z-20"
        title="Drag to resize Timeline"
      />

      {/* Bottom: Timeline Editor */}
      <div
        className="shrink-0 overflow-hidden border-t border-cs-border-subtle"
        style={{ height: layoutPrefs.timelineHeight }}
      >
        <TimelineEditor
          timeline={timeline}
          liveAssets={liveAssets}
          currentTime={currentTime}
          isPlaying={isPlaying}
          onTimelineChange={onTimelineChange}
          onSeek={onSeek}
          onPlayPause={onPlayPause}
          selectedClipId={selectedClipId}
          selectedOverlayId={selectedOverlayId}
          selectedTransitionId={selectedTransitionId}
          selectedTrackId={selectedTrackId}
          onSelectClip={onSelectClip}
          onSelectOverlay={onSelectOverlay}
          onSelectTransition={onSelectTransition}
          onSelectTrack={onSelectTrack}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={onUndo}
          onRedo={onRedo}
        />
      </div>
    </div>
  );
}

// ─── Media Library Panel (shared between modes) ───────────────────────────────

function MediaLibraryPanel({
  doc,
  liveAssets,
  selectedAssetId,
  isImporting,
  importError,
  onImport,
  onSelectAsset,
  onAuthorize,
  onRelink,
  onRemove,
  onDismissImportError,
  compact = false,
}: {
  doc: ProjectDocumentWithTimeline;
  liveAssets: Map<string, LiveAssetItem>;
  selectedAssetId: string | null;
  isImporting: boolean;
  importError: string | null;
  onImport: () => void;
  onSelectAsset: (id: string) => void;
  onAuthorize: (asset: ProjectAsset) => void;
  onRelink: (asset: ProjectAsset) => void;
  onRemove: (asset: ProjectAsset) => void;
  onDismissImportError: () => void;
  compact?: boolean;
}) {
  return (
    <Panel className="flex flex-col h-full">
      <PanelHeader
        title="Media Library"
        description={`${doc.assets.length} file${doc.assets.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="primary" size="sm" onClick={onImport} disabled={isImporting}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {!compact && "Import"}
          </Button>
        }
      />

      {importError && (
        <div className="px-3 py-2 bg-cs-error/10 border-b border-cs-error/20 flex items-center justify-between text-xs text-cs-error">
          <span className="truncate">{importError}</span>
          <IconButton label="Dismiss error" size="sm" onClick={onDismissImportError}>×</IconButton>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {doc.assets.length === 0 ? (
          <EmptyState
            icon={
              <svg width={compact ? 28 : 36} height={compact ? 28 : 36} viewBox="0 0 24 24" fill="none" strokeWidth="1.3" stroke="currentColor">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M7 6v12M17 6v12M2 10h20M2 14h20" />
              </svg>
            }
            title="No media"
            description={compact ? "Import files to begin." : "Import video and audio files. Files stay in their original location."}
            action={<Button variant="secondary" size="sm" onClick={onImport}>Select files</Button>}
            className={compact ? "py-8" : "py-16"}
          />
        ) : (
          <ul role="list" className="divide-y divide-cs-border-subtle">
            {doc.assets.map((asset) => {
              const live = liveAssets.get(asset.id);
              const status = live?.status || "ready";
              const isSelected = selectedAssetId === asset.id;

              return (
                <li
                  key={asset.id}
                  onClick={() => onSelectAsset(asset.id)}
                  className={`flex items-center gap-2 p-2.5 transition-colors cursor-pointer border-l-2 ${
                    isSelected ? "bg-cs-bg-elevated border-cs-accent" : "border-transparent hover:bg-cs-bg-elevated/40"
                  }`}
                >
                  {/* Icon */}
                  <div className="shrink-0 w-7 h-7 rounded bg-cs-bg-muted flex items-center justify-center text-cs-text-secondary border border-cs-border-subtle">
                    {asset.mediaType === "video" ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs font-medium text-cs-text-primary truncate" title={asset.name}>
                      {asset.name}
                    </span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant={asset.mediaType === "video" ? "default" : "info"} className="text-[9px] px-1 py-0">
                        {asset.mediaType.toUpperCase()}
                      </Badge>
                      {asset.metadata?.duration ? (
                        <span className="text-[10px] font-mono text-cs-text-secondary">{formatDuration(asset.metadata.duration)}</span>
                      ) : (
                        <span className="text-[10px] text-cs-text-tertiary">{formatBytes(asset.size)}</span>
                      )}
                    </div>

                    {/* Status */}
                    {status !== "ready" && (
                      <div className="flex items-center gap-1 mt-1">
                        {status === "prompt-required" && (
                          <button
                            className="text-[10px] text-cs-warning underline"
                            onClick={(e) => { e.stopPropagation(); onAuthorize(asset); }}
                          >
                            Authorize
                          </button>
                        )}
                        {status === "missing" && (
                          <button
                            className="text-[10px] text-cs-error underline"
                            onClick={(e) => { e.stopPropagation(); onRelink(asset); }}
                          >
                            Missing — Relink
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Remove */}
                  <IconButton
                    label="Remove from project"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); onRemove(asset); }}
                    className="shrink-0 hover:text-cs-error"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </IconButton>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}
