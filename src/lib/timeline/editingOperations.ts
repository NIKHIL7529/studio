/**
 * Advanced NLE Timeline Editing Operations.
 *
 * Rules:
 * - Pure functions returning new TimelineDocument instances (immutable).
 * - No React, DOM, or browser-only APIs.
 * - Microsecond precision preserved; timestamps >= 0.
 * - Handles ripple, roll, slip, slide, razor, lift, close gap, insert, overwrite,
 *   markers, grouping, linking, track management, and clipboard operations.
 * - Fully testable in Node.js.
 */

import type {
  TimelineDocument,
  TimelineTrack,
  TimelineClip,
  TimelineMarker,
  TrackType,
} from "../../types/timeline.ts";
import { splitClip, DEFAULT_TRACK_DUCKING } from "./model.ts";
import { DEFAULT_COLOR_ADJUSTMENTS } from "../color/colorPresets.ts";

export { moveClip, setClipSpeed, insertFreezeFrameAtPlayhead } from "./model.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deepCloneTimeline(timeline: TimelineDocument): TimelineDocument {
  return JSON.parse(JSON.stringify(timeline)) as TimelineDocument;
}

function findClipWithTrack(
  timeline: TimelineDocument,
  clipId: string
): { clip: TimelineClip; track: TimelineTrack } | null {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}

// ─── Ripple Trim Operations ───────────────────────────────────────────────────

export interface RippleTrimOptions {
  /** If true, ripple also affects all tracks marked with syncLocked=true */
  rippleSyncLocked?: boolean;
}

/**
 * Trims the in-point of a clip to newSourceIn, and ripples all downstream clips
 * (on this track and optionally sync-locked tracks) so that no gap is created.
 */
export function rippleTrimStart(
  timeline: TimelineDocument,
  clipId: string,
  newSourceIn: number,
  options: RippleTrimOptions = { rippleSyncLocked: true }
): TimelineDocument {
  const found = findClipWithTrack(timeline, clipId);
  if (!found || found.track.locked) return timeline;
  const { clip, track } = found;

  if (newSourceIn >= clip.sourceOut) {
    throw new Error(
      `rippleTrimStart: newSourceIn (${newSourceIn}) must be less than sourceOut (${clip.sourceOut})`
    );
  }
  if (newSourceIn < 0) {
    throw new Error(`rippleTrimStart: newSourceIn (${newSourceIn}) must be >= 0`);
  }

  const rate = clip.playbackRate > 0 ? clip.playbackRate : 1.0;
  const oldDuration = (clip.sourceOut - clip.sourceIn) / rate;
  const newDuration = (clip.sourceOut - newSourceIn) / rate;
  const durationDelta = newDuration - oldDuration; // negative if trimmed shorter, positive if extended

  // Determine affected track IDs
  const affectedTrackIds = new Set<string>();
  affectedTrackIds.add(track.id);

  if (options.rippleSyncLocked) {
    for (const t of timeline.tracks) {
      if (t.syncLocked && !t.locked) affectedTrackIds.add(t.id);
    }
  }

  const clipStartTime = clip.startTime;

  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => {
      if (!affectedTrackIds.has(t.id) || t.locked) return t;

      const isCurrentTrack = t.id === track.id;

      const updatedClips = t.clips.map((c) => {
        if (isCurrentTrack && c.id === clipId) {
          return {
            ...c,
            sourceIn: newSourceIn,
            // startTime remains unchanged; clip ends earlier/later
          };
        }

        // Shift subsequent clips that start after this clip
        if (c.startTime > clipStartTime + 0.0001) {
          return {
            ...c,
            startTime: Math.max(0, c.startTime + durationDelta),
          };
        }

        return c;
      });

      return { ...t, clips: updatedClips };
    }),
  };
}

/**
 * Trims the out-point of a clip to newSourceOut, and ripples all downstream clips
 * (on this track and optionally sync-locked tracks).
 */
