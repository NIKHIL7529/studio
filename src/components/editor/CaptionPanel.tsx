"use client";

/**
 * Dedicated Caption / Transcript Editor Panel.
 *
 * Rules:
 * - Lists all timed captions in chronological order synced with the active playhead.
 * - Auto-highlights the active caption during playback; click any cue to seek playhead.
 * - Inline text editing for each cue + quick start/end nudge buttons.
 * - Visual Caption Style Presets (Classic, Bold Karaoke, Pill, Minimal) + active word color picker.
 * - One-click "Apply Style to All Captions" button via applyCaptionStyleToAll.
 * - Quick "Generate Captions" trigger connected to 5-tier local ASR catalog.
 */

import * as React from "react";
import { useState } from "react";
import type { TimelineDocument, TextOverlay } from "../../types/timeline.ts";
import type { LiveAssetItem } from "../../types/project.ts";
import {
  applyCaptionStyleToAll,
  generateCaptionsForTimeline,
  type CaptionStylePatch,
} from "../../lib/transcription/captionGenerator.ts";
import {
  SPEECH_MODEL_CATALOG,
  getDefaultModelId,
  type SpeechModelId,
} from "../../lib/transcription/modelStorage.ts";
import { detectCapabilities } from "../../lib/capabilities.ts";
import { formatTimecode } from "../../lib/timeline/timecode.ts";
import {
  Sparkles,
  Plus,
  Trash2,
  Clock,
  Palette,
  Check,
  ChevronDown,
  Loader2,
} from "lucide-react";

interface CaptionPanelProps {
  timeline: TimelineDocument;
  currentTime: number;
  liveAssets: Map<string, LiveAssetItem>;
  onTimelineChange: (newTimeline: TimelineDocument) => void;
  onSeek: (time: number) => void;
}

