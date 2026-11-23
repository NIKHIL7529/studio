import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createTimeline,
  createClip,
  addClipToTrack,
  getClipTimelineDuration,
  splitClip,
  validateTimeline,
} from "../src/lib/timeline/model.ts";
import {
  setClipSpeed,
  insertFreezeFrameAtPlayhead,
  toggleTrackLock,
} from "../src/lib/timeline/editingOperations.ts";
import {
  resampleAudioChannel,
  timeStretchOLA,
} from "../src/lib/export/audioRenderer.ts";
import {
  validateAsset,
  validateTimelineDocument,
} from "../src/lib/projectValidation.ts";
import { inferMediaCategory } from "../src/lib/mediaImport.ts";
import type { TimelineClip } from "../src/types/timeline.ts";

describe("Clip Speed & Duration Math", () => {
  it("computes timeline duration according to playbackRate invariant", () => {
    const normalClip = createClip("asset-1", "track-v1", 0, 0, 10);
    assert.equal(getClipTimelineDuration(normalClip), 10);

    const fastClip: TimelineClip = { ...normalClip, playbackRate: 2.0 };
    assert.equal(getClipTimelineDuration(fastClip), 5.0);

    const slowClip: TimelineClip = { ...normalClip, playbackRate: 0.5 };
    assert.equal(getClipTimelineDuration(slowClip), 20.0);

    // Freeze frame clip always plays at 1.0x regardless of playbackRate
    const freezeClip: TimelineClip = {
      ...normalClip,
      playbackRate: 2.0,
      freezeFrameSourceTime: 4.5,
    };
    assert.equal(getClipTimelineDuration(freezeClip), 10.0);
  });

  it("adjusts speed with ripple and non-ripple collision resolution", () => {
    let tl = createTimeline();
    const track = tl.tracks.find((t) => t.type === "video")!;

    // Add clip A: [0, 10) (10s duration)
    const clipA = { ...createClip("asset-1", track.id, 0, 0, 10), id: "clip-a" };
    // Add clip B: [12, 18) (6s duration)
    const clipB = { ...createClip("asset-2", track.id, 12, 0, 6), id: "clip-b" };

    tl = addClipToTrack(tl, track.id, clipA);
    tl = addClipToTrack(tl, track.id, clipB);

    // 1. Speed up to 2.0x with ripple: true -> duration shrinks to 5s (delta = -5s)
    const rippledFast = setClipSpeed(tl, "clip-a", 2.0, { ripple: true });
    const fastA = rippledFast.tracks[0].clips.find((c) => c.id === "clip-a")!;
    const fastB = rippledFast.tracks[0].clips.find((c) => c.id === "clip-b")!;
    assert.equal(fastA.playbackRate, 2.0);
    assert.equal(getClipTimelineDuration(fastA), 5.0);
    assert.equal(fastB.startTime, 7.0); // 12 - 5 = 7

    // 2. Slow down to 0.5x with ripple: false -> duration expands to 20s
    // clip B was at 12s, which collides with [0, 20s). Non-ripple resolves collision by pushing clip B to 20s.
    const nonRippledSlow = setClipSpeed(tl, "clip-a", 0.5, { ripple: false });
    const slowA = nonRippledSlow.tracks[0].clips.find((c) => c.id === "clip-a")!;
    const slowB = nonRippledSlow.tracks[0].clips.find((c) => c.id === "clip-b")!;
    assert.equal(slowA.playbackRate, 0.5);
    assert.equal(getClipTimelineDuration(slowA), 20.0);
    assert.equal(slowB.startTime, 20.0);

    // 3. Clamps out of range speed values
    const clampedMax = setClipSpeed(tl, "clip-a", 10.0);
    assert.equal(clampedMax.tracks[0].clips.find((c) => c.id === "clip-a")!.playbackRate, 4.0);

    const clampedMin = setClipSpeed(tl, "clip-a", 0.05);
    assert.equal(clampedMin.tracks[0].clips.find((c) => c.id === "clip-a")!.playbackRate, 0.25);

    // 4. Respects locked track
    const lockedTl = toggleTrackLock(tl, track.id);
    const lockedRes = setClipSpeed(lockedTl, "clip-a", 2.0);
    assert.equal(lockedRes.tracks[0].clips.find((c) => c.id === "clip-a")!.playbackRate, 1.0);
  });

  it("splits clips accurately at 0.5x and 2.0x playback rates", () => {
    let tl = createTimeline();
    const track = tl.tracks[0];
    const fastClip = {
      ...createClip("asset-1", track.id, 0, 10, 20), // 10s source at 2x = 5s timeline
      id: "fast-1",
      playbackRate: 2.0,
      preservePitch: true,
      freezeFrameSourceTime: null,
    };
    tl = addClipToTrack(tl, track.id, fastClip);

    // Split at source time 14 (4s into source, which is 2s on timeline)
    const splitTl = splitClip(tl, "fast-1", 14);
    assert.ok(splitTl);
    const [c1, c2] = splitTl.tracks[0].clips;
    assert.equal(c1.sourceIn, 10);
    assert.equal(c1.sourceOut, 14);
    assert.equal(c1.startTime, 0);
    assert.equal(c1.playbackRate, 2.0);
    assert.equal(getClipTimelineDuration(c1), 2.0);

    assert.equal(c2.sourceIn, 14);
    assert.equal(c2.sourceOut, 20);
    assert.equal(c2.startTime, 2.0);
    assert.equal(c2.playbackRate, 2.0);
    assert.equal(getClipTimelineDuration(c2), 3.0);
  });
});