export function rippleTrimEnd(
  timeline: TimelineDocument,
  clipId: string,
  newSourceOut: number,
  options: RippleTrimOptions = { rippleSyncLocked: true }
): TimelineDocument {
  const found = findClipWithTrack(timeline, clipId);
  if (!found || found.track.locked) return timeline;
  const { clip, track } = found;

  if (newSourceOut <= clip.sourceIn) {
    throw new Error(
      `rippleTrimEnd: newSourceOut (${newSourceOut}) must be greater than sourceIn (${clip.sourceIn})`
    );
  }

  const rate = clip.playbackRate > 0 ? clip.playbackRate : 1.0;
  const oldDuration = (clip.sourceOut - clip.sourceIn) / rate;
  const newDuration = (newSourceOut - clip.sourceIn) / rate;
  const durationDelta = newDuration - oldDuration;

  const clipEndTime = clip.startTime + oldDuration;

  const affectedTrackIds = new Set<string>();
  affectedTrackIds.add(track.id);

  if (options.rippleSyncLocked) {
    for (const t of timeline.tracks) {
      if (t.syncLocked && !t.locked) affectedTrackIds.add(t.id);
    }
  }

  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => {
      if (!affectedTrackIds.has(t.id) || t.locked) return t;

      const isCurrentTrack = t.id === track.id;

      const updatedClips = t.clips.map((c) => {
        if (isCurrentTrack && c.id === clipId) {
          return {
            ...c,
            sourceOut: newSourceOut,
          };
        }

        if (c.startTime >= clipEndTime - 0.001) {
          return {
            ...c,
            startTime: Math.max(0, c.startTime + durationDelta),
          };
        }

        return c;
      });

      return { ...t, clips: updatedClips };
    }),
  };
}

// ─── Roll Edit ────────────────────────────────────────────────────────────────

/**
 * Adjusts the shared boundary between two adjacent clips on the same track.
 * Total timeline duration remains unchanged:
 * - leftClip's sourceOut changes by editDelta
 * - rightClip's sourceIn changes by editDelta, and rightClip's startTime shifts by editDelta
 */
export function rollEdit(
  timeline: TimelineDocument,
  leftClipId: string,
  rightClipId: string,
  editDelta: number,
  maxLeftSourceDuration?: number
): TimelineDocument {
  if (Math.abs(editDelta) < 0.0001) return timeline;

  const leftFound = findClipWithTrack(timeline, leftClipId);
  const rightFound = findClipWithTrack(timeline, rightClipId);
  if (!leftFound || !rightFound) return timeline;
  if (leftFound.track.locked || rightFound.track.locked) return timeline;
  if (leftFound.track.id !== rightFound.track.id) {
    throw new Error("rollEdit requires both clips to be on the same track");
  }

  const left = leftFound.clip;
  const right = rightFound.clip;

  const newLeftSourceOut = left.sourceOut + editDelta;
  const newRightSourceIn = right.sourceIn + editDelta;
  const newRightStartTime = right.startTime + editDelta;

  // Validate bounds
  if (newLeftSourceOut <= left.sourceIn) {
    throw new Error(`rollEdit: left clip would have zero or negative duration`);
  }
  if (maxLeftSourceDuration !== undefined && newLeftSourceOut > maxLeftSourceDuration) {
    throw new Error(`rollEdit: left clip exceeds available source duration`);
  }
  if (newRightSourceIn < 0) {
    throw new Error(`rollEdit: right clip sourceIn cannot be negative`);
  }
  if (newRightSourceIn >= right.sourceOut) {
    throw new Error(`rollEdit: right clip would have zero or negative duration`);
  }
  if (newRightStartTime < 0) {
    throw new Error(`rollEdit: right clip startTime cannot be negative`);
  }

  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => {
      if (t.id !== leftFound.track.id) return t;

      return {
        ...t,
        clips: t.clips.map((c) => {
          if (c.id === leftClipId) {
            return { ...c, sourceOut: newLeftSourceOut };
          }
          if (c.id === rightClipId) {
            return { ...c, sourceIn: newRightSourceIn, startTime: newRightStartTime };
          }
          return c;
        }),
      };
    }),
  };
}

// ─── Slip Edit ────────────────────────────────────────────────────────────────

/**
 * Changes what part of the source asset is visible inside the clip,
 * keeping startTime, duration, and surrounding clips unchanged.
 */
export function slipEdit(
  timeline: TimelineDocument,
  clipId: string,
  sourceOffset: number,
  maxSourceDuration?: number
): TimelineDocument {
  if (Math.abs(sourceOffset) < 0.0001) return timeline;

  const found = findClipWithTrack(timeline, clipId);
  if (!found || found.track.locked) return timeline;
  const clip = found.clip;

  const newSourceIn = clip.sourceIn + sourceOffset;
  const newSourceOut = clip.sourceOut + sourceOffset;

  if (newSourceIn < 0) {
    throw new Error(`slipEdit: newSourceIn (${newSourceIn}) cannot be negative`);
  }
  if (maxSourceDuration !== undefined && newSourceOut > maxSourceDuration) {
    throw new Error(`slipEdit: newSourceOut (${newSourceOut}) exceeds max source duration (${maxSourceDuration})`);
  }

  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) =>
        c.id === clipId ? { ...c, sourceIn: newSourceIn, sourceOut: newSourceOut } : c
      ),
    })),
  };
}

// ─── Slide Edit ───────────────────────────────────────────────────────────────

