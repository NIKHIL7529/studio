import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  interpolate,
  evaluatePropertyAtTime,
  evaluateClipTransform,
  evaluateOverlayAnimation,
  applyPresetAsKeyframes,
} from "../src/lib/animation/animationPresets.ts";
import type { TimelineClip, ClipKeyframe, TextOverlay } from "../src/types/timeline.ts";
import { DEFAULT_COLOR_ADJUSTMENTS } from "../src/lib/color/colorPresets.ts";

describe("Animation & Keyframe Evaluation", () => {
  it("interpolates curves correctly across linear, ease-in, ease-out, ease-in-out, and hold", () => {
    assert.equal(interpolate(0, "linear"), 0);
    assert.equal(interpolate(1, "linear"), 1);
    assert.equal(interpolate(0.5, "linear"), 0.5);

    assert.equal(interpolate(0.5, "hold"), 0);
    assert.equal(interpolate(1.0, "hold"), 1);

    const easeIn = interpolate(0.5, "ease-in");
    assert.ok(easeIn < 0.5, "easeIn at 0.5 should be below 0.5");

    const easeOut = interpolate(0.5, "ease-out");
    assert.ok(easeOut > 0.5, "easeOut at 0.5 should be above 0.5");

    const easeInOut = interpolate(0.5, "ease-in-out");
    assert.equal(easeInOut, 0.5, "easeInOut at 0.5 should be 0.5");
  });

  it("evaluates clip property keyframes across time", () => {
    const keyframes: ClipKeyframe[] = [
      { id: "kf-1", time: 0, property: "scaleX", value: 1.0, interpolation: "linear" },
      { id: "kf-2", time: 2, property: "scaleX", value: 1.5, interpolation: "linear" },
      { id: "kf-3", time: 4, property: "scaleX", value: 2.0, interpolation: "hold" },
    ];

    // Before first keyframe clamps to first value
    assert.equal(evaluatePropertyAtTime(keyframes, "scaleX", -1, 1.0), 1.0);
    // At first keyframe
    assert.equal(evaluatePropertyAtTime(keyframes, "scaleX", 0, 1.0), 1.0);
    // Halfway between kf-1 and kf-2
    assert.equal(evaluatePropertyAtTime(keyframes, "scaleX", 1.0, 1.0), 1.25);
    // At kf-2
    assert.equal(evaluatePropertyAtTime(keyframes, "scaleX", 2.0, 1.0), 1.5);
    // At 3.0 (halfway between kf-2 and kf-3 with linear interpolation)
    assert.equal(evaluatePropertyAtTime(keyframes, "scaleX", 3.0, 1.0), 1.75);
    // Beyond last keyframe clamps to last value
    assert.equal(evaluatePropertyAtTime(keyframes, "scaleX", 5.0, 1.0), 2.0);
  });

  it("evaluates clip transform with continuous preset (e.g. Ken Burns zoom in)", () => {
    const clip: TimelineClip = {
      id: "clip-1",
      assetId: "asset-1",
      trackId: "track-1",
      startTime: 0,
      sourceIn: 0,
      sourceOut: 10,
      volume: 1.0,
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
      animationPreset: {
        id: "preset-1",
        presetId: "ken_burns_in",
        category: "continuous",
        duration: 10,
        intensity: 1.0,
        seed: 42,
      },
    };

    const startTr = evaluateClipTransform(clip, 0);
    assert.equal(startTr.scaleX, 1.0);
    assert.equal(startTr.scaleY, 1.0);

    const midTr = evaluateClipTransform(clip, 5);
    assert.ok(midTr.scaleX > 1.0 && midTr.scaleX < 1.2, "Midpoint scale should be zoomed in");

    const endTr = evaluateClipTransform(clip, 10);
    assert.ok(endTr.scaleX >= 1.15, "End scale should reach target zoom");
  });

  it("evaluates deterministic camera shake with identical results for identical seeds", () => {
    const clipA: TimelineClip = {
      id: "clip-shake-a",
      assetId: "asset-1",
      trackId: "track-1",
      startTime: 0,
      sourceIn: 0,
      sourceOut: 5,
      volume: 1.0,
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
      animationPreset: {
        id: "preset-shake",
        presetId: "shake",
        category: "continuous",
        duration: 5,
        intensity: 1.0,
        seed: 12345,
      },
    };

    const clipB: TimelineClip = {
      ...clipA,
      id: "clip-shake-b",
    };

    const trA = evaluateClipTransform(clipA, 2.5);
    const trB = evaluateClipTransform(clipB, 2.5);

    assert.equal(trA.positionX, trB.positionX, "Deterministic shake must match for identical seed");
    assert.equal(trA.positionY, trB.positionY, "Deterministic shake must match for identical seed");
    assert.equal(trA.rotation, trB.rotation, "Deterministic shake rotation must match");
  });

  it("converts animation preset to explicit editable keyframes", () => {
    const clip: TimelineClip = {
      id: "clip-fade",
      assetId: "asset-1",
      trackId: "track-1",
      startTime: 0,
      sourceIn: 0,
      sourceOut: 5,
      volume: 1.0,
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

    const withKfs = applyPresetAsKeyframes(clip, "fade_in", 1.0);
    assert.ok(withKfs.keyframes && withKfs.keyframes.length > 0, "Keyframes must be generated");
    assert.equal(withKfs.animationPreset, undefined, "Preset should be cleared once baked into keyframes");

    const opacityKfs = withKfs.keyframes.filter((k) => k.property === "opacity");
    assert.ok(opacityKfs.length >= 2, "Fade in requires at least 2 opacity keyframes");
    assert.equal(opacityKfs[0].value, 0);
    assert.equal(opacityKfs[opacityKfs.length - 1].value, 1.0);
  });

  it("evaluates typewriter and word reveal text animations", () => {
    const typewriterOverlay: TextOverlay = {
      id: "t-1",
      text: "Hello World and welcome to Content Studio video editor!",
      startTime: 0,
      endTime: 5,
      x: 0.5,
      y: 0.8,
      fontSize: 24,
      color: "#ffffff",
      align: "center",
      presetId: "classic",
      activeWordColor: "#facc15",
      animationPreset: "typewriter",
    };

    const startText = evaluateOverlayAnimation(typewriterOverlay, 0);
    assert.equal(startText.renderedText, "");

    const midText = evaluateOverlayAnimation(typewriterOverlay, 0.9);
    assert.ok(midText.renderedText.length > 0);
    assert.ok(midText.renderedText.length < typewriterOverlay.text.length);

    const endText = evaluateOverlayAnimation(typewriterOverlay, 2.0);
    assert.equal(endText.renderedText, typewriterOverlay.text);
  });

  it("evaluates word-level timing for karaoke caption highlighting", () => {
    const captionOverlay: TextOverlay = {
      id: "cap-1",
      text: "Local video editor",
      startTime: 0,
      endTime: 3,
      x: 0.5,
      y: 0.85,
      fontSize: 24,
      color: "#ffffff",
      align: "center",
      presetId: "classic",
      activeWordColor: "#facc15",
      overlayType: "caption",
      wordTimings: [
        { word: "Local", start: 0.0, end: 1.0 },
        { word: "video", start: 1.0, end: 2.0 },
        { word: "editor", start: 2.0, end: 3.0 },
      ],
    };

    const eval0 = evaluateOverlayAnimation(captionOverlay, 0.5);
    assert.equal(eval0.activeWordIndex, 0, "At 0.5s word index should be 0 ('Local')");

    const eval1 = evaluateOverlayAnimation(captionOverlay, 1.5);
    assert.equal(eval1.activeWordIndex, 1, "At 1.5s word index should be 1 ('video')");

    const eval2 = evaluateOverlayAnimation(captionOverlay, 2.5);
    assert.equal(eval2.activeWordIndex, 2, "At 2.5s word index should be 2 ('editor')");
  });
});
