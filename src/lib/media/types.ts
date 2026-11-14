/**
 * Media engine types for Content Studio (Phase 3).
 *
 * Rules:
 * - Types capture only what Mediabunny or browser media APIs actually determine.
 * - Technical metadata is cleanly separated into typed internal models.
 * - Does not store live File, Blob, HTMLMediaElement, or decoder instances in project JSON.
 */

export interface InspectedVideoTrack {
  trackNumber: number;
  codec: string | null;
  codecParameterString?: string | null;
  codedWidth?: number;
  codedHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
  rotation?: number; // degrees: 0, 90, 180, 270
  frameRate?: number; // only when reliably measured (constant frame rate or confident underlying rate)
  isConstantFrameRate?: boolean;
}

export interface InspectedAudioTrack {
  trackNumber: number;
  codec: string | null;
  codecParameterString?: string | null;
  numberOfChannels?: number;
  sampleRate?: number;
}

export interface InspectedMediaMetadata {
  /** Inspected container format name (e.g. "MP4", "WebM", "WAVE") */
  containerFormat?: string;
  /** Full detected MIME type from inspection (e.g. "video/mp4; codecs=avc1.640028") */
  mimeType?: string;
  /** Authoritative duration in seconds */
  duration?: number;
  /** Video tracks */
  videoTracks: InspectedVideoTrack[];
  /** Audio tracks */
  audioTracks: InspectedAudioTrack[];
  /** Primary display width (after rotation/aspect ratio) */
  displayWidth?: number;
  /** Primary display height (after rotation/aspect ratio) */
  displayHeight?: number;
  /** Primary coded width */
  codedWidth?: number;
  /** Primary coded height */
  codedHeight?: number;
  /** Primary rotation in degrees */
  rotation?: number;
  /** Primary video frame rate (if reliably measured) */
  frameRate?: number;
  /** Whether the video frame rate is constant (CFR) */
  isConstantFrameRate?: boolean;
  /** Primary audio sample rate in Hz */
  sampleRate?: number;
  /** Primary audio channel count */
  numberOfChannels?: number;
  /** ISO timestamp of inspection */
  inspectedAt: string;
}

export type MediaInspectionStatus =
  | "ready"              // Valid media with usable audio and/or video tracks
  | "no-usable-tracks"   // Recognized container, but 0 audio and 0 video tracks
  | "unsupported"        // Unrecognized or unsupported format
  | "corrupt"            // Truncated, malformed, or 0-byte file
  | "error";             // Other inspection error

export interface MediaInspectionResult {
  status: MediaInspectionStatus;
  metadata?: InspectedMediaMetadata;
  error?: string;
}

export type PreviewPlaybackState =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "error";

export interface PreviewSourceState {
  state: PreviewPlaybackState;
  currentTime: number;
  duration: number;
  buffered: number;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  error?: string;
  isAutoplayBlocked?: boolean;
}

export interface WebCodecsCodecSupport {
  supported: boolean;
  smooth?: boolean;
  powerEfficient?: boolean;
}

export interface WebCodecsCapabilities {
  hasVideoDecoder: boolean;
  hasVideoEncoder: boolean;
  hasAudioDecoder: boolean;
  hasAudioEncoder: boolean;
  isSupported: boolean;
  workerSupported: boolean;
}