/**
 * Moves a clip along the timeline while adjusting the out-point of the preceding clip
 * and the in-point of the following clip so that no gaps or overlaps are created.
 */
export function slideEdit(
  timeline: TimelineDocument,
  clipId: string,
  deltaTime: number,
  previousClipId?: string,
  nextClipId?: string
): TimelineDocument {
  if (Math.abs(deltaTime) < 0.0001) return timeline;

  const found = findClipWithTrack(timeline, clipId);
  if (!found || found.track.locked) return timeline;
  const { clip, track } = found;

  const newClipStartTime = clip.startTime + deltaTime;
  if (newClipStartTime < 0) {
    throw new Error("slideEdit: clip startTime cannot be negative");
  }

  let prevClip: TimelineClip | undefined;
  let nextClip: TimelineClip | undefined;

  if (previousClipId) {
    prevClip = track.clips.find((c) => c.id === previousClipId);
  }
  if (nextClipId) {
    nextClip = track.clips.find((c) => c.id === nextClipId);
  }

  // If previous clip exists, its duration changes by +deltaTime (sourceOut + deltaTime)
  if (prevClip) {
    const newPrevSourceOut = prevClip.sourceOut + deltaTime;
    if (newPrevSourceOut <= prevClip.sourceIn) {
      throw new Error("slideEdit: preceding clip would have non-positive duration");
    }
  }

  // If next clip exists, its start time moves by +deltaTime, so its sourceIn moves by +deltaTime
  if (nextClip) {
    const newNextSourceIn = nextClip.sourceIn + deltaTime;
    const newNextStartTime = nextClip.startTime + deltaTime;
    if (newNextSourceIn >= nextClip.sourceOut || newNextSourceIn < 0) {
      throw new Error("slideEdit: following clip would have invalid source range");
    }
    if (newNextStartTime < 0) {
      throw new Error("slideEdit: following clip startTime cannot be negative");
    }
  }

  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => {
      if (t.id !== track.id) return t;

      return {
        ...t,
        clips: t.clips.map((c) => {
          if (c.id === clipId) {
            return { ...c, startTime: newClipStartTime };
          }
          if (prevClip && c.id === prevClip.id) {
            return { ...c, sourceOut: c.sourceOut + deltaTime };
          }
          if (nextClip && c.id === nextClip.id) {
            return {
              ...c,
              startTime: c.startTime + deltaTime,
              sourceIn: c.sourceIn + deltaTime,
            };
          }
          return c;
        }),
      };
    }),
  };
}

// ─── Razor / Blade Split Operations ──────────────────────────────────────────

/**
 * Splits clips under the playhead at playheadTime.
 * If targetClipId is given, splits only that clip.
 * If targetTrackId is given, splits only on that track.
 * Otherwise, splits all unlocked tracks at playheadTime.
 */
export function razorSplitAtPlayhead(
  timeline: TimelineDocument,
  playheadTime: number,
  targetTrackId?: string,
  targetClipId?: string
): TimelineDocument {
  let doc = timeline;

  for (const track of doc.tracks) {
    if (track.locked) continue;
    if (targetTrackId && track.id !== targetTrackId) continue;

    for (const clip of track.clips) {
      if (targetClipId && clip.id !== targetClipId) continue;

      const rate = clip.playbackRate > 0 ? clip.playbackRate : 1.0;
      const clipDuration = (clip.sourceOut - clip.sourceIn) / rate;
      const clipEnd = clip.startTime + clipDuration;
      if (playheadTime > clip.startTime + 0.001 && playheadTime < clipEnd - 0.001) {
        const offsetIntoClip = playheadTime - clip.startTime;
        const splitSourceTime = clip.sourceIn + offsetIntoClip * rate;
        const result = splitClip(doc, clip.id, splitSourceTime);
        if (result) {
          doc = result;
        }
      }
    }
  }

  return doc;
}

// ─── Lift & Ripple Delete ─────────────────────────────────────────────────────

/**
 * Lift removes selected clips leaving the empty gaps intact.
 * Clips on locked tracks are preserved.
 */
export function liftClips(
  timeline: TimelineDocument,
  clipIds: string[]
): TimelineDocument {
  const idsToRemove = new Set(clipIds);
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => {
      if (t.locked) return t;
      return {
        ...t,
        clips: t.clips.filter((c) => !idsToRemove.has(c.id)),
      };
    }),
  };
}

/**
 * Ripple delete removes selected clips and ripples subsequent clips to close the gaps.
 * Clips on locked tracks are preserved, and locked tracks are never shifted.
 */
