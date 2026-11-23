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
  TimelineTransition,
  TrackType,
  TrackAudioRole,
  TrackDuckingConfig,
  ColorAdjustments,
} from "../../types/timeline.ts";
import { DEFAULT_COLOR_ADJUSTMENTS } from "../color/colorPresets.ts";

export const DEFAULT_TRACK_DUCKING: TrackDuckingConfig = {
  enabled: false,
  reductionDb: -12,
  attackMs: 150,
  releaseMs: 400,
};

export function createTrack(
  type: TrackType,
  name: string,
  order: number,
  audioRole?: TrackAudioRole
): TimelineTrack {
  return {
    id: crypto.randomUUID(),
    type,
    name,
    order,
    locked: false,
    muted: false,
    hidden: false,
    clips: [],
    audioRole: audioRole || (type === "video" ? "dialogue" : "general"),
    ducking: { ...DEFAULT_TRACK_DUCKING },
  };
}

// ─── Factories ───────────────────────────────────────────────────────────────

/**
 * Creates a new, empty timeline with one video track and one audio track.
 */
export function createTimeline(): TimelineDocument {
  const videoTrack = createTrack("video", "Video 1", 0, "dialogue");
  const audioTrack = createTrack("audio", "Audio 1", 1, "general");

  return {
    id: crypto.randomUUID(),
    tracks: [videoTrack, audioTrack],
    textOverlays: [],
    markers: [],
    settings: {},
  };
}

/**
 * Calculates the duration of a clip on the timeline in seconds.
 * For freeze frame clips, duration equals sourceOut - sourceIn (playbackRate 1.0).
 * For normal clips, duration equals (sourceOut - sourceIn) / playbackRate.
 */
export function getClipTimelineDuration(clip: TimelineClip): number {
  if (clip.freezeFrameSourceTime !== null) {
    return clip.sourceOut - clip.sourceIn;
  }
  const rate = typeof clip.playbackRate === "number" && clip.playbackRate > 0 ? clip.playbackRate : 1.0;
  return (clip.sourceOut - clip.sourceIn) / rate;
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
    fitMode: "fit",
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    flipH: false,
    flipV: false,
    fadeIn: 0,
    fadeOut: 0,
    audioDetached: false,
    playbackRate: 1.0,
    preservePitch: true,
    freezeFrameSourceTime: null,
    color: { ...DEFAULT_COLOR_ADJUSTMENTS },
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
    presetId: "classic",
    activeWordColor: "#facc15",
  };
}

// ─── Clip operations ─────────────────────────────────────────────────────────

/**
 * Adds a clip to a track. Returns a new TimelineDocument.
 * Throws if the trackId does not exist in the timeline.
 * If the track is locked, returns the timeline unchanged.
 */
export function addClipToTrack(
  timeline: TimelineDocument,
  trackId: string,
  clip: TimelineClip,
): TimelineDocument {
  const targetTrack = timeline.tracks.find((t) => t.id === trackId);
  if (!targetTrack) {
    throw new Error(`Track "${trackId}" not found in timeline`);
  }
  if (targetTrack.locked) {
    return timeline;
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
 * If the clip's track is locked, returns timeline unchanged.
 * No-ops if the clip does not exist.
 */
export function removeClip(
  timeline: TimelineDocument,
  clipId: string,
): TimelineDocument {
  const foundTrack = timeline.tracks.find((track) =>
    track.clips.some((c) => c.id === clipId),
  );
  if (!foundTrack || foundTrack.locked) {
    return timeline;
  }

  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((c) => c.id !== clipId),
    })),
  };
}

/**
 * Moves a clip to a new startTime, optionally moving to targetTrackId.
 * Enforces track lock, track compatibility, clamping >= 0, and non-overlapping collision safety.
 * No-ops if the clip does not exist or target/source track is locked.
 */
