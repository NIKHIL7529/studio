/**
 * Sequence Caption Generator for Content Studio.
 *
 * Rules:
 * - 100% browser-local on-device transcription.
 * - Operates on the final audible sequence timeline (not untouched source files).
 * - Converts ASR cues to sequence-relative TextOverlay objects.
 * - Preserves word-level timestamps when available for karaoke styling.
 * - Reusable from both Repurpose and Editor.
 */

import type { TimelineDocument, TextOverlay } from "../../types/timeline.ts";
import type { LiveAssetItem } from "../../types/project.ts";
import { renderTimelineAudioToWav } from "./sequenceAudio.ts";
import { LocalTranscriptionEngine } from "./engine.ts";
import { resolveTextOverlayCollisions } from "../timeline/model.ts";

export interface CaptionGenerationOptions {
  modelName?: "whisper-tiny_timestamped" | "whisper-base_timestamped" | "whisper-tiny" | "whisper-base";
  language?: string;
  preset?: "clean" | "bold" | "minimal";
  signal?: AbortSignal;
  onProgress?: (percent: number, statusText: string) => void;
}

export async function generateCaptionsForTimeline(
  timeline: TimelineDocument,
  liveAssets: Map<string, LiveAssetItem>,
  options: CaptionGenerationOptions = {}
): Promise<TextOverlay[]> {
  const {
    modelName = "whisper-tiny_timestamped",
    language,
    preset = "clean",
    signal,
    onProgress,
  } = options;

  onProgress?.(5, "Extracting sequence audio mix...");

  // 1. Render sequence audio to 16kHz mono WAV
  const wavFile = await renderTimelineAudioToWav(timeline, liveAssets, {
    signal,
    onProgress: (p) => onProgress?.(Math.round(p * 0.4), "Preparing sequence audio for ASR..."),
  });

  if (signal?.aborted) {
    throw new DOMException("Caption generation cancelled.", "AbortError");
  }

  onProgress?.(45, "Running local offline Whisper transcription...");

  // 2. Transcribe locally
  const engine = new LocalTranscriptionEngine();
  const transcript = await engine.transcribe(wavFile, {
    modelName,
    language,
    signal,
    onProgress: (p) => {
      onProgress?.(45 + Math.round((p.percent / 100) * 50), `Transcribing speech locally (${p.percent}%)...`);
    },
  });

  onProgress?.(96, "Mapping sequence-relative caption cues...");

  // 3. Convert cues to TextOverlay objects
  const targetAspect = timeline.settings?.targetAspectRatio || "16:9";
  const fontSize = targetAspect === "9:16" ? 28 : 24;
  const posY = targetAspect === "9:16" ? 0.78 : 0.82;

  const newCaptions: TextOverlay[] = transcript.cues.map((cue) => {
    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `caption-${cue.id}`;

    return {
      id,
      text: cue.text.trim(),
      startTime: Number(cue.start.toFixed(2)),
      endTime: Number(cue.end.toFixed(2)),
      x: 0.5,
      y: posY,
      fontSize,
      color: "#ffffff",
      align: "center",
      overlayType: "caption",
      preset,
      backgroundColor: preset === "minimal" ? undefined : "rgba(0, 0, 0, 0.78)",
      strokeColor: "#000000",
      strokeWidth: 2,
      fontWeight: 700,
      boxWidthRatio: 0.85,
      wordTimings: cue.words?.map((w) => ({
        word: w.word,
        start: Number(w.start.toFixed(2)),
        end: Number(w.end.toFixed(2)),
      })),
    };
  });

  return resolveTextOverlayCollisions(newCaptions);
}