export function rippleDeleteClips(
  timeline: TimelineDocument,
  clipIds: string[],
  syncLockedTracks: boolean = true
): TimelineDocument {
  if (clipIds.length === 0) return timeline;

  let current = timeline;

  // Process clip by clip from latest startTime to earliest to maintain relative time offsets
  const clipDetails: { clip: TimelineClip; track: TimelineTrack }[] = [];
  for (const id of clipIds) {
    const found = findClipWithTrack(current, id);
    if (found && !found.track.locked) clipDetails.push(found);
  }

  // Sort descending by startTime
  clipDetails.sort((a, b) => b.clip.startTime - a.clip.startTime);

  for (const { clip, track } of clipDetails) {
    const duration = clip.sourceOut - clip.sourceIn;
    const clipEnd = clip.startTime + duration;

    const affectedTrackIds = new Set<string>();
    affectedTrackIds.add(track.id);

    if (syncLockedTracks) {
      for (const t of current.tracks) {
        if (t.syncLocked && !t.locked) affectedTrackIds.add(t.id);
      }
    }

    current = {
      ...current,
      tracks: current.tracks.map((t) => {
        if (t.locked) return t;
        const isCurrentTrack = t.id === track.id;

        // Remove clip if this is the target track
        const remaining = isCurrentTrack ? t.clips.filter((c) => c.id !== clip.id) : t.clips;

        if (!affectedTrackIds.has(t.id)) {
          return isCurrentTrack ? { ...t, clips: remaining } : t;
        }

        // Ripple shift downstream clips
        const shifted = remaining.map((c) => {
          if (c.startTime >= clipEnd - 0.001) {
            return {
              ...c,
              startTime: Math.max(0, c.startTime - duration),
            };
          }
          return c;
        });

        return { ...t, clips: shifted };
      }),
    };
  }

  return current;
}

/**
 * Ripple deletes a single clip by clipId, shifting subsequent clips left.
 */
export function rippleDeleteClip(
  timeline: TimelineDocument,
  clipId: string,
  syncLockedTracks: boolean = true
): TimelineDocument {
  const found = findClipWithTrack(timeline, clipId);
  if (!found || found.track.locked) return timeline;
  return rippleDeleteClips(timeline, [clipId], syncLockedTracks);
}

// ─── Detach Audio Operation ───────────────────────────────────────────────────

export type DetachAudioResult = TimelineDocument & {
  timeline: TimelineDocument;
  audioClipId: string;
};

/**
 * Detaches audio from a video clip by creating a linked audio clip on an audio track.
 * By default, disables embedded audio on the video clip so duplicate audio is not played.
 */
export function detachAudio(
  timeline: TimelineDocument,
  videoClipId: string,
  options: { disableEmbeddedAudio?: boolean; targetAudioTrackId?: string } = {}
): DetachAudioResult | null {
  const found = findClipWithTrack(timeline, videoClipId);
  if (!found || found.track.type !== "video" || found.track.locked) return null;

  const { clip: videoClip } = found;
  const disableEmbedded = options.disableEmbeddedAudio ?? true;

  const current = deepCloneTimeline(timeline);

  // Find or create suitable audio track
  let targetAudioTrack: TimelineTrack | undefined;
  if (options.targetAudioTrackId) {
    targetAudioTrack = current.tracks.find(
      (t) => t.id === options.targetAudioTrackId && t.type === "audio" && !t.locked
    );
  }
  if (!targetAudioTrack) {
    targetAudioTrack = current.tracks.find((t) => t.type === "audio" && !t.locked);
  }
  if (!targetAudioTrack) {
    // Create new audio track
    const newTrackId = crypto.randomUUID();
    const createdAudioTrack: TimelineTrack = {
      id: newTrackId,
      type: "audio",
      name: `Audio ${current.tracks.filter((t) => t.type === "audio").length + 1}`,
      order: current.tracks.length,
      locked: false,
      muted: false,
      hidden: false,
      clips: [],
      audioRole: "general",
      ducking: { ...DEFAULT_TRACK_DUCKING },
    };
    current.tracks.push(createdAudioTrack);
    targetAudioTrack = createdAudioTrack;
  }

  const assignedAudioTrack = targetAudioTrack!;
  const audioClipId = crypto.randomUUID();
  const audioClip: TimelineClip = {
    id: audioClipId,
    assetId: videoClip.assetId,
    trackId: assignedAudioTrack.id,
    startTime: videoClip.startTime,
    sourceIn: videoClip.sourceIn,
    sourceOut: videoClip.sourceOut,
    volume: videoClip.volume,
    muted: false,
    fitMode: videoClip.fitMode || "fit",
    crop: videoClip.crop ? { ...videoClip.crop } : { top: 0, right: 0, bottom: 0, left: 0 },
    flipH: videoClip.flipH ?? false,
    flipV: videoClip.flipV ?? false,
    fadeIn: videoClip.fadeIn ?? 0,
    fadeOut: videoClip.fadeOut ?? 0,
    audioDetached: false,
    playbackRate: videoClip.playbackRate,
    preservePitch: videoClip.preservePitch,
    freezeFrameSourceTime: null,
    linkedClipId: videoClip.id,
    color: videoClip.color ? { ...videoClip.color } : { ...DEFAULT_COLOR_ADJUSTMENTS },
  };

  assignedAudioTrack.clips.push(audioClip);

  // Update video clip: link to audio clip, and set audioDetached = true
  for (const track of current.tracks) {
    for (let i = 0; i < track.clips.length; i++) {
      if (track.clips[i].id === videoClipId) {
        track.clips[i] = {
          ...track.clips[i],
          linkedClipId: audioClipId,
          audioDetached: disableEmbedded,
        };
      }
    }
  }

  const result: DetachAudioResult = {
    ...current,
    timeline: current,
    audioClipId,
  };

  return result;
}

