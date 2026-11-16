"use client";

/**
 * ClipInspector — Comprehensive Properties Inspector for Content Studio.
 *
 * Professional NLE Inspector Sections:
 * 1. Selected Clip:
 *    - Transform tab: Position X/Y, Scale X/Y, Rotation, Opacity, Speed multiplier
 *    - Audio tab: Volume gain slider, Mute, Detach Audio
 *    - Transitions tab: Apply/edit in-point & out-point transitions, parameters, duration
 *    - Animation tab: Presets (Entrance, Exit, Continuous) & Editable Keyframe list
 *    - Info tab: File metadata, source in/out, duration, delete clip
 * 2. Selected Text Overlay / Caption:
 *    - Text editor with multiline support
 *    - Timing: start, end, duration, snap to playhead
 *    - Presets: Clean, Bold, Minimal, Karaoke
 *    - Font styling: family, size, weight, alignment, fill color, stroke outline, shadow
 *    - Background pill: color, opacity, corner radius, padding
 *    - Caption operations: split at playhead, merge with next, delete
 * 3. Selected Transition:
 *    - Transition type, duration, alignment, parameters (color, softness, easing), delete
 * 4. Selected Track:
 *    - Track name, mute, solo, video hidden, sync-lock, lock edits, track height, volume
 * 5. Empty Selection (Sequence / General):
 *    - Sequence properties
 *    - Quick Actions: Add Title, Generate Captions for Sequence, Import/Export SRT/VTT
 */

import * as React from "react";
import { useState, useRef } from "react";
import type {
  TimelineDocument,
  TimelineClip,
  TimelineTrack,
  TextOverlay,
  TimelineTransition,
  ClipKeyframe,
  KeyframeProperty,
  KeyframeInterpolation,
  AnimationPresetId,
  TransitionType,
} from "../../types/timeline.ts";
import type { LiveAssetItem } from "../../types/project.ts";
import {
  removeClip,
  removeTextOverlay,
  updateTextOverlay,
  moveTextOverlay,
  createTextOverlay,
  addTransition,
  removeTransition,
  updateTransition,
} from "../../lib/timeline/model.ts";
import {
  renameTrack,
  removeTrack,
  toggleTrackLock,
  toggleTrackMute,
  toggleTrackSolo,
  toggleTrackHidden,
  toggleTrackSyncLock,
  detachAudio,
} from "../../lib/timeline/editingOperations.ts";
import {
  TRANSITION_CATALOG,
  createTimelineTransition,
  getTransitionDefinition,
} from "../../lib/transitions/transitionCatalog.ts";
import {
  ANIMATION_PRESETS,
  createClipAnimationPreset,
  applyPresetAsKeyframes,
} from "../../lib/animation/animationPresets.ts";
import {
  serializeTextOverlaysToSrt,
  serializeTextOverlaysToVtt,
  parseSubtitleFileContent,
} from "../../lib/transcription/subtitleParser.ts";
import { formatDuration } from "../../lib/media/inspector.ts";
import { formatBytes } from "../../lib/projectValidation.ts";
import { Button, Badge, PanelHeader } from "@/components/ui";

