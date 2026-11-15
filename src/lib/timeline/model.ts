/**
 * Pure functions that operate on timeline data.
 *
 * Rules:
 * - No React imports, no browser-only APIs
 * - All functions return new objects (immutable updates) — arguments are never mutated
 * - ID generation uses crypto.randomUUID() (Node 15+ and all modern browsers)
 * - Fully testable in Node.js
 */

import type {
  TimelineDocument,
  TimelineTrack,
  TimelineClip,
  TextOverlay,
} from "../../types/timeline.ts";

// ─── Factories ───────────────────────────────────────────────────────────────

/**
 * Creates a new, empty timeline with one video track and one audio track.
 */
export function createTimeline(): TimelineDocument {
  const videoTrackId = crypto.randomUUID();
  const audioTrackId = crypto.randomUUID();

  const videoTrack: TimelineTrack = {
    id: videoTrackId,
    type: "video",
    name: "Video 1",
    order: 0,
    muted: false,
    clips: [],
  };

  const audioTrack: TimelineTrack = {
    id: audioTrackId,
    type: "audio",
    name: "Audio 1",
    order: 1,
    muted: false,
    clips: [],
  };

  return {
    id: crypto.randomUUID(),
    tracks: [videoTrack, audioTrack],
    textOverlays: [],
    settings: {},
  };
}

/**
 * Creates a new clip. Does NOT add it to the timeline — use addClipToTrack.
 */
export function createClip(
  assetId: string,
  trackId: string,
  startTime: number,
  sourceIn: number,
  sourceOut: number,
): TimelineClip {
  return {
    id: crypto.randomUUID(),
    assetId,
    trackId,
    startTime,
    sourceIn,
    sourceOut,
    volume: 1,
    muted: false,
  };
}

/**
 * Creates a new text overlay with sensible defaults.
 * Position defaults to center-bottom area.
 */
export function createTextOverlay(
  startTime: number,
  endTime: number,
): TextOverlay {
  return {
    id: crypto.randomUUID(),
    text: "",
    startTime,
    endTime,
    x: 0.1,
    y: 0.8,
    fontSize: 32,
    color: "#ffffff",
    align: "center",
  };
}

// ─── Clip operations ─────────────────────────────────────────────────────────

/**
 * Adds a clip to a track. Returns a new TimelineDocument.
 * Throws if the trackId does not exist in the timeline.
 */
export function addClipToTrack(
  timeline: TimelineDocument,
  trackId: string,
  clip: TimelineClip,
): TimelineDocument {
  const trackExists = timeline.tracks.some((t) => t.id === trackId);
  if (!trackExists) {
    throw new Error(`Track "${trackId}" not found in timeline`);
  }

  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === trackId
        ? { ...track, clips: [...track.clips, clip] }
        : track,
    ),
  };
}

/**
 * Removes a clip by ID from whichever track it lives on.
 * No-ops if the clip does not exist.
 */
export function removeClip(
  timeline: TimelineDocument,
  clipId: string,
): TimelineDocument {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((c) => c.id !== clipId),
    })),
  };
}

/**
 * Moves a clip to a new startTime. Clamps to >= 0.
 * No-ops if the clip does not exist.
 */
export function moveClip(
  timeline: TimelineDocument,
  clipId: string,
  newStartTime: number,
): TimelineDocument {
  const clamped = Math.max(0, newStartTime);
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) =>
        c.id === clipId ? { ...c, startTime: clamped } : c,
      ),
    })),
  };
}

/**
 * Trims the in-point of a clip. Both sourceIn and startTime are updated
 * together (the out-point stays the same, so the clip gets shorter).
 * Throws if newSourceIn >= clip.sourceOut.
 */
export function trimClipStart(
  timeline: TimelineDocument,
  clipId: string,
  newSourceIn: number,
  newStartTime: number,
): TimelineDocument {
  const clip = findClip(timeline, clipId);
  if (!clip) return timeline;

  if (newSourceIn >= clip.sourceOut) {
    throw new Error(
      `trimClipStart: newSourceIn (${newSourceIn}) must be less than sourceOut (${clip.sourceOut})`,
    );
  }

  const clampedStartTime = Math.max(0, newStartTime);

  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) =>
        c.id === clipId
          ? { ...c, sourceIn: newSourceIn, startTime: clampedStartTime }
          : c,
      ),
    })),
  };
}

/**
 * Trims the out-point of a clip. startTime and sourceIn stay the same.
 * Throws if newSourceOut <= clip.sourceIn.
 */