export const detachAudioFromClip = detachAudio;

// ─── Close Gap ────────────────────────────────────────────────────────────────

/**
 * Closes an empty gap on trackId starting at gapStartTime by rippling downstream clips leftward.
 */
export function closeGap(
  timeline: TimelineDocument,
  trackId: string,
  gapStartTime: number,
  syncLockedTracks: boolean = true
): TimelineDocument {
  const track = timeline.tracks.find((t) => t.id === trackId);
  if (!track || track.locked) return timeline;

  // Find the next clip that starts strictly after gapStartTime
  const sortedClips = [...track.clips].sort((a, b) => a.startTime - b.startTime);
  const nextClip = sortedClips.find((c) => c.startTime > gapStartTime + 0.001);
  if (!nextClip) return timeline;

  const gapDuration = nextClip.startTime - gapStartTime;
  if (gapDuration <= 0.001) return timeline;

  const affectedTrackIds = new Set<string>();
  affectedTrackIds.add(track.id);

  if (syncLockedTracks) {
    for (const t of timeline.tracks) {
      if (t.syncLocked) affectedTrackIds.add(t.id);
    }
  }

  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => {
      if (!affectedTrackIds.has(t.id)) return t;

      return {
        ...t,
        clips: t.clips.map((c) => {
          if (c.startTime >= nextClip.startTime - 0.001) {
            return {
              ...c,
              startTime: Math.max(0, c.startTime - gapDuration),
            };
          }
          return c;
        }),
      };
    }),
  };
}

// ─── Insert & Overwrite Edit ──────────────────────────────────────────────────

/**
 * Inserts a source range at insertTime on targetTrackId.
 * If insertTime falls within an existing clip, that clip is split.
 * All subsequent clips starting at >= insertTime are rippled downstream by duration.
 */
export function insertEdit(
  timeline: TimelineDocument,
  targetTrackId: string,
  assetId: string,
  sourceIn: number,
  sourceOut: number,
  insertTime: number,
  syncLockedTracks: boolean = true,
  audioTrackId?: string
): TimelineDocument {
  const track = timeline.tracks.find((t) => t.id === targetTrackId);
  if (!track || track.locked) return timeline;

  if (sourceOut <= sourceIn) {
    throw new Error("insertEdit: sourceOut must be greater than sourceIn");
  }
  const duration = sourceOut - sourceIn;

  // 1. Split existing clip if insertTime splits one
  let workingTimeline = razorSplitAtPlayhead(timeline, insertTime, targetTrackId);
  if (audioTrackId) {
    workingTimeline = razorSplitAtPlayhead(workingTimeline, insertTime, audioTrackId);
  }

  // 2. Ripple downstream clips
  const affectedTrackIds = new Set<string>();
  affectedTrackIds.add(targetTrackId);
  if (audioTrackId) affectedTrackIds.add(audioTrackId);
  if (syncLockedTracks) {
    for (const t of workingTimeline.tracks) {
      if (t.syncLocked) affectedTrackIds.add(t.id);
    }
  }

  const rippledTracks = workingTimeline.tracks.map((t) => {
    if (!affectedTrackIds.has(t.id)) return t;

    return {
      ...t,
      clips: t.clips.map((c) => {
        if (c.startTime >= insertTime - 0.001) {
          return { ...c, startTime: c.startTime + duration };
        }
        return c;
      }),
    };
  });

  // 3. Create and append the new inserted clip (with optional linked audio clip)
  const videoClipId = crypto.randomUUID();
  const audioClipId = audioTrackId ? crypto.randomUUID() : undefined;

  const newClip: TimelineClip = {
    id: videoClipId,
    assetId,
    trackId: targetTrackId,
    startTime: insertTime,
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
    linkedClipId: audioClipId,
    color: { ...DEFAULT_COLOR_ADJUSTMENTS },
  };

  const newAudioClip: TimelineClip | null = audioTrackId && audioClipId ? {
    id: audioClipId,
    assetId,
    trackId: audioTrackId,
    startTime: insertTime,
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
    linkedClipId: videoClipId,
    color: { ...DEFAULT_COLOR_ADJUSTMENTS },
  } : null;

  return {
    ...workingTimeline,
    tracks: rippledTracks.map((t) => {
      if (t.id === targetTrackId) {
        return { ...t, clips: [...t.clips, newClip] };
      }
      if (newAudioClip && t.id === audioTrackId) {
        return { ...t, clips: [...t.clips, newAudioClip] };
      }
      return t;
    }),
  };
}

