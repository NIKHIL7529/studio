/**
 * Comprehensive tests for the timeline model and undo/redo stack.
 *
 * Run: node --experimental-strip-types --test test/timeline.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createTimeline,
  createClip,
  createTextOverlay,
  addClipToTrack,
  removeClip,
  moveClip,
  trimClipStart,
  trimClipEnd,
  splitClip,
  duplicateClip,
  addTextOverlay,
  removeTextOverlay,
  updateTextOverlay,
  moveTextOverlay,
  getActiveClipAtTime,
  getActiveTextOverlaysAtTime,
  getTimelineDuration,
  validateTimeline,
} from "../src/lib/timeline/model.ts";

import { TimelineUndoStack } from "../src/lib/timeline/undoRedo.ts";
import type { TimelineDocument, TimelineClip, TextOverlay } from "../src/types/timeline.ts";
import {
  validateProjectDocument,
  createDefaultProject,
  serializeProjectDocument,
} from "../src/lib/projectValidation.ts";
import {
  computeSnapTargets,
  isInputTarget,
  snapTimeToTargets,
} from "../src/lib/timeline/interaction.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTimeline(): TimelineDocument {
  return createTimeline();
}

/** Adds a clip to the first video track of a fresh timeline. */
function addVideoClip(
  timeline: TimelineDocument,
  startTime: number,
  sourceIn: number,
  sourceOut: number,
): { timeline: TimelineDocument; clip: TimelineClip } {
  const videoTrack = timeline.tracks.find((t) => t.type === "video")!;
  const clip = createClip("asset-1", videoTrack.id, startTime, sourceIn, sourceOut);
  const updated = addClipToTrack(timeline, videoTrack.id, clip);
  return { timeline: updated, clip };
}

// ─── createTimeline ───────────────────────────────────────────────────────────

describe("createTimeline", () => {
  it("produces a timeline with one video and one audio track", () => {
    const tl = makeTimeline();
    assert.ok(tl.id, "should have an id");
    assert.equal(tl.tracks.length, 2, "should have exactly 2 tracks");

    const video = tl.tracks.find((t) => t.type === "video");
    const audio = tl.tracks.find((t) => t.type === "audio");
    assert.ok(video, "should have a video track");
    assert.ok(audio, "should have an audio track");
    assert.equal(video!.clips.length, 0);
    assert.equal(audio!.clips.length, 0);
  });

  it("produces an empty textOverlays array", () => {
    const tl = makeTimeline();
    assert.deepEqual(tl.textOverlays, []);
  });

  it("produces an empty settings object", () => {
    const tl = makeTimeline();
    assert.deepEqual(tl.settings, {});
  });

  it("generates unique IDs each call", () => {
    const a = makeTimeline();
    const b = makeTimeline();
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.tracks[0].id, b.tracks[0].id);
  });
});

// ─── addClipToTrack / removeClip ─────────────────────────────────────────────

describe("addClipToTrack", () => {
  it("appends a clip to the correct track", () => {
    const tl = makeTimeline();
    const videoTrack = tl.tracks.find((t) => t.type === "video")!;
    const clip = createClip("asset-1", videoTrack.id, 0, 0, 10);
    const updated = addClipToTrack(tl, videoTrack.id, clip);

    assert.equal(updated.tracks.find((t) => t.type === "video")!.clips.length, 1);
  });

  it("does not mutate the original timeline", () => {
    const tl = makeTimeline();
    const videoTrack = tl.tracks.find((t) => t.type === "video")!;
    const clip = createClip("asset-1", videoTrack.id, 0, 0, 10);
    addClipToTrack(tl, videoTrack.id, clip);

    assert.equal(tl.tracks.find((t) => t.type === "video")!.clips.length, 0);
  });

  it("throws when trackId does not exist", () => {
    const tl = makeTimeline();
    const clip = createClip("asset-1", "nonexistent", 0, 0, 10);
    assert.throws(
      () => addClipToTrack(tl, "nonexistent", clip),
      /not found/i,
    );
  });
});

describe("removeClip", () => {
  it("removes the clip from its track", () => {
    const tl = makeTimeline();
    const { timeline: tl2, clip } = addVideoClip(tl, 0, 0, 10);
    const tl3 = removeClip(tl2, clip.id);

    assert.equal(tl3.tracks.find((t) => t.type === "video")!.clips.length, 0);
  });

  it("is a no-op for a nonexistent clipId", () => {
    const tl = makeTimeline();
    const tl2 = removeClip(tl, "nope");
    assert.deepEqual(tl2.tracks, tl.tracks);
  });

  it("does not mutate the original timeline", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 0, 0, 10);
    removeClip(tl, clip.id);
    assert.equal(tl.tracks.find((t) => t.type === "video")!.clips.length, 1);
  });
});

