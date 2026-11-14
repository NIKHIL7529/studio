/**
 * Runtime capability detection for local video export.
 *
 * Rules:
 * - Codec support is validated strictly through VideoEncoder.isConfigSupported()
 *   and AudioEncoder.isConfigSupported(), never guessed from User-Agent strings.
 * - Entirely defensive: safe to run in SSR or test environments where WebCodecs is absent.
 * - Detects container and codec compatibility for MP4 (H.264 + AAC) and WebM (VP9 + Opus).
 */

import type { ExportCapabilitiesReport, ExportPreset } from "../../types/export.ts";

/** Standard H.264 codec strings to test in order of preference */
export const H264_CODEC_CANDIDATES = [
  "avc1.640028", // High Profile Level 4.0 (1080p30 standard)
  "avc1.4d002a", // Main Profile Level 4.2
  "avc1.42001f", // Baseline Profile Level 3.1
];

/** Standard AAC codec strings */
export const AAC_CODEC_CANDIDATES = [
  "mp4a.40.2", // AAC-LC
];

/** Fallback VP9 codec strings */
export const VP9_CODEC_CANDIDATES = [
  "vp09.00.10.08", // VP9 Profile 0 Level 1.0 8-bit
  "vp9",
];

/** Fallback Opus codec strings */
export const OPUS_CODEC_CANDIDATES = [
  "opus",
];

/**
 * Checks if a specific VideoEncoder configuration is supported.
 */
export async function checkVideoEncoderConfig(config: VideoEncoderConfig): Promise<boolean> {
  if (
    typeof VideoEncoder === "undefined" ||
    typeof VideoEncoder.isConfigSupported !== "function"
  ) {
    return false;
  }

  try {
    const res = await VideoEncoder.isConfigSupported(config);
    return Boolean(res.supported);
  } catch {
    return false;
  }
}

/**
 * Checks if a specific AudioEncoder configuration is supported.
 */
export async function checkAudioEncoderConfig(config: AudioEncoderConfig): Promise<boolean> {
  if (
    typeof AudioEncoder === "undefined" ||
    typeof AudioEncoder.isConfigSupported !== "function"
  ) {
    return false;
  }

  try {
    const res = await AudioEncoder.isConfigSupported(config);
    return Boolean(res.supported);
  } catch {
    return false;
  }
}

/**
 * Discovers the first supported video codec string from candidate list.
 */
export async function findSupportedVideoCodec(
  candidates: string[],
  width: number,
  height: number,
  frameRate: number = 30,
  bitrate: number = 5_000_000
): Promise<string | null> {
  for (const codec of candidates) {
    const supported = await checkVideoEncoderConfig({
      codec,
      width,
      height,
      bitrate,
      framerate: frameRate,
    });
    if (supported) {
      return codec;
    }
  }
  return null;
}

/**
 * Discovers the first supported audio codec string from candidate list.
 */
export async function findSupportedAudioCodec(
  candidates: string[],
  sampleRate: number = 48000,
  numberOfChannels: number = 2,
  bitrate: number = 128_000
): Promise<string | null> {
  for (const codec of candidates) {
    const supported = await checkAudioEncoderConfig({
      codec,
      sampleRate,
      numberOfChannels,
      bitrate,
    });
    if (supported) {
      return codec;
    }
  }
  return null;
}

/**
 * Evaluates full runtime export capabilities on the current device.
 */
export async function detectExportCapabilities(): Promise<ExportCapabilitiesReport> {
  const env = typeof window !== "undefined" ? window : globalThis;

  const hasVideoEncoder = typeof (env as unknown as Record<string, unknown>)["VideoEncoder"] === "function";
  const hasAudioEncoder = typeof (env as unknown as Record<string, unknown>)["AudioEncoder"] === "function";
  const hasWebCodecs = hasVideoEncoder && hasAudioEncoder;

  const notes: string[] = [];
  const supportedVideoCodecs: string[] = [];
  const supportedAudioCodecs: string[] = [];
  const supportedPresets: ExportPreset[] = [];

  if (!hasWebCodecs) {
    notes.push("WebCodecs (VideoEncoder/AudioEncoder) is not available in this environment.");
    return {
      hasWebCodecs: false,
      canExportMp4AvcAac: false,
      canExportWebmOpus: false,
      supportedVideoCodecs: [],
      supportedAudioCodecs: [],
      supportedPresets: [],
      fileSystemAccessWritable: false,
      notes,
    };
  }

  // Check H.264
  const supportedH264 = await findSupportedVideoCodec(H264_CODEC_CANDIDATES, 1920, 1080, 30);
  if (supportedH264) {
    supportedVideoCodecs.push(supportedH264);
  } else {
    notes.push("H.264 (AVC) hardware/software encoding is not supported by this browser.");
  }

  // Check AAC
  const supportedAac = await findSupportedAudioCodec(AAC_CODEC_CANDIDATES, 48000, 2);
  if (supportedAac) {
    supportedAudioCodecs.push(supportedAac);
  } else {
    notes.push("AAC audio encoding is not supported by this browser.");
  }

  // Check VP9
  const supportedVp9 = await findSupportedVideoCodec(VP9_CODEC_CANDIDATES, 1920, 1080, 30);
  if (supportedVp9) {
    supportedVideoCodecs.push(supportedVp9);
  }

  // Check Opus
  const supportedOpus = await findSupportedAudioCodec(OPUS_CODEC_CANDIDATES, 48000, 2);
  if (supportedOpus) {
    supportedAudioCodecs.push(supportedOpus);
  }

  const canExportMp4AvcAac = Boolean(supportedH264 && supportedAac);
  const canExportWebmOpus = Boolean(supportedVp9 && supportedOpus);

  // Check preset support
  if (supportedH264 || supportedVp9) {
    const baseCodec = supportedH264 || supportedVp9!;
    const check1080 = await checkVideoEncoderConfig({ codec: baseCodec, width: 1920, height: 1080, framerate: 30 });
    if (check1080) supportedPresets.push("1080p");

    const check720 = await checkVideoEncoderConfig({ codec: baseCodec, width: 1280, height: 720, framerate: 30 });
    if (check720) supportedPresets.push("720p");

    const check540 = await checkVideoEncoderConfig({ codec: baseCodec, width: 960, height: 540, framerate: 30 });
    if (check540) supportedPresets.push("540p");
  }

  // Check File System Access writable support
  const fileSystemAccessWritable =
    typeof FileSystemFileHandle !== "undefined" &&
    typeof FileSystemFileHandle.prototype.createWritable === "function";

  if (!fileSystemAccessWritable) {
    notes.push("Direct streaming to workspace disk handles is unavailable; export will offer standard download fallback.");
  }

  return {
    hasWebCodecs,
    canExportMp4AvcAac,
    canExportWebmOpus,
    supportedVideoCodecs,
    supportedAudioCodecs,
    supportedPresets,
    fileSystemAccessWritable,
    notes,
  };
}
