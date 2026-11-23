"use client";

/**
 * TimelineEditor — Full-featured Professional NLE Timeline Editor.
 *
 * Rules:
 * - Deterministic, frame-accurate timecode and timeline math.
 * - Editing tools: Selection (V), Razor / Blade (C), Ripple Edit (B), Slip (Y), Slide (U).
 * - Multi-track management: Add track, reorder, lock, mute, solo, hide, sync-lock, rename, delete.
 * - Timeline markers: Add marker (M), jump to prev/next, visual flags on ruler.
 * - Frame stepping: Step 1 frame, step 1 sec, go to start/end, J/K/L shuttle.
 * - Clip operations: Move, trim, ripple trim, slip, roll, razor split, lift, ripple delete, duplicate, link, group.
 * - Gap closure: Close gaps via context menu or action.
 * - Synchronized scrolling, adaptive ruler ticks, and zoom-to-fit.
 * - Undo / Redo with full history integration.
 */

import * as React from "react";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type {
  TimelineDocument,
  TimelineTrack,
  TimelineClip,
  TextOverlay,
  TimelineMarker,
  TimelineTransition,
  TrackType,
} from "../../types/timeline.ts";
import type { LiveAssetItem } from "../../types/project.ts";
import { DEFAULT_COLOR_ADJUSTMENTS } from "../../lib/color/colorPresets.ts";
import * as Popover from "@radix-ui/react-popover";
import {
  moveClip,
  duplicateClip,
  splitClip,
  getTimelineDuration,
  getClipTimelineDuration,
  trimClipStart,
  trimClipEnd,
  addClipToTrack,
  removeTransition,
  insertFreezeFrameAtPlayhead,
  setTrackAudioRole,
  setTrackDucking,
} from "../../lib/timeline/model.ts";
import {
  rippleTrimStart,
  rippleTrimEnd,
  slipEdit,
  razorSplitAtPlayhead,
  liftClips,
  rippleDeleteClips,
  closeGap,
  addTrack,
  toggleTrackLock,
  toggleTrackMute,
  toggleTrackSolo,
  toggleTrackHidden,
  toggleTrackSyncLock,
  renameTrack,
  addMarker,
  removeMarker,
  findNearestMarker,
  unlinkClip,
  groupClips,
  ungroupClips,
  copyClips,
  pasteClips,
  detachAudio,
} from "../../lib/timeline/editingOperations.ts";
import {
  getTransitionTimeWindow,
  getTransitionDefinition,
} from "../../lib/transitions/transitionCatalog.ts";
import {
  isInputTarget,
  computeSnapTargets,
  snapTimeToTargets,
} from "../../lib/timeline/interaction.ts";
import { formatTimecode, stepFrames } from "../../lib/timeline/timecode.ts";
import { formatDuration } from "../../lib/media/inspector.ts";
import { IconButton, Button } from "@/components/ui";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal.tsx";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Slider from "@radix-ui/react-slider";
import {
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  Magnet,
  Scissors,
  MousePointer,
  Trash2,
  Unlink,
  Flag,
  ZoomIn,
  ZoomOut,
  Copy,
  Snowflake,
} from "lucide-react";
import { useEditorStore } from "../../store/editorStore.ts";

export type EditingTool = "select" | "razor" | "ripple" | "slip" | "slide";

export interface TimelineEditorProps {
  timeline: TimelineDocument;
  liveAssets: Map<string, LiveAssetItem>;
  currentTime: number;
  isPlaying: boolean;
  onTimelineChange: (newTimeline: TimelineDocument) => void;
  onSeek: (time: number) => void;
  onPlayPause: () => void;
  selectedClipId: string | null;
  selectedOverlayId: string | null;
  selectedTransitionId?: string | null;
  selectedTrackId?: string | null;
  onSelectClip: (clipId: string | null) => void;
  onSelectOverlay: (overlayId: string | null) => void;
  onSelectTransition?: (transId: string | null) => void;
  onSelectTrack?: (trackId: string | null) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

const ZOOM_MIN = 20;
const ZOOM_MAX = 600;
const ZOOM_DEFAULT = 100;
const TRACK_HEADER_WIDTH = 190; // px
const TRACK_HEIGHT = 60; // px
const RULER_HEIGHT = 30; // px
const SNAP_THRESHOLD_PX = 8;
const OVERLAY_TRACK_HEIGHT = 36; // px

function snapTime(time: number, snapTargets: number[], pxPerSec: number, altPressed: boolean): number {
  if (altPressed) return Math.max(0, time);
  const threshold = SNAP_THRESHOLD_PX / pxPerSec;
  return snapTimeToTargets(time, snapTargets, threshold);
}

// ─── Timeline Ruler & Markers ─────────────────────────────────────────────────

function TimelineRuler({
  pxPerSec,
  currentTime,
  timelineWidth,
  fps,
  markers,
  rulerAreaRef,
  onSeek,
  onRemoveMarker,
}: {
  pxPerSec: number;
  currentTime: number;
  timelineWidth: number;
  fps: number;
  markers?: TimelineMarker[];
  rulerAreaRef: React.RefObject<HTMLDivElement | null>;
  onSeek: (t: number) => void;
  onRemoveMarker?: (id: string) => void;
}) {
  const rawInterval = 80 / pxPerSec;
  const niceIntervals = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const tickInterval = niceIntervals.find((i) => i >= rawInterval) ?? 300;

  const maxDuration = Math.max(1, timelineWidth / pxPerSec);
  const ticks: number[] = [];

  for (let t = 0; t <= maxDuration + tickInterval; t += tickInterval) {
    ticks.push(t);
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rulerEl = e.currentTarget;

    const updateSeek = (clientX: number) => {
      const rect = rulerEl.getBoundingClientRect();
      const scrollOffset = rulerAreaRef.current?.scrollLeft ?? 0;
      const relX = clientX - rect.left + scrollOffset;
      onSeek(Math.max(0, relX / pxPerSec));
    };

    updateSeek(e.clientX);

    const onMouseMove = (moveEvent: MouseEvent) => {
      updateSeek(moveEvent.clientX);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div
      className="relative bg-cs-bg-elevated border-b border-cs-border-subtle cursor-ew-resize select-none overflow-hidden shrink-0"
      style={{ height: RULER_HEIGHT, width: timelineWidth }}
      onMouseDown={handleMouseDown}
    >
      {/* Time ticks */}
      {ticks.map((t) => {
        const x = t * pxPerSec;
        const isMajor = t % (tickInterval * 5) < 0.001 || tickInterval >= 10;
        return (
          <div key={t} className="absolute top-0 flex flex-col items-center pointer-events-none" style={{ left: x }}>
            <div className={`w-px ${isMajor ? "h-3.5 bg-cs-border-strong" : "h-2 bg-cs-border-default"}`} />
            {isMajor && (
              <span className="text-[9px] font-mono text-cs-text-tertiary mt-0.5 whitespace-nowrap">
                {formatTimecode(t, fps)}
              </span>
            )}
          </div>
        );
      })}

      {/* Timeline Markers */}
      {markers?.map((marker) => {
        const x = marker.time * pxPerSec;
        return (
          <div
            key={marker.id}
            className="absolute top-0 bottom-0 z-20 flex flex-col items-center group cursor-pointer"
            style={{ left: x, transform: "translateX(-50%)" }}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(marker.time);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onRemoveMarker) onRemoveMarker(marker.id);
            }}
            title={`Marker: ${marker.label} (${formatTimecode(marker.time, fps)})\nRight-click to remove`}
          >
            <div
              className="w-2.5 h-3 shadow-md rounded-t flex items-center justify-center"
              style={{ backgroundColor: marker.color || "#3b82f6" }}
            >
              <div className="w-1 h-1 bg-white rounded-full opacity-80" />
            </div>
            <div
              className="w-2.5 h-2 shadow-sm"
              style={{
                backgroundColor: marker.color || "#3b82f6",
                clipPath: "polygon(0 0, 100% 0, 50% 100%)",
              }}
            />
          </div>
        );
      })}

      {/* Playhead arrow needle */}
      <div
        className="absolute top-0 bottom-0 pointer-events-none z-30 flex flex-col items-center"
        style={{ left: currentTime * pxPerSec, transform: "translateX(-50%)" }}
      >
        <div className="w-3.5 h-3.5 bg-cs-error rounded-t flex items-center justify-center shadow-md">
          <div className="w-1 h-1 bg-white rounded-full" />
        </div>
        <div
          className="w-3.5 h-2.5 bg-cs-error shadow-sm"
          style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
        />
      </div>
    </div>
  );
}

// ─── Clip Block ───────────────────────────────────────────────────────────────