// ─── moveClip ────────────────────────────────────────────────────────────────

describe("moveClip", () => {
  it("updates startTime", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 0, 0, 10);
    const tl2 = moveClip(tl, clip.id, 5);
    const moved = tl2.tracks.find((t) => t.type === "video")!.clips[0];
    assert.equal(moved.startTime, 5);
  });

  it("clamps negative values to 0", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 2, 0, 10);
    const tl2 = moveClip(tl, clip.id, -3);
    const moved = tl2.tracks.find((t) => t.type === "video")!.clips[0];
    assert.equal(moved.startTime, 0);
  });

  it("clamps exactly 0", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 5, 0, 10);
    const tl2 = moveClip(tl, clip.id, 0);
    const moved = tl2.tracks.find((t) => t.type === "video")!.clips[0];
    assert.equal(moved.startTime, 0);
  });

  it("is a no-op for nonexistent clipId", () => {
    const tl = makeTimeline();
    const tl2 = moveClip(tl, "ghost", 5);
    assert.deepEqual(tl2.tracks, tl.tracks);
  });
});

// ─── trimClipStart / trimClipEnd ─────────────────────────────────────────────

describe("trimClipStart", () => {
  it("updates sourceIn and startTime", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 0, 0, 10);
    const tl2 = trimClipStart(tl, clip.id, 3, 0);
    const trimmed = tl2.tracks.find((t) => t.type === "video")!.clips[0];
    assert.equal(trimmed.sourceIn, 3);
    assert.equal(trimmed.startTime, 0);
  });

  it("throws when newSourceIn >= sourceOut", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 0, 0, 10);
    assert.throws(() => trimClipStart(tl, clip.id, 10, 0), /trimClipStart/);
    assert.throws(() => trimClipStart(tl, clip.id, 11, 0), /trimClipStart/);
  });

  it("clamps startTime to 0", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 2, 0, 10);
    const tl2 = trimClipStart(tl, clip.id, 1, -5);
    const trimmed = tl2.tracks.find((t) => t.type === "video")!.clips[0];
    assert.equal(trimmed.startTime, 0);
  });

  it("is a no-op for nonexistent clipId", () => {
    const tl = makeTimeline();
    const tl2 = trimClipStart(tl, "ghost", 1, 1);
    assert.deepEqual(tl2.tracks, tl.tracks);
  });
});

describe("trimClipEnd", () => {
  it("updates sourceOut", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 0, 0, 10);
    const tl2 = trimClipEnd(tl, clip.id, 7);
    const trimmed = tl2.tracks.find((t) => t.type === "video")!.clips[0];
    assert.equal(trimmed.sourceOut, 7);
  });

  it("throws when newSourceOut <= sourceIn", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 0, 2, 10);
    assert.throws(() => trimClipEnd(tl, clip.id, 2), /trimClipEnd/);
    assert.throws(() => trimClipEnd(tl, clip.id, 1), /trimClipEnd/);
  });

  it("is a no-op for nonexistent clipId", () => {
    const tl = makeTimeline();
    const tl2 = trimClipEnd(tl, "ghost", 5);
    assert.deepEqual(tl2.tracks, tl.tracks);
  });
});

// ─── splitClip ───────────────────────────────────────────────────────────────

