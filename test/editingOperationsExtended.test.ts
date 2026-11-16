import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createTimeline,
  addClipToTrack,
  addTransition,
  removeTransition,
  updateTransition,
  validateTimeline,
} from "../src/lib/timeline/model.ts";
import { detachAudio, addTrack } from "../src/lib/timeline/editingOperations.ts";
import type { TimelineTransition } from "../src/types/timeline.ts";

describe("Extended Editing Operations & Transition Model", () => {
  it("detaches audio from video clip into an audio track and disables embedded audio", () => {
    let timeline = createTimeline();
    timeline = addTrack(timeline, "video");
    const videoTrack = timeline.tracks.find((t) => t.type === "video")!;

    timeline = addClipToTrack(timeline, videoTrack.id, {
      id: "vclip-1",
      assetId: "asset-raw",
      trackId: videoTrack.id,
      startTime: 5.0,
      sourceIn: 2.0,
      sourceOut: 12.0,
      volume: 0.8,
      muted: false,
    });

    const res = detachAudio(timeline, "vclip-1");
    assert.ok(res !== null, "detachAudio should succeed for video clip");

    const newTimeline = res.timeline;
    const audioTrack = newTimeline.tracks.find((t) => t.type === "audio");
    assert.ok(audioTrack, "An audio track must exist for detached audio");

    const detachedAudioClip = audioTrack.clips.find((c) => c.linkedClipId === "vclip-1");
    assert.ok(detachedAudioClip, "Detached audio clip must be linked to video clip");
    assert.equal(detachedAudioClip.startTime, 5.0);
    assert.equal(detachedAudioClip.sourceIn, 2.0);
    assert.equal(detachedAudioClip.sourceOut, 12.0);
    assert.equal(detachedAudioClip.volume, 0.8);

    // Verify video clip now has embeddedAudioDisabled = true
    const updatedVideo = newTimeline.tracks.flatMap((t) => t.clips).find((c) => c.id === "vclip-1")!;
    assert.equal(updatedVideo.embeddedAudioDisabled, true);
    assert.equal(updatedVideo.linkedClipId, detachedAudioClip.id);
  });

  it("adds, updates, and removes transitions with valid timeline consistency", () => {
    let timeline = createTimeline();
    const track = timeline.tracks[0];

    timeline = addClipToTrack(timeline, track.id, {
      id: "clip-a",
      assetId: "asset-1",
      trackId: track.id,
      startTime: 0,
      sourceIn: 0,
      sourceOut: 5,
      volume: 1,
      muted: false,
    });
    timeline = addClipToTrack(timeline, track.id, {
      id: "clip-b",
      assetId: "asset-2",
      trackId: track.id,
      startTime: 5,
      sourceIn: 0,
      sourceOut: 5,
      volume: 1,
      muted: false,
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
