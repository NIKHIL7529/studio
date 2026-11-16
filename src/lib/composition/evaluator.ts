/**
 * Canonical Composition Evaluator for Content Studio.
 *
 * Rules:
 * - One source of truth for Program Monitor (TimelinePreview) and export pipeline.
 * - Given (timeline, timestamp), deterministically evaluates:
 *   - Active video tracks and clips (in stacking order, respecting track.hidden / locked).
 *   - Evaluated clip transforms & keyframes (position, scale, rotation, opacity, volume).
 *   - Active transitions on edit points with normalized progress [0, 1] and from/to clip handles.
 *   - Active titles, text overlays, and captions (respecting captionsVisible / includeCaptionsInExport).
 *   - Typewriter / text reveal animations.
 *   - Word-level highlighting for karaoke captions when word timings exist.
 *   - Active audio clips, track mute/solo states, and audio fades/crossfades.
 * - Pure, deterministic, zero DOM dependencies, fully testable in Node.js.
 */

import type {
  TimelineDocument,
  TimelineTrack,
  TimelineClip,
  TextOverlay,
  TimelineTransition,
} from "../../types/timeline.ts";
import { evaluateClipTransform } from "../animation/animationPresets.ts";
import { getTransitionTimeWindow, getTransitionProgress } from "../transitions/transitionCatalog.ts";

export interface EvaluatedClip {
  clip: TimelineClip;
  track: TimelineTrack;
  sourceTime: number; // Seconds into source asset
  offsetSeconds: number; // Seconds from clip start
  transform: {
    positionX: number;
    positionY: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    opacity: number;
    volume: number;
  };
}

export interface EvaluatedTransition {
  transition: TimelineTransition;
  progress: number; // 0 to 1
  fromClip: TimelineClip | null;
  toClip: TimelineClip | null;
  track: TimelineTrack;
}

export interface EvaluatedOverlay {
  overlay: TextOverlay;
  renderedText: string;
  activeWordIndex: number | null; // For karaoke word-level highlighting
  opacity: number;
  offsetY: number;
}

export interface EvaluatedAudioSource {
  clipId: string;
  assetId: string;
  trackId: string;
  sourceTime: number;
  volume: number; // Combined volume including clip, keyframes, track gain, mute/solo, and audio transitions
  muted: boolean;
}

export interface EvaluatedComposition {
  time: number;
  activeClips: EvaluatedClip[];
  activeTransitions: EvaluatedTransition[];
  activeOverlays: EvaluatedOverlay[];
  activeAudioSources: EvaluatedAudioSource[];
}

/**
 * Evaluates the full composition state at a given sequence time.
 */