describe("splitClip", () => {
  it("splits into two clips with continuous source ranges", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 0, 0, 10);
    const tl2 = splitClip(tl, clip.id, 4);
    assert.ok(tl2, "should return a timeline");

    const clips = tl2!.tracks.find((t) => t.type === "video")!.clips;
    assert.equal(clips.length, 2);

    const [first, second] = clips;
    assert.equal(first.sourceIn, 0);
    assert.equal(first.sourceOut, 4);
    assert.equal(first.startTime, 0);

    assert.equal(second.sourceIn, 4);
    assert.equal(second.sourceOut, 10);
    assert.equal(second.startTime, 4); // 0 + (4 - 0)
  });

  it("gives the second clip a new unique ID", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 0, 0, 10);
    const tl2 = splitClip(tl, clip.id, 5)!;
    const clips = tl2.tracks.find((t) => t.type === "video")!.clips;
    assert.notEqual(clips[0].id, clips[1].id);
  });

  it("returns null when split point is at sourceIn boundary", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 0, 0, 10);
    assert.equal(splitClip(tl, clip.id, 0), null);
  });

  it("returns null when split point is at sourceOut boundary", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 0, 0, 10);
    assert.equal(splitClip(tl, clip.id, 10), null);
  });

  it("returns null when split point is outside the clip", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 0, 2, 8);
    assert.equal(splitClip(tl, clip.id, 1), null);
    assert.equal(splitClip(tl, clip.id, 9), null);
  });

  it("returns null for nonexistent clipId", () => {
    const tl = makeTimeline();
    assert.equal(splitClip(tl, "ghost", 5), null);
  });

  it("preserves all other properties on both clips (assetId, volume, etc.)", () => {
    let tl = makeTimeline();
    const videoTrack = tl.tracks.find((t) => t.type === "video")!;
    const clip = createClip("asset-xyz", videoTrack.id, 10, 0, 20);
    // Manually set volume and muted
    const customClip: TimelineClip = { ...clip, volume: 0.5, muted: true };
    tl = addClipToTrack(tl, videoTrack.id, customClip);

    const tl2 = splitClip(tl, customClip.id, 10)!;
    const clips = tl2.tracks.find((t) => t.type === "video")!.clips;
    for (const c of clips) {
      assert.equal(c.assetId, "asset-xyz");
      assert.equal(c.volume, 0.5);
      assert.equal(c.muted, true);
    }
  });

  it("handles non-zero sourceIn offset", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 5, 10, 20);
    const tl2 = splitClip(tl, clip.id, 15)!;
    const clips = tl2.tracks.find((t) => t.type === "video")!.clips;

    assert.equal(clips[0].sourceIn, 10);
    assert.equal(clips[0].sourceOut, 15);
    assert.equal(clips[0].startTime, 5);

    assert.equal(clips[1].sourceIn, 15);
    assert.equal(clips[1].sourceOut, 20);
    assert.equal(clips[1].startTime, 10); // 5 + (15 - 10)
  });
});

// ─── duplicateClip ───────────────────────────────────────────────────────────

describe("duplicateClip", () => {
  it("adds a new clip with a unique ID and specified startTime", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 0, 0, 10);
    const tl2 = duplicateClip(tl, clip.id, 15);
    const clips = tl2.tracks.find((t) => t.type === "video")!.clips;
    assert.equal(clips.length, 2);
    assert.notEqual(clips[0].id, clips[1].id);
    assert.equal(clips[1].startTime, 15);
  });

  it("copies source range from original", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 0, 2, 8);
    const tl2 = duplicateClip(tl, clip.id, 20);
    const dup = tl2.tracks.find((t) => t.type === "video")!.clips[1];
    assert.equal(dup.sourceIn, 2);
    assert.equal(dup.sourceOut, 8);
  });

  it("clamps negative startTime to 0", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 0, 0, 5);
    const tl2 = duplicateClip(tl, clip.id, -3);
    const dup = tl2.tracks.find((t) => t.type === "video")!.clips[1];
    assert.equal(dup.startTime, 0);
  });

  it("is a no-op for nonexistent clipId", () => {
    const tl = makeTimeline();
    const tl2 = duplicateClip(tl, "ghost", 5);
    assert.deepEqual(tl2.tracks, tl.tracks);
  });
});

// ─── Text overlay operations ─────────────────────────────────────────────────

describe("addTextOverlay / removeTextOverlay", () => {
  it("adds an overlay", () => {
    const tl = makeTimeline();
    const overlay = createTextOverlay(1, 5);
    const tl2 = addTextOverlay(tl, overlay);
    assert.equal(tl2.textOverlays.length, 1);
    assert.equal(tl2.textOverlays[0].id, overlay.id);
  });

  it("does not mutate original", () => {
    const tl = makeTimeline();
    const overlay = createTextOverlay(1, 5);
    addTextOverlay(tl, overlay);
    assert.equal(tl.textOverlays.length, 0);
  });

  it("removes an overlay", () => {
    const tl = makeTimeline();
    const overlay = createTextOverlay(1, 5);
    const tl2 = addTextOverlay(tl, overlay);
    const tl3 = removeTextOverlay(tl2, overlay.id);
    assert.equal(tl3.textOverlays.length, 0);
  });

  it("removeTextOverlay is a no-op for nonexistent overlayId", () => {
    const tl = makeTimeline();
    const tl2 = removeTextOverlay(tl, "ghost");
    assert.deepEqual(tl2.textOverlays, []);
  });
});

describe("updateTextOverlay", () => {
  it("applies a partial patch", () => {
    const tl = addTextOverlay(makeTimeline(), createTextOverlay(0, 5));
    const overlay = tl.textOverlays[0];
    const tl2 = updateTextOverlay(tl, overlay.id, { text: "Hello", fontSize: 48 });
    const updated = tl2.textOverlays[0];
    assert.equal(updated.text, "Hello");
    assert.equal(updated.fontSize, 48);
    // Other fields untouched
    assert.equal(updated.color, overlay.color);
  });

  it("is a no-op for nonexistent overlayId", () => {
    const tl = makeTimeline();
    const tl2 = updateTextOverlay(tl, "ghost", { text: "X" });
    assert.deepEqual(tl2.textOverlays, []);
  });
});

