"use client";

/**
 * TimelineEditor — The timeline track/clip editor (bottom panel).
 *
 * Features:
 * - Transport bar: play/pause, time display, zoom controls
 * - Keyboard shortcuts (Space, Delete, Ctrl+Z, Ctrl+Y, S) — not in inputs
 * - Ruler with time markers (adapts to zoom)
 * - Track headers: name, type icon, mute button
 * - Clip rendering: colored blocks, proportional, labeled, selected/muted states
 * - Clip interactions: click to select, drag to move, context actions (duplicate, split, delete)
 * - Text overlay track (virtual row)
 * - Snap: clip edges snap to other edges and playhead (hold Alt to disable)
 * - Zoom: 20–500 px/s, default 100
 * - Horizontal scroll
 * - Empty state per track
 */

import * as React from "react";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { TimelineDocument, TimelineTrack, TimelineClip, TextOverlay } from "../../types/timeline.ts";
import type { LiveAssetItem } from "../../types/project.ts";
import {
  moveClip,
  removeClip,
  duplicateClip,
  splitClip,
  getTimelineDuration,
} from "../../lib/timeline/model.ts";
import {
  isInputTarget,
  computeSnapTargets,
  snapTimeToTargets,
} from "../../lib/timeline/interaction.ts";
import { formatDuration } from "../../lib/media/inspector.ts";
import { IconButton } from "@/components/ui";

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
  onSelectClip: (clipId: string | null) => void;
  onSelectOverlay: (overlayId: string | null) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

