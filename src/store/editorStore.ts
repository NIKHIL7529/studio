/**
 * Zustand Interactive Editor Store.
 *
 * Rules:
 * - Isolates 60 fps interactive UI state from durable ProjectDocument persistence.
 * - Ephemeral interaction state (playhead, zoom, scrubbing, active tool, selection,
 *   drag preview) lives here.
 * - Durable project mutations remain managed via ProjectSaveQueue and bounded undo/redo.
 */

import { create } from "zustand";

export interface DragPreviewState {
  clipId?: string;
  overlayId?: string;
  deltaX?: number;
  deltaY?: number;
  deltaTime?: number;
  targetTrackId?: string;
}

export type EditorTool = "select" | "razor" | "text";
export type EditorLeftTab = "media" | "captions" | "transitions" | "presets";
export type EditorMonitorMode = "dual" | "program";

export interface EditorUiState {
  playheadTime: number;
  isPlaying: boolean;
  isScrubbing: boolean;
  zoomPxPerSec: number; // 20 - 500
  scrollLeft: number;
  snapEnabled: boolean;
  activeTool: EditorTool;
  selectedClipIds: string[];
  selectedOverlayId: string | null;
  selectedTrackId: string | null;
  selectedMarkerId: string | null;
  activeLeftTab: EditorLeftTab;
  activeMonitorMode: EditorMonitorMode;
  dragPreview: DragPreviewState | null;

  // Actions
  setPlayheadTime: (time: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setIsScrubbing: (isScrubbing: boolean) => void;
  setZoomPxPerSec: (zoom: number) => void;
  setScrollLeft: (scrollLeft: number) => void;
  setSnapEnabled: (enabled: boolean) => void;
  toggleSnap: () => void;
  setActiveTool: (tool: EditorTool) => void;
  setSelectedClipIds: (clipIds: string[]) => void;
  selectSingleClip: (clipId: string) => void;
  selectOverlay: (overlayId: string | null) => void;
  setSelectedTrackId: (trackId: string | null) => void;
  setSelectedMarkerId: (markerId: string | null) => void;
  clearSelection: () => void;
  setActiveLeftTab: (tab: EditorLeftTab) => void;
  setActiveMonitorMode: (mode: EditorMonitorMode) => void;
  setDragPreview: (dragPreview: DragPreviewState | null) => void;
  resetEditorUiState: () => void;
}

export const initialEditorUiState = {
  playheadTime: 0,
  isPlaying: false,
  isScrubbing: false,
  zoomPxPerSec: 100,
  scrollLeft: 0,
  snapEnabled: true,
  activeTool: "select" as EditorTool,
  selectedClipIds: [] as string[],
  selectedOverlayId: null as string | null,
  selectedTrackId: null as string | null,
  selectedMarkerId: null as string | null,
  activeLeftTab: "media" as EditorLeftTab,
  activeMonitorMode: "dual" as EditorMonitorMode,
  dragPreview: null as DragPreviewState | null,
};

export const useEditorStore = create<EditorUiState>((set) => ({
  ...initialEditorUiState,

  setPlayheadTime: (time: number) =>
    set({ playheadTime: Math.max(0, Number.isFinite(time) ? time : 0) }),

  setIsPlaying: (isPlaying: boolean) => set({ isPlaying }),

  setIsScrubbing: (isScrubbing: boolean) => set({ isScrubbing }),

  setZoomPxPerSec: (zoom: number) =>
    set({ zoomPxPerSec: Math.max(20, Math.min(500, Number.isFinite(zoom) ? zoom : 100)) }),

  setScrollLeft: (scrollLeft: number) =>
    set({ scrollLeft: Math.max(0, Number.isFinite(scrollLeft) ? scrollLeft : 0) }),

  setSnapEnabled: (enabled: boolean) => set({ snapEnabled: enabled }),

  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),

  setActiveTool: (tool: EditorTool) => set({ activeTool: tool }),

  setSelectedClipIds: (clipIds: string[]) => set({ selectedClipIds: clipIds }),

  selectSingleClip: (clipId: string) =>
    set({
      selectedClipIds: [clipId],
      selectedOverlayId: null,
      selectedMarkerId: null,
    }),

  selectOverlay: (overlayId: string | null) =>
    set({
      selectedOverlayId: overlayId,
      ...(overlayId ? { selectedClipIds: [], selectedMarkerId: null } : {}),
    }),

  setSelectedTrackId: (trackId: string | null) => set({ selectedTrackId: trackId }),

  setSelectedMarkerId: (markerId: string | null) =>
    set({
      selectedMarkerId: markerId,
      ...(markerId ? { selectedClipIds: [], selectedOverlayId: null } : {}),
    }),

  clearSelection: () =>
    set({
      selectedClipIds: [],
      selectedOverlayId: null,
      selectedTrackId: null,
      selectedMarkerId: null,
    }),

  setActiveLeftTab: (tab: EditorLeftTab) => set({ activeLeftTab: tab }),

  setActiveMonitorMode: (mode: EditorMonitorMode) => set({ activeMonitorMode: mode }),

  setDragPreview: (dragPreview: DragPreviewState | null) => set({ dragPreview }),

  resetEditorUiState: () => set(initialEditorUiState),
}));
