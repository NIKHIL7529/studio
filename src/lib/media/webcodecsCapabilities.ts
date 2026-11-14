/**
 * WebCodecs runtime capability detection.
 *
 * Rules:
 * - Detects VideoDecoder, VideoEncoder, AudioDecoder, AudioEncoder independently.
 * - Checks worker context capability where supported.
 * - Uses isConfigSupported() with fully specified codec configurations.
 * - Results are kept in runtime memory and NEVER persisted in project documents.
 * - Does not block native preview or inspection if WebCodecs is unavailable.
 */

import type {
  WebCodecsCapabilities,
  WebCodecsCodecSupport,
  InspectedMediaMetadata,
} from "./types.ts";

/**
 * Detects presence of WebCodecs constructor interfaces in the current environment.
 */
export function detectWebCodecsCapabilities(): WebCodecsCapabilities {
  if (typeof window === "undefined" && typeof globalThis === "undefined") {
    return {
      hasVideoDecoder: false,
      hasVideoEncoder: false,
      hasAudioDecoder: false,
      hasAudioEncoder: false,
      isSupported: false,
      workerSupported: false,
    };
  }

  const env = typeof window !== "undefined" ? window : globalThis;

  const hasVideoDecoder = typeof (env as unknown as Record<string, unknown>)["VideoDecoder"] === "function";
  const hasVideoEncoder = typeof (env as unknown as Record<string, unknown>)["VideoEncoder"] === "function";
  const hasAudioDecoder = typeof (env as unknown as Record<string, unknown>)["AudioDecoder"] === "function";
  const hasAudioEncoder = typeof (env as unknown as Record<string, unknown>)["AudioEncoder"] === "function";

  const isSupported = hasVideoDecoder && hasVideoEncoder && hasAudioDecoder && hasAudioEncoder;

  // Worker support heuristic: In Chromium, Worker shares the WebCodecs support of Window
  const workerSupported = typeof Worker !== "undefined" && isSupported;

  return {
    hasVideoDecoder,
    hasVideoEncoder,
    hasAudioDecoder,
    hasAudioEncoder,
    isSupported,
    workerSupported,
  };
}

/**
 * Checks whether a specific VideoDecoderConfig is supported on the current device.
 * Never guesses: calls VideoDecoder.isConfigSupported() directly.
 */
export async function checkVideoDecoderSupport(
  config: VideoDecoderConfig
): Promise<WebCodecsCodecSupport> {
  if (
    typeof VideoDecoder === "undefined" ||
    typeof VideoDecoder.isConfigSupported !== "function"
  ) {
    return { supported: false };
  }

  try {
    const res = await VideoDecoder.isConfigSupported(config);
    return {
      supported: Boolean(res.supported),
    };
  } catch {
    return { supported: false };
  }
}

/**
 * Checks whether a specific AudioDecoderConfig is supported on the current device.
 */
export async function checkAudioDecoderSupport(
  config: AudioDecoderConfig
): Promise<WebCodecsCodecSupport> {
  if (
    typeof AudioDecoder === "undefined" ||
    typeof AudioDecoder.isConfigSupported !== "function"
  ) {
    return { supported: false };
  }

  try {
    const res = await AudioDecoder.isConfigSupported(config);
    return {
      supported: Boolean(res.supported),
    };
  } catch {
    return { supported: false };
  }
}

/**
 * Checks whether a specific VideoEncoderConfig is supported on the current device.
 */
export async function checkVideoEncoderSupport(
  config: VideoEncoderConfig
): Promise<WebCodecsCodecSupport> {
  if (
    typeof VideoEncoder === "undefined" ||
    typeof VideoEncoder.isConfigSupported !== "function"
  ) {
    return { supported: false };
  }

  try {
    const res = await VideoEncoder.isConfigSupported(config);
    return {
      supported: Boolean(res.supported),
    };
  } catch {
    return { supported: false };
  }
}

/**
 * Checks whether a specific AudioEncoderConfig is supported on the current device.
 */
export async function checkAudioEncoderSupport(
  config: AudioEncoderConfig
): Promise<WebCodecsCodecSupport> {
  if (
    typeof AudioEncoder === "undefined" ||
    typeof AudioEncoder.isConfigSupported !== "function"
  ) {
    return { supported: false };
  }

  try {
    const res = await AudioEncoder.isConfigSupported(config);
    return {
      supported: Boolean(res.supported),
    };
  } catch {
    return { supported: false };
  }
}

/**
 * Evaluates WebCodecs decoder availability for the inspected tracks of an asset.
 */
export async function checkAssetDecoderSupport(
  metadata: InspectedMediaMetadata
): Promise<{
  videoSupported?: boolean;
  audioSupported?: boolean;
}> {
  let videoSupported: boolean | undefined = undefined;
  let audioSupported: boolean | undefined = undefined;

  const videoTrack = metadata.videoTracks[0];
  if (videoTrack?.codec) {
    const videoConfig: VideoDecoderConfig = {
      codec: videoTrack.codecParameterString || videoTrack.codec,
      codedWidth: videoTrack.codedWidth || videoTrack.displayWidth || 1920,
      codedHeight: videoTrack.codedHeight || videoTrack.displayHeight || 1080,
    };
    const res = await checkVideoDecoderSupport(videoConfig);
    videoSupported = res.supported;
  }

  const audioTrack = metadata.audioTracks[0];
  if (audioTrack?.codec) {
    const audioConfig: AudioDecoderConfig = {
      codec: audioTrack.codecParameterString || audioTrack.codec,
      sampleRate: audioTrack.sampleRate || 48000,
      numberOfChannels: audioTrack.numberOfChannels || 2,
    };
    const res = await checkAudioDecoderSupport(audioConfig);
    audioSupported = res.supported;
  }

  return { videoSupported, audioSupported };
}

