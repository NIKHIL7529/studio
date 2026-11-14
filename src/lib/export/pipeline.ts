/**
 * Local video rendering and export pipeline.
 *
 * Rules:
 * - Executes entirely locally in the user's browser.
 * - No network requests, cloud processing, or FFmpeg dependencies.
 * - Progressive streaming writes directly to disk without full-file RAM buffering.
 * - Canvas/OffscreenCanvas rendering matching TimelinePreview styling.
 * - Preserves audio gain, mutes, cuts, and synchronization across clip boundaries.
 * - Graceful cancellation, resource cleanup, and failure recovery.
 */

import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  CanvasSource,
  AudioSampleSource,
  CanvasSink,
  AudioSampleSink,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_LOW,
} from "mediabunny";
import { createMediaInput, disposeMediaInput } from "../media/input.ts";
import { createWorkspaceProgressiveWriter } from "./progressiveWriter.ts";
import { validateExportedMedia } from "./validation.ts";
import { lockCacheResource, unlockCacheResource } from "../cache/cacheManager.ts";
import { AudioTrackMixer } from "./audioRenderer.ts";
import type { TextOverlay } from "../../types/timeline.ts";
import type {
  RenderPlan,
  ExportProgress,
  ExportValidationResult,
  ExportQuality,
} from "../../types/export.ts";

export interface ExportPipelineCallbacks {
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

export interface ExportPipelineResult {
  file: File;
  validation: ExportValidationResult;
  finalFilename: string;
  relativePath: string;
}

export interface PipelineOptions extends ExportPipelineCallbacks {
  workspaceHandle?: FileSystemDirectoryHandle;
  allowOverwrite?: boolean;
}

/**
 * Maps export quality preference to Mediabunny Quality preset.
 */
function mapQuality(q: ExportQuality) {
  switch (q) {
    case "low":
      return QUALITY_LOW;
    case "medium":
      return QUALITY_MEDIUM;
    case "high":
    default:
      return QUALITY_HIGH;
  }
}

/**
 * Helper to wrap text into multiple lines within maxWidth.
 */
function wrapTextToLines(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text.split("\n");
  const resultLines: string[] = [];

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    let currentLine = words[0];
    for (let w = 1; w < words.length; w++) {
      const testLine = `${currentLine} ${words[w]}`;
      const width = typeof ctx.measureText === "function" ? ctx.measureText(testLine).width : testLine.length * 10;
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
 * Renders a TextOverlay to canvas matching the CSS preview in TimelinePreview.
 */
export function renderTextOverlayToCanvas(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  overlay: TextOverlay,
  canvasWidth: number,
  canvasHeight: number
): void {
  ctx.save();
  const px = overlay.x * canvasWidth;
  const py = overlay.y * canvasHeight;

  // Scale font size proportionally to 720p base height
  const scale = canvasHeight / 720;
  const fontSize = Math.max(12, Math.round(overlay.fontSize * scale));
  const fontWeight = overlay.fontWeight || (overlay.overlayType === "caption" ? 700 : 600);

  ctx.font = `${fontWeight} ${fontSize}px sans-serif`;
  ctx.fillStyle = overlay.color || "#ffffff";
  ctx.textAlign = overlay.align || "center";
  ctx.textBaseline = "middle";

  const maxTextWidth = canvasWidth * (overlay.boxWidthRatio || 0.85);
  const lines = wrapTextToLines(ctx, overlay.text, maxTextWidth);
  const lineHeight = fontSize * 1.35;
  const totalHeight = lines.length * lineHeight;
  const startY = py - totalHeight / 2 + lineHeight / 2;

  // Render background box/pill if requested (typical for captions or bold presets)
  const isCaption = overlay.overlayType === "caption";
  const bgColor =
    overlay.backgroundColor ||
    (overlay.preset === "bold" || isCaption ? "rgba(0, 0, 0, 0.82)" : undefined);

  if (bgColor) {
    ctx.save();
    let maxLineWidth = 0;
    for (const line of lines) {
      const w = ctx.measureText(line).width;
      if (w > maxLineWidth) maxLineWidth = w;
    }

    const padX = Math.round(16 * scale);
    const padY = Math.round(10 * scale);
    const boxW = maxLineWidth + padX * 2;
    const boxH = totalHeight + padY * 2;
    const boxX = px - (overlay.align === "left" ? 0 : overlay.align === "right" ? boxW : boxW / 2);
    const boxY = py - totalHeight / 2 - padY;
    const radius = Math.round(8 * scale);

    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, radius);
    ctx.fill();
    ctx.restore();
  }

  // Text Stroke / Outline
  const strokeColor = overlay.strokeColor || (overlay.preset === "minimal" ? "#000000" : undefined);
  const strokeWidth = (overlay.strokeWidth || (strokeColor ? 2 : 0)) * scale;

  if (strokeColor && strokeWidth > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = "round";
    for (let i = 0; i < lines.length; i++) {
      ctx.strokeText(lines[i], px, startY + i * lineHeight);
    }
  }

  // Text shadow matching preview: 0 1px 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6)
  if (!bgColor && (!strokeColor || strokeWidth <= 0)) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
    ctx.shadowBlur = Math.round(6 * scale);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.round(2 * scale);
  }

  // Text Fill
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], px, startY + i * lineHeight);
  }

  ctx.restore();
}

