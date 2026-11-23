import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createTimeline,
  createClip,
  addClipToTrack,
  removeClip,
  moveClip,
  trimClipStart,
  trimClipEnd,
  splitClip,
  addTransition,
  removeTransition,
  updateTransition,
  validateTimeline,
} from "../src/lib/timeline/model.ts";
import {
  detachAudio,
  detachAudioFromClip,
  addTrack,
  liftClips,
  rippleDeleteClip,
  addMarker,
  updateMarker,
  moveMarker,
  deleteMarker,
} from "../src/lib/timeline/editingOperations.ts";
import type { TimelineTransition } from "../src/types/timeline.ts";

describe("Extended Editing Operations & Transition Model", () => {
  it("enforces track lock on add, remove, trim, split, move, lift, and rippleDelete", () => {
    let timeline = createTimeline();
    const lockedTrack = { ...timeline.tracks[0], locked: true };
    const unlockedTrack = { ...timeline.tracks[1], locked: false };
    timeline = { ...timeline, tracks: [lockedTrack, unlockedTrack] };

    const clip = {
      ...createClip("asset-1", lockedTrack.id, 0, 0, 5),
      id: "clip-locked",
    };

    // addClipToTrack rejects adding to locked track
    const added = addClipToTrack(timeline, lockedTrack.id, clip);
    assert.equal(added.tracks.find((t) => t.id === lockedTrack.id)!.clips.length, 0);

    // Place clip directly on locked track for testing other ops
    const withClip = {
      ...timeline,
      tracks: timeline.tracks.map((t) =>
        t.id === lockedTrack.id ? { ...t, clips: [clip] } : t
      ),
    };

    // removeClip rejects removing from locked track
    const afterRemove = removeClip(withClip, "clip-locked");
    assert.equal(afterRemove.tracks.find((t) => t.id === lockedTrack.id)!.clips.length, 1);

    // trimClipStart / trimClipEnd rejects trimming on locked track
    const afterTrimStart = trimClipStart(withClip, "clip-locked", 1, 1);
    assert.equal(afterTrimStart.tracks.find((t) => t.id === lockedTrack.id)!.clips[0].sourceIn, 0);

    const afterTrimEnd = trimClipEnd(withClip, "clip-locked", 4);
    assert.equal(afterTrimEnd.tracks.find((t) => t.id === lockedTrack.id)!.clips[0].sourceOut, 5);

    // splitClip rejects splitting on locked track
    const splitRes = splitClip(withClip, "clip-locked", 2.5);
    assert.equal(splitRes, null);

    // moveClip rejects moving on locked track
    const moved = moveClip(withClip, "clip-locked", 10);
    assert.equal(moved.tracks.find((t) => t.id === lockedTrack.id)!.clips[0].startTime, 0);

    // liftClips skips clips on locked tracks
    const lifted = liftClips(withClip, ["clip-locked"]);
    assert.equal(lifted.tracks.find((t) => t.id === lockedTrack.id)!.clips.length, 1);

    // rippleDeleteClip skips clips on locked tracks
    const rippleDel = rippleDeleteClip(withClip, "clip-locked");
    assert.equal(rippleDel.tracks.find((t) => t.id === lockedTrack.id)!.clips.length, 1);

    // detachAudio on locked track returns null
    const detachRes = detachAudio(withClip, "clip-locked");
    assert.equal(detachRes, null);
  });

  it("handles reliable clip moving, track-switching, clamping, and collision safety", () => {
    let timeline = createTimeline();
    // Add two unlocked video tracks
    const v1 = { ...timeline.tracks[0], id: "v-1", type: "video" as const, locked: false, clips: [] };
    const v2 = { ...timeline.tracks[0], id: "v-2", type: "video" as const, order: 1, locked: false, clips: [] };
    const a1 = { ...timeline.tracks[1], id: "a-1", type: "audio" as const, locked: false, clips: [] };
    timeline = { ...timeline, tracks: [v1, v2, a1] };

    // Track v1 has clipA [0, 5] and clipB [10, 15]
    const clipA = { ...createClip("asset-1", "v-1", 0, 0, 5), id: "clip-a" };
    const clipB = { ...createClip("asset-2", "v-1", 10, 0, 5), id: "clip-b" };
    timeline = addClipToTrack(timeline, "v-1", clipA);
    timeline = addClipToTrack(timeline, "v-1", clipB);

    // Moving clipA to negative time clamps to 0
    let res = moveClip(timeline, "clip-a", -4);
    assert.equal(res.tracks.find((t) => t.id === "v-1")!.clips.find((c) => c.id === "clip-a")!.startTime, 0);

    // Moving clipA forward into clipB (e.g. to 8) resolves collision: clamps to adjacent (5)
    res = moveClip(timeline, "clip-a", 8);
    const movedA = res.tracks.find((t) => t.id === "v-1")!.clips.find((c) => c.id === "clip-a")!;
    assert.equal(movedA.startTime, 5); // 5 + 5 = 10, avoids overlap with clipB [10, 15]

    // Moving clipB left into clipA (e.g. to 3 when clipA is at 0) resolves collision: clamps to 5
    res = moveClip(timeline, "clip-b", 3);
    const movedB = res.tracks.find((t) => t.id === "v-1")!.clips.find((c) => c.id === "clip-b")!;
    assert.equal(movedB.startTime, 5);

    // Moving clipA to compatible video track v2
    res = moveClip(timeline, "clip-a", 2.0, "v-2");
    assert.equal(res.tracks.find((t) => t.id === "v-1")!.clips.some((c) => c.id === "clip-a"), false);
    const movedToV2 = res.tracks.find((t) => t.id === "v-2")!.clips.find((c) => c.id === "clip-a")!;
    assert.equal(movedToV2.startTime, 2.0);
    assert.equal(movedToV2.trackId, "v-2");

    // Moving video clip to incompatible audio track a-1 is rejected
    const badTrackMove = moveClip(timeline, "clip-a", 2.0, "a-1");
    assert.equal(badTrackMove.tracks.find((t) => t.id === "v-1")!.clips.some((c) => c.id === "clip-a"), true);
  });

  it("ripple deletes a clip and shifts downstream clips", () => {
    let timeline = createTimeline();
    const track = timeline.tracks[0];
    const c1 = { ...createClip("asset-1", track.id, 0, 0, 5), id: "c1" };
    const c2 = { ...createClip("asset-2", track.id, 5, 0, 4), id: "c2" };
    const c3 = { ...createClip("asset-3", track.id, 12, 0, 3), id: "c3" };

    timeline = addClipToTrack(timeline, track.id, c1);
    timeline = addClipToTrack(timeline, track.id, c2);
    timeline = addClipToTrack(timeline, track.id, c3);

    // Ripple delete c2 (duration 4). c3 should shift from 12 to 8.
    const res = rippleDeleteClip(timeline, "c2");
    const vClips = res.tracks.find((t) => t.id === track.id)!.clips;
    assert.equal(vClips.length, 2);
    assert.equal(vClips.find((c) => c.id === "c2"), undefined);
    assert.equal(vClips.find((c) => c.id === "c1")!.startTime, 0);
    assert.equal(vClips.find((c) => c.id === "c3")!.startTime, 8);
  });

  it("supports timeline markers: add, update, move, delete", () => {
    let timeline = createTimeline();

    // Add marker
    timeline = addMarker(timeline, {
      id: "m-1",
      time: 5.5,
      label: "Intro End",
      color: "#ff0000",
    });
    assert.equal(timeline.markers?.length, 1);
    assert.equal(timeline.markers![0].label, "Intro End");

    // Update marker
    timeline = updateMarker(timeline, "m-1", { label: "Chapter 1" });
    assert.equal(timeline.markers![0].label, "Chapter 1");

    // Move marker
    timeline = moveMarker(timeline, "m-1", 12.0);
    assert.equal(timeline.markers![0].time, 12.0);

    // Delete marker
    timeline = deleteMarker(timeline, "m-1");
    assert.equal(timeline.markers?.length, 0);
  });

  it("detaches audio from video clip into an audio track and disables embedded audio", () => {
    let timeline = createTimeline();
    timeline = addTrack(timeline, "video");
    const videoTrack = timeline.tracks.find((t) => t.type === "video")!;

    timeline = addClipToTrack(timeline, videoTrack.id, {
      ...createClip("asset-raw", videoTrack.id, 5.0, 2.0, 12.0),
      id: "vclip-1",
      volume: 0.8,
    });

    const res = detachAudioFromClip(timeline, "vclip-1");
    assert.ok(res !== null, "detachAudioFromClip should succeed for video clip");

    const newTimeline = res.timeline;
    const audioTrack = newTimeline.tracks.find((t) => t.type === "audio");
    assert.ok(audioTrack, "An audio track must exist for detached audio");

    const detachedAudioClip = audioTrack.clips.find((c) => c.linkedClipId === "vclip-1");
    assert.ok(detachedAudioClip, "Detached audio clip must be linked to video clip");
    assert.equal(detachedAudioClip.startTime, 5.0);
    assert.equal(detachedAudioClip.sourceIn, 2.0);
    assert.equal(detachedAudioClip.sourceOut, 12.0);
    assert.equal(detachedAudioClip.volume, 0.8);
    assert.equal(detachedAudioClip.audioDetached, false);

    // Verify video clip now has audioDetached = true
    const updatedVideo = newTimeline.tracks.flatMap((t) => t.clips).find((c) => c.id === "vclip-1")!;
    assert.equal(updatedVideo.audioDetached, true);
    assert.equal(updatedVideo.linkedClipId, detachedAudioClip.id);
  });

  it("adds, updates, and removes transitions with valid timeline consistency", () => {
    let timeline = createTimeline();
    const track = timeline.tracks[0];

    timeline = addClipToTrack(timeline, track.id, {
      ...createClip("asset-1", track.id, 0, 0, 5),
      id: "clip-a",
    });
    timeline = addClipToTrack(timeline, track.id, {
      ...createClip("asset-2", track.id, 5, 0, 5),
      id: "clip-b",
    });

    const transition: TimelineTransition = {
      id: "trans-ab",
      type: "cross_dissolve",
      family: "dissolve",
      trackId: track.id,
      fromClipId: "clip-a",
      toClipId: "clip-b",
      editPoint: 5.0,
      duration: 1.0,
      alignment: "center",
      params: { easing: "ease-in-out" },
    };

    // Add transition
    timeline = addTransition(timeline, transition);
    assert.equal(timeline.transitions?.length, 1);
    assert.equal(timeline.transitions[0].id, "trans-ab");

    // Validation passes
    const errors = validateTimeline(timeline);
    assert.equal(errors.length, 0);

    // Update transition
    timeline = updateTransition(timeline, "trans-ab", { duration: 1.5 });
    assert.equal(timeline.transitions?.[0].duration, 1.5);

    // Remove transition
    timeline = removeTransition(timeline, "trans-ab");
    assert.equal(timeline.transitions?.length, 0);
  });

  it("validates that transitions reject invalid duration or non-existent tracks", () => {
    const timeline = createTimeline();

    const badTransition: TimelineTransition = {
      id: "bad-trans",
      type: "cross_dissolve",
      family: "dissolve",
      trackId: "nonexistent-track",
      editPoint: 5,
      duration: -1, // invalid negative duration
      alignment: "center",
    };

    const withBad = {
      ...timeline,
      transitions: [badTransition],
    };

    const errors = validateTimeline(withBad);
    assert.ok(errors.some((e) => e.includes("duration")), "Must flag negative duration");
    assert.ok(errors.some((e) => e.includes("track")), "Must flag nonexistent track");
  });
});