function overwriteTrackClips(
  track: TimelineTrack,
  assetId: string,
  sourceIn: number,
  sourceOut: number,
  overwriteTime: number,
  clipId: string,
  linkedClipId?: string
): TimelineClip[] {
  const duration = sourceOut - sourceIn;
  const overwriteEnd = overwriteTime + duration;
  const newClips: TimelineClip[] = [];

  for (const clip of track.clips) {
    const clipDuration = clip.sourceOut - clip.sourceIn;
    const clipEnd = clip.startTime + clipDuration;

    // Case 1: Clip is completely outside the overwrite window
    if (clipEnd <= overwriteTime + 0.0001 || clip.startTime >= overwriteEnd - 0.0001) {
      newClips.push(clip);
      continue;
    }

    // Case 2: Clip is completely covered by overwrite window
    if (clip.startTime >= overwriteTime - 0.0001 && clipEnd <= overwriteEnd + 0.0001) {
      continue;
    }

    // Case 3: Overwrite cuts into the middle of the clip
    if (clip.startTime < overwriteTime - 0.0001 && clipEnd > overwriteEnd + 0.0001) {
      const leftPart: TimelineClip = {
        ...clip,
        sourceOut: clip.sourceIn + (overwriteTime - clip.startTime),
      };
      const rightPart: TimelineClip = {
        ...clip,
        id: crypto.randomUUID(),
        startTime: overwriteEnd,
        sourceIn: clip.sourceIn + (overwriteEnd - clip.startTime),
      };
      newClips.push(leftPart, rightPart);
      continue;
    }

    // Case 4: Overwrite overlaps the right end of the clip
    if (clip.startTime < overwriteTime && clipEnd > overwriteTime) {
      const trimmedClip: TimelineClip = {
        ...clip,
        sourceOut: clip.sourceIn + (overwriteTime - clip.startTime),
      };
      newClips.push(trimmedClip);
      continue;
    }

    // Case 5: Overwrite overlaps the left start of the clip
    if (clip.startTime < overwriteEnd && clipEnd > overwriteEnd) {
      const cutAmount = overwriteEnd - clip.startTime;
      const trimmedClip: TimelineClip = {
        ...clip,
        startTime: overwriteEnd,
        sourceIn: clip.sourceIn + cutAmount,
      };
      newClips.push(trimmedClip);
      continue;
    }
  }

  // Insert the newly placed overwrite clip
  const placedClip: TimelineClip = {
    id: clipId,
    assetId,
    trackId: track.id,
    startTime: overwriteTime,
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
    linkedClipId,
    color: { ...DEFAULT_COLOR_ADJUSTMENTS },
  };
  newClips.push(placedClip);
  return newClips;
}

/**
 * Overwrites targetTrackId from overwriteTime for the source range duration.
 * Does NOT shift downstream clips. Trims or splits overlapping existing clips.
 * Supports creating linked audio clips on audioTrackId when provided.
 */
export function overwriteEdit(
  timeline: TimelineDocument,
  targetTrackId: string,
  assetId: string,
  sourceIn: number,
  sourceOut: number,
  overwriteTime: number,
  audioTrackId?: string
): TimelineDocument {
  const track = timeline.tracks.find((t) => t.id === targetTrackId);
  if (!track || track.locked) return timeline;

  if (sourceOut <= sourceIn) {
    throw new Error("overwriteEdit: sourceOut must be greater than sourceIn");
  }

  const audioTrack = audioTrackId ? timeline.tracks.find((t) => t.id === audioTrackId && !t.locked) : undefined;
  const videoClipId = crypto.randomUUID();
  const audioClipId = audioTrack ? crypto.randomUUID() : undefined;

  const updatedTargetClips = overwriteTrackClips(
    track,
    assetId,
    sourceIn,
    sourceOut,
    overwriteTime,
    videoClipId,
    audioClipId
  );

  const updatedAudioClips = audioTrack
    ? overwriteTrackClips(
      audioTrack,
      assetId,
      sourceIn,
      sourceOut,
      overwriteTime,
      audioClipId!,
      videoClipId
    )
    : null;

  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => {
      if (t.id === targetTrackId) return { ...t, clips: updatedTargetClips };
      if (audioTrack && t.id === audioTrack.id && updatedAudioClips) return { ...t, clips: updatedAudioClips };
      return t;
    }),
  };
}