export function evaluateCompositionAtTime(
  timeline: TimelineDocument,
  time: number,
  options?: { forExport?: boolean; includeCaptions?: boolean }
): EvaluatedComposition {
  const t = Math.max(0, time);
  const activeClips: EvaluatedClip[] = [];
  const activeTransitions: EvaluatedTransition[] = [];
  const activeAudioSources: EvaluatedAudioSource[] = [];

  // 1. Process Video Tracks (Stacking order: order 0 is primary, higher order on top or vice versa)
  // In Content Studio: lower order renders higher in visual stack (order 0 = top-most)
  const videoTracks = timeline.tracks
    .filter((tr) => tr.type === "video" && !tr.hidden)
    .sort((a, b) => b.order - a.order); // Bottom tracks drawn first, top tracks composite over

  for (const track of videoTracks) {
    // Find active transition on this track
    const trackTransitions = (timeline.transitions || []).filter((tr) => tr.trackId === track.id);
    let currentTransition: EvaluatedTransition | null = null;

    for (const trans of trackTransitions) {
      const window = getTransitionTimeWindow(trans);
      if (t >= window.start && t < window.end) {
        const progress = getTransitionProgress(trans, t);
        const fromClip = trans.fromClipId ? track.clips.find((c) => c.id === trans.fromClipId) ?? null : null;
        const toClip = trans.toClipId ? track.clips.find((c) => c.id === trans.toClipId) ?? null : null;

        currentTransition = {
          transition: trans,
          progress,
          fromClip,
          toClip,
          track,
        };
        activeTransitions.push(currentTransition);
        break;
      }
    }

    // Find active clip on this track
    for (const clip of track.clips) {
      const clipDuration = (clip.sourceOut - clip.sourceIn) / (clip.speed || 1);
      const clipEnd = clip.startTime + clipDuration;

      if (t >= clip.startTime && t < clipEnd) {
        const offsetSec = (t - clip.startTime) * (clip.speed || 1);
        const sourceTime = clip.sourceIn + offsetSec;
        const transform = evaluateClipTransform(clip, offsetSec);

        activeClips.push({
          clip,
          track,
          sourceTime,
          offsetSeconds: offsetSec,
          transform,
        });
      }
    }
  }

  // 2. Process Audio Tracks & Embedded Audio
  const anyAudioTrackSolo = timeline.tracks.some((tr) => tr.type === "audio" && tr.solo);

  for (const track of timeline.tracks) {
    if (track.type !== "audio" && track.type !== "video") continue;

    const isTrackMuted = track.muted || (track.type === "audio" && anyAudioTrackSolo && !track.solo);
    const trackGain = track.volume ?? 1.0;

    for (const clip of track.clips) {
      // If on video track, skip if embedded audio was explicitly disabled
      if (track.type === "video" && clip.embeddedAudioDisabled) continue;

      const clipDuration = (clip.sourceOut - clip.sourceIn) / (clip.speed || 1);
      const clipEnd = clip.startTime + clipDuration;

      if (t >= clip.startTime && t < clipEnd) {
        const offsetSec = (t - clip.startTime) * (clip.speed || 1);
        const sourceTime = clip.sourceIn + offsetSec;
        const transform = evaluateClipTransform(clip, offsetSec);

        let finalVol = isTrackMuted || clip.muted ? 0 : transform.volume * trackGain;

        // Check for audio transitions
        const audioTransitions = (timeline.transitions || []).filter(
          (tr) => tr.trackId === track.id && tr.family === "audio"
        );

        for (const at of audioTransitions) {
          const window = getTransitionTimeWindow(at);
          if (t >= window.start && t < window.end) {
            const p = getTransitionProgress(at, t);
            if (at.fromClipId === clip.id) {
              // Outgoing fade: 1 -> 0
              finalVol *= (at.type.includes("equal_power") ? Math.cos((p * Math.PI) / 2) : 1 - p);
            } else if (at.toClipId === clip.id) {
              // Incoming fade: 0 -> 1
              finalVol *= (at.type.includes("equal_power") ? Math.sin((p * Math.PI) / 2) : p);
            }
          }
        }

        activeAudioSources.push({
          clipId: clip.id,
          assetId: clip.assetId,
          trackId: track.id,
          sourceTime,
          volume: Math.max(0, finalVol),
          muted: finalVol <= 0.0001,
        });
      }
    }
  }

  // 3. Process Text Overlays & Captions
  const activeOverlays: EvaluatedOverlay[] = [];
  const includeCaptions = options?.forExport
    ? (options.includeCaptions ?? (timeline.settings?.includeCaptionsInExport !== false))
    : (timeline.settings?.captionsVisible !== false);

  for (const overlay of timeline.textOverlays) {
    if (t < overlay.startTime || t >= overlay.endTime) continue;

    const isCaption = overlay.overlayType === "caption";
    if (isCaption && !includeCaptions) continue;

    const dur = overlay.endTime - overlay.startTime;
    const offset = t - overlay.startTime;

    let renderedText = overlay.text;
    let activeWordIndex: number | null = null;
    let opacity = 1.0;
    let offsetY = 0;

    // Check typewriter or word reveal animation
    if (overlay.animationPreset === "typewriter") {
      const animDur = Math.min(dur * 0.8, 1.8);
      const progress = Math.min(1, offset / animDur);
      const chars = Math.floor(overlay.text.length * progress);
      renderedText = overlay.text.slice(0, chars);
    } else if (overlay.animationPreset === "word_reveal") {
      const words = overlay.text.split(/\s+/);
      const animDur = Math.min(dur * 0.8, words.length * 0.25);
      const progress = Math.min(1, offset / animDur);
      const wordCount = Math.max(1, Math.floor(words.length * progress));
      renderedText = words.slice(0, wordCount).join(" ");
    }

    // Word-level highlighting for karaoke
    if (overlay.wordTimings && overlay.wordTimings.length > 0) {
      for (let w = 0; w < overlay.wordTimings.length; w++) {
        const wt = overlay.wordTimings[w];
        if (t >= wt.start && t < wt.end) {
          activeWordIndex = w;
          break;
        }
      }
    }

    activeOverlays.push({
      overlay,
      renderedText,
      activeWordIndex,
      opacity,
      offsetY,
    });
  }

  return {
    time: t,
    activeClips,
    activeTransitions,
    activeOverlays,
    activeAudioSources,
  };
}

/**
 * Text word wrapping helper for Canvas rendering.
 */
