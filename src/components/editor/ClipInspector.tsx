"use client";

/**
 * ClipInspector — Properties panel for the selected timeline clip or text overlay.
 *
 * Shows editable properties for selected clip (asset info, start time, source
 * in/out, volume, mute, delete) or selected text overlay (text, timing, style,
 * position, delete). When nothing is selected, shows an "Add Text Overlay" button.
 */

import * as React from "react";
import { useState } from "react";
import type { TimelineDocument, TimelineClip, TextOverlay } from "../../types/timeline.ts";
import type { LiveAssetItem } from "../../types/project.ts";
import {
  removeClip,
  removeTextOverlay,
  updateTextOverlay,
  moveTextOverlay,
  createTextOverlay,
} from "../../lib/timeline/model.ts";
import { formatDuration } from "../../lib/media/inspector.ts";
import { Button, Badge, PanelHeader } from "@/components/ui";

export interface ClipInspectorProps {
  timeline: TimelineDocument;
  selectedClipId: string | null;
  selectedOverlayId: string | null;
  liveAssets: Map<string, LiveAssetItem>;
  currentTime: number;
  onTimelineChange: (t: TimelineDocument) => void;
  onAddTextOverlay: (overlay: TextOverlay) => void;
}

// ─── Clip Inspector ──────────────────────────────────────────────────────────

function findClip(timeline: TimelineDocument, clipId: string): TimelineClip | null {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return null;
}

function findOverlay(timeline: TimelineDocument, overlayId: string): TextOverlay | null {
  return timeline.textOverlays.find((o) => o.id === overlayId) ?? null;
}

function labelClamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

interface NumberFieldProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
  className?: string;
}

function NumberField({ label, value, min, max, step = 0.01, onChange, unit, className = "" }: NumberFieldProps) {
  const [localVal, setLocalVal] = useState(String(Math.round(value * 100) / 100));
  const [prevVal, setPrevVal] = useState(value);

  if (prevVal !== value) {
    setPrevVal(value);
    setLocalVal(String(Math.round(value * 100) / 100));
  }

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <label className="text-[10px] text-cs-text-tertiary uppercase tracking-wider font-semibold">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={localVal}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setLocalVal(e.target.value)}
          onBlur={() => {
            const parsed = parseFloat(localVal);
            if (!isNaN(parsed)) {
              const clamped = min !== undefined && max !== undefined ? labelClamp(parsed, min, max) : parsed;
              onChange(clamped);
              setLocalVal(String(clamped));
            } else {
              setLocalVal(String(value));
            }
          }}
          className="flex-1 h-7 px-2 text-xs font-mono rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary focus:border-cs-accent focus:outline-none focus:ring-1 focus:ring-cs-accent transition-colors"
        />
        {unit && <span className="text-[10px] text-cs-text-tertiary shrink-0">{unit}</span>}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-cs-text-tertiary">
      {children}
    </span>
  );
}

// ─── Clip Panel ───────────────────────────────────────────────────────────────