export interface ClipInspectorProps {
  timeline: TimelineDocument;
  selectedClipId: string | null;
  selectedOverlayId: string | null;
  selectedTransitionId?: string | null;
  selectedTrackId?: string | null;
  liveAssets: Map<string, LiveAssetItem>;
  currentTime: number;
  onTimelineChange: (t: TimelineDocument) => void;
  onAddTextOverlay: (overlay: TextOverlay) => void;
  onSelectTrack?: (trackId: string | null) => void;
  onSelectTransition?: (transitionId: string | null) => void;
  onGenerateCaptions?: () => void;
  isGeneratingCaptions?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function findTransition(timeline: TimelineDocument, transId: string): TimelineTransition | null {
  return (timeline.transitions || []).find((t) => t.id === transId) ?? null;
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

// ─── Selected Clip Inspector ──────────────────────────────────────────────────

function ClipPanel({
  clip,
  timeline,
  liveAssets,
  currentTime,
  onTimelineChange,
}: {
  clip: TimelineClip;
  timeline: TimelineDocument;
  liveAssets: Map<string, LiveAssetItem>;
  currentTime: number;
  onTimelineChange: (t: TimelineDocument) => void;
}) {
  const [tab, setTab] = useState<"transform" | "audio" | "transitions" | "animation" | "info">("transform");
  const liveItem = liveAssets.get(clip.assetId);
  const asset = liveItem?.asset;
  const clipDuration = (clip.sourceOut - clip.sourceIn) / (clip.speed || 1);
  const track = timeline.tracks.find((t) => t.id === clip.trackId);
  const isVideo = track?.type === "video";

  function patchClip(patch: Partial<TimelineClip>) {
    const newTimeline: TimelineDocument = {
      ...timeline,
      tracks: timeline.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clip.id ? { ...c, ...patch } : c)),
      })),
    };
    onTimelineChange(newTimeline);
  }

  function patchTransform(patch: Partial<NonNullable<TimelineClip["transform"]>>) {
    const currentT = clip.transform || { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
    patchClip({ transform: { ...currentT, ...patch } });
  }

  // Handle Detach Audio
  const handleDetachAudio = () => {
    const res = detachAudio(timeline, clip.id, { disableEmbeddedAudio: true });
    if (res) {
      onTimelineChange(res.timeline);
    }
  };

  // Transitions on this clip
  const clipTransitions = (timeline.transitions || []).filter(
    (t) => t.fromClipId === clip.id || t.toClipId === clip.id
  );

  const handleAddTransition = (type: TransitionType) => {
    const trans = createTimelineTransition(type, clip.startTime, clip.trackId, {
      toClipId: clip.id,
      duration: 0.8,
      alignment: "center",
    });
    onTimelineChange(addTransition(timeline, trans));
  };

  // Keyframes management
  const [keyframeProp, setKeyframeProp] = useState<KeyframeProperty>("opacity");
  const [keyframeVal, setKeyframeVal] = useState<number>(1);
  const [keyframeInterp, setKeyframeInterp] = useState<KeyframeInterpolation>("ease-in-out");

  const handleAddKeyframeAtPlayhead = () => {
    const offset = Math.max(0, Math.min(clipDuration, currentTime - clip.startTime));
    const newKf: ClipKeyframe = {
      id: `kf-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      property: keyframeProp,
      time: Number(offset.toFixed(2)),
      value: keyframeVal,
      interpolation: keyframeInterp,
    };
    const existing = clip.keyframes || [];
    const updated = [...existing.filter((k) => !(k.property === keyframeProp && Math.abs(k.time - offset) < 0.05)), newKf];
    patchClip({ keyframes: updated.sort((a, b) => a.time - b.time) });
  };

  const handleRemoveKeyframe = (kfId: string) => {
    patchClip({ keyframes: (clip.keyframes || []).filter((k) => k.id !== kfId) });
  };

  const handleApplyPreset = (presetId: AnimationPresetId) => {
    const updatedClip = applyPresetAsKeyframes(clip, presetId);
    patchClip({ keyframes: updatedClip.keyframes, animationPreset: undefined });
  };

  return (
    <div className="flex flex-col h-full bg-cs-bg-surface overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-cs-border-subtle shrink-0">
        <div className="flex items-center gap-2">
          <div className="shrink-0 w-7 h-7 rounded bg-cs-bg-muted flex items-center justify-center border border-cs-border-subtle">
            {isVideo ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <polygon points="10 9 10 15 15 12 10 9" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            )}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs font-semibold text-cs-text-primary truncate" title={asset?.name ?? clip.assetId}>
              {asset?.name ?? clip.assetId}
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Badge variant={isVideo ? "default" : "info"}>{track?.type.toUpperCase()}</Badge>
              <span className="text-[10px] text-cs-text-tertiary font-mono">{formatDuration(clipDuration)}</span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-1 mt-3 bg-cs-bg-base p-0.5 rounded border border-cs-border-subtle text-[11px]">
          {(["transform", "audio", "transitions", "animation", "info"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1 rounded capitalize font-medium transition-colors ${
                tab === t ? "bg-cs-bg-active text-cs-text-primary shadow-xs" : "text-cs-text-tertiary hover:text-cs-text-primary"
              }`}
            >
              {t === "transform" ? "Motion" : t}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
        {tab === "transform" && (
          <>
            <div className="flex flex-col gap-2">
              <SectionLabel>Position</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="X"
                  value={clip.transform?.x || 0}
                  step={5}
                  unit="px"
                  onChange={(v) => patchTransform({ x: v })}
                />
                <NumberField
                  label="Y"
                  value={clip.transform?.y || 0}
                  step={5}
                  unit="px"
                  onChange={(v) => patchTransform({ y: v })}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <SectionLabel>Scale & Rotation</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Scale X"
                  value={clip.transform?.scaleX ?? 1}
                  min={0.1}
                  max={5}
                  step={0.05}
                  unit="x"
                  onChange={(v) => patchTransform({ scaleX: v })}
                />
                <NumberField
                  label="Scale Y"
                  value={clip.transform?.scaleY ?? 1}
                  min={0.1}
                  max={5}
                  step={0.05}
                  unit="x"
                  onChange={(v) => patchTransform({ scaleY: v })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Rotation"
                  value={clip.transform?.rotation || 0}
                  min={-360}
                  max={360}
                  step={1}
                  unit="°"
                  onChange={(v) => patchTransform({ rotation: v })}
                />
                <NumberField
                  label="Opacity"
                  value={Math.round((clip.transform?.opacity ?? 1) * 100)}
                  min={0}
                  max={100}
                  step={5}
                  unit="%"
                  onChange={(v) => patchTransform({ opacity: v / 100 })}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <SectionLabel>Playback Speed</SectionLabel>
              <div className="flex items-center gap-2">
                {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((s) => (
                  <button
                    key={s}
                    onClick={() => patchClip({ speed: s })}
                    className={`flex-1 py-1 rounded text-[11px] font-mono border transition-colors ${
                      (clip.speed ?? 1.0) === s
                        ? "bg-cs-accent text-white border-cs-accent font-semibold"
                        : "bg-cs-bg-base border-cs-border-default text-cs-text-secondary hover:text-cs-text-primary"
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => patchClip({ transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, speed: 1.0 })}
            >
              Reset Motion to Default
            </Button>
          </>
        )}

        {tab === "audio" && (
          <>
            <div className="flex flex-col gap-2">
              <SectionLabel>Clip Volume</SectionLabel>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={clip.volume}
                  onChange={(e) => patchClip({ volume: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-cs-bg-base rounded appearance-none cursor-pointer accent-cs-accent"
                />
                <span className="text-xs font-mono text-cs-text-primary w-10 text-right">
                  {Math.round(clip.volume * 100)}%
                </span>
              </div>
              <label className="flex items-center gap-2 mt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clip.muted}
                  onChange={(e) => patchClip({ muted: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-cs-border-default accent-cs-accent"
                />
                <span className="text-xs text-cs-text-secondary">Mute clip audio</span>
              </label>
            </div>

            {isVideo && (
              <div className="p-3 bg-cs-bg-base/70 border border-cs-border-subtle rounded-lg flex flex-col gap-2">
                <SectionLabel>Audio Separation</SectionLabel>
                <p className="text-[11px] text-cs-text-tertiary">
                  Creates an independent linked audio clip on an audio track. Mutes embedded audio on this video clip to prevent double playback.
                </p>
                <Button variant="secondary" size="sm" onClick={handleDetachAudio} className="w-full">
                  Detach Audio to Dedicated Track
                </Button>
                {clip.embeddedAudioDisabled && (
                  <Badge variant="warning">Embedded source audio is muted (detached)</Badge>
                )}
              </div>
            )}
          </>
        )}

        {tab === "transitions" && (
          <>
            <div className="flex flex-col gap-2">
              <SectionLabel>Applied Transitions</SectionLabel>
              {clipTransitions.length === 0 ? (
                <p className="text-xs text-cs-text-tertiary italic">No transition applied to this clip edit points.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {clipTransitions.map((tr) => (
                    <div key={tr.id} className="p-2.5 rounded bg-cs-bg-base border border-cs-border-subtle flex flex-col gap-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-cs-text-primary">{getTransitionDefinition(tr.type)?.label ?? tr.type}</span>
                        <button
                          onClick={() => onTimelineChange(removeTransition(timeline, tr.id))}
                          className="text-cs-text-tertiary hover:text-cs-error text-xs"
                          title="Remove transition"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-cs-text-tertiary">
                        <span>Duration: {tr.duration}s</span>
                        <span className="capitalize">{tr.alignment} edit</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 pt-2 border-t border-cs-border-subtle">
              <SectionLabel>Add Transition</SectionLabel>
              <div className="grid grid-cols-2 gap-1.5">
                {TRANSITION_CATALOG.slice(0, 8).map((cat) => (
                  <button
                    key={cat.type}
                    onClick={() => handleAddTransition(cat.type)}
                    className="p-1.5 rounded bg-cs-bg-base border border-cs-border-default hover:border-cs-accent hover:text-cs-accent text-[11px] text-left transition-colors truncate"
                    title={cat.description}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === "animation" && (
          <>
            <div className="flex flex-col gap-2">
              <SectionLabel>Presets</SectionLabel>
              <div className="grid grid-cols-2 gap-1.5">
                {ANIMATION_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleApplyPreset(p.id)}
                    className="p-2 rounded bg-cs-bg-base border border-cs-border-default hover:border-cs-accent hover:text-cs-accent text-left transition-colors flex flex-col gap-0.5"
                  >
                    <span className="text-xs font-medium text-cs-text-primary truncate">{p.label}</span>
                    <span className="text-[10px] text-cs-text-tertiary capitalize">{p.category}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-2 border-t border-cs-border-subtle">
              <SectionLabel>Add Keyframe at Playhead</SectionLabel>
              <div className="grid grid-cols-3 gap-1.5">
                <select
                  value={keyframeProp}
                  onChange={(e) => setKeyframeProp(e.target.value as KeyframeProperty)}
                  className="bg-cs-bg-base border border-cs-border-default rounded px-2 py-1 text-xs text-cs-text-primary font-medium"
                >
                  <option value="positionX">Position X</option>
                  <option value="positionY">Position Y</option>
                  <option value="scale">Scale</option>
                  <option value="rotation">Rotation</option>
                  <option value="opacity">Opacity</option>
                  <option value="volume">Volume</option>
                </select>
                <input
                  type="number"
                  value={keyframeVal}
                  step={0.1}
                  onChange={(e) => setKeyframeVal(parseFloat(e.target.value) || 0)}
                  className="bg-cs-bg-base border border-cs-border-default rounded px-2 py-1 text-xs text-cs-text-primary font-mono"
                />
                <Button variant="primary" size="sm" onClick={handleAddKeyframeAtPlayhead}>
                  + Add Keyframe
                </Button>
              </div>
            </div>

            {clip.keyframes && clip.keyframes.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <SectionLabel>Existing Keyframes ({clip.keyframes.length})</SectionLabel>
                <div className="flex flex-col gap-1 max-h-40 overflow-y-auto pr-1">
                  {clip.keyframes.map((kf) => (
                    <div key={kf.id} className="flex items-center justify-between p-1.5 rounded bg-cs-bg-base text-xs font-mono">
                      <span>{kf.property}: {kf.value} @ +{kf.time.toFixed(2)}s</span>
                      <button
                        onClick={() => handleRemoveKeyframe(kf.id)}
                        className="text-cs-text-tertiary hover:text-cs-error text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {tab === "info" && (
          <>
            <div className="flex flex-col gap-2 text-xs">
              <SectionLabel>Timing & Asset</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Timeline Start"
                  value={clip.startTime}
                  min={0}
                  step={0.1}
                  unit="s"
                  onChange={(v) => patchClip({ startTime: v })}
                />
                <div className="flex flex-col gap-0.5">
                  <label className="text-[10px] text-cs-text-tertiary uppercase tracking-wider font-semibold">Duration</label>
                  <span className="h-7 px-2 flex items-center text-xs font-mono rounded bg-cs-bg-base border border-cs-border-subtle text-cs-text-secondary">
                    {formatDuration(clipDuration)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Source In"
                  value={clip.sourceIn}
                  min={0}
                  step={0.1}
                  unit="s"
                  onChange={(v) => v < clip.sourceOut && patchClip({ sourceIn: v })}
                />
                <NumberField
                  label="Source Out"
                  value={clip.sourceOut}
                  min={clip.sourceIn + 0.05}
                  step={0.1}
                  unit="s"
                  onChange={(v) => v > clip.sourceIn && patchClip({ sourceOut: v })}
                />
              </div>

              {asset && (
                <div className="p-2.5 rounded bg-cs-bg-base border border-cs-border-subtle flex flex-col gap-1 text-[11px] text-cs-text-secondary">
                  <span>File: {asset.name}</span>
                  <span>Size: {formatBytes(asset.size)}</span>
                  {asset.metadata?.videoTracks?.[0] && (
                    <span>
                      Video: {asset.metadata.videoTracks[0].displayWidth || asset.metadata.videoTracks[0].codedWidth}x
                      {asset.metadata.videoTracks[0].displayHeight || asset.metadata.videoTracks[0].codedHeight} (
                      {asset.metadata.videoTracks[0].codec || "H.264"})
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-cs-border-subtle">
              <Button
                variant="danger"
                size="sm"
                className="w-full"
                onClick={() => onTimelineChange(removeClip(timeline, clip.id))}
              >
                Delete Clip from Sequence
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Selected Text Overlay / Caption Inspector ────────────────────────────────

function OverlayPanel({
  overlay,
  timeline,
  currentTime,
  onTimelineChange,
}: {
  overlay: TextOverlay;
  timeline: TimelineDocument;
  currentTime: number;
  onTimelineChange: (t: TimelineDocument) => void;
}) {
  const isCaption = overlay.overlayType === "caption";

  function patch(partial: Partial<TextOverlay>) {
    onTimelineChange(updateTextOverlay(timeline, overlay.id, partial));
  }

  // Caption split at playhead
  const handleSplitAtPlayhead = () => {
    if (currentTime <= overlay.startTime + 0.1 || currentTime >= overlay.endTime - 0.1) return;
    const firstHalfText = overlay.text.slice(0, Math.floor(overlay.text.length / 2)).trim();
    const secondHalfText = overlay.text.slice(Math.floor(overlay.text.length / 2)).trim();

    const secondCue: TextOverlay = {
      ...overlay,
      id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `caption-${Date.now()}`,
      text: secondHalfText,
      startTime: currentTime,
      endTime: overlay.endTime,
    };

    const updatedCurrent: TextOverlay = {
      ...overlay,
      text: firstHalfText,
      endTime: currentTime,
    };

    const newOverlays = timeline.textOverlays.map((o) => (o.id === overlay.id ? updatedCurrent : o));
    onTimelineChange({
      ...timeline,
      textOverlays: [...newOverlays, secondCue].sort((a, b) => a.startTime - b.startTime),
    });
  };

  return (
    <div className="flex flex-col h-full bg-cs-bg-surface overflow-y-auto p-3 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-cs-border-subtle pb-2">
        <div className="flex items-center gap-2">
          <Badge variant={isCaption ? "info" : "default"}>
            {isCaption ? "TIMED CAPTION" : "TITLE OVERLAY"}
          </Badge>
          <span className="text-xs text-cs-text-tertiary font-mono">
            {formatDuration(overlay.endTime - overlay.startTime)}
          </span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => patch({ overlayType: "title" })}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              !isCaption ? "bg-cs-accent text-white" : "bg-cs-bg-base text-cs-text-secondary border border-cs-border-subtle"
            }`}
          >
            Title
          </button>
          <button
            onClick={() => patch({ overlayType: "caption" })}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              isCaption ? "bg-cs-accent text-white" : "bg-cs-bg-base text-cs-text-secondary border border-cs-border-subtle"
            }`}
          >
            Caption
          </button>
        </div>
      </div>

      {/* Text Area */}
      <div className="flex flex-col gap-1.5">
        <SectionLabel>Text Content</SectionLabel>
        <textarea
          value={overlay.text}
          rows={3}
          onChange={(e) => patch({ text: e.target.value })}
          className="w-full px-2 py-1.5 text-xs rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary focus:border-cs-accent focus:outline-none focus:ring-1 focus:ring-cs-accent resize-none transition-colors"
          placeholder="Enter overlay text…"
        />
      </div>

      {/* Timing Controls */}
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
            onChange={(v) => v < overlay.endTime && patch({ startTime: v })}
          />
          <NumberField
            label="End"
            value={overlay.endTime}
            min={overlay.startTime + 0.1}
            step={0.1}
            unit="s"
            onChange={(v) => v > overlay.startTime && patch({ endTime: v })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => patch({ startTime: currentTime, endTime: Math.max(currentTime + 1, overlay.endTime) })}
            className="flex-1 text-[11px]"
          >
            Align Start to Playhead
          </Button>
          {isCaption && (
            <Button variant="secondary" size="sm" onClick={handleSplitAtPlayhead} className="flex-1 text-[11px]">
              Split at Playhead
            </Button>
          )}
        </div>
      </div>

      {/* Style & Presets */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Appearance</SectionLabel>
        {isCaption && (
          <div className="flex gap-1.5">
            {(["clean", "bold", "minimal"] as const).map((p) => (
              <button
                key={p}
                onClick={() => {
                  if (p === "bold") {
                    patch({ preset: p, backgroundColor: "rgba(0, 0, 0, 0.85)", strokeColor: undefined, strokeWidth: 0 });
                  } else if (p === "minimal") {
                    patch({ preset: p, backgroundColor: undefined, strokeColor: "#000000", strokeWidth: 2 });
                  } else {
                    patch({ preset: p, backgroundColor: "rgba(0, 0, 0, 0.72)", strokeColor: "#000000", strokeWidth: 1.5 });
                  }
                }}
                className={`flex-1 py-1 rounded text-xs capitalize font-medium border transition-colors ${
                  overlay.preset === p || (!overlay.preset && p === "clean")
                    ? "bg-cs-accent text-white border-cs-accent"
                    : "bg-cs-bg-base border-cs-border-default text-cs-text-secondary"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-cs-text-tertiary uppercase tracking-wider font-semibold">Font Family</label>
            <select
              value={overlay.fontFamily || "sans-serif"}
              onChange={(e) => patch({ fontFamily: e.target.value })}
              className="h-7 px-2 text-xs rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary"
            >
              <option value="sans-serif">System Sans</option>
              <option value="Inter, sans-serif">Inter</option>
              <option value="Impact, sans-serif">Impact</option>
              <option value="Arial, sans-serif">Arial</option>
              <option value="Georgia, serif">Georgia</option>
              <option value="monospace">Monospace</option>
            </select>
          </div>
          <NumberField
            label="Font Size"
            value={overlay.fontSize}
            min={12}
            max={96}
            step={1}
            unit="px"
            onChange={(v) => patch({ fontSize: Math.round(v) })}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-cs-text-tertiary uppercase tracking-wider font-semibold">Fill Color</label>
            <input
              type="color"
              value={overlay.color}
              onChange={(e) => patch({ color: e.target.value })}
              className="h-7 w-full rounded bg-cs-bg-base border border-cs-border-default cursor-pointer"
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-cs-text-tertiary uppercase tracking-wider font-semibold">Alignment</label>
            <div className="flex gap-1 h-7">
              {(["left", "center", "right"] as const).map((al) => (
                <button
                  key={al}
                  onClick={() => patch({ align: al })}
                  className={`flex-1 rounded text-xs capitalize ${
                    overlay.align === al ? "bg-cs-accent text-white" : "bg-cs-bg-base border border-cs-border-default text-cs-text-secondary"
                  }`}
                >
                  {al[0].toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Animation */}
        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] text-cs-text-tertiary uppercase tracking-wider font-semibold">Text Animation</label>
          <select
            value={overlay.animationPreset || "none"}
            onChange={(e) => patch({ animationPreset: e.target.value === "none" ? undefined : (e.target.value as any) })}
            className="h-7 px-2 text-xs rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary"
          >
            <option value="none">None (Static Text)</option>
            <option value="typewriter">Typewriter Reveal</option>
            <option value="word_reveal">Word-by-Word Reveal</option>
            <option value="character_reveal">Character Sweep</option>
          </select>
        </div>
      </div>

      {/* Delete */}
      <div className="pt-2 border-t border-cs-border-subtle">
        <Button
          variant="danger"
          size="sm"
          className="w-full"
          onClick={() => onTimelineChange(removeTextOverlay(timeline, overlay.id))}
        >
          Delete {isCaption ? "Caption Cue" : "Title Overlay"}
        </Button>
      </div>
    </div>
  );
}

// ─── Selected Transition Inspector ────────────────────────────────────────────

function TransitionPanel({
  transition,
  timeline,
  onTimelineChange,
  onDeselect,
}: {
  transition: TimelineTransition;
  timeline: TimelineDocument;
  onTimelineChange: (t: TimelineDocument) => void;
  onDeselect: () => void;
}) {
  const def = getTransitionDefinition(transition.type);

  function patch(patchData: Partial<TimelineTransition>) {
    onTimelineChange(updateTransition(timeline, transition.id, patchData));
  }

  function patchParam(key: string, val: any) {
    patch({ params: { ...transition.params, [key]: val } });
  }

  return (
    <div className="flex flex-col h-full bg-cs-bg-surface overflow-y-auto p-3 gap-4">
      <div className="flex items-center justify-between border-b border-cs-border-subtle pb-2">
        <Badge variant="default">TRANSITION</Badge>
        <span className="text-xs font-semibold text-cs-text-primary">{def?.label ?? transition.type}</span>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Settings</SectionLabel>
        <NumberField
          label="Duration"
          value={transition.duration}
          min={0.1}
          max={5.0}
          step={0.1}
          unit="s"
          onChange={(v) => patch({ duration: v })}
        />

        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] text-cs-text-tertiary uppercase tracking-wider font-semibold">Alignment</label>
          <div className="flex gap-1 h-7">
            {(["start", "center", "end"] as const).map((al) => (
              <button
                key={al}
                onClick={() => patch({ alignment: al })}
                className={`flex-1 rounded text-xs capitalize ${
                  transition.alignment === al ? "bg-cs-accent text-white" : "bg-cs-bg-base border border-cs-border-default text-cs-text-secondary"
                }`}
              >
                {al}
              </button>
            ))}
          </div>
        </div>

        {def?.availableParams?.map((p) => (
          <div key={p.name} className="flex flex-col gap-0.5">
            <label className="text-[10px] text-cs-text-tertiary uppercase tracking-wider font-semibold">{p.label}</label>
            {p.type === "color" && (
              <input
                type="color"
                value={(transition.params as any)?.[p.name] || p.default}
                onChange={(e) => patchParam(p.name, e.target.value)}
                className="h-7 w-full rounded bg-cs-bg-base border border-cs-border-default cursor-pointer"
              />
            )}
            {p.type === "number" && (
              <NumberField
                label=""
                value={(transition.params as any)?.[p.name] ?? p.default}
                min={p.min}
                max={p.max}
                step={p.step}
                onChange={(v) => patchParam(p.name, v)}
              />
            )}
            {p.type === "select" && (
              <select
                value={(transition.params as any)?.[p.name] || p.default}
                onChange={(e) => patchParam(p.name, e.target.value)}
                className="h-7 px-2 text-xs rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary"
              >
                {p.options?.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>

      <div className="pt-2 border-t border-cs-border-subtle">
        <Button
          variant="danger"
          size="sm"
          className="w-full"
          onClick={() => {
            onDeselect();
            onTimelineChange(removeTransition(timeline, transition.id));
          }}
        >
          Remove Transition
        </Button>
      </div>
    </div>
  );
}

// ─── Empty Selection (Sequence & Captions Overview) ───────────────────────────

function SequenceOverviewPanel({
  timeline,
  currentTime,
  onAddTextOverlay,
  onGenerateCaptions,
  isGeneratingCaptions,
  onTimelineChange,
}: {
  timeline: TimelineDocument;
  currentTime: number;
  onAddTextOverlay: (overlay: TextOverlay) => void;
  onGenerateCaptions?: () => void;
  isGeneratingCaptions?: boolean;
  onTimelineChange: (t: TimelineDocument) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const captionCues = timeline.textOverlays.filter((o) => o.overlayType === "caption");
  const titleOverlays = timeline.textOverlays.filter((o) => o.overlayType !== "caption");

  const handleExportSrt = () => {
    const srt = serializeTextOverlaysToSrt(captionCues);
    const blob = new Blob([srt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sequence-captions-${Date.now()}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportVtt = () => {
    const vtt = serializeTextOverlaysToVtt(captionCues);
    const blob = new Blob([vtt], { type: "text/vtt" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sequence-captions-${Date.now()}.vtt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSubtitles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || "");
      const { cues, errors } = parseSubtitleFileContent(content);
      if (cues.length === 0) {
        alert(`No valid subtitle cues found: ${errors.join(", ")}`);
        return;
      }

      const newCaptions: TextOverlay[] = cues.map((c) => ({
        id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `caption-${c.id}`,
        text: c.text,
        startTime: c.start,
        endTime: c.end,
        x: 0.5,
        y: 0.8,
        fontSize: 24,
        color: "#ffffff",
        align: "center",
        overlayType: "caption",
        preset: "clean",
        backgroundColor: "rgba(0,0,0,0.75)",
        strokeColor: "#000000",
        strokeWidth: 2,
        fontWeight: 700,
        boxWidthRatio: 0.85,
      }));

      onTimelineChange({
        ...timeline,
        textOverlays: [...timeline.textOverlays, ...newCaptions].sort((a, b) => a.startTime - b.startTime),
      });
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col h-full bg-cs-bg-surface overflow-y-auto p-3 gap-4 select-none">
      <input type="file" ref={fileInputRef} onChange={handleImportSubtitles} accept=".srt,.vtt" className="hidden" />

      <div className="flex flex-col gap-1 border-b border-cs-border-subtle pb-2">
        <SectionLabel>Sequence Overview</SectionLabel>
        <span className="text-xs text-cs-text-secondary mt-0.5">
          Select any clip, transition, or caption on the timeline to edit properties.
        </span>
      </div>

      {/* Captions Section */}
      <div className="p-3 rounded-lg bg-cs-bg-base border border-cs-border-subtle flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <SectionLabel>Sequence Captions</SectionLabel>
          <Badge variant={captionCues.length > 0 ? "success" : "muted"}>
            {captionCues.length} {captionCues.length === 1 ? "cue" : "cues"}
          </Badge>
        </div>

        <p className="text-[11px] text-cs-text-tertiary leading-relaxed">
          {captionCues.length > 0
            ? "Captions are active and will burn into exported video by default."
            : "No caption track currently active. You can generate captions locally or import SRT/VTT."}
        </p>

        {onGenerateCaptions && (
          <Button
            variant="primary"
            size="sm"
            onClick={onGenerateCaptions}
            disabled={isGeneratingCaptions}
            className="w-full flex items-center justify-center gap-1.5"
          >
            {isGeneratingCaptions ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="10" />
                </svg>
                <span>Transcribing Sequence...</span>
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                </svg>
                <span>Generate Captions for Sequence</span>
              </>
            )}
          </Button>
        )}

        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 text-[11px]"
          >
            Import SRT / VTT
          </Button>
          {captionCues.length > 0 && (
            <div className="flex gap-1 flex-1">
              <Button variant="ghost" size="sm" onClick={handleExportSrt} className="flex-1 text-[10px]">
                Export SRT
              </Button>
              <Button variant="ghost" size="sm" onClick={handleExportVtt} className="flex-1 text-[10px]">
                Export VTT
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Quick Add Actions */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Add Overlay</SectionLabel>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const overlay = createTextOverlay(currentTime, currentTime + 3);
            overlay.overlayType = "title";
            overlay.text = "New Title Headline";
            onAddTextOverlay(overlay);
          }}
          className="w-full flex items-center justify-center gap-1.5"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Add Title Overlay at Playhead</span>
        </Button>
      </div>
    </div>
  );
}

// ─── Selected Track Inspector ─────────────────────────────────────────────────

function TrackPanel({
  track,
  timeline,
  onTimelineChange,
  onDeselect,
}: {
  track: TimelineTrack;
  timeline: TimelineDocument;
  onTimelineChange: (t: TimelineDocument) => void;
  onDeselect: () => void;
}) {
  const [nameVal, setNameVal] = useState(track.name);
  const isVideo = track.type === "video";

  return (
    <div className="flex flex-col gap-4 p-3 select-none">
      <div className="flex flex-col gap-1.5 border-b border-cs-border-subtle pb-2">
        <SectionLabel>Track Properties</SectionLabel>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant={isVideo ? "default" : "info"}>{track.type.toUpperCase()}</Badge>
          <input
            type="text"
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onBlur={() => {
              if (nameVal.trim() && nameVal.trim() !== track.name) {
                onTimelineChange(renameTrack(timeline, track.id, nameVal.trim()));
              }
            }}
            className="text-xs font-semibold text-cs-text-primary bg-transparent border-b border-transparent hover:border-cs-border-default focus:border-cs-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Track Controls</SectionLabel>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => onTimelineChange(toggleTrackMute(timeline, track.id))}
            className={`h-7 px-2 rounded text-xs font-medium flex items-center justify-between border ${
              track.muted ? "bg-amber-500/15 border-amber-500/40 text-amber-300" : "bg-cs-bg-base border-cs-border-subtle text-cs-text-secondary"
            }`}
          >
            <span>Mute</span>
            <span>{track.muted ? "ON" : "OFF"}</span>
          </button>
          <button
            onClick={() => onTimelineChange(toggleTrackSolo(timeline, track.id))}
            className={`h-7 px-2 rounded text-xs font-medium flex items-center justify-between border ${
              track.solo ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" : "bg-cs-bg-base border-cs-border-subtle text-cs-text-secondary"
            }`}
          >
            <span>Solo</span>
            <span>{track.solo ? "ON" : "OFF"}</span>
          </button>
          {isVideo && (
            <button
              onClick={() => onTimelineChange(toggleTrackHidden(timeline, track.id))}
              className={`h-7 px-2 rounded text-xs font-medium flex items-center justify-between border ${
                track.hidden ? "bg-amber-500/15 border-amber-500/40 text-amber-300" : "bg-cs-bg-base border-cs-border-subtle text-cs-text-secondary"
              }`}
            >
              <span>Hidden</span>
              <span>{track.hidden ? "YES" : "NO"}</span>
            </button>
          )}
          <button
            onClick={() => onTimelineChange(toggleTrackSyncLock(timeline, track.id))}
            className={`h-7 px-2 rounded text-xs font-medium flex items-center justify-between border ${
              track.syncLocked !== false ? "bg-sky-500/15 border-sky-500/40 text-sky-300" : "bg-cs-bg-base border-cs-border-subtle text-cs-text-secondary"
            }`}
          >
            <span>Sync-Lock</span>
            <span>{track.syncLocked !== false ? "ON" : "OFF"}</span>
          </button>
          <button
            onClick={() => onTimelineChange(toggleTrackLock(timeline, track.id))}
            className={`h-7 px-2 rounded text-xs font-medium flex items-center justify-between border col-span-2 ${
              track.locked ? "bg-red-500/15 border-red-500/40 text-red-300" : "bg-cs-bg-base border-cs-border-subtle text-cs-text-secondary"
            }`}
          >
            <span>Lock Track Against Edits</span>
            <span>{track.locked ? "LOCKED" : "UNLOCKED"}</span>
          </button>
        </div>
      </div>

      <div className="pt-2 border-t border-cs-border-subtle">
        <Button
          variant="danger"
          size="sm"
          className="w-full"
          onClick={() => {
            onDeselect();
            onTimelineChange(removeTrack(timeline, track.id));
          }}
        >
          Delete Track
        </Button>
      </div>
    </div>
  );
}

// ─── Main ClipInspector Component ─────────────────────────────────────────────

export function ClipInspector({
  timeline,
  selectedClipId,
  selectedOverlayId,
  selectedTransitionId,
  selectedTrackId,
  liveAssets,
  currentTime,
  onTimelineChange,
  onAddTextOverlay,
  onSelectTrack,
  onSelectTransition,
  onGenerateCaptions,
  isGeneratingCaptions,
}: ClipInspectorProps) {
  const selectedClip = selectedClipId ? findClip(timeline, selectedClipId) : null;
  const selectedOverlay = selectedOverlayId ? findOverlay(timeline, selectedOverlayId) : null;
  const selectedTransition = selectedTransitionId ? findTransition(timeline, selectedTransitionId) : null;
  const selectedTrack = selectedTrackId ? timeline.tracks.find((t) => t.id === selectedTrackId) ?? null : null;

  return (
    <div className="flex flex-col h-full bg-cs-bg-surface overflow-hidden">
      <PanelHeader title="Inspector" />
      <div className="flex-1 overflow-hidden">
        {selectedClip ? (
          <ClipPanel
            clip={selectedClip}
            timeline={timeline}
            liveAssets={liveAssets}
            currentTime={currentTime}
            onTimelineChange={onTimelineChange}
          />
        ) : selectedOverlay ? (
          <OverlayPanel
            overlay={selectedOverlay}
            timeline={timeline}
            currentTime={currentTime}
            onTimelineChange={onTimelineChange}
          />
        ) : selectedTransition ? (
          <TransitionPanel
            transition={selectedTransition}
            timeline={timeline}
            onTimelineChange={onTimelineChange}
            onDeselect={() => onSelectTransition?.(null)}
          />
        ) : selectedTrack ? (
          <TrackPanel
            track={selectedTrack}
            timeline={timeline}
            onTimelineChange={onTimelineChange}
            onDeselect={() => onSelectTrack?.(null)}
          />
        ) : (
          <SequenceOverviewPanel
            timeline={timeline}
            currentTime={currentTime}
            onAddTextOverlay={onAddTextOverlay}
            onGenerateCaptions={onGenerateCaptions}
            isGeneratingCaptions={isGeneratingCaptions}
            onTimelineChange={onTimelineChange}
          />
        )}
      </div>
    </div>
  );
}