export function wrapCanvasText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text.split("\n");
  const resultLines: string[] = [];
  const measure = (str: string) =>
    typeof ctx.measureText === "function" ? ctx.measureText(str).width : str.length * 10;

  for (const para of paragraphs) {
    const rawWords = para.split(/\s+/).filter(Boolean);
    if (rawWords.length === 0) continue;

    const words: string[] = [];
    for (const w of rawWords) {
      if (measure(w) > maxWidth && maxWidth > 20) {
        let chunk = "";
        for (const char of w) {
          if (measure(chunk + char) > maxWidth && chunk.length > 0) {
            words.push(chunk);
            chunk = char;
          } else {
            chunk += char;
          }
        }
        if (chunk) words.push(chunk);
      } else {
        words.push(w);
      }
    }

    let currentLine = words[0];
    for (let w = 1; w < words.length; w++) {
      const testLine = `${currentLine} ${words[w]}`;
      const width = measure(testLine);
      if (width > maxWidth) {
        resultLines.push(currentLine);
        currentLine = words[w];
      } else {
        currentLine = testLine;
      }
    }
    resultLines.push(currentLine);
  }

  return resultLines.length > 0 ? resultLines : [text];
}

/**
 * Unified Text and Caption Overlay Renderer for Canvas.
 */
export function renderOverlayOnCanvas(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  evaluated: EvaluatedOverlay,
  canvasWidth: number,
  canvasHeight: number
): void {
  const { overlay, renderedText, activeWordIndex, opacity, offsetY } = evaluated;
  if (!renderedText || opacity <= 0) return;

  ctx.save();
  ctx.globalAlpha = opacity;

  const px = overlay.x * canvasWidth;
  const py = overlay.y * canvasHeight + offsetY;

  // Proportional font scaling based on 720p reference
  const scale = canvasHeight / 720;
  const fontSize = Math.max(12, Math.round(overlay.fontSize * scale));
  const fontFamily = overlay.fontFamily || "sans-serif";
  const fontWeight = overlay.fontWeight || (overlay.overlayType === "caption" ? 700 : 600);

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = overlay.color || "#ffffff";
  ctx.textAlign = overlay.align || "center";
  ctx.textBaseline = "middle";

  if (overlay.rotation) {
    ctx.translate(px, py);
    ctx.rotate((overlay.rotation * Math.PI) / 180);
    ctx.translate(-px, -py);
  }

  const maxTextWidth = canvasWidth * (overlay.boxWidthRatio || 0.85);
  const lines = wrapCanvasText(ctx, renderedText, maxTextWidth);
  const lineHeight = fontSize * (overlay.lineHeight || 1.35);
  const totalHeight = lines.length * lineHeight;
  const startY = py - totalHeight / 2 + lineHeight / 2;

  // Background Box / Pill
  const isCaption = overlay.overlayType === "caption";
  const bgColor =
    overlay.backgroundColor ||
    (overlay.preset === "bold" || isCaption ? "rgba(0, 0, 0, 0.78)" : undefined);

  if (bgColor) {
    ctx.save();
    let maxLineWidth = 0;
    for (const line of lines) {
      const w = typeof ctx.measureText === "function" ? ctx.measureText(line).width : line.length * 10;
      if (w > maxLineWidth) maxLineWidth = w;
    }

    const paddingX = overlay.backgroundPadding ?? Math.round(fontSize * 0.45);
    const paddingY = Math.round(fontSize * 0.25);
    const boxW = maxLineWidth + paddingX * 2;
    const boxH = totalHeight + paddingY * 2;
    let boxX = px - boxW / 2;

    if (overlay.align === "left") boxX = px - paddingX;
    if (overlay.align === "right") boxX = px - boxW + paddingX;

    const boxY = py - totalHeight / 2 - paddingY;
    const radius = overlay.backgroundCornerRadius ?? (isCaption ? 6 : 4);

    ctx.fillStyle = bgColor;
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === "function") {
      (ctx as any).roundRect(boxX, boxY, boxW, boxH, radius);
    } else {
      ctx.rect(boxX, boxY, boxW, boxH);
    }
    ctx.fill();
    ctx.restore();
  }

  // Text Shadow
  if (overlay.shadowColor) {
    ctx.shadowColor = overlay.shadowColor;
    ctx.shadowBlur = overlay.shadowBlur ?? 4;
  }

  // Draw Lines
  for (let i = 0; i < lines.length; i++) {
    const lineY = startY + i * lineHeight;
    const lineText = lines[i];

    // Stroke Outline
    if (overlay.strokeColor && (overlay.strokeWidth ?? 0) > 0) {
      ctx.save();
      ctx.strokeStyle = overlay.strokeColor;
      ctx.lineWidth = overlay.strokeWidth! * scale;
      ctx.strokeText(lineText, px, lineY);
      ctx.restore();
    }

    // Fill Text
    ctx.fillText(lineText, px, lineY);
  }

  ctx.restore();
}
