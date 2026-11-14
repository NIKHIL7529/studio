/**
 * Local output validation for completed video exports (Phase 5).
 *
 * Rules:
 * - Validates container integrity, tracks, codecs, dimensions, and duration.
 * - Confirms non-zero byte size and readability with Mediabunny.
 * - Distinguishes container/technical validation from perceptual quality checks.
 * - Does not publish partially written or corrupt outputs as completed.
 */

import { createMediaInput, disposeMediaInput } from "../media/input.ts";
import type { RenderPlan, ExportValidationResult } from "../../types/export.ts";

/**
 * Validates a finalized export file against its render plan.
 */
export async function validateExportedMedia(
  file: File | Blob,
  plan: RenderPlan
): Promise<ExportValidationResult> {
  // 1. File size check
  if (!file || file.size === 0) {
    return {
      ok: false,
      error: "Output file is empty (0 bytes).",
    };
  }

  let input: ReturnType<typeof createMediaInput> | null = null;

  try {
    input = createMediaInput(file);

    // 2. Container readability
    const canRead = await input.canRead();
    if (!canRead) {
      return {
        ok: false,
        error: "Exported container could not be parsed by media inspector.",
      };
    }

    const format = await input.getFormat();
    let mimeType = "";
    try {
      mimeType = await input.getMimeType();
    } catch {
      mimeType = format.mimeType || "";
    }

    const videoTracks = await input.getVideoTracks();
    const audioTracks = await input.getAudioTracks();

    // 3. Track presence
    if (plan.hasVideo && videoTracks.length === 0) {
      return {
        ok: false,
        error: "Export was expected to contain a video track, but no video track was found.",
      };
    }

    if (plan.hasAudio && audioTracks.length === 0) {
      return {
        ok: false,
        error: "Export was expected to contain an audio track, but no audio track was found.",
      };
    }

    let detectedWidth = 0;
    let detectedHeight = 0;
    let detectedVideoCodec: string | undefined = undefined;
    let detectedFrameRate: number | undefined = undefined;

    // 4. Video track validation
    if (videoTracks.length > 0) {
      const vTrack = videoTracks[0];
      const codec = await vTrack.getCodec();
      detectedVideoCodec = codec || undefined;

      const expectedCodecPrefix = plan.settings.format === "webm" ? "vp9" : "avc";
      if (codec && !codec.toLowerCase().includes(expectedCodecPrefix)) {
        return {
          ok: false,
          error: `Video codec mismatch: expected "${expectedCodecPrefix}", got "${codec}".`,
        };
      }

      detectedWidth = vTrack.displayWidth || vTrack.codedWidth || 0;
      detectedHeight = vTrack.displayHeight || vTrack.codedHeight || 0;

      // Allow small tolerance for dimensions (even rounding)
      if (
        Math.abs(detectedWidth - plan.settings.width) > 4 ||
        Math.abs(detectedHeight - plan.settings.height) > 4
      ) {
        return {
          ok: false,
          error: `Output resolution mismatch: expected ${plan.settings.width}x${plan.settings.height}, got ${detectedWidth}x${detectedHeight}.`,
        };
      }

      try {
        const stats = await vTrack.computePacketStats();
        if (stats && stats.averagePacketRate > 0) {
          detectedFrameRate = Math.round(stats.averagePacketRate);
        }
      } catch {
        // computePacketStats is optional
      }
    }

    // 5. Audio track validation
    let detectedAudioCodec: string | undefined = undefined;
    if (audioTracks.length > 0) {
      const aTrack = audioTracks[0];
      const codec = await aTrack.getCodec();
      detectedAudioCodec = codec || undefined;
    }

    // 6. Duration validation
    let duration = 0;
    try {
      const metaDuration = await input.getDurationFromMetadata();
      if (typeof metaDuration === "number" && metaDuration > 0) {
        duration = metaDuration;
      }
    } catch {}

    if (duration <= 0) {
      try {
        const compDuration = await input.computeDuration();
        if (typeof compDuration === "number" && compDuration > 0) {
          duration = compDuration;
        }
      } catch {}
    }

    if (duration <= 0) {
      return {
        ok: false,
        error: "Exported media has non-positive or undetermined duration.",
      };
    }

    // Tolerance of ±0.5 seconds or 2 frames for container metadata discrepancies
    const durationDelta = Math.abs(duration - plan.totalDurationSeconds);
    const tolerance = Math.max(0.5, 2 / plan.frameRate);
    if (durationDelta > tolerance) {
      return {
        ok: false,
        error: `Output duration mismatch: expected ~${plan.totalDurationSeconds.toFixed(2)}s, got ${duration.toFixed(2)}s (delta: ${durationDelta.toFixed(2)}s).`,
      };
    }

    // 7. Optional local browser smoke test
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      try {
        await smokeTestPlayback(file);
      } catch (err) {
        return {
          ok: false,
          error: `Smoke playback validation failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    return {
      ok: true,
      metadata: {
        format: format.mimeType || plan.settings.format,
        mimeType,
        hasVideo: videoTracks.length > 0,
        hasAudio: audioTracks.length > 0,
        videoCodec: detectedVideoCodec,
        audioCodec: detectedAudioCodec,
        width: detectedWidth || plan.settings.width,
        height: detectedHeight || plan.settings.height,
        frameRate: detectedFrameRate || plan.frameRate,
        duration,
        fileSize: file.size,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: `Validation inspection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    disposeMediaInput(input);
  }
}

/**
 * Quick local browser playback verification using <video> loadedmetadata.
 */
function smokeTestPlayback(file: File | Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";

    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
      URL.revokeObjectURL(url);
    };

    const onLoaded = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("Browser video element failed to decode container metadata."));
    };

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onError);

    video.src = url;
  });
}
