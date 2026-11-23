import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectDialogueIntervals,
  evaluateDuckingGainAtTime,
} from "../src/lib/export/audioDucking.ts";
import { createTimeline, createTrack, createClip } from "../src/lib/timeline/model.ts";
import type { TimelineDocument, TrackDuckingConfig } from "../src/types/timeline.ts";

describe("Deterministic Audio Ducking Engine", () => {
  const defaultDucking: TrackDuckingConfig = {
    enabled: true,
    reductionDb: -12,
    attackMs: 150,
    releaseMs: 400,
  };

  it("returns empty intervals when no dialogue is present or dialogue tracks are muted", () => {
    const timeline = createTimeline();
    // Default tracks have no clips
    const intervals = collectDialogueIntervals(timeline);
    assert.deepEqual(intervals, []);

    // Muted video track
    const mutedVideoTrack = createTrack("video", "Video 1", 0, "dialogue");
    mutedVideoTrack.muted = true;
    mutedVideoTrack.clips.push(createClip("asset-1", mutedVideoTrack.id, 0, 0, 5));

    const mutedTimeline: TimelineDocument = {
      ...timeline,
      tracks: [mutedVideoTrack],
    };
    assert.deepEqual(collectDialogueIntervals(mutedTimeline), []);
  });

  it("collects dialogue intervals from video embedded audio and audio dialogue tracks", () => {
    const timeline = createTimeline();

    // Track 1: Video track with embedded audio
    const videoTrack = createTrack("video", "Video 1", 0, "dialogue");
    const clip1 = createClip("asset-1", videoTrack.id, 1.0, 0, 4.0); // 1.0 -> 5.0
    videoTrack.clips.push(clip1);

    // Track 2: Audio track with role "dialogue"
    const audioTrack = createTrack("audio", "Audio 1", 1, "dialogue");
    const clip2 = createClip("asset-2", audioTrack.id, 10.0, 0, 5.0); // 10.0 -> 15.0
    audioTrack.clips.push(clip2);

    const doc: TimelineDocument = {
      ...timeline,
      tracks: [videoTrack, audioTrack],
    };

    const intervals = collectDialogueIntervals(doc);
    assert.equal(intervals.length, 2);
    assert.equal(intervals[0].start, 1.0);
    assert.equal(intervals[0].end, 5.0);
    assert.equal(intervals[1].start, 10.0);
    assert.equal(intervals[1].end, 15.0);
  });

  it("merges dialogue intervals separated by gaps shorter than the merge threshold", () => {
    const timeline = createTimeline();
    const track = createTrack("audio", "Dialogue", 0, "dialogue");

    // Clip 1: [1.0, 3.0]
    const clip1 = createClip("asset-1", track.id, 1.0, 0, 2.0);
    // Clip 2: [3.3, 5.0] (gap of 0.3s < default mergeThresholdSec 0.55s)
    const clip2 = createClip("asset-2", track.id, 3.3, 0, 1.7);
    track.clips.push(clip1, clip2);

    const doc: TimelineDocument = { ...timeline, tracks: [track] };
    const merged = collectDialogueIntervals(doc, 0.55);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].start, 1.0);
    assert.equal(merged[0].end, 5.0);
  });

  it("evaluates ducking gain with attack ramp, dialogue minimum gain, and release ramp", () => {
    const intervals = [{ start: 2.0, end: 6.0 }];
    const config: TrackDuckingConfig = {
      enabled: true,
      reductionDb: -12, // 10^(-12/20) ≈ 0.2511886
      attackMs: 200,    // 0.2s: attack window is [1.8, 2.0]
      releaseMs: 400,   // 0.4s: release window is [6.0, 6.4]
    };

    const minGain = Math.pow(10, -12 / 20);

    // 1. Before attack window (t = 1.0): full volume
    assert.equal(evaluateDuckingGainAtTime(1.0, intervals, config), 1.0);

    // 2. Start of attack window (t = 1.8): 1.0
    const startAttack = evaluateDuckingGainAtTime(1.8, intervals, config);
    assert.ok(Math.abs(startAttack - 1.0) < 0.001);

    // 3. Mid attack window (t = 1.9): halfway between 1.0 and minGain
    const midAttack = evaluateDuckingGainAtTime(1.9, intervals, config);
    const expectedMidAttack = minGain + 0.5 * (1.0 - minGain);
    assert.ok(Math.abs(midAttack - expectedMidAttack) < 0.005);

    // 4. During dialogue (t = 2.0 to 6.0): clamped to minGain
    assert.ok(Math.abs(evaluateDuckingGainAtTime(2.0, intervals, config) - minGain) < 0.0001);
    assert.ok(Math.abs(evaluateDuckingGainAtTime(4.0, intervals, config) - minGain) < 0.0001);
    assert.ok(Math.abs(evaluateDuckingGainAtTime(6.0, intervals, config) - minGain) < 0.0001);

    // 5. Mid release window (t = 6.2): halfway between minGain and 1.0
    const midRelease = evaluateDuckingGainAtTime(6.2, intervals, config);
    const expectedMidRelease = minGain + 0.5 * (1.0 - minGain);
    assert.ok(Math.abs(midRelease - expectedMidRelease) < 0.005);

    // 6. End of release window (t = 6.4): restored to 1.0
    const endRelease = evaluateDuckingGainAtTime(6.4, intervals, config);
    assert.ok(Math.abs(endRelease - 1.0) < 0.001);

    // 7. After release window (t = 7.0): full volume
    assert.equal(evaluateDuckingGainAtTime(7.0, intervals, config), 1.0);
  });

  it("returns 1.0 when ducking is disabled or intervals list is empty", () => {
    const disabledConfig: TrackDuckingConfig = {
      ...defaultDucking,
      enabled: false,
    };
    assert.equal(evaluateDuckingGainAtTime(4.0, [{ start: 2.0, end: 6.0 }], disabledConfig), 1.0);
    assert.equal(evaluateDuckingGainAtTime(4.0, [], defaultDucking), 1.0);
  });
});