// ─── Linking & Grouping ───────────────────────────────────────────────────────

export function linkClips(
  timeline: TimelineDocument,
  clipIdA: string,
  clipIdB: string
): TimelineDocument {
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        if (c.id === clipIdA) return { ...c, linkedClipId: clipIdB };
        if (c.id === clipIdB) return { ...c, linkedClipId: clipIdA };
        return c;
      }),
    })),
  };
}

export function unlinkClip(
  timeline: TimelineDocument,
  clipId: string
): TimelineDocument {
  const found = findClipWithTrack(timeline, clipId);
  if (!found) return timeline;
  const partnerId = found.clip.linkedClipId;

  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        if (c.id === clipId || (partnerId && c.id === partnerId)) {
          const copy = { ...c };
          delete copy.linkedClipId;
          return copy;
        }
        return c;
      }),
    })),
  };
}

export function groupClips(
  timeline: TimelineDocument,
  clipIds: string[]
): TimelineDocument {
  if (clipIds.length <= 1) return timeline;
  const newGroupId = crypto.randomUUID();
  const idSet = new Set(clipIds);

  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => (idSet.has(c.id) ? { ...c, groupId: newGroupId } : c)),
    })),
  };
}

export function ungroupClips(
  timeline: TimelineDocument,
  clipIds: string[]
): TimelineDocument {
  const idSet = new Set(clipIds);
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        if (idSet.has(c.id)) {
          const copy = { ...c };
          delete copy.groupId;
          return copy;
        }
        return c;
      }),
    })),
  };
}

// ─── Track Management ─────────────────────────────────────────────────────────

export function addTrack(
  timeline: TimelineDocument,
  type: TrackType,
  name?: string
): TimelineDocument {
  const trackId = crypto.randomUUID();
  const typeTracks = timeline.tracks.filter((t) => t.type === type);
  const defaultName = name || `${type === "video" ? "Video" : type === "audio" ? "Audio" : "Track"} ${typeTracks.length + 1}`;

  const newTrack: TimelineTrack = {
    id: trackId,
    type,
    name: defaultName,
    order: timeline.tracks.length,
    muted: false,
    locked: false,
    hidden: false,
    solo: false,
    syncLocked: true,
    clips: [],
    audioRole: type === "video" ? "dialogue" : "general",
    ducking: { ...DEFAULT_TRACK_DUCKING },
  };

  return {
    ...timeline,
    tracks: [...timeline.tracks, newTrack],
  };
}

export function removeTrack(
  timeline: TimelineDocument,
  trackId: string
): TimelineDocument {
  // Ensure at least 1 video track and 1 audio track remain
  const trackToRemove = timeline.tracks.find((t) => t.id === trackId);
  if (!trackToRemove) return timeline;

  const sameTypeCount = timeline.tracks.filter((t) => t.type === trackToRemove.type).length;
  if (sameTypeCount <= 1 && (trackToRemove.type === "video" || trackToRemove.type === "audio")) {
    throw new Error(`Cannot delete the last remaining ${trackToRemove.type} track`);
  }

  return {
    ...timeline,
    tracks: timeline.tracks
      .filter((t) => t.id !== trackId)
      .map((t, index) => ({ ...t, order: index })),
  };
}

export function reorderTrack(
  timeline: TimelineDocument,
  trackId: string,
  direction: "up" | "down"
): TimelineDocument {
  const index = timeline.tracks.findIndex((t) => t.id === trackId);
  if (index === -1) return timeline;

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= timeline.tracks.length) return timeline;

  const newTracks = [...timeline.tracks];
  const [moved] = newTracks.splice(index, 1);
  newTracks.splice(targetIndex, 0, moved);

  return {
    ...timeline,
    tracks: newTracks.map((t, i) => ({ ...t, order: i })),
  };
}

export function toggleTrackLock(timeline: TimelineDocument, trackId: string): TimelineDocument {
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => (t.id === trackId ? { ...t, locked: !t.locked } : t)),
  };
}

export function toggleTrackMute(timeline: TimelineDocument, trackId: string): TimelineDocument {
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)),
  };
}

export function toggleTrackSolo(timeline: TimelineDocument, trackId: string): TimelineDocument {
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => (t.id === trackId ? { ...t, solo: !t.solo } : t)),
  };
}

