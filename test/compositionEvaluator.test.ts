import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateCompositionAtTime } from "../src/lib/composition/evaluator.ts";
import { createTimeline, addClipToTrack, addTransition } from "../src/lib/timeline/model.ts";
import { addTrack } from "../src/lib/timeline/editingOperations.ts";
import type { TimelineTransition, TextOverlay } from "../src/types/timeline.ts";

describe("Canonical Composition Evaluator", () => {
  it("evaluates active clips and keyframed transforms across time", () => {
    let timeline = createTimeline();
    const track = timeline.tracks[0];

    timeline = addClipToTrack(timeline, track.id, {
      id: "clip-1",
      assetId: "asset-1",
      trackId: track.id,
      startTime: 2.0,
      sourceIn: 10.0,
      sourceOut: 20.0,
      volume: 1.0,
      muted: false,
      keyframes: [
        { id: "kf-1", time: 0, property: "opacity", value: 0, interpolation: "linear" },
        { id: "kf-2", time: 2, property: "opacity", value: 1, interpolation: "linear" },
      ],
    });

    // Before clip start
    const compBefore = evaluateCompositionAtTime(timeline, 1.0);
    assert.equal(compBefore.activeClips.length, 0);

    // At clip start + 1s (time = 3.0, offset = 1.0)
    const compMid = evaluateCompositionAtTime(timeline, 3.0);
    assert.equal(compMid.activeClips.length, 1);
    assert.equal(compMid.activeClips[0].clip.id, "clip-1");
    assert.equal(compMid.activeClips[0].sourceTime, 11.0);
    assert.equal(compMid.activeClips[0].transform.opacity, 0.5);

    // At clip start + 2s (time = 4.0, offset = 2.0)
    const compFull = evaluateCompositionAtTime(timeline, 4.0);
    assert.equal(compFull.activeClips[0].transform.opacity, 1.0);
  });

  it("evaluates active transitions at cut points with normalized progress", () => {
    let timeline = createTimeline();
    const track = timeline.tracks[0];

    timeline = addClipToTrack(timeline, track.id, {
      id: "clip-a",
      assetId: "asset-1",
      trackId: track.id,
      startTime: 0,
      sourceIn: 0,
      sourceOut: 10,
      volume: 1,
      muted: false,
    });
    timeline = addClipToTrack(timeline, track.id, {
      id: "clip-b",
      assetId: "asset-2",
      trackId: track.id,
      startTime: 10,
      sourceIn: 0,
      sourceOut: 10,
      volume: 1,
      muted: false,
    });

    const trans: TimelineTransition = {
      id: "trans-1",
      type: "cross_dissolve",
      family: "dissolve",
      trackId: track.id,
      fromClipId: "clip-a",
      toClipId: "clip-b",
      editPoint: 10,
      duration: 2,
      alignment: "center",
      params: { easing: "linear" },
    };

    timeline = addTransition(timeline, trans);

    // Outside transition (time = 8.0)
    const compBefore = evaluateCompositionAtTime(timeline, 8.0);
    assert.equal(compBefore.activeTransitions.length, 0);

    // Inside transition at midpoint (time = 10.0) -> progress 0.5
    const compMid = evaluateCompositionAtTime(timeline, 10.0);
    assert.equal(compMid.activeTransitions.length, 1);
    assert.equal(compMid.activeTransitions[0].progress, 0.5);
    assert.equal(compMid.activeTransitions[0].fromClip?.id, "clip-a");
    assert.equal(compMid.activeTransitions[0].toClip?.id, "clip-b");
  });

  it("respects caption inclusion/exclusion options for export and preview", () => {
    let timeline = createTimeline();
    const caption: TextOverlay = {
      id: "cap-1",
      text: "Subtitled moment",
      startTime: 2,
      endTime: 6,
      x: 0.5,
      y: 0.8,
      fontSize: 24,
      color: "#ffffff",
      align: "center",
      overlayType: "caption",
    };
    const title: TextOverlay = {
      id: "title-1",
      text: "Permanent Title",
      startTime: 0,
      endTime: 10,
      x: 0.5,
      y: 0.2,
      fontSize: 32,
      color: "#ffffff",
      align: "center",
      overlayType: "title",
    };

    timeline = {
      ...timeline,
      textOverlays: [caption, title],
    };

    // When includeCaptions is false (e.g. export opt-out)
    const compNoCaps = evaluateCompositionAtTime(timeline, 4.0, {
      forExport: true,
      includeCaptions: false,
    });
    assert.equal(compNoCaps.activeOverlays.length, 1);
    assert.equal(compNoCaps.activeOverlays[0].overlay.overlayType, "title");

    // When includeCaptions is true
    const compWithCaps = evaluateCompositionAtTime(timeline, 4.0, {
      forExport: true,
      includeCaptions: true,
    });
    assert.equal(compWithCaps.activeOverlays.length, 2);
  });
});