describe("Freeze Frame Operations", () => {
  it("inserts freeze frame at playhead, splits clip, and shifts trailing clips", () => {
    let tl = createTimeline();
    const track = tl.tracks.find((t) => t.type === "video")!;

    // Clip: [0, 10) at 1.0x (source: 0 to 10)
    const clipA = { ...createClip("asset-1", track.id, 0, 0, 10), id: "clip-a" };
    // Subsequent clip: [15, 20)
    const clipB = { ...createClip("asset-2", track.id, 15, 0, 5), id: "clip-b" };

    tl = addClipToTrack(tl, track.id, clipA);
    tl = addClipToTrack(tl, track.id, clipB);

    // Freeze at playhead = 4.0s for 2.0s duration
    const frozenTl = insertFreezeFrameAtPlayhead(tl, "clip-a", 4.0, 2.0);
    const clips = frozenTl.tracks[0].clips;
    assert.equal(clips.length, 4);

    // First half of split clip: [0, 4.0) with source [0, 4.0)
    const firstHalf = clips[0];
    assert.equal(firstHalf.startTime, 0);
    assert.equal(firstHalf.sourceIn, 0);
    assert.equal(firstHalf.sourceOut, 4.0);

    // Freeze clip: [4.0, 6.0) holding source 4.0
    const freezeClip = clips[1];
    assert.equal(freezeClip.startTime, 4.0);
    assert.equal(getClipTimelineDuration(freezeClip), 2.0);
    assert.equal(freezeClip.freezeFrameSourceTime, 4.0);
    assert.equal(freezeClip.playbackRate, 1.0);
    assert.equal(freezeClip.audioDetached, true);

    // Trailing half: [6.0, 12.0) with source [4.0, 10.0)
    const trailingHalf = clips[2];
    assert.equal(trailingHalf.startTime, 6.0);
    assert.equal(trailingHalf.sourceIn, 4.0);
    assert.equal(trailingHalf.sourceOut, 10.0);

    // Subsequent clip: shifted right by 2.0s -> [17.0, 22.0)
    const shiftedB = clips[3];
    assert.equal(shiftedB.startTime, 17.0);
  });

  it("correctly computes freeze frame source time under non-1.0x playback rate", () => {
    let tl = createTimeline();
    const track = tl.tracks.find((t) => t.type === "video")!;

    // Clip at 2.0x: timeline [0, 5.0) covering source [10.0, 20.0)
    const fastClip = {
      ...createClip("asset-1", track.id, 0, 10.0, 20.0),
      id: "fast-clip",
      playbackRate: 2.0,
      preservePitch: true,
      freezeFrameSourceTime: null,
    };
    tl = addClipToTrack(tl, track.id, fastClip);

    // Playhead at 3.0s timeline -> source time should be 10.0 + (3.0 * 2.0) = 16.0
    const frozenTl = insertFreezeFrameAtPlayhead(tl, "fast-clip", 3.0, 2.0);
    const freezeClip = frozenTl.tracks[0].clips.find((c) => c.freezeFrameSourceTime !== null)!;
    assert.ok(freezeClip);
    assert.equal(freezeClip.freezeFrameSourceTime, 16.0);
  });

  it("enforces track lock and playhead bounds", () => {
    let tl = createTimeline();
    const track = tl.tracks.find((t) => t.type === "video")!;
    const clip = { ...createClip("asset-1", track.id, 5.0, 0, 10.0), id: "clip-bound" };
    tl = addClipToTrack(tl, track.id, clip);

    // Outside clip playhead (e.g. 2.0s) -> no change
    const noChange = insertFreezeFrameAtPlayhead(tl, "clip-bound", 2.0);
    assert.equal(noChange.tracks[0].clips.length, 1);

    // Locked track -> no change
    const lockedTl = toggleTrackLock(tl, track.id);
    const lockedRes = insertFreezeFrameAtPlayhead(lockedTl, "clip-bound", 7.0);
    assert.equal(lockedRes.tracks[0].clips.length, 1);
  });
});