export function toggleTrackHidden(timeline: TimelineDocument, trackId: string): TimelineDocument {
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => (t.id === trackId ? { ...t, hidden: !t.hidden } : t)),
  };
}

export function toggleTrackSyncLock(timeline: TimelineDocument, trackId: string): TimelineDocument {
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) =>
      t.id === trackId ? { ...t, syncLocked: t.syncLocked === false ? true : false } : t
    ),
  };
}

export function renameTrack(
  timeline: TimelineDocument,
  trackId: string,
  newName: string
): TimelineDocument {
  const clean = newName.trim();
  if (!clean) return timeline;
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => (t.id === trackId ? { ...t, name: clean } : t)),
  };
}

// ─── Timeline Markers ─────────────────────────────────────────────────────────

export function addMarker(
  timeline: TimelineDocument,
  marker: Omit<TimelineMarker, "id"> & { id?: string }
): TimelineDocument {
  const newMarker: TimelineMarker = {
    id: marker.id || crypto.randomUUID(),
    time: Math.max(0, marker.time),
    label: marker.label.trim() || "Marker",
    color: marker.color || "#3b82f6",
    notes: marker.notes,
    duration: marker.duration,
  };

  const existing = timeline.markers || [];
  return {
    ...timeline,
    markers: [...existing, newMarker].sort((a, b) => a.time - b.time),
  };
}

export function updateMarker(
  timeline: TimelineDocument,
  markerId: string,
  patch: Partial<TimelineMarker>
): TimelineDocument {
  if (!timeline.markers) return timeline;
  return {
    ...timeline,
    markers: timeline.markers.map((m) =>
      m.id === markerId ? { ...m, ...patch, time: patch.time !== undefined ? Math.max(0, patch.time) : m.time } : m
    ).sort((a, b) => a.time - b.time),
  };
}

export function removeMarker(
  timeline: TimelineDocument,
  markerId: string
): TimelineDocument {
  if (!timeline.markers) return timeline;
  return {
    ...timeline,
    markers: timeline.markers.filter((m) => m.id !== markerId),
  };
}

export function moveMarker(
  timeline: TimelineDocument,
  markerId: string,
  newTime: number
): TimelineDocument {
  return updateMarker(timeline, markerId, { time: Math.max(0, newTime) });
}

export function deleteMarker(
  timeline: TimelineDocument,
  markerId: string
): TimelineDocument {
  return removeMarker(timeline, markerId);
}

export function findNearestMarker(
  timeline: TimelineDocument,
  currentTime: number,
  direction: "prev" | "next" | "any"
): TimelineMarker | null {
  const markers = timeline.markers || [];
  if (markers.length === 0) return null;

  if (direction === "prev") {
    const prevs = markers.filter((m) => m.time < currentTime - 0.05);
    return prevs.length > 0 ? prevs[prevs.length - 1] : null;
  }
  if (direction === "next") {
    const nexts = markers.filter((m) => m.time > currentTime + 0.05);
    return nexts.length > 0 ? nexts[0] : null;
  }

  // Any closest
  let closest = markers[0];
  let minDiff = Math.abs(currentTime - closest.time);
  for (const m of markers) {
    const diff = Math.abs(currentTime - m.time);
    if (diff < minDiff) {
      minDiff = diff;
      closest = m;
    }
  }
  return closest;
}

// ─── Clipboard Operations ─────────────────────────────────────────────────────

export function copyClips(
  timeline: TimelineDocument,
  clipIds: string[]
): TimelineClip[] {
  const idSet = new Set(clipIds);
  const found: TimelineClip[] = [];

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (idSet.has(clip.id)) {
        found.push(JSON.parse(JSON.stringify(clip)));
      }
    }
  }

  // Sort by startTime
  return found.sort((a, b) => a.startTime - b.startTime);
}

export function pasteClips(
  timeline: TimelineDocument,
  copiedClips: TimelineClip[],
  pasteTime: number,
  targetTrackId?: string
): TimelineDocument {
  if (copiedClips.length === 0) return timeline;

  const minStartTime = copiedClips[0].startTime;
  const timeOffset = pasteTime - minStartTime;

  const current = deepCloneTimeline(timeline);

  for (const orig of copiedClips) {
    const destTrackId = targetTrackId && copiedClips.length === 1 ? targetTrackId : orig.trackId;
    const destTrack = current.tracks.find((t) => t.id === destTrackId) || current.tracks[0];
    if (!destTrack || destTrack.locked) continue;

    const newClip: TimelineClip = {
      ...orig,
      id: crypto.randomUUID(),
      trackId: destTrack.id,
      startTime: Math.max(0, orig.startTime + timeOffset),
    };

    destTrack.clips.push(newClip);
  }

  return current;
}


