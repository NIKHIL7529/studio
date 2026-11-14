/**
 * Local media inspection using Mediabunny.
 *
 * Rules:
 * - Pass original File/Blob directly; do not read full bytes into memory.
 * - Treat file extension and browser MIME type as hints only; inspected media is authoritative.
 * - Return explicit result states: "ready", "no-usable-tracks", "unsupported", "corrupt", "error".
 * - Never invent metadata or infer fixed frame rates for variable-frame-rate content.
 * - Every Input instance is disposed safely in a finally block.
 */

import { UnsupportedInputFormatError } from "mediabunny";
import { createMediaInput, disposeMediaInput } from "./input.ts";
import type {
  MediaInspectionResult,
  InspectedMediaMetadata,
  InspectedVideoTrack,
  InspectedAudioTrack,
} from "./types.ts";

export interface InspectOptions {
  signal?: AbortSignal;
}

/**
 * Inspects a local media file or blob with Mediabunny and returns a typed result.
 */
export async function inspectMediaFile(
  file: File | Blob,
  options?: InspectOptions
): Promise<MediaInspectionResult> {
  if (options?.signal?.aborted) {
    throw new DOMException("Media inspection aborted", "AbortError");
  }

  // Fast check: zero-byte files cannot contain media headers
  if (file.size === 0) {
    return {
      status: "corrupt",
      error: "File is empty (0 bytes).",
    };
  }

  let input: ReturnType<typeof createMediaInput> | null = null;

  try {
    input = createMediaInput(file);

    const canRead = await input.canRead();
    if (options?.signal?.aborted) {
      throw new DOMException("Media inspection aborted", "AbortError");
    }

    if (!canRead) {
      return {
        status: "unsupported",
        error: "Media container or format is not supported.",
      };
    }

    const format = await input.getFormat();
    if (options?.signal?.aborted) {
      throw new DOMException("Media inspection aborted", "AbortError");
    }

    let detectedMime = "";
    try {
      detectedMime = await input.getMimeType();
    } catch {
      detectedMime = format.mimeType || "";
    }

    const videoTracks = await input.getVideoTracks();
    const audioTracks = await input.getAudioTracks();

    if (videoTracks.length === 0 && audioTracks.length === 0) {
      return {
        status: "no-usable-tracks",
        error: "Media file was recognized but contains no usable audio or video tracks.",
      };
    }

    // Determine duration: prefer cheaper metadata duration, fall back to computeDuration
    let duration: number | undefined = undefined;
    try {
      const metaDuration = await input.getDurationFromMetadata();
      if (typeof metaDuration === "number" && Number.isFinite(metaDuration) && metaDuration > 0) {
        duration = metaDuration;
      }
    } catch {
      // Ignore metadata duration read failure and try computeDuration
    }

    if (duration === undefined) {
      try {
        const computed = await input.computeDuration();
        if (typeof computed === "number" && Number.isFinite(computed) && computed > 0) {
          duration = computed;
        }
      } catch {
        // Leave duration undefined if uncomputable
      }
    }

    // Inspect video tracks
    const inspectedVideoTracks: InspectedVideoTrack[] = [];
    for (let i = 0; i < videoTracks.length; i++) {
      if (options?.signal?.aborted) {
        throw new DOMException("Media inspection aborted", "AbortError");
      }
      const track = videoTracks[i];
      let codedWidth: number | undefined;
      let codedHeight: number | undefined;
      let displayWidth: number | undefined;
      let displayHeight: number | undefined;
      let rotation = 0;
      let codec: string | null = null;
      let codecParameterString: string | null = null;
      let frameRate: number | undefined;
      let isConstantFrameRate: boolean | undefined;

      try {
        codedWidth = await track.getCodedWidth();
      } catch { /* ignored */ }

      try {
        codedHeight = await track.getCodedHeight();
      } catch { /* ignored */ }

      try {
        displayWidth = await track.getDisplayWidth();
      } catch { /* ignored */ }

      try {
        displayHeight = await track.getDisplayHeight();
      } catch { /* ignored */ }

      try {
        rotation = await track.getRotation();
      } catch { /* ignored */ }

      try {
        codec = await track.getCodec();
      } catch { /* ignored */ }

      try {
        codecParameterString = await track.getCodecParameterString();
      } catch { /* ignored */ }

      // Frame rate metrics: inspect bounded packet count (64 packets max)
      try {
        const metrics = await track.computeFrameRateMetrics({ targetPacketCount: 64 });
        if (metrics.frameRateIsConstant && metrics.underlyingFrameRate != null && Number.isFinite(metrics.underlyingFrameRate)) {
          frameRate = Math.round(metrics.underlyingFrameRate * 100) / 100;
          isConstantFrameRate = true;
        } else {
          isConstantFrameRate = false;
          // Do not infer or invent a fixed frame rate for VFR content
          frameRate = undefined;
        }
      } catch {
        // Frame rate inspection non-critical
      }

      inspectedVideoTracks.push({
        trackNumber: i + 1,
        codec,
        codecParameterString,
        codedWidth,
        codedHeight,
        displayWidth,
        displayHeight,
        rotation,
        frameRate,
        isConstantFrameRate,
      });
    }

    // Inspect audio tracks
    const inspectedAudioTracks: InspectedAudioTrack[] = [];
    for (let i = 0; i < audioTracks.length; i++) {
      if (options?.signal?.aborted) {
        throw new DOMException("Media inspection aborted", "AbortError");
      }
      const track = audioTracks[i];
      let numberOfChannels: number | undefined;
      let sampleRate: number | undefined;
      let codec: string | null = null;
      let codecParameterString: string | null = null;

      try {
        numberOfChannels = await track.getNumberOfChannels();
      } catch { /* ignored */ }

      try {
        sampleRate = await track.getSampleRate();
      } catch { /* ignored */ }

      try {
        codec = await track.getCodec();
      } catch { /* ignored */ }

      try {
        codecParameterString = await track.getCodecParameterString();
      } catch { /* ignored */ }

      inspectedAudioTracks.push({
        trackNumber: i + 1,
        codec,
        codecParameterString,
        numberOfChannels,
        sampleRate,
      });
    }

    // Derive primary track attributes
    const primaryVideo = inspectedVideoTracks[0];
    const primaryAudio = inspectedAudioTracks[0];

    const metadata: InspectedMediaMetadata = {
      containerFormat: format.name,
      mimeType: detectedMime,
      duration,
      videoTracks: inspectedVideoTracks,
      audioTracks: inspectedAudioTracks,
      displayWidth: primaryVideo?.displayWidth,
      displayHeight: primaryVideo?.displayHeight,
      codedWidth: primaryVideo?.codedWidth,
      codedHeight: primaryVideo?.codedHeight,
      rotation: primaryVideo?.rotation,
      frameRate: primaryVideo?.frameRate,
      isConstantFrameRate: primaryVideo?.isConstantFrameRate,
      sampleRate: primaryAudio?.sampleRate,
      numberOfChannels: primaryAudio?.numberOfChannels,
      inspectedAt: new Date().toISOString(),
    };

    return {
      status: "ready",
      metadata,
    };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }

    if (err instanceof UnsupportedInputFormatError) {
      return {
        status: "unsupported",
        error: "Media container or format is not supported by Content Studio.",
      };
    }

    return {
      status: "corrupt",
      error: err instanceof Error ? err.message : "Media file is damaged, truncated, or unreadable.",
    };
  } finally {
    disposeMediaInput(input);
  }
}

/**
 * Formats a duration in seconds into a clean time string (e.g. "01:23" or "1:02:45").
 */
export function formatDuration(seconds?: number): string {
  if (seconds === undefined || Number.isNaN(seconds) || seconds < 0) {
    return "--:--";
  }

  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

/**
 * Formats display dimensions into a clean string (e.g. "1920 × 1080").
 */
export function formatResolution(width?: number, height?: number): string {
  if (!width || !height) return "Unknown";
  return `${width} × ${height}`;
}