describe("moveTextOverlay", () => {
  it("updates startTime and endTime", () => {
    const tl = addTextOverlay(makeTimeline(), createTextOverlay(0, 5));
    const overlay = tl.textOverlays[0];
    const tl2 = moveTextOverlay(tl, overlay.id, 3, 9);
    const moved = tl2.textOverlays[0];
    assert.equal(moved.startTime, 3);
    assert.equal(moved.endTime, 9);
  });
});

// ─── getActiveClipAtTime ─────────────────────────────────────────────────────

describe("getActiveClipAtTime", () => {
  it("returns clip covering the given time", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 0, 0, 10);
    const result = getActiveClipAtTime(tl, 5);
    assert.equal(result?.id, clip.id);
  });

  it("includes startTime (inclusive boundary)", () => {
    const { timeline: tl, clip } = addVideoClip(makeTimeline(), 2, 0, 5);
    const result = getActiveClipAtTime(tl, 2);
    assert.equal(result?.id, clip.id);
  });

  it("excludes end (exclusive boundary)", () => {
    const { timeline: tl } = addVideoClip(makeTimeline(), 0, 0, 5);
    // clip ends at startTime + (sourceOut - sourceIn) = 0 + 5 = 5
    const result = getActiveClipAtTime(tl, 5);
    assert.equal(result, null);
  });

  it("returns null for a gap between clips", () => {
    let tl = makeTimeline();
    const videoTrack = tl.tracks.find((t) => t.type === "video")!;

    const c1 = createClip("a1", videoTrack.id, 0, 0, 5);
    const c2 = createClip("a1", videoTrack.id, 10, 0, 5);
    tl = addClipToTrack(tl, videoTrack.id, c1);
    tl = addClipToTrack(tl, videoTrack.id, c2);

    // Gap is between 5 and 10
    assert.equal(getActiveClipAtTime(tl, 7), null);
  });

  it("returns null before any clips", () => {
    const { timeline: tl } = addVideoClip(makeTimeline(), 5, 0, 5);
    assert.equal(getActiveClipAtTime(tl, 2), null);
  });

  it("ignores audio-track clips", () => {
    const tl = makeTimeline();
    const audioTrack = tl.tracks.find((t) => t.type === "audio")!;
    const clip = createClip("a1", audioTrack.id, 0, 0, 10);
    const tl2 = addClipToTrack(tl, audioTrack.id, clip);
    assert.equal(getActiveClipAtTime(tl2, 5), null);
  });

  it("returns first video-track clip when multiple overlap", () => {
    // This exercises that we return the first one found (track order)
    let tl = makeTimeline();
    const videoTrack = tl.tracks.find((t) => t.type === "video")!;
    const c1 = createClip("a1", videoTrack.id, 0, 0, 10);
    const c2 = createClip("a2", videoTrack.id, 0, 0, 10);
    tl = addClipToTrack(tl, videoTrack.id, c1);
    tl = addClipToTrack(tl, videoTrack.id, c2);
    const result = getActiveClipAtTime(tl, 5);
    assert.equal(result?.id, c1.id);
  });
});

// ─── getActiveTextOverlaysAtTime ─────────────────────────────────────────────

describe("getActiveTextOverlaysAtTime", () => {
  function buildOverlayTimeline() {
    let tl = makeTimeline();
    const o1 = createTextOverlay(0, 5);
    const o2 = createTextOverlay(3, 8);
    const o3 = createTextOverlay(10, 15);
    tl = addTextOverlay(tl, o1);
    tl = addTextOverlay(tl, o2);
    tl = addTextOverlay(tl, o3);
    return { tl, o1, o2, o3 };
  }

  it("enforces single text overlay at time=4 (no multiple overlapping overlays)", () => {
    const { tl, o2 } = buildOverlayTimeline();
    const result = getActiveTextOverlaysAtTime(tl, 4);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, o2.id);
  });

  it("includes startTime (inclusive)", () => {
    const { tl, o1 } = buildOverlayTimeline();
    const result = getActiveTextOverlaysAtTime(tl, 0);
    assert.ok(result.some((o) => o.id === o1.id));
  });

  it("excludes endTime (exclusive)", () => {
    const { tl, o1 } = buildOverlayTimeline();
    // o1 ends at 5; time=5 should NOT include o1
    const result = getActiveTextOverlaysAtTime(tl, 5);
    assert.ok(!result.some((o) => o.id === o1.id));
  });

  it("returns empty array in a gap", () => {
    const { tl } = buildOverlayTimeline();
    // Gap between 8 and 10
    const result = getActiveTextOverlaysAtTime(tl, 9);
    assert.equal(result.length, 0);
  });
});