function ClipBlock({
  clip,
  pxPerSec,
  trackHeight,
  assetName,
  isSelected,
  trackType,
  isTrackLocked,
  activeTool,
  onSelect,
  onDragStart,
  onTrimStart,
  onTrimEnd,
  onFadeInDrag,
  onFadeOutDrag,
  onRazorClick,
  onContextAction,
}: {
  clip: TimelineClip;
  pxPerSec: number;
  trackHeight: number;
  assetName: string;
  isSelected: boolean;
  trackType: TrackType;
  isTrackLocked?: boolean;
  activeTool: EditingTool;
  onSelect: (e: React.MouseEvent) => void;
  onDragStart: (e: React.MouseEvent, clip: TimelineClip) => void;
  onTrimStart: (e: React.MouseEvent, clip: TimelineClip) => void;
  onTrimEnd: (e: React.MouseEvent, clip: TimelineClip) => void;
  onFadeInDrag?: (e: React.MouseEvent, clip: TimelineClip) => void;
  onFadeOutDrag?: (e: React.MouseEvent, clip: TimelineClip) => void;
  onRazorClick: (e: React.MouseEvent, clip: TimelineClip) => void;
  onContextAction: (
    action: "lift" | "rippleDelete" | "duplicate" | "split" | "link" | "unlink" | "group" | "ungroup" | "detachAudio" | "freezeFrame",
    clipId: string
  ) => void;
}) {
  const duration = getClipTimelineDuration(clip);
  const left = clip.startTime * pxPerSec;
  const width = Math.max(3, duration * pxPerSec);

  const baseColor =
    trackType === "video"
      ? "bg-cs-accent/30 border-cs-accent/60"
      : trackType === "audio"
      ? "bg-cs-info/30 border-cs-info/60"
      : "bg-cs-warning/30 border-cs-warning/60";

  const selectedColor =
    trackType === "video"
      ? "ring-2 ring-cs-accent"
      : trackType === "audio"
      ? "ring-2 ring-cs-info"
      : "ring-2 ring-cs-warning";

  const mutedOpacity = clip.muted ? "opacity-40" : "";
  const cursorStyle =
    isTrackLocked
      ? "cursor-not-allowed"
      : activeTool === "razor"
      ? "cursor-crosshair"
      : activeTool === "ripple"
      ? "cursor-col-resize"
      : activeTool === "slip"
      ? "cursor-ew-resize"
      : "cursor-grab active:cursor-grabbing";

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          className={`absolute top-1 rounded border text-[10px] font-medium overflow-hidden select-none group
            ${baseColor} ${mutedOpacity} ${isSelected ? selectedColor : ""} ${cursorStyle}
          `}
          style={{ left, width, height: trackHeight - 8 }}
          onClick={(e) => {
            e.stopPropagation();
            if (activeTool === "razor" && !isTrackLocked) {
              onRazorClick(e, clip);
            } else {
              onSelect(e);
            }
          }}
          onMouseDown={(e) => {
            if (e.button === 0 && !isTrackLocked && (activeTool === "select" || activeTool === "slip")) {
              onDragStart(e, clip);
            }
          }}
          onContextMenu={(e) => {
            e.stopPropagation();
            onSelect(e);
          }}
          title={`${assetName} — ${formatDuration(duration)}${clip.linkedClipId ? " (Linked)" : ""}${clip.groupId ? " (Grouped)" : ""}`}
        >
          {/* Audio Fade In Ramp & Handle */}
          {clip.fadeIn > 0 && (
            <div
              className="absolute top-0 bottom-0 left-0 pointer-events-none bg-gradient-to-r from-white/25 to-transparent"
              style={{ width: `${Math.min(width, clip.fadeIn * pxPerSec)}px` }}
            />
          )}
          {!isTrackLocked && onFadeInDrag && (
            <div
              className="absolute top-0 left-0 w-3 h-3 bg-white/40 hover:bg-white rounded-br cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
              title={`Fade In: ${clip.fadeIn.toFixed(2)}s`}
              onMouseDown={(e) => {
                e.stopPropagation();
                onFadeInDrag(e, clip);
              }}
            />
          )}

          {/* Audio Fade Out Ramp & Handle */}
          {clip.fadeOut > 0 && (
            <div
              className="absolute top-0 bottom-0 right-0 pointer-events-none bg-gradient-to-l from-white/25 to-transparent"
              style={{ width: `${Math.min(width, clip.fadeOut * pxPerSec)}px` }}
            />
          )}
          {!isTrackLocked && onFadeOutDrag && (
            <div
              className="absolute top-0 right-0 w-3 h-3 bg-white/40 hover:bg-white rounded-bl cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
              title={`Fade Out: ${clip.fadeOut.toFixed(2)}s`}
              onMouseDown={(e) => {
                e.stopPropagation();
                onFadeOutDrag(e, clip);
              }}
            />
          )}

          {/* Left Trim Handle */}
          {!isTrackLocked && (activeTool === "select" || activeTool === "ripple") && (
            <div
              className="absolute left-0 top-0 bottom-0 w-2 hover:w-3 bg-white/20 hover:bg-cs-accent cursor-ew-resize z-10 transition-all opacity-0 group-hover:opacity-100 flex items-center justify-center"
              onMouseDown={(e) => {
                e.stopPropagation();
                onTrimStart(e, clip);
              }}
              title="Drag to trim In-point"
            >
              <div className="w-0.5 h-3 bg-white/80 rounded" />
            </div>
          )}

          {/* Clip Content Label & Indicators */}
          <div className="px-2 py-0.5 flex items-center gap-1.5 h-full pointer-events-none">
            <span className="truncate leading-tight font-medium text-cs-text-primary">
              {assetName}
            </span>
            {clip.linkedClipId && (
              <span className="shrink-0 text-[9px] text-cs-text-tertiary" title="Linked Media">
                🔗
              </span>
            )}
            {clip.groupId && (
              <span className="shrink-0 text-[9px] text-cs-accent" title="Grouped Clip">
                📁
              </span>
            )}
            {clip.muted && (
              <span className="shrink-0 text-[9px] text-cs-text-tertiary">🔇</span>
            )}
            {clip.freezeFrameSourceTime !== null ? (
              <span className="shrink-0 flex items-center gap-0.5 text-[9px] font-mono text-cyan-300 bg-cyan-950/80 px-1 py-0.5 rounded border border-cyan-700/60" title={`Freeze Frame at ${clip.freezeFrameSourceTime.toFixed(2)}s`}>
                <Snowflake className="w-2.5 h-2.5 text-cyan-400" />
                <span>Freeze</span>
              </span>
            ) : clip.playbackRate !== 1 ? (
              <span className="shrink-0 text-[9px] font-mono text-cs-warning bg-amber-950/80 px-1 py-0.5 rounded border border-amber-700/60">
                {clip.playbackRate}x
              </span>
            ) : null}
          </div>

          {/* Right Trim Handle */}
          {!isTrackLocked && (activeTool === "select" || activeTool === "ripple") && (
            <div
              className="absolute right-0 top-0 bottom-0 w-2 hover:w-3 bg-white/20 hover:bg-cs-accent cursor-ew-resize z-10 transition-all opacity-0 group-hover:opacity-100 flex items-center justify-center"
              onMouseDown={(e) => {
                e.stopPropagation();
                onTrimEnd(e, clip);
              }}
              title="Drag to trim Out-point"
            >
              <div className="w-0.5 h-3 bg-white/80 rounded" />
            </div>
          )}
        </div>
      </ContextMenu.Trigger>

      {/* Accessible Radix Context Menu */}
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="z-50 min-w-44 rounded-md border border-cs-border-default bg-[#18181b]/95 backdrop-blur-md p-1 shadow-2xl text-xs text-cs-text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          <ContextMenu.Item
            className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-cs-accent hover:text-white cursor-pointer outline-none"
            onSelect={() => onContextAction("split", clip.id)}
          >
            <Scissors className="w-3.5 h-3.5 text-cs-text-secondary" />
            <span>Split at Playhead</span>
            <span className="ml-auto font-mono text-[10px] text-cs-text-tertiary">S</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-cs-accent hover:text-white cursor-pointer outline-none"
            onSelect={() => onContextAction("duplicate", clip.id)}
          >
            <Copy className="w-3.5 h-3.5 text-cs-text-secondary" />
            <span>Duplicate</span>
            <span className="ml-auto font-mono text-[10px] text-cs-text-tertiary">Ctrl+D</span>
          </ContextMenu.Item>

          <ContextMenu.Separator className="h-px bg-white/10 my-1" />

          {trackType === "video" && (
            <ContextMenu.Item
              className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-cs-accent hover:text-white cursor-pointer outline-none"
              onSelect={() => onContextAction("freezeFrame", clip.id)}
            >
              <Snowflake className="w-3.5 h-3.5 text-cyan-400" />
              <span>Freeze Frame at Playhead</span>
            </ContextMenu.Item>
          )}

          {trackType === "video" && (
            <ContextMenu.Item
              className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-cs-accent hover:text-white cursor-pointer outline-none"
              onSelect={() => onContextAction("detachAudio", clip.id)}
            >
              <Unlink className="w-3.5 h-3.5 text-cs-text-secondary" />
              <span>Detach Audio</span>
              <span className="ml-auto font-mono text-[10px] text-cs-text-tertiary">Alt+A</span>
            </ContextMenu.Item>
          )}

          {clip.linkedClipId ? (
            <ContextMenu.Item
              className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-cs-accent hover:text-white cursor-pointer outline-none"
              onSelect={() => onContextAction("unlink", clip.id)}
            >
              <span>Unlink Audio/Video</span>
            </ContextMenu.Item>
          ) : (
            <ContextMenu.Item
              className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-cs-accent hover:text-white cursor-pointer outline-none"
              onSelect={() => onContextAction("link", clip.id)}
            >
              <span>Link Selection</span>
            </ContextMenu.Item>
          )}

          {clip.groupId ? (
            <ContextMenu.Item
              className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-cs-accent hover:text-white cursor-pointer outline-none"
              onSelect={() => onContextAction("ungroup", clip.id)}
            >
              <span>Ungroup Clips</span>
            </ContextMenu.Item>
          ) : (
            <ContextMenu.Item
              className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-cs-accent hover:text-white cursor-pointer outline-none"
              onSelect={() => onContextAction("group", clip.id)}
            >
              <span>Group Clips</span>
              <span className="ml-auto font-mono text-[10px] text-cs-text-tertiary">Ctrl+G</span>
            </ContextMenu.Item>
          )}

          <ContextMenu.Separator className="h-px bg-white/10 my-1" />

          <ContextMenu.Item
            className="flex items-center gap-2 px-2.5 py-1.5 rounded text-red-400 hover:bg-red-500 hover:text-white cursor-pointer outline-none"
            onSelect={() => onContextAction("lift", clip.id)}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete (Lift)</span>
            <span className="ml-auto font-mono text-[10px] opacity-70">Del</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            className="flex items-center gap-2 px-2.5 py-1.5 rounded text-red-400 hover:bg-red-500 hover:text-white cursor-pointer outline-none"
            onSelect={() => onContextAction("rippleDelete", clip.id)}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Ripple Delete</span>
            <span className="ml-auto font-mono text-[10px] opacity-70">Shift+Del</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

// ─── Transition Block ─────────────────────────────────────────────────────────

function TransitionBlock({
  transition,
  pxPerSec,
  isSelected,
  onSelect,
  onDelete,
}: {
  transition: TimelineTransition;
  pxPerSec: number;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const window = getTransitionTimeWindow(transition);
  const dur = window.end - window.start;
  const left = window.start * pxPerSec;
  const width = Math.max(16, dur * pxPerSec);
  const def = getTransitionDefinition(transition.type);

  return (
    <div
      className={`absolute top-1 bottom-1 rounded border z-20 flex items-center justify-between px-1.5 cursor-pointer select-none transition-shadow ${
        isSelected
          ? "border-emerald-400 bg-emerald-500/40 text-white shadow-lg ring-2 ring-emerald-300"
          : "border-emerald-500/60 bg-emerald-600/30 text-emerald-200 hover:bg-emerald-500/40"
      }`}
      style={{ left, width }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      title={`Transition: ${def?.label || transition.type} (${dur.toFixed(2)}s)\nClick to inspect, Del to remove`}
    >
      <div className="flex items-center gap-1 overflow-hidden pointer-events-none">
        <span className="text-[10px]">✨</span>
        <span className="text-[10px] font-semibold truncate leading-none">
          {width > 35 ? (def?.label || transition.type) : ""}
        </span>
      </div>
      {isSelected && (
        <button
          className="w-3.5 h-3.5 rounded-full bg-black/40 hover:bg-red-500 text-[10px] flex items-center justify-center text-white shrink-0 ml-1"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Remove transition"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ─── Text Overlay Block & Lane Allocation ───────────────────────────────────

function computeOverlayLanes(overlays: TextOverlay[]): { lanes: Map<string, number>; totalLanes: number } {
  const lanes = new Map<string, number>();
  const laneEndTimes: number[] = [];

  const sorted = [...overlays].sort((a, b) => a.startTime - b.startTime);
  for (const o of sorted) {
    let placed = false;
    for (let l = 0; l < laneEndTimes.length; l++) {
      if (laneEndTimes[l] <= o.startTime + 0.05) {
        lanes.set(o.id, l);
        laneEndTimes[l] = o.endTime;
        placed = true;
        break;
      }
    }
    if (!placed) {
      lanes.set(o.id, laneEndTimes.length);
      laneEndTimes.push(o.endTime);
    }
  }
  return { lanes, totalLanes: Math.max(1, laneEndTimes.length) };
}

function OverlayBlock({
  overlay,
  pxPerSec,
  isSelected,
  laneIndex = 0,
  totalLanes = 1,
  onSelect,
  onTrimStart,
  onTrimEnd,
}: {
  overlay: TextOverlay;
  pxPerSec: number;
  isSelected: boolean;
  laneIndex?: number;
  totalLanes?: number;
  onSelect: () => void;
  onTrimStart?: (e: React.MouseEvent, overlay: TextOverlay) => void;
  onTrimEnd?: (e: React.MouseEvent, overlay: TextOverlay) => void;
}) {
  const left = overlay.startTime * pxPerSec;
  const width = Math.max(4, (overlay.endTime - overlay.startTime) * pxPerSec);

  const availableHeight = OVERLAY_TRACK_HEIGHT - 6;
  const laneHeight = Math.max(16, availableHeight / totalLanes);
  const top = 3 + laneIndex * laneHeight;
  const height = Math.max(14, laneHeight - 2);

  const isNarrow = width < 45;
  const isCaption = overlay.overlayType === "caption";

  return (
    <div
      className={`absolute rounded border text-[10px] font-medium overflow-hidden cursor-pointer select-none box-border transition-shadow group ${
        isCaption
          ? "border-amber-500/60 bg-amber-500/20 text-amber-300"
          : "border-sky-500/60 bg-sky-500/20 text-sky-300"
      } ${isSelected ? "ring-2 ring-white shadow-md z-10" : "hover:border-white/50"}`}
      style={{ left, width, top, height }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      title={`${overlay.text || "(empty caption)"} [${overlay.startTime.toFixed(2)}s – ${overlay.endTime.toFixed(2)}s]`}
    >
      {/* Left Trim Handle */}
      {onTrimStart && (
        <div
          className="absolute left-0 top-0 bottom-0 w-2 hover:w-3 bg-white/20 hover:bg-amber-400 cursor-ew-resize z-10 transition-all opacity-0 group-hover:opacity-100 flex items-center justify-center"
          onMouseDown={(e) => {
            e.stopPropagation();
            onTrimStart(e, overlay);
          }}
          title="Drag to trim caption start"
        >
          <div className="w-0.5 h-2 bg-white/80 rounded" />
        </div>
      )}

      <div className="px-1.5 py-0.2 truncate leading-tight flex items-center h-full pointer-events-none">
        {isNarrow ? (
          <span className="font-mono text-[9px] font-bold mx-auto">
            {isCaption ? "CC" : "T"}
          </span>
        ) : (
          <span className="truncate">{overlay.text || "(empty)"}</span>
        )}
      </div>

      {/* Right Trim Handle */}
      {onTrimEnd && (
        <div
          className="absolute right-0 top-0 bottom-0 w-2 hover:w-3 bg-white/20 hover:bg-amber-400 cursor-ew-resize z-10 transition-all opacity-0 group-hover:opacity-100 flex items-center justify-center"
          onMouseDown={(e) => {
            e.stopPropagation();
            onTrimEnd(e, overlay);
          }}
          title="Drag to trim caption end"
        >
          <div className="w-0.5 h-2 bg-white/80 rounded" />
        </div>
      )}
    </div>
  );
}

// ─── Playhead ─────────────────────────────────────────────────────────────────

function Playhead({
  currentTime,
  pxPerSec,
  totalHeight,
}: {
  currentTime: number;
  pxPerSec: number;
  totalHeight: number;
}) {
  const x = currentTime * pxPerSec;
  return (
    <div
      className="absolute top-0 bottom-0 w-0.5 bg-cs-error pointer-events-none z-30"
      style={{ left: x, height: totalHeight, transform: "translateX(-50%)" }}
    />
  );
}

// ─── Main TimelineEditor Component ────────────────────────────────────────────

export function TimelineEditor({
  timeline,
  liveAssets,
  currentTime,
  isPlaying,
  onTimelineChange,
  onSeek,
  onPlayPause,
  selectedClipId,
  selectedOverlayId,
  selectedTransitionId,
  selectedTrackId,
  onSelectClip,
  onSelectOverlay,
  onSelectTransition,
  onSelectTrack,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: TimelineEditorProps) {
  const [pxPerSec, setPxPerSec] = useState(ZOOM_DEFAULT);
  const [activeTool, setActiveTool] = useState<EditingTool>("select");
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>(
    selectedClipId ? [selectedClipId] : []
  );
  const [prevSelectedClipId, setPrevSelectedClipId] = useState(selectedClipId);
  if (selectedClipId !== prevSelectedClipId) {
    setPrevSelectedClipId(selectedClipId);
    setSelectedClipIds(selectedClipId ? [selectedClipId] : []);
  }

  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [clipboardClips, setClipboardClips] = useState<TimelineClip[]>([]);
  const { snapEnabled, toggleSnap } = useEditorStore();

  const handleFadeInDrag = useCallback((e: React.MouseEvent, clip: TimelineClip) => {
    e.preventDefault();
    const startX = e.clientX;
    const origFade = clip.fadeIn || 0;
    const clipDur = getClipTimelineDuration(clip);
    const onMove = (ev: MouseEvent) => {
      const dt = (ev.clientX - startX) / pxPerSec;
      const newFade = Math.max(0, Math.min(clipDur, origFade + dt));
      const updated = timeline.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clip.id ? { ...c, fadeIn: Number(newFade.toFixed(2)) } : c)),
      }));
      onTimelineChange({ ...timeline, tracks: updated });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pxPerSec, timeline, onTimelineChange]);

  const handleFadeOutDrag = useCallback((e: React.MouseEvent, clip: TimelineClip) => {
    e.preventDefault();
    const startX = e.clientX;
    const origFade = clip.fadeOut || 0;
    const clipDur = getClipTimelineDuration(clip);
    const onMove = (ev: MouseEvent) => {
      const dt = (startX - ev.clientX) / pxPerSec;
      const newFade = Math.max(0, Math.min(clipDur, origFade + dt));
      const updated = timeline.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clip.id ? { ...c, fadeOut: Number(newFade.toFixed(2)) } : c)),
      }));
      onTimelineChange({ ...timeline, tracks: updated });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pxPerSec, timeline, onTimelineChange]);

  const handleOverlayTrimStart = useCallback((e: React.MouseEvent, overlay: TextOverlay) => {
    e.preventDefault();
    const startX = e.clientX;
    const origStart = overlay.startTime;
    const onMove = (ev: MouseEvent) => {
      const dt = (ev.clientX - startX) / pxPerSec;
      const newStart = Math.max(0, Math.min(overlay.endTime - 0.2, origStart + dt));
      const updated = timeline.textOverlays.map((o) => (o.id === overlay.id ? { ...o, startTime: Number(newStart.toFixed(2)) } : o));
      onTimelineChange({ ...timeline, textOverlays: updated });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pxPerSec, timeline, onTimelineChange]);

  const handleOverlayTrimEnd = useCallback((e: React.MouseEvent, overlay: TextOverlay) => {
    e.preventDefault();
    const startX = e.clientX;
    const origEnd = overlay.endTime;
    const onMove = (ev: MouseEvent) => {
      const dt = (ev.clientX - startX) / pxPerSec;
      const newEnd = Math.max(overlay.startTime + 0.2, origEnd + dt);
      const updated = timeline.textOverlays.map((o) => (o.id === overlay.id ? { ...o, endTime: Number(newEnd.toFixed(2)) } : o));
      onTimelineChange({ ...timeline, textOverlays: updated });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pxPerSec, timeline, onTimelineChange]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rulerAreaRef = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(800);

  const fps = timeline.timebase?.fps || 30;
  const totalDuration = getTimelineDuration(timeline);
  const timelineWidth = Math.max(totalDuration * pxPerSec + 300, viewWidth);

  const { lanes: overlayLanes, totalLanes: overlayTotalLanes } = useMemo(
    () => computeOverlayLanes(timeline.textOverlays),
    [timeline.textOverlays]
  );
  const overlayTrackHeight = Math.max(OVERLAY_TRACK_HEIGHT, overlayTotalLanes * 22 + 8);
  const totalHeight = timeline.tracks.length * TRACK_HEIGHT + overlayTrackHeight;

  // Sync scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const sl = e.currentTarget.scrollLeft;
    if (rulerAreaRef.current) rulerAreaRef.current.scrollLeft = sl;
  }, []);

  // Measure container width
  useEffect(() => {
    if (!scrollContainerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewWidth(entry.contentRect.width - TRACK_HEADER_WIDTH);
      }
    });
    ro.observe(scrollContainerRef.current);
    return () => ro.disconnect();
  }, []);

  // ─── Tool Selection & Clip Drag State ────────────────────────────────────────

  const dragRef = useRef<{
    clipId: string;
    originalStartTime: number;
    dragStartX: number;
    pxPerSec: number;
    mode: "move" | "trimStart" | "trimEnd" | "slip";
    originalSourceIn: number;
    originalSourceOut: number;
  } | null>(null);

  const handleClipDragStart = useCallback(
    (e: React.MouseEvent, clip: TimelineClip) => {
      e.preventDefault();
      dragRef.current = {
        clipId: clip.id,
        originalStartTime: clip.startTime,
        dragStartX: e.clientX,
        pxPerSec,
        mode: activeTool === "slip" ? "slip" : "move",
        originalSourceIn: clip.sourceIn,
        originalSourceOut: clip.sourceOut,
      };

      const handleMouseMove = (ev: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = ev.clientX - drag.dragStartX;
        const dt = dx / drag.pxPerSec;

        if (drag.mode === "slip") {
          try {
            onTimelineChange(slipEdit(timeline, drag.clipId, dt));
          } catch {
            /* clamp bounds silently */
          }
        } else {
          const rawNewStart = drag.originalStartTime + dt;
          const snapTargets = computeSnapTargets(timeline, currentTime, drag.clipId);
          const snapped = snapTime(rawNewStart, snapTargets, drag.pxPerSec, ev.altKey);
          onTimelineChange(moveClip(timeline, drag.clipId, snapped));
        }
      };

      const handleMouseUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [pxPerSec, timeline, currentTime, activeTool, onTimelineChange]
  );

  const handleTrimStart = useCallback(
    (e: React.MouseEvent, clip: TimelineClip) => {
      e.preventDefault();
      const dragStartX = e.clientX;
      const origSourceIn = clip.sourceIn;
      const origStartTime = clip.startTime;
      const rate = clip.playbackRate > 0 ? clip.playbackRate : 1.0;

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - dragStartX;
        const dt = dx / pxPerSec;
        const dtSource = dt * rate;
        const newSourceIn = Math.max(0, origSourceIn + dtSource);
        if (newSourceIn >= clip.sourceOut - 0.1) return;

        if (activeTool === "ripple") {
          onTimelineChange(rippleTrimStart(timeline, clip.id, newSourceIn));
        } else {
          onTimelineChange(trimClipStart(timeline, clip.id, newSourceIn, origStartTime + dt));
        }
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [pxPerSec, timeline, activeTool, onTimelineChange]
  );

  const handleTrimEnd = useCallback(
    (e: React.MouseEvent, clip: TimelineClip) => {
      e.preventDefault();
      const dragStartX = e.clientX;
      const origSourceOut = clip.sourceOut;
      const rate = clip.playbackRate > 0 ? clip.playbackRate : 1.0;

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - dragStartX;
        const dt = dx / pxPerSec;
        const dtSource = dt * rate;
        const newSourceOut = origSourceOut + dtSource;
        if (newSourceOut <= clip.sourceIn + 0.1) return;

        if (activeTool === "ripple") {
          onTimelineChange(rippleTrimEnd(timeline, clip.id, newSourceOut));
        } else {
          onTimelineChange(trimClipEnd(timeline, clip.id, newSourceOut));
        }
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [pxPerSec, timeline, activeTool, onTimelineChange]
  );

  const handleRazorClick = useCallback(
    (e: React.MouseEvent, clip: TimelineClip) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickSeconds = clip.startTime + clickX / pxPerSec;
      const rate = clip.playbackRate > 0 ? clip.playbackRate : 1.0;
      const offset = (clickSeconds - clip.startTime) * rate;
      const splitSourceTime = clip.sourceIn + offset;

      const result = splitClip(timeline, clip.id, splitSourceTime);
      if (result) {
        onTimelineChange(result);
      }
    },
    [pxPerSec, timeline, onTimelineChange]
  );

  // ─── Keyboard Shortcuts Listener ─────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isInputTarget(e)) return;

      // Transport controls
      if (e.code === "Space") {
        e.preventDefault();
        if (totalDuration > 0 && currentTime >= totalDuration - 0.05 && !isPlaying) {
          onSeek(0);
        }
        onPlayPause();
        return;
      }

      if (e.code === "KeyK") {
        e.preventDefault();
        if (isPlaying) onPlayPause();
        return;
      }

      if (e.code === "Home") {
        e.preventDefault();
        onSeek(0);
        return;
      }

      if (e.code === "End") {
        e.preventDefault();
        onSeek(totalDuration);
        return;
      }

      if (e.code === "ArrowLeft") {
        e.preventDefault();
        const delta = e.shiftKey ? -Math.round(fps) : -1;
        onSeek(Math.max(0, stepFrames(currentTime, delta, fps)));
        return;
      }

      if (e.code === "ArrowRight") {
        e.preventDefault();
        const delta = e.shiftKey ? Math.round(fps) : 1;
        onSeek(Math.max(0, stepFrames(currentTime, delta, fps)));
        return;
      }

      // Tools
      if (e.code === "KeyV" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setActiveTool("select");
        return;
      }
      if (e.code === "KeyC" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setActiveTool("razor");
        return;
      }
      if (e.code === "KeyB" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setActiveTool("ripple");
        return;
      }
      if (e.code === "KeyY" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setActiveTool("slip");
        return;
      }
      if (e.code === "KeyU" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setActiveTool("slide");
        return;
      }

      // Split at playhead
      if (e.code === "KeyS" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onTimelineChange(razorSplitAtPlayhead(timeline, currentTime, undefined, selectedClipId || undefined));
        return;
      }

      // Lift / Ripple Delete or remove transition
      if (e.code === "Delete" || e.code === "Backspace") {
        e.preventDefault();
        if (selectedTransitionId) {
          onTimelineChange(removeTransition(timeline, selectedTransitionId));
          onSelectTransition?.(null);
          return;
        }
        const targetIds = selectedClipIds.length > 0 ? selectedClipIds : selectedClipId ? [selectedClipId] : [];
        if (targetIds.length > 0) {
          if (e.shiftKey) {
            onTimelineChange(rippleDeleteClips(timeline, targetIds, true));
          } else {
            onTimelineChange(liftClips(timeline, targetIds));
          }
          onSelectClip(null);
          setSelectedClipIds([]);
        }
        return;
      }

      // Detach Audio
      if (e.code === "KeyA" && e.altKey && selectedClipId) {
        e.preventDefault();
        const res = detachAudio(timeline, selectedClipId);
        if (res) onTimelineChange(res.timeline);
        return;
      }

      // Markers
      if (e.code === "KeyM" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) {
          const next = findNearestMarker(timeline, currentTime, "next");
          if (next) onSeek(next.time);
        } else if (e.altKey) {
          const prev = findNearestMarker(timeline, currentTime, "prev");
          if (prev) onSeek(prev.time);
        } else {
          onTimelineChange(addMarker(timeline, { time: currentTime, label: "Marker", color: "#3b82f6" }));
        }
        return;
      }

      // Undo / Redo
      if (e.code === "KeyZ" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if (e.code === "KeyY" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onRedo();
        return;
      }

      // Clipboard
      if (e.code === "KeyC" && (e.ctrlKey || e.metaKey)) {
        const targetIds = selectedClipIds.length > 0 ? selectedClipIds : selectedClipId ? [selectedClipId] : [];
        if (targetIds.length > 0) {
          e.preventDefault();
          setClipboardClips(copyClips(timeline, targetIds));
        }
        return;
      }
      if (e.code === "KeyV" && (e.ctrlKey || e.metaKey)) {
        if (clipboardClips.length > 0) {
          e.preventDefault();
          onTimelineChange(pasteClips(timeline, clipboardClips, currentTime));
        }
        return;
      }
      if (e.code === "KeyD" && (e.ctrlKey || e.metaKey) && selectedClipId) {
        e.preventDefault();
        const clip = timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId);
        if (clip) {
          const dur = getClipTimelineDuration(clip);
          onTimelineChange(duplicateClip(timeline, selectedClipId, clip.startTime + dur));
        }
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    timeline,
    selectedClipId,
    selectedClipIds,
    currentTime,
    isPlaying,
    totalDuration,
    fps,
    clipboardClips,
    onPlayPause,
    onSeek,
    onTimelineChange,
    onSelectClip,
    selectedTransitionId,
    onSelectTransition,
    onUndo,
    onRedo,
  ]);

  // Context Actions Handler
  const handleContextAction = useCallback(
    (
      action: "lift" | "rippleDelete" | "duplicate" | "split" | "link" | "unlink" | "group" | "ungroup" | "detachAudio" | "freezeFrame",
      clipId: string
    ) => {
      if (action === "detachAudio") {
        const res = detachAudio(timeline, clipId);
        if (res) onTimelineChange(res.timeline);
        return;
      }

      if (action === "freezeFrame") {
        onTimelineChange(insertFreezeFrameAtPlayhead(timeline, clipId, currentTime));
        return;
      }

      const targetIds = selectedClipIds.includes(clipId) ? selectedClipIds : [clipId];

      if (action === "lift") {
        onTimelineChange(liftClips(timeline, targetIds));
        onSelectClip(null);
        setSelectedClipIds([]);
      } else if (action === "rippleDelete") {
        onTimelineChange(rippleDeleteClips(timeline, targetIds, true));
        onSelectClip(null);
        setSelectedClipIds([]);
      } else if (action === "duplicate") {
        const clip = timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
        if (clip) {
          const dur = getClipTimelineDuration(clip);
          onTimelineChange(duplicateClip(timeline, clipId, clip.startTime + dur));
        }
      } else if (action === "split") {
        const found = timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
        if (found) {
          const rate = found.playbackRate > 0 ? found.playbackRate : 1.0;
          const offset = (currentTime - found.startTime) * rate;
          const splitSourceTime = found.sourceIn + offset;
          const result = splitClip(timeline, clipId, splitSourceTime);
          if (result) onTimelineChange(result);
        }
      } else if (action === "group") {
        onTimelineChange(groupClips(timeline, targetIds));
      } else if (action === "ungroup") {
        onTimelineChange(ungroupClips(timeline, targetIds));
      } else if (action === "unlink") {
        onTimelineChange(unlinkClip(timeline, clipId));
      }
    },
    [timeline, selectedClipIds, currentTime, onTimelineChange, onSelectClip]
  );

  const handleRemoveTransition = useCallback(
    (transitionId: string) => {
      onTimelineChange(removeTransition(timeline, transitionId));
      if (selectedTransitionId === transitionId) {
        onSelectTransition?.(null);
      }
    },
    [timeline, selectedTransitionId, onTimelineChange, onSelectTransition]
  );

  const handleAddClip = useCallback(
    (trackId: string, clip: TimelineClip) => {
      onTimelineChange(addClipToTrack(timeline, trackId, clip));
    },
    [timeline, onTimelineChange]
  );

  // Zoom controls
  const zoomIn = () => setPxPerSec((z) => Math.min(ZOOM_MAX, Math.round(z * 1.4)));
  const zoomOut = () => setPxPerSec((z) => Math.max(ZOOM_MIN, Math.round(z / 1.4)));
  const zoomToFit = () => {
    if (totalDuration > 0 && viewWidth > 0) {
      const fitted = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.floor(viewWidth / (totalDuration + 2))));
      setPxPerSec(fitted);
    }
  };

  const sortedTracks = useMemo(
    () => [...timeline.tracks].sort((a, b) => a.order - b.order),
    [timeline.tracks]
  );

  return (
    <div className="flex flex-col h-full bg-cs-bg-base border-t border-cs-border-subtle overflow-hidden select-none">
      {/* ─── NLE Toolbar & Transport Bar ────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-cs-bg-surface border-b border-cs-border-subtle shrink-0 flex-wrap">
        {/* Left: Tool Selection + Snapping + Undo / Redo */}
        <div className="flex items-center gap-1.5">
          {/* Tool Selector */}
          <div className="flex items-center bg-cs-bg-elevated rounded border border-cs-border-subtle p-0.5">
            <button
              onClick={() => setActiveTool("select")}
              className={`h-6 px-2 rounded text-xs font-medium flex items-center gap-1 transition-colors ${
                activeTool === "select" ? "bg-cs-bg-active text-cs-text-primary" : "text-cs-text-secondary hover:text-cs-text-primary"
              }`}
              title="Selection Tool (V)"
            >
              <MousePointer className="w-3 h-3" />
              <span className="hidden sm:inline">Select</span>
            </button>
            <button
              onClick={() => setActiveTool("razor")}
              className={`h-6 px-2 rounded text-xs font-medium flex items-center gap-1 transition-colors ${
                activeTool === "razor" ? "bg-cs-bg-active text-cs-text-primary" : "text-cs-text-secondary hover:text-cs-text-primary"
              }`}
              title="Razor / Blade Tool (C)"
            >
              <Scissors className="w-3 h-3" />
              <span className="hidden sm:inline">Razor</span>
            </button>
            <button
              onClick={() => setActiveTool("ripple")}
              className={`h-6 px-2 rounded text-xs font-medium flex items-center gap-1 transition-colors ${
                activeTool === "ripple" ? "bg-cs-bg-active text-cs-text-primary" : "text-cs-text-secondary hover:text-cs-text-primary"
              }`}
              title="Ripple Edit Tool (B)"
            >
              <span className="font-mono text-[10px] font-bold">»</span>
              <span className="hidden sm:inline">Ripple</span>
            </button>
            <button
              onClick={() => setActiveTool("slip")}
              className={`h-6 px-2 rounded text-xs font-medium flex items-center gap-1 transition-colors ${
                activeTool === "slip" ? "bg-cs-bg-active text-cs-text-primary" : "text-cs-text-secondary hover:text-cs-text-primary"
              }`}
              title="Slip Tool (Y)"
            >
              <span className="font-mono text-[10px] font-bold">⇄</span>
              <span className="hidden sm:inline">Slip</span>
            </button>
          </div>

          <div className="w-px h-5 bg-cs-border-subtle mx-0.5 shrink-0" />

          {/* Magnetic Snap Toggle */}
          <button
            onClick={toggleSnap}
            className={`h-6 px-2 rounded text-xs font-medium flex items-center gap-1 transition-colors ${
              snapEnabled ? "bg-cs-accent/20 text-cs-accent border border-cs-accent/40" : "text-cs-text-tertiary hover:text-cs-text-primary"
            }`}
            title={snapEnabled ? "Snapping ON (N)" : "Snapping OFF (N)"}
          >
            <Magnet className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Snap</span>
          </button>

          <div className="w-px h-5 bg-cs-border-subtle mx-0.5 shrink-0" />

          {/* Undo / Redo */}
          <IconButton label="Undo (Ctrl+Z)" size="sm" onClick={onUndo} disabled={!canUndo}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 .49-3.51" />
            </svg>
          </IconButton>
          <IconButton label="Redo (Ctrl+Y)" size="sm" onClick={onRedo} disabled={!canRedo}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-.49-3.51" />
            </svg>
          </IconButton>
        </div>

        {/* Center: Transport + Timecode Readout + Clip Quick Actions */}
        <div className="flex items-center gap-2">
          {/* Step Back Frame */}
          <IconButton label="Step 1 Frame Back (Left)" size="sm" onClick={() => onSeek(Math.max(0, stepFrames(currentTime, -1, fps)))}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="19 20 9 12 19 4 19 20" />
              <line x1="5" y1="19" x2="5" y2="5" />
            </svg>
          </IconButton>

          {/* Play / Pause Button */}
          <button
            onClick={() => {
              if (totalDuration > 0 && currentTime >= totalDuration - 0.05 && !isPlaying) {
                onSeek(0);
              }
              onPlayPause();
            }}
            className="w-7 h-7 flex items-center justify-center rounded bg-cs-accent hover:bg-cs-accent-hover text-white transition-colors shrink-0 shadow-sm"
            aria-label={isPlaying ? "Pause" : "Play"}
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>

          {/* Step Forward Frame */}
          <IconButton label="Step 1 Frame Forward (Right)" size="sm" onClick={() => onSeek(stepFrames(currentTime, 1, fps))}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 4 15 12 5 20 5 4" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </IconButton>

          <div className="w-px h-5 bg-cs-border-subtle mx-1 shrink-0" />

          {/* SMPTE Timecode Display */}
          <div className="flex items-center gap-1.5 font-mono text-xs bg-cs-bg-base px-2.5 py-1 rounded border border-cs-border-default">
            <span className="text-cs-text-primary font-bold tabular-nums">
              {formatTimecode(currentTime, fps)}
            </span>
            <span className="text-cs-text-tertiary">/</span>
            <span className="text-cs-text-secondary tabular-nums">
              {formatTimecode(totalDuration, fps)}
            </span>
          </div>

          {/* Split at Playhead */}
          <IconButton
            label="Split at playhead (S)"
            size="sm"
            onClick={() => onTimelineChange(razorSplitAtPlayhead(timeline, currentTime, undefined, selectedClipId || undefined))}
          >
            <Scissors className="w-3.5 h-3.5 text-cs-text-secondary" />
          </IconButton>

          {/* Add Marker */}
          <IconButton
            label="Add Marker (M)"
            size="sm"
            onClick={() => onTimelineChange(addMarker(timeline, { time: currentTime, label: "Marker", color: "#3b82f6" }))}
          >
            <Flag className="w-3.5 h-3.5 text-cs-text-secondary" />
          </IconButton>

          {/* Contextual Ripple Delete CTA */}
          {selectedClipId && (
            <IconButton
              label="Ripple Delete Selected Clip (Shift+Del)"
              size="sm"
              onClick={() => onTimelineChange(rippleDeleteClips(timeline, [selectedClipId]))}
              className="text-red-400 hover:text-red-300"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </IconButton>
          )}

          {/* Contextual Detach Audio CTA */}
          {selectedClipId && (
            <IconButton
              label="Detach Audio (Alt+A)"
              size="sm"
              onClick={() => {
                const res = detachAudio(timeline, selectedClipId);
                if (res) onTimelineChange(res);
              }}
            >
              <Unlink className="w-3.5 h-3.5 text-cs-text-secondary" />
            </IconButton>
          )}
        </div>

        {/* Right: Zoom & Shortcuts */}
        <div className="flex items-center gap-2">
          {/* Radix Slider Zoom controls */}
          <div className="flex items-center gap-1.5 bg-cs-bg-elevated px-2 py-0.5 rounded border border-cs-border-subtle">
            <IconButton label="Zoom out (-)" size="sm" onClick={zoomOut} disabled={pxPerSec <= ZOOM_MIN}>
              <ZoomOut className="w-3 h-3 text-cs-text-secondary" />
            </IconButton>
            <Slider.Root
              value={[pxPerSec]}
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={5}
              onValueChange={([val]) => setPxPerSec(val)}
              className="relative flex items-center select-none touch-none w-16 sm:w-20 h-4 cursor-pointer"
            >
              <Slider.Track className="bg-cs-border-default relative grow rounded-full h-1">
                <Slider.Range className="absolute bg-cs-accent rounded-full h-full" />
              </Slider.Track>
              <Slider.Thumb className="block w-2.5 h-2.5 bg-white rounded-full shadow hover:scale-110 focus:outline-none" />
            </Slider.Root>
            <IconButton label="Zoom in (+)" size="sm" onClick={zoomIn} disabled={pxPerSec >= ZOOM_MAX}>
              <ZoomIn className="w-3 h-3 text-cs-text-secondary" />
            </IconButton>
          </div>

          <IconButton label="Zoom to Fit (Shift+Z)" size="sm" onClick={zoomToFit}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </IconButton>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsShortcutsOpen(true)}
            title="View keyboard shortcuts reference"
            className="text-[11px] text-cs-text-secondary px-2"
          >
            Shortcuts (?)
          </Button>
        </div>
      </div>

      {/* ─── Timeline Body (Headers + Tracks) ─────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Track Headers Column */}
        <div
          className="shrink-0 flex flex-col bg-cs-bg-surface border-r border-cs-border-subtle"
          style={{ width: TRACK_HEADER_WIDTH }}
        >
          {/* Header Spacer & Add Track Buttons */}
          <div
            className="shrink-0 bg-cs-bg-elevated border-b border-cs-border-subtle flex items-center justify-between px-2"
            style={{ height: RULER_HEIGHT }}
          >
            <span className="text-[10px] text-cs-text-tertiary uppercase tracking-wider font-semibold">
              Tracks
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onTimelineChange(addTrack(timeline, "video"))}
                className="text-[10px] text-cs-accent hover:underline"
                title="Add Video Track"
              >
                +Video
              </button>
              <span className="text-cs-border-default">|</span>
              <button
                onClick={() => onTimelineChange(addTrack(timeline, "audio"))}
                className="text-[10px] text-cs-info hover:underline"
                title="Add Audio Track"
              >
                +Audio
              </button>
            </div>
          </div>

          {/* Sorted Track Headers */}
          {sortedTracks.map((track) => (
            <TrackHeader
              key={track.id}
              track={track}
              timeline={timeline}
              isSelected={selectedTrackId === track.id}
              onSelect={() => {
                onSelectClip(null);
                onSelectOverlay(null);
                onSelectTrack?.(track.id);
              }}
              onTimelineChange={onTimelineChange}
            />
          ))}

          {/* Text Overlay Track Header */}
          <div
            className="shrink-0 flex items-center gap-2 px-2 border-b border-cs-border-subtle bg-cs-bg-surface select-none"
            style={{ height: overlayTrackHeight }}
          >
            <div className="text-cs-warning opacity-70">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <span className="text-[11px] text-cs-text-secondary truncate">Titles / Captions</span>
          </div>
        </div>

        {/* Scrollable Ruler + Track Lanes Area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Ruler */}
          <div
            ref={rulerAreaRef}
            className="shrink-0 overflow-hidden"
            style={{ height: RULER_HEIGHT }}
          >
            <div style={{ width: timelineWidth, position: "relative" }}>
              <TimelineRuler
                pxPerSec={pxPerSec}
                currentTime={currentTime}
                timelineWidth={timelineWidth}
                fps={fps}
                markers={timeline.markers}
                rulerAreaRef={rulerAreaRef}
                onSeek={onSeek}
                onRemoveMarker={(id) => onTimelineChange(removeMarker(timeline, id))}
              />
            </div>
          </div>

          {/* Track Lanes */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-auto"
            onScroll={handleScroll}
          >
            <div className="relative" style={{ width: timelineWidth, height: totalHeight }}>
              {/* Playhead Vertical Line */}
              <Playhead
                currentTime={currentTime}
                pxPerSec={pxPerSec}
                totalHeight={totalHeight}
              />

              {/* Tracks */}
              {sortedTracks.map((track, idx) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  timeline={timeline}
                  pxPerSec={pxPerSec}
                  liveAssets={liveAssets}
                  selectedClipId={selectedClipId}
                  selectedTransitionId={selectedTransitionId}
                  activeTool={activeTool}
                  onSelectClip={onSelectClip}
                  onSelectTransition={onSelectTransition}
                  onRemoveTransition={handleRemoveTransition}
                  onAddClip={handleAddClip}
                  onLaneClick={() => {
                    onSelectClip(null);
                    onSelectOverlay(null);
                    onSelectTrack?.(null);
                    onSelectTransition?.(null);
                    setSelectedClipIds([]);
                  }}
                  onClipDragStart={handleClipDragStart}
                  onTrimStart={handleTrimStart}
                  onTrimEnd={handleTrimEnd}
                  onFadeInDrag={handleFadeInDrag}
                  onFadeOutDrag={handleFadeOutDrag}
                  onRazorClick={handleRazorClick}
                  onContextAction={handleContextAction}
                  onCloseGap={(gapStart) => onTimelineChange(closeGap(timeline, track.id, gapStart, true))}
                  style={{ top: idx * TRACK_HEIGHT }}
                />
              ))}

              {/* Overlay Lane */}
              <div
                className="absolute left-0 right-0 border-b border-cs-border-subtle bg-cs-bg-base/20"
                style={{ top: sortedTracks.length * TRACK_HEIGHT, height: overlayTrackHeight }}
                onClick={() => {
                  onSelectClip(null);
                  onSelectOverlay(null);
                  onSelectTrack?.(null);
                  onSelectTransition?.(null);
                }}
              >
                {timeline.textOverlays.map((overlay) => (
                  <OverlayBlock
                    key={overlay.id}
                    overlay={overlay}
                    pxPerSec={pxPerSec}
                    isSelected={selectedOverlayId === overlay.id}
                    laneIndex={overlayLanes.get(overlay.id) ?? 0}
                    totalLanes={overlayTotalLanes}
                    onTrimStart={handleOverlayTrimStart}
                    onTrimEnd={handleOverlayTrimEnd}
                    onSelect={() => {
                      onSelectClip(null);
                      onSelectOverlay(overlay.id);
                      onSelectTrack?.(null);
                      onSelectTransition?.(null);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />
    </div>
  );
}

// ─── Track Header ─────────────────────────────────────────────────────────────

function TrackHeader({
  track,
  timeline,
  isSelected,
  onSelect,
  onTimelineChange,
}: {
  track: TimelineTrack;
  timeline: TimelineDocument;
  isSelected?: boolean;
  onSelect?: () => void;
  onTimelineChange: (t: TimelineDocument) => void;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(track.name);

  const handleCommitRename = () => {
    if (renameVal.trim()) {
      onTimelineChange(renameTrack(timeline, track.id, renameVal.trim()));
    }
    setIsRenaming(false);
  };

  return (
    <div
      onClick={onSelect}
      className={`shrink-0 flex items-center justify-between px-2 border-b border-cs-border-subtle text-xs cursor-pointer select-none transition-colors ${
        isSelected
          ? "bg-cs-bg-elevated border-l-2 border-l-cs-accent"
          : "bg-cs-bg-surface hover:bg-cs-bg-base"
      }`}
      style={{ height: TRACK_HEIGHT }}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {/* Track Type Icon */}
        <span className="text-cs-text-tertiary shrink-0">
          {track.type === "video" ? "🎬" : track.type === "audio" ? "🔊" : "📝"}
        </span>

        {/* Track Name */}
        {isRenaming ? (
          <input
            type="text"
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onBlur={handleCommitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCommitRename();
              if (e.key === "Escape") setIsRenaming(false);
            }}
            autoFocus
            className="w-20 h-5 px-1 text-[11px] rounded bg-cs-bg-base border border-cs-border-focus text-cs-text-primary outline-none"
          />
        ) : (
          <span
            onDoubleClick={() => setIsRenaming(true)}
            className={`font-medium truncate flex-1 text-[11px] cursor-pointer hover:underline ${
              track.muted ? "text-cs-text-tertiary line-through" : "text-cs-text-primary"
            }`}
            title="Double-click to rename"
          >
            {track.name}
          </span>
        )}

        {/* Audio Track Role Badge & Ducking Popover */}
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className={`px-1 py-0.2 rounded text-[9px] font-semibold uppercase tracking-wider border transition-colors shrink-0 ${
                track.ducking?.enabled
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : track.audioRole === "dialogue"
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  : track.audioRole === "music"
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                  : "bg-white/10 text-cs-text-secondary border-white/10"
              }`}
              title={`Role: ${track.audioRole}${track.ducking?.enabled ? " (Ducking ON)" : ""}`}
            >
              {track.audioRole.slice(0, 3)}
              {track.ducking?.enabled && " 🦆"}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="z-50 w-56 p-3 rounded-lg bg-cs-bg-elevated border border-cs-border-default shadow-xl text-xs flex flex-col gap-2.5 select-none text-cs-text-primary"
              sideOffset={5}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="font-semibold text-cs-text-primary text-[11px] uppercase tracking-wider">
                Track Audio & Ducking
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-cs-text-tertiary">Role</label>
                <div className="grid grid-cols-2 gap-1">
                  {(["dialogue", "music", "sfx", "general"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => onTimelineChange(setTrackAudioRole(timeline, track.id, r))}
                      className={`h-6 rounded text-[10px] font-medium border capitalize ${
                        track.audioRole === r
                          ? "bg-cs-accent text-white border-cs-accent"
                          : "bg-cs-bg-base border-cs-border-subtle text-cs-text-secondary hover:text-white"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pt-2 border-t border-cs-border-subtle flex flex-col gap-1.5">
                <label className="flex items-center justify-between text-[11px] text-cs-text-secondary cursor-pointer">
                  <span>Auto-Ducking</span>
                  <input
                    type="checkbox"
                    checked={!!track.ducking?.enabled}
                    onChange={(e) =>
                      onTimelineChange(setTrackDucking(timeline, track.id, { enabled: e.target.checked }))
                    }
                    className="rounded border-cs-border-default accent-cs-accent"
                  />
                </label>
                {track.ducking?.enabled && (
                  <div className="flex flex-col gap-1.5 pt-1 text-[10px] text-cs-text-tertiary">
                    <div className="flex justify-between items-center">
                      <span>Reduction: {track.ducking.reductionDb} dB</span>
                      <input
                        type="range"
                        min={-30}
                        max={-3}
                        step={1}
                        value={track.ducking.reductionDb}
                        onChange={(e) =>
                          onTimelineChange(
                            setTrackDucking(timeline, track.id, { reductionDb: Number(e.target.value) })
                          )
                        }
                        className="w-24 accent-cs-accent"
                      />
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Attack: {track.ducking.attackMs} ms</span>
                      <input
                        type="range"
                        min={20}
                        max={1000}
                        step={10}
                        value={track.ducking.attackMs}
                        onChange={(e) =>
                          onTimelineChange(
                            setTrackDucking(timeline, track.id, { attackMs: Number(e.target.value) })
                          )
                        }
                        className="w-24 accent-cs-accent"
                      />
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Release: {track.ducking.releaseMs} ms</span>
                      <input
                        type="range"
                        min={50}
                        max={2000}
                        step={25}
                        value={track.ducking.releaseMs}
                        onChange={(e) =>
                          onTimelineChange(
                            setTrackDucking(timeline, track.id, { releaseMs: Number(e.target.value) })
                          )
                        }
                        className="w-24 accent-cs-accent"
                      />
                    </div>
                  </div>
                )}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      {/* Track Control Buttons (Lock, Video Hide, Mute, Solo, SyncLock) */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Lock Track */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTimelineChange(toggleTrackLock(timeline, track.id));
          }}
          className={`p-1 rounded transition-colors ${
            track.locked ? "text-red-400 bg-red-500/10" : "text-cs-text-tertiary hover:text-cs-text-primary"
          }`}
          title={track.locked ? "Unlock track" : "Lock track"}
        >
          {track.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
        </button>

        {/* Hide Video Track */}
        {track.type === "video" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTimelineChange(toggleTrackHidden(timeline, track.id));
            }}
            className={`p-1 rounded transition-colors ${
              track.hidden ? "text-amber-400 bg-amber-500/10" : "text-cs-text-tertiary hover:text-cs-text-primary"
            }`}
            title={track.hidden ? "Show video track" : "Hide video track"}
          >
            {track.hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </button>
        )}

        {/* Mute Track */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTimelineChange(toggleTrackMute(timeline, track.id));
          }}
          className={`p-1 rounded transition-colors ${
            track.muted ? "text-amber-400 bg-amber-500/10" : "text-cs-text-tertiary hover:text-cs-text-primary"
          }`}
          title={track.muted ? "Unmute track" : "Mute track"}
        >
          {track.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
        </button>

        {/* Solo Track */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTimelineChange(toggleTrackSolo(timeline, track.id));
          }}
          className={`w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center transition-colors ${
            track.solo ? "bg-cs-accent text-white" : "text-cs-text-tertiary hover:text-cs-text-primary bg-white/5"
          }`}
          title={track.solo ? "Disable solo" : "Solo track"}
        >
          S
        </button>

        {/* Sync Lock Track */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTimelineChange(toggleTrackSyncLock(timeline, track.id));
          }}
          className={`p-1 rounded transition-colors ${
            track.syncLocked ? "text-cyan-400" : "text-cs-text-tertiary opacity-40 hover:opacity-100"
          }`}
          title={track.syncLocked ? "Sync-lock enabled" : "Sync-lock disabled"}
        >
          <span className="font-mono text-[9px] font-bold">🔗</span>
        </button>
      </div>
    </div>
  );
}

// ─── Track Lane ───────────────────────────────────────────────────────────────

function TrackLane({
  track,
  timeline,
  pxPerSec,
  liveAssets,
  selectedClipId,
  selectedTransitionId,
  activeTool,
  onSelectClip,
  onSelectTransition,
  onRemoveTransition,
  onAddClip,
  onLaneClick,
  onClipDragStart,
  onTrimStart,
  onTrimEnd,
  onFadeInDrag,
  onFadeOutDrag,
  onRazorClick,
  onContextAction,
  onCloseGap,
  style,
}: {
  track: TimelineTrack;
  timeline: TimelineDocument;
  pxPerSec: number;
  liveAssets: Map<string, LiveAssetItem>;
  selectedClipId: string | null;
  selectedTransitionId?: string | null;
  activeTool: EditingTool;
  onSelectClip: (id: string | null) => void;
  onSelectTransition?: (id: string | null) => void;
  onRemoveTransition?: (id: string) => void;
  onAddClip?: (trackId: string, clip: TimelineClip) => void;
  onLaneClick: () => void;
  onClipDragStart: (e: React.MouseEvent, clip: TimelineClip) => void;
  onTrimStart: (e: React.MouseEvent, clip: TimelineClip) => void;
  onTrimEnd: (e: React.MouseEvent, clip: TimelineClip) => void;
  onFadeInDrag?: (e: React.MouseEvent, clip: TimelineClip) => void;
  onFadeOutDrag?: (e: React.MouseEvent, clip: TimelineClip) => void;
  onRazorClick: (e: React.MouseEvent, clip: TimelineClip) => void;
  onContextAction: (
    action: "lift" | "rippleDelete" | "duplicate" | "split" | "link" | "unlink" | "group" | "ungroup" | "detachAudio" | "freezeFrame",
    clipId: string
  ) => void;
  onCloseGap: (gapStart: number) => void;
  style?: React.CSSProperties;
}) {
  const handleLaneContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickTime = Math.max(0, clickX / pxPerSec);
    onCloseGap(clickTime);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const assetId =
      e.dataTransfer.getData("application/x-content-studio-asset-id") ||
      e.dataTransfer.getData("text/plain");
    if (!assetId) return;

    const liveItem = liveAssets.get(assetId);
    if (!liveItem) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const dropX = e.clientX - rect.left;
    const dropTime = Math.max(0, dropX / pxPerSec);

    const mediaDuration =
      liveItem.asset.metadata?.duration && liveItem.asset.metadata.duration > 0
        ? liveItem.asset.metadata.duration
        : 5;

    const newClip: TimelineClip = {
      id: crypto.randomUUID(),
      assetId,
      trackId: track.id,
      startTime: dropTime,
      sourceIn: 0,
      sourceOut: mediaDuration,
      volume: 1,
      muted: false,
      fitMode: "fit",
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      flipH: false,
      flipV: false,
      fadeIn: 0,
      fadeOut: 0,
      audioDetached: false,
      playbackRate: 1.0,
      preservePitch: true,
      freezeFrameSourceTime: null,
      color: { ...DEFAULT_COLOR_ADJUSTMENTS },
    };

    onAddClip?.(track.id, newClip);
  };

  const trackTransitions = (timeline.transitions || []).filter((tr) => tr.trackId === track.id);

  return (
    <div
      className={`absolute left-0 right-0 border-b border-cs-border-subtle ${
        track.locked
          ? "bg-[repeating-linear-gradient(45deg,#131316,#131316_10px,#1c1c21_10px,#1c1c21_20px)] opacity-60 pointer-events-none"
          : track.muted
          ? "bg-cs-bg-base/40 opacity-70"
          : ""
      }`}
      style={{ ...style, height: TRACK_HEIGHT }}
      onClick={onLaneClick}
      onContextMenu={handleLaneContextMenu}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {track.clips.length === 0 && (
        <div className="flex items-center h-full px-4 pointer-events-none">
          <span className="text-[10px] text-cs-text-tertiary opacity-40 italic">
            Drag media here or perform an Insert/Overwrite edit from the Source Monitor
          </span>
        </div>
      )}

      {/* Render clips on this track */}
      {track.clips.map((clip) => {
        const liveItem = liveAssets.get(clip.assetId);
        const assetName = liveItem?.asset.name ?? clip.assetId;
        return (
          <ClipBlock
            key={clip.id}
            clip={clip}
            pxPerSec={pxPerSec}
            trackHeight={TRACK_HEIGHT}
            assetName={assetName}
            isSelected={selectedClipId === clip.id}
            trackType={track.type}
            isTrackLocked={track.locked}
            activeTool={activeTool}
            onSelect={() => {
              onSelectClip(clip.id);
            }}
            onDragStart={onClipDragStart}
            onTrimStart={onTrimStart}
            onTrimEnd={onTrimEnd}
            onFadeInDrag={onFadeInDrag}
            onFadeOutDrag={onFadeOutDrag}
            onRazorClick={onRazorClick}
            onContextAction={onContextAction}
          />
        );
      })}

      {/* Render transitions on this track */}
      {trackTransitions.map((trans) => (
        <TransitionBlock
          key={trans.id}
          transition={trans}
          pxPerSec={pxPerSec}
          isSelected={selectedTransitionId === trans.id}
          onSelect={() => onSelectTransition?.(trans.id)}
          onDelete={() => onRemoveTransition?.(trans.id)}
        />
      ))}
    </div>
  );
}
