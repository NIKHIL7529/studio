import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateCompositionAtTime, renderClipFrameToCanvas } from "../src/lib/composition/evaluator.ts";
import { createTimeline, createClip, createTextOverlay, addClipToTrack, addTransition } from "../src/lib/timeline/model.ts";
import type { TimelineTransition, TextOverlay, TimelineClip } from "../src/types/timeline.ts";

describe("Canonical Composition Evaluator", () => {
  it("evaluates active clips and keyframed transforms across time", () => {
    let timeline = createTimeline();
    const track = timeline.tracks[0];

    timeline = addClipToTrack(timeline, track.id, {
      ...createClip("asset-1", track.id, 2.0, 10.0, 20.0),
      id: "clip-1",
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
      ...createClip("asset-1", track.id, 0, 0, 10),
      id: "clip-a",
    });
    timeline = addClipToTrack(timeline, track.id, {
      ...createClip("asset-2", track.id, 10, 0, 10),
      id: "clip-b",
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
      ...createTextOverlay(2, 6),
      id: "cap-1",
      text: "Subtitled moment",
      x: 0.5,
      y: 0.8,
      fontSize: 24,
      color: "#ffffff",
      align: "center",
      overlayType: "caption",
    };
    const title: TextOverlay = {
      ...createTextOverlay(0, 10),
      id: "title-1",
      text: "Permanent Title",
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

  it("calculates audio fade-in and fade-out envelope gains and skips detached audio", () => {
    let timeline = createTimeline();
    const vTrack = timeline.tracks[0];

    // Clip with 2s fade in, 2s fade out over 10s duration [0, 10]
    const clipWithFades: TimelineClip = {
      ...createClip("asset-fades", vTrack.id, 0, 0, 10),
      id: "clip-fade",
      volume: 1.0,
      fadeIn: 2.0,
      fadeOut: 2.0,
      audioDetached: false,
    };
    timeline = addClipToTrack(timeline, vTrack.id, clipWithFades);

    // At t = 1.0 (midway through 2s fade in): gain should be 0.5
    const compStart = evaluateCompositionAtTime(timeline, 1.0);
    assert.equal(compStart.activeAudioSources.length, 1);
    assert.ok(Math.abs(compStart.activeAudioSources[0].volume - 0.5) < 0.01);

    // At t = 5.0 (between fades): gain should be 1.0
    const compCenter = evaluateCompositionAtTime(timeline, 5.0);
    assert.ok(Math.abs(compCenter.activeAudioSources[0].volume - 1.0) < 0.01);

    // At t = 9.0 (1s left of 2s fade out): gain should be 0.5
    const compEnd = evaluateCompositionAtTime(timeline, 9.0);
    assert.ok(Math.abs(compEnd.activeAudioSources[0].volume - 0.5) < 0.01);

    // When audioDetached is true on video clip, embedded audio is skipped
    const detachedTimeline: typeof timeline = {
      ...timeline,
      tracks: timeline.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => ({ ...c, audioDetached: true })),
      })),
    };
    const compDetached = evaluateCompositionAtTime(detachedTimeline, 5.0);
    assert.equal(compDetached.activeAudioSources.length, 0, "Embedded audio must be skipped when detached");
  });

  it("renderClipFrameToCanvas applies normalized crop, flip, and fit/fill/blur-bg framing", () => {
    const drawCalls: unknown[][] = [];
    const scaleCalls: { x: number; y: number }[] = [];
    let currentFilter = "";

    const mockCtx = {
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: (x: number, y: number) => {
        scaleCalls.push({ x, y });
      },
      rotate: () => {},
      drawImage: (...args: unknown[]) => {
        drawCalls.push(args);
      },
      fillRect: () => {},
      get filter() {
        return currentFilter;
      },
      set filter(v: string) {
        currentFilter = v;
      },
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;

    const mockSource = {} as CanvasImageSource;

    const baseClip: TimelineClip = {
      ...createClip("img-1", "track-v", 0, 0, 5),
      id: "clip-img",
      fitMode: "blur-bg",
      crop: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
      flipH: true,
      flipV: false,
    };

    renderClipFrameToCanvas(mockCtx, mockSource, 1920, 1080, 1080, 1920, baseClip);

    // For blur-bg: background pass drawn with blur filter, foreground pass drawn sharp
    assert.ok(drawCalls.length >= 2, "blur-bg must draw background layer and foreground layer");
    assert.ok(scaleCalls.some((s) => s.x === -1 && s.y === 1), "flipH must apply scale(-1, 1)");

    // Test "fit" mode
    drawCalls.length = 0;
    scaleCalls.length = 0;
    renderClipFrameToCanvas(mockCtx, mockSource, 1920, 1080, 1920, 1080, {
      ...baseClip,
      fitMode: "fit",
      flipH: false,
      flipV: false,
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    assert.equal(drawCalls.length, 1);
    // Draw call arguments: source, sx, sy, sw, sh, dx, dy, dw, dh
    const [, sx, sy, sw, sh] = drawCalls[0] as [unknown, number, number, number, number];
    assert.equal(sx, 0);
    assert.equal(sy, 0);
    assert.equal(sw, 1920);
    assert.equal(sh, 1080);
  });
});
