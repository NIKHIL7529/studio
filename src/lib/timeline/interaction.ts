/**
 * Timeline interaction utilities (snapping, keyboard guards).
 *
 * Pure functions in TypeScript so they are testable in Node.js without JSX transforms.
 */

import type { TimelineDocument } from "../../types/timeline.ts";

/**
 * Guard to prevent editor keyboard shortcuts from firing when the user
 * is typing into an input, textarea, or contentEditable element.
 * Accepts either a KeyboardEvent/Event or the target element directly.
 */
export function isInputTarget(
  targetOrEvent:
    | KeyboardEvent
    | Event
    | { target?: { tagName?: string; isContentEditable?: boolean } | null; tagName?: string; isContentEditable?: boolean }
    | null
    | undefined
): boolean {
  if (!targetOrEvent) return false;
  const el = (
    "target" in targetOrEvent && targetOrEvent.target !== undefined
      ? targetOrEvent.target
      : targetOrEvent
  ) as { tagName?: string; isContentEditable?: boolean } | null;

  if (!el) return false;
  const tag = (el.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * Computes all snapping candidate points along the timeline:
 * - 0 (timeline origin)
 * - Current playhead position
 * - Every clip's start and end points across all tracks (excluding clip currently being moved)
 * - Every text overlay's start and end points
 */
export function computeSnapTargets(
  timeline: TimelineDocument,
  currentTime: number,
  excludeClipId?: string
): number[] {
  const targets = new Set<number>();
  targets.add(0);
  if (Number.isFinite(currentTime) && currentTime >= 0) {
    targets.add(currentTime);
  }

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue;
      targets.add(clip.startTime);
      targets.add(clip.startTime + (clip.sourceOut - clip.sourceIn));
    }
  }

  for (const overlay of timeline.textOverlays) {
    targets.add(overlay.startTime);
    targets.add(overlay.endTime);
  }

  return Array.from(targets).sort((a, b) => a - b);
}

/**
 * Snaps a target timeline time to the nearest snap candidate if within threshold.
 * Returns the original time if no candidate is within threshold.
 */
export function snapTimeToTargets(
  time: number,
  candidates: number[],
  thresholdSeconds: number
): number {
  let closest = time;
  let minDiff = thresholdSeconds;

  for (const target of candidates) {
    const diff = Math.abs(time - target);
    if (diff <= minDiff) {
      minDiff = diff;
      closest = target;
    }
  }

  return Math.max(0, closest);
}