const ZOOM_MIN = 20;
const ZOOM_MAX = 500;
const ZOOM_DEFAULT = 100;
const TRACK_HEADER_WIDTH = 160; // px
const TRACK_HEIGHT = 56; // px
const RULER_HEIGHT = 28; // px
const SNAP_THRESHOLD_PX = 8;
const OVERLAY_TRACK_HEIGHT = 36; // px

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimeDisplay(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${f}`;
}

function snapTime(time: number, snapTargets: number[], pxPerSec: number, altPressed: boolean): number {
  if (altPressed) return Math.max(0, time);
  const threshold = SNAP_THRESHOLD_PX / pxPerSec;
  return snapTimeToTargets(time, snapTargets, threshold);
}

// ─── Ruler ────────────────────────────────────────────────────────────────────

function TimelineRuler({
  pxPerSec,
  currentTime,
  timelineWidth,
  rulerAreaRef,
  onSeek,
}: {
  pxPerSec: number;
  currentTime: number;
  timelineWidth: number;
  rulerAreaRef: React.RefObject<HTMLDivElement | null>;
  onSeek: (t: number) => void;
}) {
  // Pick a sensible tick spacing
  const rawInterval = 80 / pxPerSec; // target ~80px between ticks
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
      {ticks.map((t) => {
        const x = t * pxPerSec;
        const isMajor = t % (tickInterval * 5) < 0.001 || tickInterval >= 10;
        return (
          <div key={t} className="absolute top-0 flex flex-col items-center pointer-events-none" style={{ left: x }}>
            <div
              className={`w-px ${isMajor ? "h-3 bg-cs-border-strong" : "h-2 bg-cs-border-default"}`}
            />
            {isMajor && (
              <span className="text-[9px] font-mono text-cs-text-tertiary mt-0.5 whitespace-nowrap">
                {formatDuration(t)}
              </span>
            )}
          </div>
        );
      })}

      {/* Playhead pointer / arrow handle on the ruler */}
      <div
        className="absolute top-0 bottom-0 pointer-events-none z-30 flex flex-col items-center"
        style={{ left: currentTime * pxPerSec, transform: "translateX(-50%)" }}
      >
        {/* Scrubber needle head */}
        <div className="w-3.5 h-3.5 bg-cs-error rounded-t flex items-center justify-center shadow-md">
          <div className="w-1 h-1 bg-white rounded-full" />
        </div>
        {/* Scrubber downward pointer triangle */}
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
  onSelect,
  onDragStart,
  onContextAction,
}: {
  clip: TimelineClip;
  pxPerSec: number;
  trackHeight: number;
  assetName: string;
  isSelected: boolean;
  trackType: "video" | "audio";
  onSelect: () => void;
  onDragStart: (e: React.MouseEvent, clip: TimelineClip) => void;
  onContextAction: (action: "delete" | "duplicate" | "split", clipId: string) => void;
}) {
  const duration = clip.sourceOut - clip.sourceIn;
  const left = clip.startTime * pxPerSec;
  const width = Math.max(2, duration * pxPerSec);

  const baseColor = trackType === "video"
    ? "bg-cs-accent/30 border-cs-accent/60"
    : "bg-cs-info/30 border-cs-info/60";
  const selectedColor = trackType === "video"
    ? "ring-2 ring-cs-accent"
    : "ring-2 ring-cs-info";
  const mutedOpacity = clip.muted ? "opacity-40" : "";

  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const handleOut = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOut);
    return () => document.removeEventListener("mousedown", handleOut);
  }, [showMenu]);

  return (
    <div
      className={`absolute top-1 rounded border text-[10px] font-medium overflow-hidden cursor-grab active:cursor-grabbing select-none
        ${baseColor} ${mutedOpacity} ${isSelected ? selectedColor : ""}
      `}
      style={{ left, width, height: trackHeight - 8 }}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onMouseDown={(e) => {
        if (e.button === 0) onDragStart(e, clip);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setShowMenu(true);
      }}
      title={`${assetName} — ${formatDuration(duration)}`}
    >
      <div className="px-1.5 py-0.5 flex items-center gap-1 h-full">
        <span className="truncate leading-tight">{assetName}</span>
        {clip.muted && (
          <span className="shrink-0 text-[9px] text-cs-text-tertiary">🔇</span>
        )}
      </div>

      {/* Context menu */}
      {showMenu && (
        <div
          ref={menuRef}
          className="absolute left-0 top-full mt-1 z-50 min-w-28 rounded border border-cs-border-default bg-cs-bg-overlay shadow-lg py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {[
            { label: "Split at playhead", action: "split" as const },
            { label: "Duplicate", action: "duplicate" as const },
            { label: "Delete", action: "delete" as const },
          ].map(({ label, action }) => (
            <button
              key={action}
              className={`w-full px-3 py-1 text-left text-xs hover:bg-cs-bg-hover transition-colors ${action === "delete" ? "text-cs-error" : "text-cs-text-primary"}`}
              onClick={() => { setShowMenu(false); onContextAction(action, clip.id); }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Overlay Block ────────────────────────────────────────────────────────────

function OverlayBlock({
  overlay,
  pxPerSec,
  isSelected,
  onSelect,
}: {
  overlay: TextOverlay;
  pxPerSec: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const left = overlay.startTime * pxPerSec;
  const width = Math.max(2, (overlay.endTime - overlay.startTime) * pxPerSec);

  return (
    <div
      className={`absolute top-1 rounded border border-cs-warning/60 bg-cs-warning/20 text-[10px] font-medium overflow-hidden cursor-pointer select-none ${isSelected ? "ring-2 ring-cs-warning" : ""
        }`}
      style={{ left, width, height: OVERLAY_TRACK_HEIGHT - 8 }}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      title={overlay.text}
    >
      <div className="px-1.5 py-0.5 truncate leading-tight text-cs-warning">
        {overlay.text || "(empty)"}
      </div>
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

// ─── Main Component ───────────────────────────────────────────────────────────

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
  onSelectClip,
  onSelectOverlay,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: TimelineEditorProps) {
  const [pxPerSec, setPxPerSec] = useState(ZOOM_DEFAULT);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rulerAreaRef = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(800);

  // Track drag state
  const dragRef = useRef<{
    clipId: string;
    originalStartTime: number;
    dragStartX: number;
    pxPerSec: number;
  } | null>(null);

  const totalDuration = getTimelineDuration(timeline);
  const timelineWidth = Math.max(totalDuration * pxPerSec + 200, viewWidth);
  const totalHeight = timeline.tracks.length * TRACK_HEIGHT + OVERLAY_TRACK_HEIGHT;

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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isInputTarget(e)) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (totalDuration > 0 && currentTime >= totalDuration - 0.05 && !isPlaying) {
          onSeek(0);
        }
        onPlayPause();
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

      if ((e.code === "Delete" || e.code === "Backspace") && selectedClipId) {
        e.preventDefault();
        onTimelineChange(removeClip(timeline, selectedClipId));
        onSelectClip(null);
        return;
      }

      if (e.code === "KeyZ" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey) {
          onRedo();
        } else {
          onUndo();
        }
        return;
      }

      if (e.code === "KeyY" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onRedo();
        return;
      }

      if (e.code === "KeyS" && !e.ctrlKey && !e.metaKey && selectedClipId) {
        e.preventDefault();
        // Split at playhead
        const result = splitClip(timeline, selectedClipId, currentTime);
        if (result) {
          onTimelineChange(result);
          onSelectClip(null);
        }
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [timeline, selectedClipId, currentTime, isPlaying, totalDuration, onPlayPause, onSeek, onTimelineChange, onSelectClip, onUndo, onRedo]);

  // Drag handlers
  const handleClipDragStart = useCallback((e: React.MouseEvent, clip: TimelineClip) => {
    e.preventDefault();
    dragRef.current = {
      clipId: clip.id,
      originalStartTime: clip.startTime,
      dragStartX: e.clientX,
      pxPerSec,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = ev.clientX - drag.dragStartX;
      const dt = dx / drag.pxPerSec;
      const rawNewStart = drag.originalStartTime + dt;

      const snapTargets = computeSnapTargets(timeline, currentTime, drag.clipId);
      const snapped = snapTime(rawNewStart, snapTargets, drag.pxPerSec, ev.altKey);

      onTimelineChange(moveClip(timeline, drag.clipId, snapped));
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [pxPerSec, timeline, currentTime, onTimelineChange]);

  // Context menu actions
  const handleContextAction = useCallback((action: "delete" | "duplicate" | "split", clipId: string) => {
    if (action === "delete") {
      onTimelineChange(removeClip(timeline, clipId));
      if (selectedClipId === clipId) onSelectClip(null);
    } else if (action === "duplicate") {
      const clip = timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
      if (clip) {
        const dur = clip.sourceOut - clip.sourceIn;
        onTimelineChange(duplicateClip(timeline, clipId, clip.startTime + dur));
      }
    } else if (action === "split") {
      const result = splitClip(timeline, clipId, currentTime);
      if (result) {
        onTimelineChange(result);
        if (selectedClipId === clipId) onSelectClip(null);
      }
    }
  }, [timeline, selectedClipId, currentTime, onTimelineChange, onSelectClip]);

  // Ruler click to seek
  const handleRulerSeek = useCallback((t: number) => {
    onSeek(t);
  }, [onSeek]);

  // Click on empty track lane to deselect
  const handleLaneClick = useCallback(() => {
    onSelectClip(null);
    onSelectOverlay(null);
  }, [onSelectClip, onSelectOverlay]);

  // Zoom controls
  const zoomIn = () => setPxPerSec((z) => Math.min(ZOOM_MAX, Math.round(z * 1.5)));
  const zoomOut = () => setPxPerSec((z) => Math.max(ZOOM_MIN, Math.round(z / 1.5)));

  // Auto-scroll playhead into view
  useEffect(() => {
    const sc = scrollContainerRef.current;
    if (!sc) return;
    const playheadX = currentTime * pxPerSec;
    const left = sc.scrollLeft;
    const right = left + viewWidth;
    if (isPlaying && (playheadX < left + 20 || playheadX > right - 40)) {
      sc.scrollLeft = playheadX - viewWidth * 0.3;
    }
  }, [currentTime, pxPerSec, isPlaying, viewWidth]);

  const sortedTracks = useMemo(
    () => [...timeline.tracks].sort((a, b) => a.order - b.order),
    [timeline.tracks]
  );

  return (
    <div className="flex flex-col h-full bg-cs-bg-base border-t border-cs-border-subtle overflow-hidden select-none">
      {/* Transport Bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-cs-bg-surface border-b border-cs-border-subtle shrink-0">
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

        <div className="w-px h-5 bg-cs-border-subtle mx-1 shrink-0" />

        {/* Play / Pause */}
        <button
          onClick={() => {
            if (totalDuration > 0 && currentTime >= totalDuration - 0.05 && !isPlaying) {
              onSeek(0);
            }
            onPlayPause();
          }}
          className="w-7 h-7 flex items-center justify-center rounded bg-cs-accent hover:bg-cs-accent-hover text-white transition-colors shrink-0"
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

        {/* Replay / Jump to Start */}
        <IconButton
          label="Replay / Jump to start (Home)"
          size="sm"
          onClick={() => {
            onSeek(0);
            if (!isPlaying) onPlayPause();
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 .49-3.51" />
          </svg>
        </IconButton>

        <div className="w-px h-5 bg-cs-border-subtle mx-1 shrink-0" />

        {/* Split at playhead */}
        <IconButton
          label="Split selected clip at playhead (S)"
          size="sm"
          disabled={!selectedClipId}
          onClick={() => {
            if (selectedClipId) {
              const result = splitClip(timeline, selectedClipId, currentTime);
              if (result) {
                onTimelineChange(result);
                onSelectClip(null);
              }
            }
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
            <line x1="12" y1="2" x2="12" y2="22" strokeDasharray="3 3" />
            <path d="M19 12H5" />
          </svg>
        </IconButton>

        {/* Delete clip */}
        <IconButton
          label="Delete selected clip (Del)"
          size="sm"
          disabled={!selectedClipId}
          onClick={() => {
            if (selectedClipId) {
              onTimelineChange(removeClip(timeline, selectedClipId));
              onSelectClip(null);
            }
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </IconButton>

        {/* Time display */}
        <span className="text-xs font-mono text-cs-text-primary tabular-nums shrink-0">
          {formatTimeDisplay(currentTime)}
        </span>
        <span className="text-xs font-mono text-cs-text-tertiary shrink-0">
          / {formatTimeDisplay(totalDuration)}
        </span>

        <div className="flex-1" />

        {/* Zoom controls */}
        <span className="text-[10px] text-cs-text-tertiary shrink-0">Zoom</span>
        <IconButton label="Zoom out" size="sm" onClick={zoomOut} disabled={pxPerSec <= ZOOM_MIN}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </IconButton>
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={5}
          value={pxPerSec}
          onChange={(e) => setPxPerSec(parseInt(e.target.value))}
          className="w-20 h-1.5 bg-cs-bg-elevated rounded-lg appearance-none cursor-pointer accent-cs-accent"
          aria-label="Timeline zoom"
        />
        <IconButton label="Zoom in" size="sm" onClick={zoomIn} disabled={pxPerSec >= ZOOM_MAX}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </IconButton>
        <span className="text-[10px] text-cs-text-tertiary w-10 shrink-0">{pxPerSec}px/s</span>
      </div>

      {/* Timeline body */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Track headers column */}
        <div
          className="shrink-0 flex flex-col bg-cs-bg-surface border-r border-cs-border-subtle"
          style={{ width: TRACK_HEADER_WIDTH }}
        >
          {/* Ruler header spacer */}
          <div
            className="shrink-0 bg-cs-bg-elevated border-b border-cs-border-subtle flex items-center px-2"
            style={{ height: RULER_HEIGHT }}
          >
            <span className="text-[10px] text-cs-text-tertiary uppercase tracking-wider font-semibold">Track</span>
          </div>

          {/* Track headers */}
          {sortedTracks.map((track) => (
            <TrackHeader key={track.id} track={track} timeline={timeline} onTimelineChange={onTimelineChange} />
          ))}

          {/* Overlay track header */}
          <div
            className="shrink-0 flex items-center gap-2 px-2 border-b border-cs-border-subtle bg-cs-bg-surface"
            style={{ height: OVERLAY_TRACK_HEIGHT }}
          >
            <div className="text-cs-warning opacity-70">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <span className="text-[10px] text-cs-text-tertiary truncate">Text</span>
          </div>
        </div>

        {/* Scrollable ruler + tracks area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Ruler (scrolls horizontally with tracks) */}
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
                rulerAreaRef={rulerAreaRef}
                onSeek={handleRulerSeek}
              />
            </div>
          </div>

          {/* Track lanes + playhead (scrollable) */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-auto"
            onScroll={handleScroll}
          >
            <div className="relative" style={{ width: timelineWidth, height: totalHeight }}>
              {/* Playhead */}
              <Playhead
                currentTime={currentTime}
                pxPerSec={pxPerSec}
                totalHeight={totalHeight}
              />

              {/* Track lanes */}
              {sortedTracks.map((track, idx) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  pxPerSec={pxPerSec}
                  liveAssets={liveAssets}
                  selectedClipId={selectedClipId}
                  onSelectClip={onSelectClip}
                  onLaneClick={handleLaneClick}
                  onClipDragStart={handleClipDragStart}
                  onContextAction={handleContextAction}
                  style={{ top: idx * TRACK_HEIGHT }}
                />
              ))}

              {/* Text overlay lane */}
              <div
                className="absolute left-0 right-0 border-b border-cs-border-subtle bg-cs-bg-base/20"
                style={{ top: sortedTracks.length * TRACK_HEIGHT, height: OVERLAY_TRACK_HEIGHT }}
                onClick={handleLaneClick}
              >
                {timeline.textOverlays.map((overlay) => (
                  <OverlayBlock
                    key={overlay.id}
                    overlay={overlay}
                    pxPerSec={pxPerSec}
                    isSelected={selectedOverlayId === overlay.id}
                    onSelect={() => { onSelectClip(null); onSelectOverlay(overlay.id); }}
                  />
                ))}
                {timeline.textOverlays.length === 0 && (
                  <div className="flex items-center h-full px-3">
                    <span className="text-[10px] text-cs-text-tertiary opacity-50 italic">No text overlays</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Track Header ─────────────────────────────────────────────────────────────

function TrackHeader({
  track,
  timeline,
  onTimelineChange,
}: {
  track: TimelineTrack;
  timeline: TimelineDocument;
  onTimelineChange: (t: TimelineDocument) => void;
}) {
  const toggleMute = () => {
    onTimelineChange({
      ...timeline,
      tracks: timeline.tracks.map((t) =>
        t.id === track.id ? { ...t, muted: !t.muted } : t
      ),
    });
  };

  return (
    <div
      className="shrink-0 flex items-center gap-2 px-2 border-b border-cs-border-subtle"
      style={{ height: TRACK_HEIGHT }}
    >
      {/* Type icon */}
      <div className={`text-cs-text-tertiary ${track.muted ? "opacity-30" : ""}`}>
        {track.type === "video" ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <polygon points="10 9 10 15 15 12 10 9" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        )}
      </div>

      {/* Track name */}
      <span
        className={`text-xs font-medium truncate flex-1 ${track.muted ? "text-cs-text-tertiary line-through" : "text-cs-text-primary"}`}
        title={track.name}
      >
        {track.name}
      </span>

      {/* Mute button */}
      <button
        onClick={toggleMute}
        className={`w-5 h-5 flex items-center justify-center rounded transition-colors shrink-0 ${track.muted
          ? "text-cs-warning bg-cs-warning/10 hover:bg-cs-warning/20"
          : "text-cs-text-tertiary hover:text-cs-text-primary hover:bg-cs-bg-hover"
          }`}
        title={track.muted ? "Unmute track" : "Mute track"}
        aria-label={track.muted ? "Unmute track" : "Mute track"}
      >
        {track.muted ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0a7 7 0 0 1-.11 1.23" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        )}
      </button>
    </div>
  );
}

// ─── Track Lane ───────────────────────────────────────────────────────────────

function TrackLane({
  track,
  pxPerSec,
  liveAssets,
  selectedClipId,
  onSelectClip,
  onLaneClick,
  onClipDragStart,
  onContextAction,
  style,
}: {
  track: TimelineTrack;
  pxPerSec: number;
  liveAssets: Map<string, LiveAssetItem>;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  onLaneClick: () => void;
  onClipDragStart: (e: React.MouseEvent, clip: TimelineClip) => void;
  onContextAction: (action: "delete" | "duplicate" | "split", clipId: string) => void;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="absolute left-0 right-0 border-b border-cs-border-subtle"
      style={{ ...style, height: TRACK_HEIGHT, background: track.muted ? "rgba(0,0,0,0.3)" : undefined }}
      onClick={onLaneClick}
    >
      {track.clips.length === 0 && (
        <div className="flex items-center h-full px-4">
          <span className="text-[10px] text-cs-text-tertiary opacity-40 italic">
            Drag media here or click + to add
          </span>
        </div>
      )}

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
            onSelect={() => onSelectClip(clip.id)}
            onDragStart={onClipDragStart}
            onContextAction={onContextAction}
          />
        );
      })}
    </div>
  );
}