// ─── getTimelineDuration ─────────────────────────────────────────────────────

describe("getTimelineDuration", () => {
  it("returns 0 for an empty timeline", () => {
    assert.equal(getTimelineDuration(makeTimeline()), 0);
  });

  it("returns the end of the longest clip", () => {
    let tl = makeTimeline();
    tl = addVideoClip(tl, 0, 0, 10).timeline;
    tl = addVideoClip(tl, 5, 0, 20).timeline; // ends at 5+20=25
    assert.equal(getTimelineDuration(tl), 25);
  });

  it("includes text overlay endTime", () => {
    let tl = makeTimeline();
    tl = addVideoClip(tl, 0, 0, 10).timeline; // ends at 10
    const overlay = createTextOverlay(0, 30);
    tl = addTextOverlay(tl, overlay);
    assert.equal(getTimelineDuration(tl), 30);
  });

  it("handles non-zero sourceIn offsets correctly", () => {
    // clip startTime=0, sourceIn=5, sourceOut=15 → duration=10, end=10
    const { timeline: tl } = addVideoClip(makeTimeline(), 0, 5, 15);
    assert.equal(getTimelineDuration(tl), 10);
  });
});

// ─── validateTimeline ────────────────────────────────────────────────────────

describe("validateTimeline", () => {
  it("returns empty array for a valid timeline", () => {
    const { timeline: tl } = addVideoClip(makeTimeline(), 0, 0, 10);
    const errors = validateTimeline(tl);
    assert.deepEqual(errors, []);
  });

  it("flags negative startTime", () => {
    let tl = makeTimeline();
    const videoTrack = tl.tracks.find((t) => t.type === "video")!;
    const clip = createClip("a1", videoTrack.id, -1, 0, 10);
    tl = addClipToTrack(tl, videoTrack.id, clip);
    const errors = validateTimeline(tl);
    assert.ok(errors.some((e) => e.includes("startTime")));
  });

  it("flags negative sourceIn", () => {
    let tl = makeTimeline();
    const videoTrack = tl.tracks.find((t) => t.type === "video")!;
    // We bypass createClip to inject invalid data
    const clip: TimelineClip = {
      ...createClip("a1", videoTrack.id, 0, 0, 10),
      sourceIn: -1,
    };
    tl = addClipToTrack(tl, videoTrack.id, clip);
    const errors = validateTimeline(tl);
    assert.ok(errors.some((e) => e.includes("sourceIn")));
  });

  it("flags sourceOut <= sourceIn", () => {
    let tl = makeTimeline();
    const videoTrack = tl.tracks.find((t) => t.type === "video")!;
    const clip: TimelineClip = {
      ...createClip("a1", videoTrack.id, 0, 5, 5),
    };
    tl = addClipToTrack(tl, videoTrack.id, clip);
    const errors = validateTimeline(tl);
    assert.ok(errors.some((e) => e.includes("sourceOut")));
  });

  it("flags empty assetId", () => {
    let tl = makeTimeline();
    const videoTrack = tl.tracks.find((t) => t.type === "video")!;
    const clip: TimelineClip = {
      ...createClip("", videoTrack.id, 0, 0, 10),
    };
    tl = addClipToTrack(tl, videoTrack.id, clip);
    const errors = validateTimeline(tl);
    assert.ok(errors.some((e) => e.includes("assetId")));
  });

  it("flags empty trackId", () => {
    let tl = makeTimeline();
    const videoTrack = tl.tracks.find((t) => t.type === "video")!;
    const clip: TimelineClip = {
      ...createClip("a1", "", 0, 0, 10),
    };
    tl = addClipToTrack(tl, videoTrack.id, clip);
    const errors = validateTimeline(tl);
    assert.ok(errors.some((e) => e.includes("trackId")));
  });

  it("flags text overlay endTime <= startTime", () => {
    let tl = makeTimeline();
    // Inject invalid overlay directly
    const overlay: TextOverlay = {
      ...createTextOverlay(5, 3),
      text: "Bad",
      x: 0,
      y: 0,
      fontSize: 32,
      color: "#fff",
      align: "left",
    };
    tl = { ...tl, textOverlays: [overlay] };
    const errors = validateTimeline(tl);
    assert.ok(errors.some((e) => e.includes("endTime")));
  });

  it("returns multiple errors for multiple issues", () => {
    let tl = makeTimeline();
    const videoTrack = tl.tracks.find((t) => t.type === "video")!;
    const badClip: TimelineClip = {
      ...createClip("", "", -1, -1, -2),
    };
    tl = addClipToTrack(tl, videoTrack.id, badClip);
    const errors = validateTimeline(tl);
    assert.ok(errors.length > 1, `Expected multiple errors, got: ${JSON.stringify(errors)}`);
  });
});