export function trimClipEnd(
  timeline: TimelineDocument,
  clipId: string,
  newSourceOut: number,
): TimelineDocument {
  const clip = findClip(timeline, clipId);
  if (!clip) return timeline;

  if (newSourceOut <= clip.sourceIn) {
    throw new Error(
      `trimClipEnd: newSourceOut (${newSourceOut}) must be greater than sourceIn (${clip.sourceIn})`,
    );
  }

  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) =>
        c.id === clipId ? { ...c, sourceOut: newSourceOut } : c,
      ),
    })),
  };
}

/**
 * Splits a clip at a given source-time position into two adjacent clips.
 * - The first clip covers [sourceIn, splitAtSourceTime)
 * - The second clip starts immediately after the first on the timeline and
 *   covers [splitAtSourceTime, sourceOut)
 *
 * Returns null when splitAtSourceTime is strictly outside (sourceIn, sourceOut).
 */
export function splitClip(
  timeline: TimelineDocument,
  clipId: string,
  splitAtSourceTime: number,
): TimelineDocument | null {
  const clip = findClip(timeline, clipId);
  if (!clip) return null;

  // Must be strictly inside (not at the edges)
  if (
    splitAtSourceTime <= clip.sourceIn ||
    splitAtSourceTime >= clip.sourceOut
  ) {
    return null;
  }

  const firstDuration = splitAtSourceTime - clip.sourceIn;

  const firstClip: TimelineClip = {
    ...clip,
    sourceOut: splitAtSourceTime,
  };

  const secondClip: TimelineClip = {
    ...clip,
    id: crypto.randomUUID(),
    sourceIn: splitAtSourceTime,
    // sourceOut stays unchanged
    startTime: clip.startTime + firstDuration,
  };

  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => {
      if (!track.clips.some((c) => c.id === clipId)) return track;
      return {
        ...track,
        clips: track.clips.flatMap((c) =>
          c.id === clipId ? [firstClip, secondClip] : [c],
        ),
      };
    }),
  };
}

/**
 * Duplicates a clip, placing the copy at newStartTime.
 * No-ops if the clip does not exist.
 */
export function duplicateClip(
  timeline: TimelineDocument,
  clipId: string,
  newStartTime: number,
): TimelineDocument {
  const clip = findClip(timeline, clipId);
  if (!clip) return timeline;

  const copy: TimelineClip = {
    ...clip,
    id: crypto.randomUUID(),
    startTime: Math.max(0, newStartTime),
  };

  return addClipToTrack(timeline, clip.trackId, copy);
}

// ─── Text overlay operations ─────────────────────────────────────────────────

/**
 * Ensures that across the timeline, at any point in time there is at most
 * ONE text overlay active. If overlays collide or overlap, their boundaries
 * are adjusted or resolved so intervals are strictly non-overlapping.
 */