export function moveClip(
  timeline: TimelineDocument,
  clipId: string,
  newStartTime: number,
  targetTrackId?: string,
): TimelineDocument {
  const sourceTrack = timeline.tracks.find((t) =>
    t.clips.some((c) => c.id === clipId),
  );
  if (!sourceTrack || sourceTrack.locked) return timeline;

  const clip = sourceTrack.clips.find((c) => c.id === clipId);
  if (!clip) return timeline;

  let destTrack = sourceTrack;
  if (targetTrackId && targetTrackId !== sourceTrack.id) {
    const foundDest = timeline.tracks.find((t) => t.id === targetTrackId);
    if (!foundDest || foundDest.locked || foundDest.type !== sourceTrack.type) {
      return timeline;
    }
    destTrack = foundDest;
  }

  const duration = getClipTimelineDuration(clip);
  let finalStartTime = Math.max(0, newStartTime);

  // Other clips on destination track
  const otherClips = destTrack.clips
    .filter((c) => c.id !== clipId)
    .sort((a, b) => a.startTime - b.startTime);

  for (const other of otherClips) {
    const otherDuration = getClipTimelineDuration(other);
    const otherEnd = other.startTime + otherDuration;

    // Check collision / overlap
    if (
      finalStartTime < otherEnd - 0.0001 &&
      finalStartTime + duration > other.startTime + 0.0001
    ) {
      if (clip.trackId === destTrack.id && clip.startTime <= other.startTime) {
        finalStartTime = Math.max(0, other.startTime - duration);
      } else {
        finalStartTime = otherEnd;
      }
    }
  }

  const updatedClip: TimelineClip = {
    ...clip,
    trackId: destTrack.id,
    startTime: finalStartTime,
  };

  if (destTrack.id === sourceTrack.id) {
    return {
      ...timeline,
      tracks: timeline.tracks.map((track) =>
        track.id === sourceTrack.id
          ? {
            ...track,
            clips: track.clips
              .map((c) => (c.id === clipId ? updatedClip : c))
              .sort((a, b) => a.startTime - b.startTime),
          }
          : track,
      ),
    };
  }

  // Moved across tracks
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => {
      if (track.id === sourceTrack.id) {
        return {
          ...track,
          clips: track.clips.filter((c) => c.id !== clipId),
        };
      }
      if (track.id === destTrack.id) {
        return {
          ...track,
          clips: [...track.clips, updatedClip].sort(
            (a, b) => a.startTime - b.startTime,
          ),
        };
      }
      return track;
    }),
  };
}

/**
 * Trims the in-point of a clip. Both sourceIn and startTime are updated
 * together (the out-point stays the same, so the clip gets shorter).
 * Returns timeline unchanged if track is locked.
 * Throws if newSourceIn >= clip.sourceOut.
 */