// ─── TimelineUndoStack ────────────────────────────────────────────────────────

describe("TimelineUndoStack", () => {
  it("canUndo is false when empty", () => {
    const stack = new TimelineUndoStack();
    assert.equal(stack.canUndo(), false);
  });

  it("canRedo is false when empty", () => {
    const stack = new TimelineUndoStack();
    assert.equal(stack.canRedo(), false);
  });

  it("undo returns null when empty", () => {
    const stack = new TimelineUndoStack();
    assert.equal(stack.undo(), null);
  });

  it("redo returns null when empty", () => {
    const stack = new TimelineUndoStack();
    assert.equal(stack.redo(), null);
  });

  it("size is 0 when empty", () => {
    const stack = new TimelineUndoStack();
    assert.equal(stack.size, 0);
  });

  it("push increments size", () => {
    const stack = new TimelineUndoStack();
    stack.push(makeTimeline());
    assert.equal(stack.size, 1);
  });

  it("canUndo is false with only one entry (nothing to go back to)", () => {
    const stack = new TimelineUndoStack();
    stack.push(makeTimeline());
    assert.equal(stack.canUndo(), false);
  });

  it("canUndo is true after two pushes", () => {
    const stack = new TimelineUndoStack();
    stack.push(makeTimeline());
    stack.push(makeTimeline());
    assert.equal(stack.canUndo(), true);
  });

  it("undo returns previous state", () => {
    const stack = new TimelineUndoStack();
    const tl1 = makeTimeline();
    const tl2 = makeTimeline();
    stack.push(tl1);
    stack.push(tl2);
    const restored = stack.undo();
    assert.equal(restored?.id, tl1.id);
  });

  it("canRedo is true after undo", () => {
    const stack = new TimelineUndoStack();
    stack.push(makeTimeline());
    stack.push(makeTimeline());
    stack.undo();
    assert.equal(stack.canRedo(), true);
  });

  it("redo returns the state that was undone", () => {
    const stack = new TimelineUndoStack();
    const tl1 = makeTimeline();
    const tl2 = makeTimeline();
    stack.push(tl1);
    stack.push(tl2);
    stack.undo();
    const redone = stack.redo();
    assert.equal(redone?.id, tl2.id);
  });

  it("redo returns null when at newest", () => {
    const stack = new TimelineUndoStack();
    stack.push(makeTimeline());
    assert.equal(stack.redo(), null);
  });

  it("push after undo discards redo history", () => {
    const stack = new TimelineUndoStack();
    stack.push(makeTimeline());
    stack.push(makeTimeline());
    stack.undo();
    assert.equal(stack.canRedo(), true);

    // Push a new state — redo history should be discarded
    stack.push(makeTimeline());
    assert.equal(stack.canRedo(), false);
  });

  it("bounded: evicts oldest entry when over maxSize", () => {
    const maxSize = 3;
    const stack = new TimelineUndoStack(maxSize);
    const timelines: TimelineDocument[] = [];
    for (let i = 0; i < 5; i++) {
      const tl = makeTimeline();
      timelines.push(tl);
      stack.push(tl);
    }
    assert.equal(stack.size, maxSize);
  });

  it("bounded: oldest entries are evicted first", () => {
    const stack = new TimelineUndoStack(2);
    const tl1 = makeTimeline();
    const tl2 = makeTimeline();
    const tl3 = makeTimeline();

    stack.push(tl1);
    stack.push(tl2);
    stack.push(tl3); // tl1 should be evicted

    assert.equal(stack.size, 2);
    // After eviction: history = [tl2, tl3], cursor at index 1 (tl3)
    // Undo should give us tl2
    const restored = stack.undo();
    assert.equal(restored?.id, tl2.id);
  });

  it("clear resets size to 0", () => {
    const stack = new TimelineUndoStack();
    stack.push(makeTimeline());
    stack.push(makeTimeline());
    stack.clear();
    assert.equal(stack.size, 0);
    assert.equal(stack.canUndo(), false);
    assert.equal(stack.canRedo(), false);
  });

  it("undo and redo do not share references (deep clone)", () => {
    const stack = new TimelineUndoStack();
    const tl1 = makeTimeline();
    stack.push(tl1);
    stack.push(makeTimeline());

    const restored = stack.undo()!;
    // Mutating the restored object should not affect what undo returns next time
    restored.id = "mutated";

    stack.redo();
    const restoredAgain = stack.undo()!;
    assert.notEqual(restoredAgain.id, "mutated");
  });

  it("throws when maxSize < 1", () => {
    assert.throws(() => new TimelineUndoStack(0), /maxSize/);
  });

  it("multi-step undo/redo navigation", () => {
    const stack = new TimelineUndoStack();
    const tl1 = makeTimeline();
    const tl2 = makeTimeline();
    const tl3 = makeTimeline();

    stack.push(tl1);
    stack.push(tl2);
    stack.push(tl3);

    // undo twice
    const r1 = stack.undo()!;
    assert.equal(r1.id, tl2.id);
    const r2 = stack.undo()!;
    assert.equal(r2.id, tl1.id);
    assert.equal(stack.canUndo(), false);

    // redo once
    const r3 = stack.redo()!;
    assert.equal(r3.id, tl2.id);
    assert.equal(stack.canRedo(), true);
  });

  it("seeds with initial timeline document and allows single-edit undo/redo", () => {
    const initial = makeTimeline();
    const stack = new TimelineUndoStack(initial);

    assert.equal(stack.size, 1);
    assert.equal(stack.canUndo(), false);
    assert.equal(stack.canRedo(), false);

    // Apply 1st edit
    const edit1 = makeTimeline();
    stack.push(edit1);

    assert.equal(stack.size, 2);
    assert.equal(stack.canUndo(), true);
    assert.equal(stack.canRedo(), false);

    // Undo 1st edit
    const restored = stack.undo();
    assert.ok(restored);
    assert.equal(restored.id, initial.id);
    assert.equal(stack.canUndo(), false);
    assert.equal(stack.canRedo(), true);

    // Redo 1st edit
    const redone = stack.redo();
    assert.ok(redone);
    assert.equal(redone.id, edit1.id);
    assert.equal(stack.canUndo(), true);
    assert.equal(stack.canRedo(), false);
  });
});