describe("Audio Resampling & Pitch Preservation", () => {
  it("timeStretchOLA produces exact target output length for time compression and expansion", () => {
    const sampleRate = 48000;
    // 1 second of test audio (sine wave 440 Hz)
    const sourceLen = 48000;
    const source = new Float32Array(sourceLen);
    for (let i = 0; i < sourceLen; i++) {
      source[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }

    // 2.0x speed -> 0.5s output (24000 samples)
    const compressed = timeStretchOLA(source, 24000, sampleRate);
    assert.equal(compressed.length, 24000);
    assert.ok(Number.isFinite(compressed[0]));
    assert.ok(Number.isFinite(compressed[12000]));
    assert.ok(Number.isFinite(compressed[23999]));

    // 0.5x speed -> 2.0s output (96000 samples)
    const expanded = timeStretchOLA(source, 96000, sampleRate);
    assert.equal(expanded.length, 96000);
    assert.ok(Number.isFinite(expanded[0]));
    assert.ok(Number.isFinite(expanded[48000]));
    assert.ok(Number.isFinite(expanded[95999]));
  });

  it("resampleAudioChannel performs linear resampling to exact target length", () => {
    const source = new Float32Array([0.0, 0.5, 1.0, 0.5, 0.0]);
    const resampled = resampleAudioChannel(source, 44100, 48000, 10);
    assert.equal(resampled.length, 10);
    assert.equal(resampled[0], 0.0);
    assert.ok(Number.isFinite(resampled[5]));
  });
});

describe("Strict Validation Bounds", () => {
  it("validateTimeline enforces playbackRate, preservePitch, and freezeFrameSourceTime", () => {
    let tl = createTimeline();
    const track = tl.tracks[0];

    const validClip = createClip("asset-1", track.id, 0, 0, 10);
    tl = addClipToTrack(tl, track.id, validClip);
    assert.equal(validateTimeline(tl).length, 0);

    // Invalid playbackRate (< 0.25)
    const invalidRateTl = {
      ...tl,
      tracks: [{ ...track, clips: [{ ...validClip, playbackRate: 0.1 }] }],
    };
    const rateErrors = validateTimeline(invalidRateTl);
    assert.ok(rateErrors.some((e) => e.includes("playbackRate")));

    // Invalid preservePitch (non-boolean)
    const invalidPitchTl = {
      ...tl,
      tracks: [{ ...track, clips: [{ ...validClip, preservePitch: "yes" as unknown as boolean }] }],
    };
    const pitchErrors = validateTimeline(invalidPitchTl);
    assert.ok(pitchErrors.some((e) => e.includes("preservePitch")));

    // Invalid freezeFrameSourceTime (negative)
    const invalidFreezeTl = {
      ...tl,
      tracks: [{ ...track, clips: [{ ...validClip, freezeFrameSourceTime: -1.0 }] }],
    };
    const freezeErrors = validateTimeline(invalidFreezeTl);
    assert.ok(freezeErrors.some((e) => e.includes("freezeFrameSourceTime")));
  });

  it("enforces restricted image extensions in validation and inference", () => {
    // Media category inference
    assert.equal(inferMediaCategory("pic.png"), "image");
    assert.equal(inferMediaCategory("pic.jpg"), "image");
    assert.equal(inferMediaCategory("pic.jpeg"), "image");
    assert.equal(inferMediaCategory("pic.webp"), "image");
    assert.equal(inferMediaCategory("pic.svg"), "unknown");
    assert.equal(inferMediaCategory("pic.bmp"), "unknown");
    assert.equal(inferMediaCategory("pic.gif"), "unknown");

    // Asset validation
    const validAsset = {
      id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      name: "valid.png",
      kind: "image" as const,
      mediaType: "image",
      mimeType: "image/png",
      size: 1024,
      handleRefId: "h-1",
    };
    assert.equal(validateAsset(validAsset).ok, true);

    const invalidAsset = {
      ...validAsset,
      id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      name: "graphic.svg",
    };
    assert.equal(validateAsset(invalidAsset).ok, false);
  });

  it("validateTimelineDocument strictly parses new clip fields", () => {
    const rawTimeline = {
      id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      tracks: [
        {
          id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
          type: "video",
          name: "Video 1",
          order: 0,
          locked: false,
          muted: false,
          hidden: false,
          audioRole: "dialogue",
          ducking: {
            enabled: false,
            reductionDb: -12,
            attackMs: 150,
            releaseMs: 400,
          },
          clips: [
            {
              id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
              assetId: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
              trackId: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
              startTime: 0,
              sourceIn: 0,
              sourceOut: 5,
              volume: 1,
              muted: false,
              fitMode: "fit",
              crop: { top: 0, right: 0, bottom: 0, left: 0 },
              flipH: false,
              flipV: false,
              fadeIn: 0,
              fadeOut: 0,
              audioDetached: false,
              playbackRate: 1.5,
              preservePitch: false,
              freezeFrameSourceTime: 2.5,
              color: {
                presetId: "none",
                brightness: 0,
                contrast: 0,
                saturation: 0,
                exposure: 0,
                temperature: 0,
              },
            },
          ],
        },
      ],
      textOverlays: [],
      transitions: [],
      markers: [],
    };

    const res = validateTimelineDocument(rawTimeline);
    assert.equal(res.ok, true);
    if (res.ok) {
      const parsedClip = res.data.tracks[0].clips[0];
      assert.equal(parsedClip.playbackRate, 1.5);
      assert.equal(parsedClip.preservePitch, false);
      assert.equal(parsedClip.freezeFrameSourceTime, 2.5);
    }
  });
});
