import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyEditPlanToTimeline, createEditPlanFromCandidates } from "../src/lib/repurpose/editPlan.ts";
import { applyCaptionStyleToAll } from "../src/lib/transcription/captionGenerator.ts";
import type { RepurposeCandidate } from "../src/types/repurpose.ts";
import type { SourceTranscript } from "../src/types/transcription.ts";

describe("Timeline Sequence & Timed Caption Construction", () => {
  const candidate1: RepurposeCandidate = {
    id: "cand-1",
    objective: "educational",
    sourceAssetId: "asset-a",
    sourceAssetName: "speaker-1.mp4",
    sourceIn: 10.0,
    sourceOut: 20.0,
    duration: 10.0,
    score: 88,
    scoreBreakdown: {
      signalStrength: 80,
      durationFit: 90,
      boundaryQuality: 95,
      pacingOrContinuity: 90,
      keywordBonus: 0,
      penalty: 0,
    },
    contributingEvidence: {
      hasAudio: true,
      hasVideo: true,
      sceneCutCount: 0,
      avgVisualDiff: 0.1,
      peakVisualDiff: 0.2,
      avgRms: 0.4,
      speechActivityRatio: 0.9,
      startsAtNaturalBoundary: true,
      endsAtNaturalBoundary: true,
    },
    explanation: "Self-contained thought",
    selected: true,
    cacheKey: "key-1",
  };

  const candidate2: RepurposeCandidate = {
    id: "cand-2",
    objective: "educational",
    sourceAssetId: "asset-a",
    sourceAssetName: "speaker-1.mp4",
    sourceIn: 30.0,
    sourceOut: 45.0,
    duration: 15.0,
    score: 85,
    scoreBreakdown: {
      signalStrength: 80,
      durationFit: 85,
      boundaryQuality: 90,
      pacingOrContinuity: 85,
      keywordBonus: 0,
      penalty: 0,
    },
    contributingEvidence: {
      hasAudio: true,
      hasVideo: true,
      sceneCutCount: 0,
      avgVisualDiff: 0.1,
      peakVisualDiff: 0.2,
      avgRms: 0.4,
      speechActivityRatio: 0.9,
      startsAtNaturalBoundary: true,
      endsAtNaturalBoundary: true,
    },
    explanation: "Second moment",
    selected: true,
    cacheKey: "key-2",
  };

  const sourceTranscripts = new Map<string, SourceTranscript>([
    [
      "asset-a",
      {
        sourceAssetId: "asset-a",
        sourceAssetName: "speaker-1.mp4",
        engine: "srt-vtt",
        duration: 60.0,
        cues: [
          // Within cand-1 (10s to 20s)
          { id: "cue-1", start: 10.5, end: 14.5, text: "First thought in excerpt one." },
          { id: "cue-2", start: 15.0, end: 19.5, text: "Second thought in excerpt one." },
          // Outside cand-1 and cand-2 (in between gap)
          { id: "cue-gap", start: 22.0, end: 28.0, text: "This cue is in the gap and must NOT appear." },
          // Within cand-2 (30s to 45s)
          { id: "cue-3", start: 31.0, end: 38.0, text: "Key insight from excerpt two." },
        ],
        fullText: "First thought in excerpt one. Second thought in excerpt one. This cue is in the gap and must NOT appear. Key insight from excerpt two.",
        coverage: [{ start: 10.5, end: 38.0 }],
        createdAt: new Date().toISOString(),
        isWordLevel: false,
      },
    ],
  ]);

  test("generates timeline with clips and timed captions mapped to timeline offsets", () => {
    const editPlan = createEditPlanFromCandidates(
      "a0000000-0000-4000-8000-000000000001",
      [candidate1, candidate2],
      "educational",
      "9:16"
    );

    assert.equal(editPlan.isValid, true);
    assert.equal(editPlan.segments.length, 2);
    // Segment 1: timelineStart=0, duration=10
    // Segment 2: timelineStart=10, duration=15
    assert.equal(editPlan.segments[0].timelineStart, 0);
    assert.equal(editPlan.segments[1].timelineStart, 10);

    const { timeline, errors } = applyEditPlanToTimeline(editPlan, undefined, sourceTranscripts);
    assert.equal(errors.length, 0);

    // Primary video track clips
    const videoTrack = timeline.tracks.find((t) => t.type === "video");
    assert.ok(videoTrack);
    assert.equal(videoTrack.clips.length, 2);

    // Captions mapped to timeline
    const captions = timeline.textOverlays;
    assert.equal(captions.length, 3, "Only cues within selected intervals are mapped");

    // Caption 1: sourceIn 10.5 -> relative to segment 1 (10.0) is +0.5s -> timeline 0.5s to 4.5s
    assert.equal(captions[0].text, "First thought in excerpt one.");
    assert.equal(captions[0].startTime, 0.5);
    assert.equal(captions[0].endTime, 4.5);

    // Caption 2: sourceIn 15.0 -> timeline 5.0s to 9.5s
    assert.equal(captions[1].text, "Second thought in excerpt one.");
    assert.equal(captions[1].startTime, 5.0);
    assert.equal(captions[1].endTime, 9.5);

    // Caption 3: in Segment 2 (timelineStart 10.0, sourceIn 30.0). Cue start 31.0 -> relative +1.0 -> timeline 11.0s to 18.0s
    assert.equal(captions[2].text, "Key insight from excerpt two.");
    assert.equal(captions[2].startTime, 11.0);
    assert.equal(captions[2].endTime, 18.0);

    // Verify cue in gap was strictly excluded
    const hasGapCue = captions.some((c) => c.text.includes("gap"));
    assert.equal(hasGapCue, false, "Captions do not bleed into gaps");
  });

  test("captions configure overlayType='caption' and styling presets", () => {
    const editPlan = createEditPlanFromCandidates(
      "a0000000-0000-4000-8000-000000000001",
      [candidate1],
      "educational",
      "9:16"
    );

    const { timeline } = applyEditPlanToTimeline(editPlan, undefined, sourceTranscripts);
    const caption = timeline.textOverlays[0];

    assert.equal(caption.overlayType, "caption");
    assert.equal(caption.preset, "clean");
    assert.equal(caption.boxWidthRatio, 0.85);
    assert.ok(caption.backgroundColor !== undefined);
  });

  test("applyCaptionStyleToAll updates all captions while preserving non-captions", () => {
    const editPlan = createEditPlanFromCandidates(
      "a0000000-0000-4000-8000-000000000001",
      [candidate1],
      "educational",
      "9:16"
    );

    const { timeline } = applyEditPlanToTimeline(editPlan, undefined, sourceTranscripts);
    assert.ok(timeline.textOverlays.length > 0);

    // Apply bulk style
    const updated = applyCaptionStyleToAll(timeline, {
      color: "#00ffcc",
      activeWordColor: "#ff0077",
      fontSize: 36,
      preset: "bold",
    });

    for (const ov of updated.textOverlays) {
      if (ov.overlayType === "caption") {
        assert.equal(ov.color, "#00ffcc");
        assert.equal(ov.activeWordColor, "#ff0077");
        assert.equal(ov.fontSize, 36);
        assert.equal(ov.preset, "bold");
      }
    }
  });

  test("multi-cut captions enforce strictly monotonic non-overlapping intervals", () => {
    // Create adjacent candidate cuts
    const candA: RepurposeCandidate = {
      ...candidate1,
      id: "cut-a",
      sourceIn: 10.0,
      sourceOut: 15.0,
      duration: 5.0,
    };
    const candB: RepurposeCandidate = {
      ...candidate2,
      id: "cut-b",
      sourceIn: 15.0,
      sourceOut: 20.0,
      duration: 5.0,
    };

    const multiTranscripts = new Map<string, SourceTranscript>([
      [
        "asset-a",
        {
          sourceAssetId: "asset-a",
          sourceAssetName: "speaker-1.mp4",
          engine: "browser-whisper",
          duration: 30.0,
          cues: [
            { id: "c1", start: 10.0, end: 12.5, text: "Part one" },
            { id: "c2", start: 12.5, end: 15.2, text: "Part two (bleeds slightly past cut)" },
            { id: "c3", start: 15.0, end: 18.0, text: "Part three at start of second cut" },
          ],
          fullText: "Part one Part two Part three",
          coverage: [{ start: 10.0, end: 18.0 }],
          createdAt: new Date().toISOString(),
          isWordLevel: false,
        },
      ],
    ]);

    const plan = createEditPlanFromCandidates(
      "a0000000-0000-4000-8000-000000000001",
      [candA, candB],
      "educational",
      "9:16"
    );

    const { timeline } = applyEditPlanToTimeline(plan, undefined, multiTranscripts);
    const caps = timeline.textOverlays.filter((o) => o.overlayType === "caption");

    // Check monotonic non-overlapping condition
    for (let i = 0; i < caps.length - 1; i++) {
      assert.ok(
        caps[i].endTime <= caps[i + 1].startTime + 0.001,
        `Captions must not overlap: ${caps[i].endTime} <= ${caps[i + 1].startTime}`
      );
    }

    // Cue 2 must not extend past cut-a (timelineEnd <= 5.0)
    assert.ok(caps[1].endTime <= 5.0001, "Caption must not bleed past parent clip duration");
  });
});