// ─── computeSnapTargets ───────────────────────────────────────────────────────

describe("computeSnapTargets", () => {
  it("includes 0 and current playhead time", () => {
    const tl = makeTimeline();
    const targets = computeSnapTargets(tl, 4.5);
    assert.ok(targets.includes(0));
    assert.ok(targets.includes(4.5));
  });

  it("includes clip start and end points", () => {
    const tl = makeTimeline();
    const { timeline: tl2, clip } = addVideoClip(tl, 2.0, 0, 5.0);
    const targets = computeSnapTargets(tl2, 1.0);

    assert.ok(targets.includes(2.0)); // start
    assert.ok(targets.includes(7.0)); // start (2.0) + duration (5.0)
    assert.ok(targets.includes(clip.startTime));
  });

  it("includes text overlay start and end points", () => {
    const tl = makeTimeline();
    const overlay = createTextOverlay(3.0, 6.0);
    const updated = addTextOverlay(tl, overlay);
    const targets = computeSnapTargets(updated, 0);

    assert.ok(targets.includes(3.0));
    assert.ok(targets.includes(6.0));
  });

  it("excludes specified clipId (the one being dragged)", () => {
    const tl = makeTimeline();
    const { timeline: tl2, clip } = addVideoClip(tl, 2.0, 0, 5.0);
    const targets = computeSnapTargets(tl2, 0, clip.id);

    // Should NOT include the clip's 2.0 or 7.0 boundary
    assert.equal(targets.includes(2.0), false);
    assert.equal(targets.includes(7.0), false);
    assert.ok(targets.includes(0));
  });

  it("snapTimeToTargets snaps to candidate within threshold", () => {
    const candidates = [0, 2.0, 5.0, 10.0];
    assert.equal(snapTimeToTargets(2.05, candidates, 0.1), 2.0);
    assert.equal(snapTimeToTargets(4.95, candidates, 0.1), 5.0);
    assert.equal(snapTimeToTargets(3.5, candidates, 0.1), 3.5); // outside threshold
  });
});

// ─── isInputTarget (keyboard shortcut guard) ─────────────────────────────────