export function trimClipStart(
  timeline: TimelineDocument,
  clipId: string,
  newSourceIn: number,
  newStartTime: number,
): TimelineDocument {
  const foundTrack = timeline.tracks.find((track) =>
    track.clips.some((c) => c.id === clipId),
  );
  if (!foundTrack || foundTrack.locked) return timeline;

  const clip = foundTrack.clips.find((c) => c.id === clipId);
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
 * Returns timeline unchanged if track is locked.
 * Throws if newSourceOut <= clip.sourceIn.
 */
export function trimClipEnd(
  timeline: TimelineDocument,
  clipId: string,
  newSourceOut: number,
): TimelineDocument {
  const foundTrack = timeline.tracks.find((track) =>
    track.clips.some((c) => c.id === clipId),
  );
  if (!foundTrack || foundTrack.locked) return timeline;

  const clip = foundTrack.clips.find((c) => c.id === clipId);
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
 * Returns null if track is locked or when splitAtSourceTime is strictly outside (sourceIn, sourceOut).
 */
export function splitClip(
  timeline: TimelineDocument,
  clipId: string,
  splitAtSourceTime: number,
): TimelineDocument | null {
  const foundTrack = timeline.tracks.find((track) =>
    track.clips.some((c) => c.id === clipId),
  );
  if (!foundTrack || foundTrack.locked) return null;

  const clip = foundTrack.clips.find((c) => c.id === clipId);
  if (!clip) return null;

  // Must be strictly inside (not at the edges)
  if (
    splitAtSourceTime <= clip.sourceIn ||
    splitAtSourceTime >= clip.sourceOut
  ) {
    return null;
  }

  const rate = typeof clip.playbackRate === "number" && clip.playbackRate > 0 ? clip.playbackRate : 1.0;
  const firstDuration = (splitAtSourceTime - clip.sourceIn) / rate;

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
      const duration = getClipTimelineDuration(clip);
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
      const end = clip.startTime + getClipTimelineDuration(clip);
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

  if (!Array.isArray(timeline.markers)) {
    errors.push("timeline.markers must be an array");
  } else {
    for (const marker of timeline.markers) {
      const prefix = `Marker "${marker.id}"`;
      if (!marker.id || typeof marker.id !== "string") {
        errors.push(`${prefix}: id must be a non-empty string`);
      }
      if (typeof marker.time !== "number" || marker.time < 0 || !Number.isFinite(marker.time)) {
        errors.push(`${prefix}: time must be a non-negative number`);
      }
      if (typeof marker.label !== "string") {
        errors.push(`${prefix}: label must be a string`);
      }
      if (typeof marker.color !== "string" || !marker.color.trim()) {
        errors.push(`${prefix}: color must be a non-empty string`);
      }
    }
  }

    for (const track of timeline.tracks) {
    const trackPrefix = `Track "${track.id}"`;
    if (typeof track.locked !== "boolean") {
      errors.push(`${trackPrefix}: locked must be a boolean`);
    }
    if (typeof track.muted !== "boolean") {
      errors.push(`${trackPrefix}: muted must be a boolean`);
    }
    if (typeof track.hidden !== "boolean") {
      errors.push(`${trackPrefix}: hidden must be a boolean`);
    }
    const validRoles = ["dialogue", "music", "sfx", "general"];
    if (!validRoles.includes(track.audioRole)) {
      errors.push(`${trackPrefix}: audioRole must be one of ${validRoles.join(", ")} (got ${track.audioRole})`);
    }
    if (!track.ducking || typeof track.ducking !== "object") {
      errors.push(`${trackPrefix}: ducking must be an object`);
    } else {
      if (typeof track.ducking.enabled !== "boolean") {
        errors.push(`${trackPrefix}: ducking.enabled must be a boolean`);
      }
      if (
        typeof track.ducking.reductionDb !== "number" ||
        !Number.isFinite(track.ducking.reductionDb) ||
        track.ducking.reductionDb < -30 ||
        track.ducking.reductionDb > -3
      ) {
        errors.push(
          `${trackPrefix}: ducking.reductionDb must be a number between -30 and -3 (got ${track.ducking.reductionDb})`
        );
      }
      if (
        typeof track.ducking.attackMs !== "number" ||
        !Number.isFinite(track.ducking.attackMs) ||
        track.ducking.attackMs < 20 ||
        track.ducking.attackMs > 1000
      ) {
        errors.push(
          `${trackPrefix}: ducking.attackMs must be a number between 20 and 1000 (got ${track.ducking.attackMs})`
        );
      }
      if (
        typeof track.ducking.releaseMs !== "number" ||
        !Number.isFinite(track.ducking.releaseMs) ||
        track.ducking.releaseMs < 50 ||
        track.ducking.releaseMs > 2000
      ) {
        errors.push(
          `${trackPrefix}: ducking.releaseMs must be a number between 50 and 2000 (got ${track.ducking.releaseMs})`
        );
      }
    }

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

      const validFitModes = ["fit", "fill", "blur-bg"];
      if (!validFitModes.includes(clip.fitMode)) {
        errors.push(`${prefix}: fitMode must be one of ${validFitModes.join(", ")}`);
      }
      if (!clip.crop || typeof clip.crop !== "object") {
        errors.push(`${prefix}: crop must be an object with top, right, bottom, left`);
      } else {
        const { top, right, bottom, left } = clip.crop;
        for (const [side, val] of Object.entries({ top, right, bottom, left })) {
          if (typeof val !== "number" || !Number.isFinite(val) || val < 0 || val >= 0.5) {
            errors.push(`${prefix}: crop.${side} (${val}) must be a number between 0 and 0.45`);
          }
        }
      }
      if (typeof clip.flipH !== "boolean") {
        errors.push(`${prefix}: flipH must be a boolean`);
      }
      if (typeof clip.flipV !== "boolean") {
        errors.push(`${prefix}: flipV must be a boolean`);
      }
      if (typeof clip.fadeIn !== "number" || !Number.isFinite(clip.fadeIn) || clip.fadeIn < 0) {
        errors.push(`${prefix}: fadeIn must be >= 0`);
      }
      if (typeof clip.fadeOut !== "number" || !Number.isFinite(clip.fadeOut) || clip.fadeOut < 0) {
        errors.push(`${prefix}: fadeOut must be >= 0`);
      }
      if (typeof clip.audioDetached !== "boolean") {
        errors.push(`${prefix}: audioDetached must be a boolean`);
      }
      if (typeof clip.playbackRate !== "number" || !Number.isFinite(clip.playbackRate) || clip.playbackRate < 0.25 || clip.playbackRate > 4.0) {
        errors.push(`${prefix}: playbackRate must be a number between 0.25 and 4.0 (got ${clip.playbackRate})`);
      }
      if (typeof clip.preservePitch !== "boolean") {
        errors.push(`${prefix}: preservePitch must be a boolean`);
      }
      if (clip.freezeFrameSourceTime !== null) {
        if (typeof clip.freezeFrameSourceTime !== "number" || !Number.isFinite(clip.freezeFrameSourceTime) || clip.freezeFrameSourceTime < 0) {
          errors.push(`${prefix}: freezeFrameSourceTime must be null or a non-negative number (got ${clip.freezeFrameSourceTime})`);
        }
      }
      if (!clip.color || typeof clip.color !== "object") {
        errors.push(`${prefix}: color must be an object`);
      } else {
        const validPresets = ["none", "vivid", "warm", "cool", "bw", "cinematic"];
        if (!validPresets.includes(clip.color.presetId)) {
          errors.push(`${prefix}: color.presetId must be one of ${validPresets.join(", ")} (got ${clip.color.presetId})`);
        }
        for (const prop of ["brightness", "contrast", "saturation", "exposure", "temperature"] as const) {
          const val = clip.color[prop];
          if (typeof val !== "number" || !Number.isFinite(val) || val < -100 || val > 100) {
            errors.push(`${prefix}: color.${prop} must be a number between -100 and 100 (got ${val})`);
          }
        }
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
    const validPresets = ["classic", "bold-karaoke", "pill", "minimal", "custom"];
    if (!validPresets.includes(overlay.presetId)) {
      errors.push(`${prefix}: presetId must be one of ${validPresets.join(", ")}`);
    }
    if (typeof overlay.activeWordColor !== "string" || !overlay.activeWordColor.trim()) {
      errors.push(`${prefix}: activeWordColor must be a non-empty string`);
    }
  }

  if (Array.isArray(timeline.transitions)) {
    for (const trans of timeline.transitions) {
      const prefix = `Transition "${trans.id}"`;
      if (trans.duration <= 0) {
        errors.push(`${prefix}: duration (${trans.duration}) must be > 0`);
      }
      if (trans.editPoint < 0) {
        errors.push(`${prefix}: editPoint (${trans.editPoint}) must be >= 0`);
      }
      if (!trans.trackId) {
        errors.push(`${prefix}: trackId must be a non-empty string`);
      } else if (!timeline.tracks.some((t) => t.id === trans.trackId)) {
        errors.push(`${prefix}: references non-existent track "${trans.trackId}"`);
      }
    }
  }

  return errors;
}

// ─── Transition Operations ───────────────────────────────────────────────────

export function addTransition(
  timeline: TimelineDocument,
  transition: TimelineTransition
): TimelineDocument {
  const transitions = timeline.transitions || [];
  // Remove any existing transition occupying the exact same edit point on the same track
  const filtered = transitions.filter(
    (t) => !(t.trackId === transition.trackId && Math.abs(t.editPoint - transition.editPoint) < 0.05)
  );
  return {
    ...timeline,
    transitions: [...filtered, transition],
  };
}

export function removeTransition(
  timeline: TimelineDocument,
  transitionId: string
): TimelineDocument {
  return {
    ...timeline,
    transitions: (timeline.transitions || []).filter((t) => t.id !== transitionId),
  };
}

export function updateTransition(
  timeline: TimelineDocument,
  transitionId: string,
  patch: Partial<TimelineTransition>
): TimelineDocument {
  return {
    ...timeline,
    transitions: (timeline.transitions || []).map((t) =>
      t.id === transitionId ? { ...t, ...patch } : t
    ),
  };
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

// ─── Speed & Freeze Frame Operations ──────────────────────────────────────────

/**
 * Adjusts playback speed of a clip within [0.25, 4.0].
 * Keeps sourceIn and sourceOut fixed while recomputing timeline duration.
 * If ripple === true, shifts subsequent clips by deltaDuration;
 * otherwise resolves collisions cleanly without overlapping neighbors.
 */
export function setClipSpeed(
  timeline: TimelineDocument,
  clipId: string,
  playbackRate: number,
  options?: { preservePitch?: boolean; ripple?: boolean }
): TimelineDocument {
  const foundTrack = timeline.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  if (!foundTrack || foundTrack.locked) return timeline;

  const clip = foundTrack.clips.find((c) => c.id === clipId);
  if (!clip) return timeline;

  const clampedRate = Math.max(0.25, Math.min(4.0, playbackRate));
  const preservePitch = options?.preservePitch ?? clip.preservePitch ?? true;
  const ripple = options?.ripple ?? false;

  const oldDuration = getClipTimelineDuration(clip);
  const updatedClip: TimelineClip = {
    ...clip,
    playbackRate: clampedRate,
    preservePitch,
  };
  const newDuration = getClipTimelineDuration(updatedClip);
  const deltaDuration = newDuration - oldDuration;

  let updatedClips: TimelineClip[];

  if (ripple) {
    updatedClips = foundTrack.clips.map((c) => {
      if (c.id === clipId) return updatedClip;
      if (c.startTime > clip.startTime + 0.0001) {
        return {
          ...c,
          startTime: Math.max(0, c.startTime + deltaDuration),
        };
      }
      return c;
    });
  } else {
    // Non-ripple: resolve collisions cleanly without overlapping neighbors
    const sorted = foundTrack.clips
      .map((c) => (c.id === clipId ? updatedClip : c))
      .sort((a, b) => a.startTime - b.startTime);

    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i];
      const next = sorted[i + 1];
      const curDur = getClipTimelineDuration(cur);
      const curEnd = cur.startTime + curDur;
      if (next.startTime < curEnd - 0.0001) {
        sorted[i + 1] = {
          ...next,
          startTime: curEnd,
        };
      }
    }
    updatedClips = sorted;
  }

  return {
    ...timeline,
    tracks: timeline.tracks.map((t) =>
      t.id === foundTrack.id ? { ...t, clips: updatedClips.sort((a, b) => a.startTime - b.startTime) } : t
    ),
  };
}

/**
 * Inserts a freeze frame holding the source frame at playheadTime for durationSec (default 2.0s).
 * Enforces track lock check and requires a video clip covering playheadTime.
 * Splits the clip at playheadTime (if strictly inside), inserts a new freeze clip (audioDetached: true),
 * and shifts the trailing clip + subsequent clips right by durationSec.
 */
export function insertFreezeFrameAtPlayhead(
  timeline: TimelineDocument,
  clipId: string,
  playheadTime: number,
  durationSec = 2.0
): TimelineDocument {
  const foundTrack = timeline.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  if (!foundTrack || foundTrack.locked || foundTrack.type !== "video") return timeline;

  const clip = foundTrack.clips.find((c) => c.id === clipId);
  if (!clip) return timeline;

  const clipDuration = getClipTimelineDuration(clip);
  const clipEnd = clip.startTime + clipDuration;
  if (playheadTime < clip.startTime - 0.0001 || playheadTime > clipEnd + 0.0001) {
    return timeline;
  }

  const offset = playheadTime - clip.startTime;
  const freezeSourceTime = clip.freezeFrameSourceTime !== null
    ? clip.freezeFrameSourceTime
    : clip.sourceIn + offset * (clip.playbackRate || 1.0);

  const freezeClip: TimelineClip = {
    id: crypto.randomUUID(),
    assetId: clip.assetId,
    trackId: foundTrack.id,
    startTime: playheadTime,
    sourceIn: 0,
    sourceOut: durationSec,
    volume: 1.0,
    muted: true,
    fitMode: clip.fitMode,
    crop: { ...clip.crop },
    flipH: clip.flipH,
    flipV: clip.flipV,
    fadeIn: 0,
    fadeOut: 0,
    audioDetached: true,
    playbackRate: 1.0,
    preservePitch: true,
    freezeFrameSourceTime: freezeSourceTime,
    transform: clip.transform ? { ...clip.transform } : undefined,
    color: clip.color ? { ...clip.color } : { ...DEFAULT_COLOR_ADJUSTMENTS },
  };

  const isStrictlyInside = playheadTime > clip.startTime + 0.001 && playheadTime < clipEnd - 0.001;
  const newClips: TimelineClip[] = [];

  if (isStrictlyInside) {
    const firstClip: TimelineClip = {
      ...clip,
      sourceOut: freezeSourceTime,
    };
    const trailingClip: TimelineClip = {
      ...clip,
      id: crypto.randomUUID(),
      startTime: playheadTime + durationSec,
      sourceIn: freezeSourceTime,
    };

    for (const c of foundTrack.clips) {
      if (c.id === clipId) {
        newClips.push(firstClip, freezeClip, trailingClip);
      } else if (c.startTime > clip.startTime + 0.0001) {
        newClips.push({
          ...c,
          startTime: c.startTime + durationSec,
        });
      } else {
        newClips.push(c);
      }
    }
  } else {
    // At boundary (start or end)
    for (const c of foundTrack.clips) {
      if (c.id === clipId) {
        if (Math.abs(playheadTime - clip.startTime) <= 0.001) {
          newClips.push(freezeClip, { ...c, startTime: c.startTime + durationSec });
        } else {
          newClips.push(c, freezeClip);
        }
      } else if (c.startTime >= playheadTime - 0.0001) {
        newClips.push({
          ...c,
          startTime: c.startTime + durationSec,
        });
      } else {
        newClips.push(c);
      }
    }
  }

  return {
    ...timeline,
    tracks: timeline.tracks.map((t) =>
      t.id === foundTrack.id ? { ...t, clips: newClips.sort((a, b) => a.startTime - b.startTime) } : t
    ),
  };
}

// ─── Color & Track Audio Helpers ─────────────────────────────────────────────

export function setClipColorAdjustments(
  timeline: TimelineDocument,
  clipId: string,
  color: ColorAdjustments
): TimelineDocument {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) =>
        clip.id === clipId ? { ...clip, color: { ...color } } : clip
      ),
    })),
  };
}

export function setTrackAudioRole(
  timeline: TimelineDocument,
  trackId: string,
  audioRole: TrackAudioRole
): TimelineDocument {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === trackId ? { ...track, audioRole } : track
    ),
  };
}

export function setTrackDucking(
  timeline: TimelineDocument,
  trackId: string,
  ducking: Partial<TrackDuckingConfig>
): TimelineDocument {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === trackId
        ? { ...track, ducking: { ...track.ducking, ...ducking } }
        : track
    ),
  };
}