export function resolveTextOverlayCollisions(overlays: TextOverlay[]): TextOverlay[] {
  if (overlays.length <= 1) return overlays;

  // Sort primarily by startTime, secondary by text/non-caption priority, then id
  const sorted = [...overlays].sort((a, b) => {
    if (Math.abs(a.startTime - b.startTime) > 0.001) {
      return a.startTime - b.startTime;
    }
    if (a.overlayType !== b.overlayType) {
      return a.overlayType === "title" ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });

  const resolved: TextOverlay[] = [];

  for (const current of sorted) {
    if (current.endTime <= current.startTime) continue;

    if (resolved.length === 0) {
      resolved.push({ ...current });
      continue;
    }

    const prev = resolved[resolved.length - 1];

    if (current.startTime < prev.endTime) {
      // Overlap detected!
      if (current.startTime <= prev.startTime + 0.01) {
        // Virtually same start time: keep the current one (higher priority)
        resolved[resolved.length - 1] = {
          ...current,
          endTime: Math.max(prev.endTime, current.endTime),
        };
      } else {
        // Truncate previous overlay so it ends exactly where current begins
        const newPrevEnd = Number(current.startTime.toFixed(2));
        if (newPrevEnd > prev.startTime + 0.05) {
          prev.endTime = newPrevEnd;
          resolved.push({ ...current });
        } else {
          // Previous was too short after truncation; replace with current
          resolved[resolved.length - 1] = { ...current };
        }
      }
    } else {
      resolved.push({ ...current });
    }
  }

  return resolved;
}

/** Adds a text overlay. Ensures non-overlapping invariant across timeline. */
export function addTextOverlay(
  timeline: TimelineDocument,
  overlay: TextOverlay,
): TimelineDocument {
  return {
    ...timeline,
    textOverlays: resolveTextOverlayCollisions([...timeline.textOverlays, overlay]),
  };
}

/** Removes a text overlay by ID. No-ops if not found. */
export function removeTextOverlay(
  timeline: TimelineDocument,
  overlayId: string,
): TimelineDocument {
  return {
    ...timeline,
    textOverlays: timeline.textOverlays.filter((o) => o.id !== overlayId),
  };
}

/**
 * Applies a partial patch to a text overlay.
 * No-ops if the overlay does not exist.
 */
export function updateTextOverlay(
  timeline: TimelineDocument,
  overlayId: string,
  patch: Partial<Omit<TextOverlay, "id">>,
): TimelineDocument {
  const updated = timeline.textOverlays.map((o) =>
    o.id === overlayId ? { ...o, ...patch } : o,
  );
  return {
    ...timeline,
    textOverlays: resolveTextOverlayCollisions(updated),
  };
}

/**
 * Moves a text overlay to a new time range.
 * No-ops if the overlay does not exist.
 */
export function moveTextOverlay(
  timeline: TimelineDocument,
  overlayId: string,
  startTime: number,
  endTime: number,
): TimelineDocument {
  const updated = timeline.textOverlays.map((o) =>
    o.id === overlayId ? { ...o, startTime, endTime } : o,
  );
  return {
    ...timeline,
    textOverlays: resolveTextOverlayCollisions(updated),
  };
}

// ─── Query functions ─────────────────────────────────────────────────────────

/**
 * Returns the first video-track clip that covers the given timeline time.
 * A clip covers [startTime, startTime + (sourceOut - sourceIn)).
 */
export function getActiveClipAtTime(
  timeline: TimelineDocument,
  time: number,
): TimelineClip | null {
  const visibleVideoTracks = [...timeline.tracks]
    .filter((t) => t.type === "video" && !t.hidden)
    .sort((a, b) => a.order - b.order);

  for (const track of visibleVideoTracks) {
    for (const clip of track.clips) {
      const duration = clip.sourceOut - clip.sourceIn;
      const endTime = clip.startTime + duration;
      if (time >= clip.startTime && time < endTime) {
        return clip;
      }
    }
  }
  return null;
}

/**
 * Returns active text overlay at the given timeline time.
 * Invariant: at any particular moment or second, at most a single text overlay is active.
 */
export function getActiveTextOverlaysAtTime(
  timeline: TimelineDocument,
  time: number,
): TextOverlay[] {
  const active = timeline.textOverlays.filter(
    (o) => time >= o.startTime && time < o.endTime,
  );
  return active.slice(0, 1);
}

/**
 * Returns the total timeline duration: the maximum end time across all clips
 * and text overlays. Returns 0 for an empty timeline.
 */
export function getTimelineDuration(timeline: TimelineDocument): number {
  let max = 0;

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const end = clip.startTime + (clip.sourceOut - clip.sourceIn);
      if (end > max) max = end;
    }
  }

  for (const overlay of timeline.textOverlays) {
    if (overlay.endTime > max) max = overlay.endTime;
  }

  return max;
}

/**
 * Validates a TimelineDocument. Returns an array of error message strings.
 * An empty array means the timeline is valid.
 */
export function validateTimeline(timeline: TimelineDocument): string[] {
  const errors: string[] = [];

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const prefix = `Clip "${clip.id}"`;

      if (clip.startTime < 0) {
        errors.push(`${prefix}: startTime must be >= 0 (got ${clip.startTime})`);
      }
      if (clip.sourceIn < 0) {
        errors.push(`${prefix}: sourceIn must be >= 0 (got ${clip.sourceIn})`);
      }
      if (clip.sourceOut <= clip.sourceIn) {
        errors.push(
          `${prefix}: sourceOut (${clip.sourceOut}) must be > sourceIn (${clip.sourceIn})`,
        );
      }
      const duration = clip.sourceOut - clip.sourceIn;
      if (duration <= 0) {
        errors.push(`${prefix}: duration must be > 0 (got ${duration})`);
      }
      if (!clip.assetId) {
        errors.push(`${prefix}: assetId must be a non-empty string`);
      }
      if (!clip.trackId) {
        errors.push(`${prefix}: trackId must be a non-empty string`);
      }
    }
  }

  for (const overlay of timeline.textOverlays) {
    const prefix = `TextOverlay "${overlay.id}"`;
    if (overlay.endTime <= overlay.startTime) {
      errors.push(
        `${prefix}: endTime (${overlay.endTime}) must be > startTime (${overlay.startTime})`,
      );
    }
  }

  return errors;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function findClip(
  timeline: TimelineDocument,
  clipId: string,
): TimelineClip | undefined {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}