describe("isInputTarget", () => {
  it("returns true for INPUT element", () => {
    const mockEvent = { target: { tagName: "INPUT" } };
    assert.equal(isInputTarget(mockEvent as unknown as KeyboardEvent), true);
  });

  it("returns true for TEXTAREA element", () => {
    const mockEvent = { target: { tagName: "TEXTAREA" } };
    assert.equal(isInputTarget(mockEvent as unknown as KeyboardEvent), true);
  });

  it("returns true for contentEditable element", () => {
    const mockEvent = { target: { tagName: "DIV", isContentEditable: true } };
    assert.equal(isInputTarget(mockEvent as unknown as KeyboardEvent), true);
  });

  it("returns false for non-input elements", () => {
    const buttonEvent = { target: { tagName: "BUTTON" } };
    const divEvent = { target: { tagName: "DIV" } };
    const nullEvent = { target: null };

    assert.equal(isInputTarget(buttonEvent as unknown as KeyboardEvent), false);
    assert.equal(isInputTarget(divEvent as unknown as KeyboardEvent), false);
    assert.equal(isInputTarget(nullEvent as unknown as KeyboardEvent), false);
  });
});

// ─── Timeline persistence & validation roundtrip ─────────────────────────────

describe("Timeline persistence & validation roundtrip", () => {
  it("validates and preserves timeline within ProjectDocument", () => {
    const doc = createDefaultProject("Editor Project");
    const assetId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    doc.assets.push({
      id: assetId,
      name: "sample.mp4",
      kind: "video",
      mediaType: "video",
      mimeType: "video/mp4",
      size: 1024,
      handleRefId: "ref-1",
    });

    const tl = makeTimeline();
    const videoTrack = tl.tracks.find((t) => t.type === "video")!;
    const clip = createClip(assetId, videoTrack.id, 0, 1.5, 8.5);
    const withClip = addClipToTrack(tl, videoTrack.id, clip);
    const overlay = createTextOverlay(2.0, 5.0);
    overlay.text = "Hello World";
    const withOverlay = addTextOverlay(withClip, overlay);

    doc.timeline = withOverlay;

    const res = validateProjectDocument(doc);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.ok(res.data.timeline);
      assert.equal(res.data.timeline.tracks.length, 2);
      const vTrack = res.data.timeline.tracks.find((t) => t.type === "video")!;
      assert.equal(vTrack.clips.length, 1);
      assert.equal(vTrack.clips[0].sourceIn, 1.5);
      assert.equal(vTrack.clips[0].sourceOut, 8.5);
      assert.equal(res.data.timeline.textOverlays.length, 1);
      assert.equal(res.data.timeline.textOverlays[0].text, "Hello World");
    }
  });

  it("serializes to JSON and parses back with identical timeline structure", () => {
    const doc = createDefaultProject("Serialized Project");
    const tl = makeTimeline();
    const overlay = createTextOverlay(1.0, 4.0);
    overlay.text = "Caption";
    doc.timeline = addTextOverlay(tl, overlay);

    const serialized = serializeProjectDocument(doc);
    const parsed = JSON.parse(serialized);
    const validated = validateProjectDocument(parsed);

    assert.equal(validated.ok, true);
    if (validated.ok) {
      assert.ok(validated.data.timeline);
      assert.equal(validated.data.timeline.id, tl.id);
      assert.equal(validated.data.timeline.textOverlays[0].text, "Caption");
      assert.equal(validated.data.timeline.textOverlays[0].startTime, 1.0);
      assert.equal(validated.data.timeline.textOverlays[0].endTime, 4.0);
    }
  });

  it("rejects project document with corrupt timeline", () => {
    const doc = createDefaultProject("Corrupt Project");
    (doc as unknown as Record<string, unknown>).timeline = {
      id: "invalid-uuid",
      tracks: "not-an-array",
    };

    const res = validateProjectDocument(doc);
    assert.equal(res.ok, false);
    assert.match(res.error, /timeline/i);
  });
});

// ─── Offline source resilience ───────────────────────────────────────────────

describe("Offline source resilience", () => {
  it("preserves timeline clips when referenced source is missing or offline", () => {
    const tl = makeTimeline();
    const missingAssetId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const videoTrack = tl.tracks.find((t) => t.type === "video")!;
    const clip = createClip(missingAssetId, videoTrack.id, 5.0, 0, 10.0);
    const withClip = addClipToTrack(tl, videoTrack.id, clip);

    // Verify clip retains its values without throwing or resetting
    assert.equal(withClip.tracks[0].clips.length, 1);
    const savedClip = withClip.tracks[0].clips[0];
    assert.equal(savedClip.assetId, missingAssetId);
    assert.equal(savedClip.startTime, 5.0);
    assert.equal(savedClip.sourceIn, 0);
    assert.equal(savedClip.sourceOut, 10.0);

    // Moving and trimming offline clip still works
    const moved = moveClip(withClip, savedClip.id, 8.0);
    assert.equal(moved.tracks[0].clips[0].startTime, 8.0);
    assert.equal(moved.tracks[0].clips[0].assetId, missingAssetId);
  });
});