function ClipPanel({
  clip,
  timeline,
  liveAssets,
  onTimelineChange,
}: {
  clip: TimelineClip;
  timeline: TimelineDocument;
  liveAssets: Map<string, LiveAssetItem>;
  onTimelineChange: (t: TimelineDocument) => void;
}) {
  const liveItem = liveAssets.get(clip.assetId);
  const asset = liveItem?.asset;
  const clipDuration = clip.sourceOut - clip.sourceIn;
  const track = timeline.tracks.find((t) => t.id === clip.trackId);

  function patch<K extends keyof TimelineClip>(field: K, value: TimelineClip[K]) {
    const newTimeline: TimelineDocument = {
      ...timeline,
      tracks: timeline.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) =>
          c.id === clip.id ? { ...c, [field]: value } : c
        ),
      })),
    };
    onTimelineChange(newTimeline);
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      {/* Asset header */}
      <div className="flex flex-col gap-1.5">
        <SectionLabel>Clip</SectionLabel>
        <div className="flex items-center gap-2 mt-0.5">
          <div className="shrink-0 w-7 h-7 rounded bg-cs-bg-muted flex items-center justify-center border border-cs-border-subtle">
            {track?.type === "video" ? (
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
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-cs-text-primary truncate">
              {asset?.name ?? clip.assetId}
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Badge variant={track?.type === "audio" ? "info" : "default"}>
                {track?.type?.toUpperCase() ?? "CLIP"}
              </Badge>
              <span className="text-[11px] text-cs-text-tertiary font-mono">
                {formatDuration(clipDuration)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline position */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Timeline Position</SectionLabel>
        <NumberField
          label="Start time"
          value={clip.startTime}
          min={0}
          step={0.1}
          unit="s"
          onChange={(v) => patch("startTime", v)}
        />
      </div>

      {/* Source range */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Source Range</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="In"
            value={clip.sourceIn}
            min={0}
            max={clip.sourceOut - 0.033}
            step={0.1}
            unit="s"
            onChange={(v) => {
              if (v < clip.sourceOut) patch("sourceIn", v);
            }}
          />
          <NumberField
            label="Out"
            value={clip.sourceOut}
            min={clip.sourceIn + 0.033}
            step={0.1}
            unit="s"
            onChange={(v) => {
              if (v > clip.sourceIn) patch("sourceOut", v);
            }}
          />
        </div>
        <div className="text-[11px] text-cs-text-tertiary">
          Duration: <span className="font-mono text-cs-text-secondary">{formatDuration(clip.sourceOut - clip.sourceIn)}</span>
        </div>
      </div>

      {/* Audio */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Audio</SectionLabel>
        <div className="flex items-center gap-3">
          <div className="flex-1 flex flex-col gap-0.5">
            <label className="text-[10px] text-cs-text-tertiary uppercase tracking-wider font-semibold">Volume</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={clip.volume}
              onChange={(e) => patch("volume", parseFloat(e.target.value))}
              className="w-full h-1.5 bg-cs-bg-base rounded-lg appearance-none cursor-pointer accent-cs-accent"
              aria-label="Volume"
            />
          </div>
          <span className="text-xs font-mono text-cs-text-secondary shrink-0 w-9 text-right">
            {Math.round(clip.volume * 100)}%
          </span>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={clip.muted}
            onChange={(e) => patch("muted", e.target.checked)}
            className="w-3.5 h-3.5 accent-cs-accent"
          />
          <span className="text-xs text-cs-text-secondary">Mute clip</span>
        </label>
      </div>

      {/* Delete */}
      <div className="pt-1 border-t border-cs-border-subtle">
        <Button
          variant="danger"
          size="sm"
          className="w-full"
          onClick={() => onTimelineChange(removeClip(timeline, clip.id))}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          Delete Clip
        </Button>
      </div>
    </div>
  );
}

// ─── Text Overlay Panel ────────────────────────────────────────────────────────

function OverlayPanel({
  overlay,
  timeline,
  onTimelineChange,
}: {
  overlay: TextOverlay;
  timeline: TimelineDocument;
  onTimelineChange: (t: TimelineDocument) => void;
}) {
  function patch(partial: Partial<TextOverlay>) {
    onTimelineChange(updateTextOverlay(timeline, overlay.id, partial));
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex flex-col gap-1.5">
        <SectionLabel>Text Overlay</SectionLabel>
      </div>

      {/* Text */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] text-cs-text-tertiary uppercase tracking-wider font-semibold">Text</label>
        <textarea
          value={overlay.text}
          rows={3}
          onChange={(e) => patch({ text: e.target.value })}
          className="px-2 py-1.5 text-xs rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary focus:border-cs-accent focus:outline-none focus:ring-1 focus:ring-cs-accent resize-none transition-colors"
          placeholder="Enter overlay text…"
        />
      </div>

      {/* Timing */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Timing</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Start"
            value={overlay.startTime}
            min={0}
            max={overlay.endTime - 0.1}
            step={0.1}
            unit="s"
            onChange={(v) => {
              if (v < overlay.endTime) {
                onTimelineChange(moveTextOverlay(timeline, overlay.id, v, overlay.endTime));
              }
            }}
          />
          <NumberField
            label="End"
            value={overlay.endTime}
            min={overlay.startTime + 0.1}
            step={0.1}
            unit="s"
            onChange={(v) => {
              if (v > overlay.startTime) {
                onTimelineChange(moveTextOverlay(timeline, overlay.id, overlay.startTime, v));
              }
            }}
          />
        </div>
        <div className="text-[11px] text-cs-text-tertiary">
          Duration: <span className="font-mono text-cs-text-secondary">{formatDuration(overlay.endTime - overlay.startTime)}</span>
        </div>
      </div>

      {/* Style */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Style</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Font size"
            value={overlay.fontSize}
            min={12}
            max={96}
            step={1}
            unit="px"
            onChange={(v) => patch({ fontSize: Math.round(v) })}
          />
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-cs-text-tertiary uppercase tracking-wider font-semibold">Color</label>
            <input
              type="color"
              value={overlay.color}
              onChange={(e) => patch({ color: e.target.value })}
              className="h-7 w-full rounded bg-cs-bg-base border border-cs-border-default cursor-pointer"
              title="Text color"
            />
          </div>
        </div>

        {/* Alignment */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-cs-text-tertiary uppercase tracking-wider font-semibold">Alignment</label>
          <div className="flex gap-1">
            {(["left", "center", "right"] as const).map((align) => (
              <button
                key={align}
                onClick={() => patch({ align })}
                className={`flex-1 h-7 rounded text-xs transition-colors capitalize ${overlay.align === align
                  ? "bg-cs-accent text-white"
                  : "bg-cs-bg-elevated text-cs-text-secondary hover:bg-cs-bg-hover border border-cs-border-default"
                  }`}
              >
                {align}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Position */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Position</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="X"
            value={Math.round(overlay.x * 100)}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => patch({ x: v / 100 })}
          />
          <NumberField
            label="Y"
            value={Math.round(overlay.y * 100)}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => patch({ y: v / 100 })}
          />
        </div>
      </div>

      {/* Delete */}
      <div className="pt-1 border-t border-cs-border-subtle">
        <Button
          variant="danger"
          size="sm"
          className="w-full"
          onClick={() => onTimelineChange(removeTextOverlay(timeline, overlay.id))}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          Delete Overlay
        </Button>
      </div>
    </div>
  );
}

// ─── Empty Panel ──────────────────────────────────────────────────────────────

function EmptyPanel({
  currentTime,
  onAddTextOverlay,
}: {
  currentTime: number;
  onAddTextOverlay: (overlay: TextOverlay) => void;
}) {
  const handleAdd = () => {
    const overlay = createTextOverlay(currentTime, currentTime + 3);
    onAddTextOverlay(overlay);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-4 text-center">
      <div className="text-cs-text-tertiary opacity-40">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" strokeWidth="1.3" stroke="currentColor">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-cs-text-secondary">Nothing selected</p>
        <p className="text-[11px] text-cs-text-tertiary leading-relaxed">
          Click a clip or text overlay to edit its properties.
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={handleAdd}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add text overlay
      </Button>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function ClipInspector({
  timeline,
  selectedClipId,
  selectedOverlayId,
  liveAssets,
  currentTime,
  onTimelineChange,
  onAddTextOverlay,
}: ClipInspectorProps) {
  const selectedClip = selectedClipId ? findClip(timeline, selectedClipId) : null;
  const selectedOverlay = selectedOverlayId ? findOverlay(timeline, selectedOverlayId) : null;

  const handleAddOverlay = (overlay: TextOverlay) => {
    onAddTextOverlay(overlay);
  };

  return (
    <div className="flex flex-col h-full bg-cs-bg-surface border-l border-cs-border-subtle overflow-hidden">
      <PanelHeader
        title="Inspector"
        description={
          selectedClip
            ? "Clip properties"
            : selectedOverlay
              ? "Text overlay"
              : "No selection"
        }
      />

      <div className="flex-1 overflow-y-auto">
        {selectedClip ? (
          <ClipPanel
            clip={selectedClip}
            timeline={timeline}
            liveAssets={liveAssets}
            onTimelineChange={onTimelineChange}
          />
        ) : selectedOverlay ? (
          <OverlayPanel
            overlay={selectedOverlay}
            timeline={timeline}
            onTimelineChange={onTimelineChange}
          />
        ) : (
          <EmptyPanel
            currentTime={currentTime}
            onAddTextOverlay={handleAddOverlay}
          />
        )}
      </div>
    </div>
  );
}