/**
 * Coordinates the full local export pipeline from RenderPlan to validated output file.
 */
export async function renderAndExport(
  plan: RenderPlan,
  options: PipelineOptions = {}
): Promise<ExportPipelineResult> {
  const { onProgress, signal, workspaceHandle, allowOverwrite } = options;
  const startTime = Date.now();

  const reportProgress = (
    stage: ExportProgress["stage"],
    percent: number,
    statusText: string,
    currentFrame?: number,
    totalFrames?: number
  ) => {
    if (onProgress) {
      onProgress({
        stage,
        percent: Math.max(0, Math.min(100, Math.round(percent))),
        currentFrame,
        totalFrames,
        elapsedMs: Date.now() - startTime,
        statusText,
      });
    }
  };

  // 1. Preflight plan validation
  reportProgress("validating-timeline", 2, "Validating timeline and media sources...");
  if (!plan.isValid) {
    throw new Error(`Cannot export: ${plan.validationErrors.join(" ")}`);
  }
  if (signal?.aborted) {
    throw new DOMException("Export was cancelled.", "AbortError");
  }

  // 2. Initialize progressive output writer
  reportProgress("preparing-writer", 5, "Preparing output writer...");
  const writer = await createWorkspaceProgressiveWriter({
    workspaceHandle,
    projectId: plan.projectId,
    preferredFilename: plan.settings.filename,
    allowOverwrite,
  });

  lockCacheResource(writer.relativePath);

  const openedInputs: ReturnType<typeof createMediaInput>[] = [];
  let output: Output | null = null;
  let canvasSource: CanvasSource | null = null;
  let audioSource: AudioSampleSource | null = null;
  let audioMixer: AudioTrackMixer | null = null;

  try {
    if (signal?.aborted) {
      throw new DOMException("Export was cancelled.", "AbortError");
    }

    // 3. Prepare source inputs and sinks
    reportProgress("checking-capabilities", 8, "Initializing media decoders...");
    const canvasSinks = new Map<string, CanvasSink>();
    const audioSinks = new Map<string, AudioSampleSink>();

    for (const [assetId, sourceMeta] of plan.sources.entries()) {
      if (!sourceMeta.file) continue;

      const input = createMediaInput(sourceMeta.file);
      openedInputs.push(input);

      if (sourceMeta.hasVideo) {
        const vTracks = await input.getVideoTracks();
        if (vTracks.length > 0) {
          const sink = new CanvasSink(vTracks[0], {
            width: plan.settings.width,
            height: plan.settings.height,
            fit: "contain",
            poolSize: 4,
          });
          canvasSinks.set(assetId, sink);
        }
      }

      if (sourceMeta.hasAudio) {
        const aTracks = await input.getAudioTracks();
        if (aTracks.length > 0) {
          const sink = new AudioSampleSink(aTracks[0]);
          audioSinks.set(assetId, sink);
        }
      }
    }

    if (signal?.aborted) {
      throw new DOMException("Export was cancelled.", "AbortError");
    }

    // 4. Create Master Canvas
    const canvasWidth = plan.settings.width;
    const canvasHeight = plan.settings.height;

    let masterCanvas: HTMLCanvasElement | OffscreenCanvas;
    if (typeof OffscreenCanvas !== "undefined") {
      masterCanvas = new OffscreenCanvas(canvasWidth, canvasHeight);
    } else if (typeof document !== "undefined") {
      masterCanvas = document.createElement("canvas");
      masterCanvas.width = canvasWidth;
      masterCanvas.height = canvasHeight;
    } else {
      throw new Error("Canvas/OffscreenCanvas is not available in this environment.");
    }

    const ctx = masterCanvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    if (!ctx) {
      throw new Error("Failed to acquire 2D rendering context for output canvas.");
    }

    // 5. Setup Mediabunny Output & Tracks
    const format =
      plan.settings.format === "webm"
        ? new WebMOutputFormat()
        : new Mp4OutputFormat({ fastStart: false });

    output = new Output({
      format,
      target: writer.target,
    });

    const quality = mapQuality(plan.settings.quality);
    const videoCodec = plan.settings.format === "webm" ? "vp9" : "avc";

    canvasSource = new CanvasSource(masterCanvas, {
      codec: videoCodec,
      quality,
    });
    output.addVideoTrack(canvasSource, { frameRate: plan.frameRate });

    // Audio setup
    const shouldRenderAudio = plan.hasAudio && audioSinks.size > 0;
    if (shouldRenderAudio) {
      const audioCodec = plan.settings.format === "webm" ? "opus" : "aac";
      audioSource = new AudioSampleSource({
        codec: audioCodec,
        quality,
      });
      output.addAudioTrack(audioSource);
      audioMixer = new AudioTrackMixer(plan, audioSinks, {
        outputSampleRate: plan.settings.audioSampleRate || 48000,
        outputChannels: plan.settings.audioChannels || 2,
      });
    }

    await output.start();

    // 6. Interleaved Video & Audio Rendering
    // Interleaves bounded 1.0-second blocks of audio and video across the presentation timeline,
    // ensuring multi-track muxer packet balance, sample-accurate audio continuity, and bounded memory.
    const intervalSeconds = 1.0;
    const totalDurationSeconds = plan.totalDurationSeconds;
    const totalVideoFrames = plan.totalFrames;
    const outputSampleRate = plan.settings.audioSampleRate || 48000;
    const totalAudioSamples = Math.round(totalDurationSeconds * outputSampleRate);

    let currentVideoFrame = 0;
    let currentAudioSample = 0;

    const totalSteps = Math.ceil(totalDurationSeconds / intervalSeconds);

    for (let step = 0; step < totalSteps; step++) {
      if (signal?.aborted) {
        throw new DOMException("Export was cancelled.", "AbortError");
      }

      const stepStartTime = step * intervalSeconds;
      const stepEndTime = Math.min(totalDurationSeconds, stepStartTime + intervalSeconds);

      // A. Encode continuous audio block for this interval
      if (shouldRenderAudio && audioSource && audioMixer) {
        const targetAudioEndSample = Math.min(
          totalAudioSamples,
          Math.round(stepEndTime * outputSampleRate)
        );
        const framesToRender = targetAudioEndSample - currentAudioSample;

        if (framesToRender > 0) {
          const audioSample = await audioMixer.renderBlock(
            currentAudioSample,
            framesToRender
          );
          if (audioSample) {
            try {
              await audioSource.add(audioSample);
            } catch (err) {
              console.warn("Audio encoding warning:", err);
            } finally {
              audioSample.close();
            }
          }
          currentAudioSample = targetAudioEndSample;
        }
      }

      // B. Encode video frames for this interval
      const targetVideoFrame = Math.min(
        totalVideoFrames,
        Math.ceil(stepEndTime * plan.frameRate)
      );

      for (let f = currentVideoFrame; f < targetVideoFrame; f++) {
        if (signal?.aborted) {
          throw new DOMException("Export was cancelled.", "AbortError");
        }

        const frame = plan.videoFrames[f];

        // 1. Clear to black background
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // 2. Render active video clip if present
        if (frame.activeClip) {
          const sink = canvasSinks.get(frame.activeClip.assetId);
          if (sink) {
            try {
              const wrapped = await sink.getCanvas(frame.activeClip.sourceTimeSeconds);
              if (wrapped?.canvas) {
                ctx.drawImage(wrapped.canvas, 0, 0, canvasWidth, canvasHeight);
              }
            } catch (err) {
              console.warn(`Frame ${f}: failed to decode source canvas`, err);
            }
          }
        }

        // 3. Render active text overlays
        if (frame.activeOverlays.length > 0) {
          for (const overlay of frame.activeOverlays) {
            renderTextOverlayToCanvas(ctx, overlay, canvasWidth, canvasHeight);
          }
        }

        // 4. Feed composited frame to CanvasSource with backpressure
        await canvasSource.add(frame.presentationTimeSeconds, frame.durationSeconds);
      }
      currentVideoFrame = targetVideoFrame;

      // C. Report progress
      const percent = 15 + (currentVideoFrame / Math.max(1, totalVideoFrames)) * 73;
      reportProgress(
        "rendering-video",
        percent,
        `Encoding: ${currentVideoFrame} of ${totalVideoFrames} frames (${stepEndTime.toFixed(1)}s)...`,
        currentVideoFrame,
        totalVideoFrames
      );

      // Yield event loop for cancellation and UI updates
      await new Promise((r) => setTimeout(r, 0));
    }

    // Flush any remaining audio samples if duration rounding had leftover samples
    if (shouldRenderAudio && audioSource && audioMixer && currentAudioSample < totalAudioSamples) {
      const remaining = totalAudioSamples - currentAudioSample;
      const audioSample = await audioMixer.renderBlock(currentAudioSample, remaining);
      if (audioSample) {
        try {
          await audioSource.add(audioSample);
        } catch {} finally {
          audioSample.close();
        }
      }
      currentAudioSample = totalAudioSamples;
    }

    // Flush any remaining video frames
    while (currentVideoFrame < totalVideoFrames) {
      if (signal?.aborted) {
        throw new DOMException("Export was cancelled.", "AbortError");
      }
      const frame = plan.videoFrames[currentVideoFrame];
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      if (frame.activeClip) {
        const sink = canvasSinks.get(frame.activeClip.assetId);
        if (sink) {
          try {
            const wrapped = await sink.getCanvas(frame.activeClip.sourceTimeSeconds);
            if (wrapped?.canvas) {
              ctx.drawImage(wrapped.canvas, 0, 0, canvasWidth, canvasHeight);
            }
          } catch {}
        }
      }
      if (frame.activeOverlays.length > 0) {
        for (const overlay of frame.activeOverlays) {
          renderTextOverlayToCanvas(ctx, overlay, canvasWidth, canvasHeight);
        }
      }
      await canvasSource.add(frame.presentationTimeSeconds, frame.durationSeconds);
      currentVideoFrame++;
    }

    // 7. Finalize Encoders & Container
    reportProgress("finalizing-output", 88, "Finalizing container and metadata...");
    canvasSource.close();
    if (audioSource) {
      audioSource.close();
    }

    await output.finalize();

    // 8. Finalize Writer and acquire File
    reportProgress("validating-output", 92, "Validating output file...");
    const outputFile = await writer.finalize();

    // 9. Output Validation
    const validation = await validateExportedMedia(outputFile, plan);
    if (!validation.ok) {
      throw new Error(`Output validation failed: ${validation.error}`);
    }

    reportProgress("completed", 100, "Export completed successfully!");

    return {
      file: outputFile,
      validation,
      finalFilename: writer.finalFilename,
      relativePath: writer.relativePath,
    };
  } catch (err) {
    // Cleanup on failure or cancellation
    try {
      await writer.abort();
    } catch {}

    if (canvasSource) {
      try {
        canvasSource.close();
      } catch {}
    }

    if (audioSource) {
      try {
        audioSource.close();
      } catch {}
    }

    if (output && output.state !== "finalized") {
      try {
        output.cancel();
      } catch {}
    }

    if (signal?.aborted) {
      reportProgress("cancelled", 0, "Export was cancelled.");
      throw new DOMException("Export was cancelled.", "AbortError");
    }

    const message = err instanceof Error ? err.message : String(err);
    reportProgress("failed", 0, `Export failed: ${message}`);
    throw err;
  } finally {
    if (audioMixer) {
      audioMixer.dispose();
    }
    unlockCacheResource(writer.relativePath);
    // Clean up all opened media inputs
    for (const input of openedInputs) {
      disposeMediaInput(input);
    }
  }
}