export function CaptionPanel({
  timeline,
  currentTime,
  liveAssets,
  onTimelineChange,
  onSeek,
}: CaptionPanelProps) {
  const [selectedModel, setSelectedModel] = useState<SpeechModelId>(() => getDefaultModelId(false));
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Styling state for bulk applying
  const [presetId, setPresetId] = useState<"classic" | "bold-karaoke" | "pill" | "minimal">("bold-karaoke");
  const [activeWordColor, setActiveWordColor] = useState("#facc15");
  const [captionTextColor, setCaptionTextColor] = useState("#ffffff");
  const [fontSize, setFontSize] = useState<number>(28);
  const [showStyleSettings, setShowStyleSettings] = useState(false);
  const [appliedNotification, setAppliedNotification] = useState(false);

  const hasWebGpu = detectCapabilities().webGpu.available;

  // Filter and sort caption overlays
  const captions = timeline.textOverlays
    .filter((o) => o.overlayType === "caption")
    .sort((a, b) => a.startTime - b.startTime);

  // Handle single caption text change
  const handleTextChange = (id: string, text: string) => {
    const updated = timeline.textOverlays.map((o) =>
      o.id === id ? { ...o, text } : o
    );
    onTimelineChange({ ...timeline, textOverlays: updated });
  };

  // Handle nudging start / end time
  const handleNudge = (id: string, field: "startTime" | "endTime", delta: number) => {
    const updated = timeline.textOverlays.map((o) => {
      if (o.id !== id) return o;
      if (field === "startTime") {
        const newStart = Math.max(0, Number((o.startTime + delta).toFixed(2)));
        if (newStart >= o.endTime) return o;
        return { ...o, startTime: newStart };
      } else {
        const newEnd = Math.max(o.startTime + 0.1, Number((o.endTime + delta).toFixed(2)));
        return { ...o, endTime: newEnd };
      }
    });
    onTimelineChange({ ...timeline, textOverlays: updated });
  };

  // Delete a caption cue
  const handleDeleteCaption = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = timeline.textOverlays.filter((o) => o.id !== id);
    onTimelineChange({ ...timeline, textOverlays: updated });
  };

  // Add caption cue at playhead
  const handleAddCaption = () => {
    const start = Number(currentTime.toFixed(2));
    const end = Number((currentTime + 2.5).toFixed(2));
    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `caption-${Date.now()}`;

    const newCaption: TextOverlay = {
      id,
      text: "New subtitle line",
      startTime: start,
      endTime: end,
      x: 0.5,
      y: timeline.settings?.targetAspectRatio === "9:16" ? 0.78 : 0.82,
      fontSize,
      color: captionTextColor,
      align: "center",
      presetId,
      activeWordColor,
      overlayType: "caption",
      preset: presetId === "bold-karaoke" ? "bold" : presetId === "minimal" ? "minimal" : "clean",
      backgroundColor: presetId === "minimal" ? undefined : "rgba(0, 0, 0, 0.75)",
      strokeColor: "#000000",
      strokeWidth: 2,
      fontWeight: 700,
      boxWidthRatio: 0.85,
    };

    onTimelineChange({
      ...timeline,
      textOverlays: [...timeline.textOverlays, newCaption],
    });
  };

  // Apply visual style to all captions
  const handleApplyStyleToAll = () => {
    const patch: CaptionStylePatch = {
      presetId,
      color: captionTextColor,
      activeWordColor,
      fontSize,
      preset: presetId === "bold-karaoke" ? "bold" : presetId === "minimal" ? "minimal" : "clean",
      backgroundColor: presetId === "minimal" ? undefined : "rgba(0, 0, 0, 0.75)",
      strokeColor: "#000000",
      strokeWidth: 2,
      fontWeight: 700,
      boxWidthRatio: 0.85,
    };
    const updated = applyCaptionStyleToAll(timeline, patch);
    onTimelineChange(updated);
    setAppliedNotification(true);
    setTimeout(() => setAppliedNotification(false), 2000);
  };

  // Run local speech-to-text
  const handleRunTranscription = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setGenerateError(null);
    setGenerateProgress("Preparing sequence audio...");

    try {
      const generated = await generateCaptionsForTimeline(timeline, liveAssets, {
        modelName: selectedModel,
        onProgress: (_percent, statusText) => {
          setGenerateProgress(statusText);
        },
      });

      // Keep non-caption overlays and replace captions
      const nonCaptions = timeline.textOverlays.filter((o) => o.overlayType !== "caption");
      onTimelineChange({
        ...timeline,
        textOverlays: [...nonCaptions, ...generated],
      });
      setGenerateProgress(null);
    } catch (err: unknown) {
      console.error("Caption generation error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setGenerateError(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-cs-bg-surface overflow-hidden text-xs">
      {/* Top action header */}
      <div className="p-3 border-b border-cs-border-subtle bg-cs-bg-elevated/40 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-semibold text-cs-text-primary text-[13px]">
            <Sparkles className="w-4 h-4 text-cs-accent" />
            <span>Captions & Subtitles</span>
            <span className="text-cs-text-tertiary text-xs font-normal">({captions.length})</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowStyleSettings(!showStyleSettings)}
              className={`p-1.5 rounded transition-colors ${
                showStyleSettings
                  ? "bg-cs-accent text-white"
                  : "bg-cs-bg-elevated text-cs-text-secondary hover:text-cs-text-primary border border-cs-border-subtle"
              }`}
              title="Caption styling presets & colors"
            >
              <Palette className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleAddCaption}
              className="flex items-center gap-1 px-2 py-1 rounded bg-cs-accent hover:bg-cs-accent-hover text-white font-medium transition-colors"
              title="Add caption at playhead"
            >
              <Plus className="w-3 h-3" />
              <span>Add</span>
            </button>
          </div>
        </div>

        {/* Style presets drop-down tray */}
        {showStyleSettings && (
          <div className="p-2.5 rounded bg-cs-bg-base border border-cs-border-default space-y-2.5 mt-2 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-cs-text-primary">Style Presets</span>
              {appliedNotification && (
                <span className="text-emerald-400 text-[11px] flex items-center gap-1 font-medium">
                  <Check className="w-3 h-3" /> Applied to all
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { id: "bold-karaoke", label: "Bold Karaoke" },
                  { id: "classic", label: "Classic" },
                  { id: "pill", label: "Pill Box" },
                  { id: "minimal", label: "Minimal" },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setPresetId(preset.id)}
                  className={`px-2 py-1.5 rounded border text-left font-medium transition-all ${
                    presetId === preset.id
                      ? "border-cs-accent bg-cs-accent/15 text-cs-accent"
                      : "border-cs-border-subtle bg-cs-bg-elevated/40 text-cs-text-secondary hover:text-cs-text-primary"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-cs-text-tertiary">Highlight:</span>
                <input
                  type="color"
                  value={activeWordColor}
                  onChange={(e) => setActiveWordColor(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border border-cs-border-subtle bg-transparent p-0"
                  title="Active word karaoke highlight color"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-cs-text-tertiary">Text:</span>
                <input
                  type="color"
                  value={captionTextColor}
                  onChange={(e) => setCaptionTextColor(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border border-cs-border-subtle bg-transparent p-0"
                  title="Subtitle text color"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-cs-text-tertiary">Size:</span>
                <input
                  type="number"
                  min={14}
                  max={64}
                  value={fontSize}
                  onChange={(e) => setFontSize(Math.max(14, Math.min(64, Number(e.target.value) || 28)))}
                  className="w-12 px-1.5 py-0.5 rounded bg-cs-bg-elevated border border-cs-border-subtle text-cs-text-primary text-center font-mono"
                />
              </div>
            </div>

            <button
              onClick={handleApplyStyleToAll}
              className="w-full py-1.5 rounded bg-cs-bg-elevated hover:bg-cs-bg-active text-cs-text-primary font-medium border border-cs-border-subtle transition-colors flex items-center justify-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5 text-cs-accent" />
              <span>Apply Style to All Captions</span>
            </button>
          </div>
        )}

        {/* Local ASR Auto-Generation Bar */}
        <div className="p-2 rounded bg-cs-bg-base/70 border border-cs-border-subtle flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-cs-text-secondary font-medium">Auto-Transcribe (Local ASR)</span>
            <span className="text-[10px] text-cs-text-tertiary">100% on-device</span>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value as SpeechModelId)}
                disabled={isGenerating}
                className="w-full appearance-none px-2 py-1 rounded bg-cs-bg-elevated border border-cs-border-subtle text-cs-text-primary text-[11px] font-medium pr-6 truncate"
              >
                {SPEECH_MODEL_CATALOG.map((m) => {
                  const disabled = m.requiresWebGpu && !hasWebGpu;
                  return (
                    <option key={m.id} value={m.id} disabled={disabled}>
                      {m.label} ({m.estimatedSizeFormatted}) {disabled ? "— Requires WebGPU" : ""}
                    </option>
                  );
                })}
              </select>
              <ChevronDown className="w-3 h-3 text-cs-text-tertiary absolute right-2 top-2 pointer-events-none" />
            </div>

            <button
              onClick={handleRunTranscription}
              disabled={isGenerating}
              className="px-2.5 py-1 rounded bg-cs-accent hover:bg-cs-accent-hover disabled:opacity-50 text-white font-medium shrink-0 flex items-center gap-1 transition-colors text-[11px]"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Working...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3" />
                  <span>Transcribe</span>
                </>
              )}
            </button>
          </div>

          {generateProgress && (
            <div className="text-[10px] text-cs-accent animate-pulse font-mono truncate">
              {generateProgress}
            </div>
          )}

          {generateError && (
            <div className="text-[10px] text-rose-400 font-mono truncate">
              Error: {generateError}
            </div>
          )}
        </div>
      </div>

      {/* Chronological Cues List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
        {captions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-cs-text-tertiary p-4 space-y-2">
            <Clock className="w-8 h-8 opacity-40 text-cs-text-secondary" />
            <p className="text-xs text-cs-text-secondary">No captions in this sequence yet.</p>
            <p className="text-[11px] max-w-xs">
              Click &quot;Transcribe&quot; to auto-generate speech captions with local Whisper, or &quot;Add&quot; to insert one manually.
            </p>
          </div>
        ) : (
          captions.map((cue, index) => {
            const isActive = currentTime >= cue.startTime && currentTime < cue.endTime;
            return (
              <div
                key={cue.id}
                onClick={() => onSeek(cue.startTime)}
                className={`p-2 rounded border transition-all cursor-pointer ${
                  isActive
                    ? "bg-cs-accent/15 border-cs-accent ring-1 ring-cs-accent/50 shadow-sm"
                    : "bg-cs-bg-elevated/40 border-cs-border-subtle hover:bg-cs-bg-elevated hover:border-cs-border-default"
                }`}
              >
                {/* Header: index, timing, nudge buttons, delete */}
                <div className="flex items-center justify-between text-[11px] mb-1.5">
                  <div className="flex items-center gap-1.5 font-mono text-cs-text-tertiary">
                    <span className="w-4 h-4 rounded-full bg-cs-bg-base flex items-center justify-center text-[10px] text-cs-text-secondary font-semibold">
                      {index + 1}
                    </span>
                    <span className={isActive ? "text-cs-accent font-semibold" : "text-cs-text-secondary"}>
                      {formatTimecode(cue.startTime)} → {formatTimecode(cue.endTime)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center bg-cs-bg-base rounded border border-cs-border-subtle px-1 py-0.5 gap-1 text-[10px]">
                      <span className="text-cs-text-tertiary">In:</span>
                      <button
                        onClick={() => handleNudge(cue.id, "startTime", -0.1)}
                        className="hover:text-cs-accent px-0.5"
                        title="Nudge In -0.1s"
                      >
                        -
                      </button>
                      <button
                        onClick={() => handleNudge(cue.id, "startTime", 0.1)}
                        className="hover:text-cs-accent px-0.5"
                        title="Nudge In +0.1s"
                      >
                        +
                      </button>
                    </div>

                    <div className="flex items-center bg-cs-bg-base rounded border border-cs-border-subtle px-1 py-0.5 gap-1 text-[10px]">
                      <span className="text-cs-text-tertiary">Out:</span>
                      <button
                        onClick={() => handleNudge(cue.id, "endTime", -0.1)}
                        className="hover:text-cs-accent px-0.5"
                        title="Nudge Out -0.1s"
                      >
                        -
                      </button>
                      <button
                        onClick={() => handleNudge(cue.id, "endTime", 0.1)}
                        className="hover:text-cs-accent px-0.5"
                        title="Nudge Out +0.1s"
                      >
                        +
                      </button>
                    </div>

                    <button
                      onClick={(e) => handleDeleteCaption(cue.id, e)}
                      className="p-1 rounded text-cs-text-tertiary hover:text-rose-400 hover:bg-rose-500/10 transition-colors ml-0.5"
                      title="Delete caption cue"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Inline cue text editing */}
                <input
                  type="text"
                  value={cue.text}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handleTextChange(cue.id, e.target.value)}
                  className="w-full px-2 py-1 rounded bg-cs-bg-base border border-cs-border-subtle focus:border-cs-accent focus:outline-none text-cs-text-primary text-xs font-medium"
                  placeholder="Caption text..."
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
