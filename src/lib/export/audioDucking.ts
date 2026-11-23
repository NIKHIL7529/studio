/**
 * Deterministic Audio Ducking Engine for Content Studio.
 *
 * Rules:
 * - Pure, deterministic functions with zero external dependencies.
 * - Collects active dialogue intervals across non-muted dialogue tracks.
 * - Merges dialogue gaps shorter than (attackMs + releaseMs) to eliminate choppy volume flutter.
 * - Computes attack and release ramps to 10^(reductionDb / 20).
 * - Exact 1:1 parity across Program preview (evaluator.ts) and export (audioRenderer.ts).
 */

import type { TimelineDocument, TrackDuckingConfig } from "../../types/timeline.ts";
import { getClipTimelineDuration } from "../timeline/model.ts";

export interface TimeInterval {
  start: number;
  end: number;
}

/**
 * Gathers active dialogue intervals from non-muted dialogue sources:
 * 1. Video tracks that are not muted, with embedded audio (!clip.audioDetached, freezeFrameSourceTime === null, !clip.muted).
 * 2. Audio tracks that are not muted, with audioRole === "dialogue" and !clip.muted.
 *
 * Merges intervals where the gap between them is <= mergeThresholdSec (default 0.55s, or attackMs + releaseMs).
 */
export function collectDialogueIntervals(
  timeline: TimelineDocument,
  mergeThresholdSec = 0.55
): TimeInterval[] {
  const rawIntervals: TimeInterval[] = [];

  for (const track of timeline.tracks) {
    if (track.muted) continue;

    if (track.type === "video") {
      for (const clip of track.clips) {
        if (clip.muted || clip.audioDetached || clip.freezeFrameSourceTime !== null) {
          continue;
        }
        const duration = getClipTimelineDuration(clip);
        if (duration <= 0) continue;
        rawIntervals.push({
          start: clip.startTime,
          end: clip.startTime + duration,
        });
      }
    } else if (track.type === "audio") {
      if (track.audioRole !== "dialogue") continue;

      for (const clip of track.clips) {
        if (clip.muted) continue;
        const duration = getClipTimelineDuration(clip);
        if (duration <= 0) continue;
        rawIntervals.push({
          start: clip.startTime,
          end: clip.startTime + duration,
        });
      }
    }
  }

  if (rawIntervals.length === 0) return [];

  // Sort by start time ascending
  rawIntervals.sort((a, b) => a.start - b.start);

  const merged: TimeInterval[] = [{ ...rawIntervals[0] }];

  for (let i = 1; i < rawIntervals.length; i++) {
    const current = rawIntervals[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end + mergeThresholdSec) {
      // Overlapping or within gap threshold: extend last interval
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/**
 * Evaluates the ducking multiplier [minGain, 1.0] at a specific sequence time.
 * - Attack ramp: linearly reduces gain from 1.0 to minGain over attackMs prior to dialogue.
 * - During dialogue: gain is clamped at minGain = 10^(reductionDb / 20).
 * - Release ramp: linearly restores gain from minGain to 1.0 over releaseMs after dialogue.
 */
export function evaluateDuckingGainAtTime(
  timeSec: number,
  dialogueIntervals: TimeInterval[],
  config: TrackDuckingConfig
): number {
  if (!config.enabled || dialogueIntervals.length === 0) {
    return 1.0;
  }

  const reductionDb = Math.max(-30, Math.min(-3, config.reductionDb));
  const minGain = Math.pow(10, reductionDb / 20);

  const attackSec = Math.max(0.001, config.attackMs / 1000);
  const releaseSec = Math.max(0.001, config.releaseMs / 1000);

  let currentGain = 1.0;

  for (const interval of dialogueIntervals) {
    // 1. Inside dialogue interval
    if (timeSec >= interval.start && timeSec <= interval.end) {
      return minGain;
    }

    // 2. In attack ramp before dialogue interval
    if (timeSec < interval.start && timeSec >= interval.start - attackSec) {
      const distBefore = interval.start - timeSec;
      const t = distBefore / attackSec; // 1 at start of attack ramp, 0 at interval start
      const rampGain = minGain + t * (1.0 - minGain);
      currentGain = Math.min(currentGain, rampGain);
    }

    // 3. In release ramp after dialogue interval
    if (timeSec > interval.end && timeSec <= interval.end + releaseSec) {
      const distAfter = timeSec - interval.end;
      const t = distAfter / releaseSec; // 0 at interval end, 1 at end of release ramp
      const rampGain = minGain + t * (1.0 - minGain);
      currentGain = Math.min(currentGain, rampGain);
    }
  }

  return Math.max(minGain, Math.min(1.0, currentGain));
}
