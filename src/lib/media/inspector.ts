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
 * Inspects image files (.png, .jpg, .jpeg, .webp) for natural dimensions.
 * Uses createImageBitmap in the browser, with lightweight binary header parsing for Node tests.
 */
export async function inspectImageDimensions(
  file: File | Blob
): Promise<{ width: number; height: number; mimeType: string } | null> {
  const fileName = "name" in file ? (file.name as string).toLowerCase() : "";
  const mimeType = (file.type || "").toLowerCase();

  // In browser environments with createImageBitmap support
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close();
      if (width > 0 && height > 0) {
        return {
          width,
          height,
          mimeType: mimeType || (fileName.endsWith(".webp") ? "image/webp" : fileName.endsWith(".png") ? "image/png" : "image/jpeg"),
        };
      }
    } catch {
      // Fall through to binary header parser
    }
  }

  // Lightweight binary header parsing for Node.js test environments
  try {
    const buffer = await file.slice(0, 65536).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    // 1. PNG Header: 89 50 4E 47 0D 0A 1A 0A
    if (
      bytes.length >= 24 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      const width = view.getUint32(16, false);
      const height = view.getUint32(20, false);
      if (width > 0 && height > 0) {
        return { width, height, mimeType: "image/png" };
      }
    }

    // 2. JPEG Header: FF D8
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2;
      while (offset < bytes.length - 8) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = bytes[offset + 1];
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          const height = view.getUint16(offset + 5, false);
          const width = view.getUint16(offset + 7, false);
          if (width > 0 && height > 0) {
            return { width, height, mimeType: "image/jpeg" };
          }
        }
        const length = view.getUint16(offset + 2, false);
        offset += 2 + length;
      }
    }

    // 3. WebP Header: RIFF .... WEBP
    if (
      bytes.length >= 30 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
      if (chunkType === "VP8 ") {
        const width = view.getUint16(26, true) & 0x3fff;
        const height = view.getUint16(28, true) & 0x3fff;
        if (width > 0 && height > 0) {
          return { width, height, mimeType: "image/webp" };
        }
      } else if (chunkType === "VP8L") {
        const b1 = bytes[21];
        const b2 = bytes[22];
        const b3 = bytes[23];
        const b4 = bytes[24];
        const width = 1 + (((b2 & 0x3f) << 8) | b1);
        const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
        if (width > 0 && height > 0) {
          return { width, height, mimeType: "image/webp" };
        }
      } else if (chunkType === "VP8X") {
        const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
        const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
        if (width > 0 && height > 0) {
          return { width, height, mimeType: "image/webp" };
        }
      }
    }
  } catch {
    // non-fatal
  }

  return null;
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

  // Check if file is an image (.png, .jpg, .jpeg, .webp, etc.)
  const isImageHint =
    file.type.startsWith("image/") ||
    ("name" in file && /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test((file as File).name));

  if (isImageHint) {
    const imgInfo = await inspectImageDimensions(file);
    if (imgInfo) {
      return {
        status: "ready",
        metadata: {
          containerFormat: "IMAGE",
          mimeType: imgInfo.mimeType,
          duration: 5, // default clip duration when dropped on a video track, freely trimmable/extendable
          videoTracks: [
            {
              trackNumber: 1,
              codec: "image",
              displayWidth: imgInfo.width,
              displayHeight: imgInfo.height,
              codedWidth: imgInfo.width,
              codedHeight: imgInfo.height,
              rotation: 0,
            },
          ],
          audioTracks: [],
          displayWidth: imgInfo.width,
          displayHeight: imgInfo.height,
          codedWidth: imgInfo.width,
          codedHeight: imgInfo.height,
          rotation: 0,
          inspectedAt: new Date().toISOString(),
        },
      };
    }
  }

  let input: ReturnType<typeof createMediaInput> | null = null;

  try {
    input = createMediaInput(file);

    const canRead = await input.canRead();
    if (options?.signal?.aborted) {
      throw new DOMException("Media inspection aborted", "AbortError");
    }

    if (!canRead) {
      const fallbackImg = await inspectImageDimensions(file);
      if (fallbackImg) {
        return {
          status: "ready",
          metadata: {
            containerFormat: "IMAGE",
            mimeType: fallbackImg.mimeType,
            duration: 5,
            videoTracks: [
              {
                trackNumber: 1,
                codec: "image",
                displayWidth: fallbackImg.width,
                displayHeight: fallbackImg.height,
                codedWidth: fallbackImg.width,
                codedHeight: fallbackImg.height,
                rotation: 0,
              },
            ],
            audioTracks: [],
            displayWidth: fallbackImg.width,
            displayHeight: fallbackImg.height,
            codedWidth: fallbackImg.width,
            codedHeight: fallbackImg.height,
            rotation: 0,
            inspectedAt: new Date().toISOString(),
          },
        };
      }
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
      const fallbackImg = await inspectImageDimensions(file);
      if (fallbackImg) {
        return {
          status: "ready",
          metadata: {
            containerFormat: "IMAGE",
            mimeType: fallbackImg.mimeType,
            duration: 5,
            videoTracks: [
              {
                trackNumber: 1,
                codec: "image",
                displayWidth: fallbackImg.width,
                displayHeight: fallbackImg.height,
                codedWidth: fallbackImg.width,
                codedHeight: fallbackImg.height,
                rotation: 0,
              },
            ],
            audioTracks: [],
            displayWidth: fallbackImg.width,
            displayHeight: fallbackImg.height,
            codedWidth: fallbackImg.width,
            codedHeight: fallbackImg.height,
            rotation: 0,
            inspectedAt: new Date().toISOString(),
          },
        };
      }
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

