/**
 * Frame-accurate timecode calculations and formatting for Content Studio.
 *
 * Rules:
 * - Deterministic integer frame math avoids cumulative floating-point drift.
 * - Supports arbitrary standard frame rates (23.976, 24, 25, 29.97, 30, 50, 59.94, 60).
 * - SMPTE timecode format: HH:MM:SS:FF (or HH:MM:SS;FF for drop-frame).
 * - Pure TypeScript functions with no DOM or browser dependencies.
 */

export const DEFAULT_FPS = 30;

/**
 * Common standard editing frame rates.
 */
export const STANDARD_FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60] as const;

/**
 * Converts a timeline time in seconds to the absolute integer frame index.
 */
export function secondsToFrames(seconds: number, fps: number = DEFAULT_FPS): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const safeFps = fps > 0 ? fps : DEFAULT_FPS;
  return Math.round(seconds * safeFps);
}

/**
 * Converts an absolute integer frame index back to seconds.
 */
export function framesToSeconds(frames: number, fps: number = DEFAULT_FPS): number {
  if (!Number.isFinite(frames) || frames <= 0) return 0;
  const safeFps = fps > 0 ? fps : DEFAULT_FPS;
  return frames / safeFps;
}

/**
 * Snaps a time in seconds to the nearest discrete frame boundary.
 */
export function snapToFrame(seconds: number, fps: number = DEFAULT_FPS): number {
  const frames = secondsToFrames(seconds, fps);
  return framesToSeconds(frames, fps);
}

/**
 * Steps the current time by a discrete number of frames.
 */
export function stepFrames(currentTime: number, frameDelta: number, fps: number = DEFAULT_FPS): number {
  const safeFps = fps > 0 ? fps : DEFAULT_FPS;
  const currentFrame = secondsToFrames(currentTime, safeFps);
  const targetFrame = Math.max(0, currentFrame + frameDelta);
  return framesToSeconds(targetFrame, safeFps);
}

/**
 * Formats seconds into an SMPTE timecode string: HH:MM:SS:FF.
 */
export function formatTimecode(
  seconds: number,
  fps: number = DEFAULT_FPS,
  dropFrame: boolean = false
): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00:00:00";
  }

  const safeFps = fps > 0 ? fps : DEFAULT_FPS;
  const nominalFps = Math.round(safeFps);
  let totalFrames = secondsToFrames(seconds, safeFps);

  const delimiter = dropFrame ? ";" : ":";

  // Drop-frame handling for 29.97 fps (SMPTE standard)
  if (dropFrame && (Math.abs(safeFps - 29.97) < 0.05 || Math.abs(safeFps - 59.94) < 0.05)) {
    const dropFramesPerMinute = Math.abs(safeFps - 29.97) < 0.05 ? 2 : 4;
    const framesPerTenMinutes = Math.round(safeFps * 600);
    const framesPerMinute = Math.round(safeFps * 60) - dropFramesPerMinute;

    const d = Math.floor(totalFrames / framesPerTenMinutes);
    const m = totalFrames % framesPerTenMinutes;

    if (m > dropFramesPerMinute) {
      totalFrames += dropFramesPerMinute * 9 * d + dropFramesPerMinute * Math.floor((m - dropFramesPerMinute) / framesPerMinute);
    } else {
      totalFrames += dropFramesPerMinute * 9 * d;
    }
  }

  const f = totalFrames % nominalFps;
  const totalSeconds = Math.floor(totalFrames / nominalFps);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);

  const pad = (num: number) => String(num).padStart(2, "0");

  return `${pad(h)}:${pad(m)}:${pad(s)}${delimiter}${pad(f)}`;
}

/**
 * Parses an SMPTE timecode or partial timecode string into seconds.
 * Supports:
 * - HH:MM:SS:FF or HH:MM:SS;FF
 * - MM:SS:FF
 * - SS:FF
 * - Floating point seconds string
 */
export function parseTimecode(tcStr: string, fps: number = DEFAULT_FPS): number | null {
  if (typeof tcStr !== "string") return null;
  const clean = tcStr.trim();
  if (clean.length === 0) return null;

  // Direct float format (e.g. "12.5" or "12.5s")
  const floatMatch = /^-?\d+(\.\d+)?s?$/.exec(clean);
  if (floatMatch) {
    const num = parseFloat(clean);
    return Number.isFinite(num) && num >= 0 ? num : null;
  }

  const parts = clean.split(/[:;]/).map((p) => parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p) || p < 0)) return null;

  const safeFps = fps > 0 ? fps : DEFAULT_FPS;
  const nominalFps = Math.round(safeFps);

  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  let frames = 0;

  if (parts.length === 4) {
    [hours, minutes, seconds, frames] = parts;
  } else if (parts.length === 3) {
    [minutes, seconds, frames] = parts;
  } else if (parts.length === 2) {
    [seconds, frames] = parts;
  } else if (parts.length === 1) {
    seconds = parts[0];
  } else {
    return null;
  }

  const totalFrames = (hours * 3600 + minutes * 60 + seconds) * nominalFps + frames;
  return framesToSeconds(totalFrames, safeFps);
}
