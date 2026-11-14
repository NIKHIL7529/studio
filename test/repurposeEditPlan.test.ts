import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createEditPlanFromCandidates,
  validateEditPlan,
  applyEditPlanToTimeline,
} from "../src/lib/repurpose/editPlan.ts";
import type { RepurposeCandidate } from "../src/types/repurpose.ts";
import { validateTimeline } from "../src/lib/timeline/model.ts";

function createMockCandidate(
  id: string,
  assetId: string,
  sourceIn: number,
  sourceOut: number
): RepurposeCandidate {
  return {
    id,
    sourceAssetId: assetId,
    sourceAssetName: `source-${assetId}.mp4`,
    sourceIn,
    sourceOut,
    duration: Number((sourceOut - sourceIn).toFixed(2)),
    objective: "highlights",
    score: 85,
    scoreBreakdown: {
      signalStrength: 85,
      durationFit: 85,
      boundaryQuality: 85,
      pacingOrContinuity: 85,
      keywordBonus: 0,
      penalty: 0,
    },
    contributingEvidence: {
      hasAudio: true,
      hasVideo: true,
      sceneCutCount: 1,
      avgVisualDiff: 0.3,
      peakVisualDiff: 0.5,
      avgRms: 0.15,
      speechActivityRatio: 0.7,
      startsAtNaturalBoundary: true,
      endsAtNaturalBoundary: true,
    },
    explanation: "Mock explanation",
    selected: true,
    cacheKey: `cache-${id}`,
  };
}

describe("Repurpose EditPlan & Timeline EDL Integration", () => {
  const projectId = "b0000000-0000-4000-8000-000000000001";

  test("createEditPlanFromCandidates builds valid sequential EditPlan", () => {
    const candidates: RepurposeCandidate[] = [
      createMockCandidate("c2", "asset-1", 20.5, 35.0),
      createMockCandidate("c1", "asset-1", 5.0, 15.2),
    ];

    const plan = createEditPlanFromCandidates(projectId, candidates, "highlights", "9:16");

    assert.equal(plan.projectId, projectId);
    assert.equal(plan.targetAspectRatio, "9:16");
    assert.equal(plan.segments.length, 2);

    // Should sort chronologically by sourceIn: c1 ([5.0, 15.2], dur: 10.2s) then c2 ([20.5, 35.0], dur: 14.5s)
    assert.equal(plan.segments[0].candidateId, "c1");
    assert.equal(plan.segments[0].sourceIn, 5.0);
    assert.equal(plan.segments[0].sourceOut, 15.2);
    assert.equal(plan.segments[0].timelineStart, 0.0);
    assert.equal(plan.segments[0].duration, 10.2);

    assert.equal(plan.segments[1].candidateId, "c2");
    assert.equal(plan.segments[1].sourceIn, 20.5);
    assert.equal(plan.segments[1].sourceOut, 35.0);
    assert.equal(plan.segments[1].timelineStart, 10.2);
    assert.equal(plan.segments[1].duration, 14.5);

    assert.equal(plan.totalDuration, 24.7);
    assert.equal(plan.isValid, true);
    assert.equal(plan.validationErrors.length, 0);
  });

  test("validateEditPlan catches invalid timestamps and broken continuity", () => {
    const validPlan = createEditPlanFromCandidates(
      projectId,
      [createMockCandidate("c1", "asset-1", 0, 10)],
      "highlights"
    );

    // Corrupt timelineStart on segment 1
    const brokenPlan = {
      ...validPlan,
      segments: [
        { ...validPlan.segments[0], timelineStart: 5.0 }, // expected 0.0!
      ],
    };

    const res = validateEditPlan(brokenPlan);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes("timelineStart")));
  });

  test("applyEditPlanToTimeline generates valid TimelineDocument and preserves clips", () => {
    const candidates: RepurposeCandidate[] = [
      createMockCandidate("c1", "asset-1", 0, 12),
      createMockCandidate("c2", "asset-2", 15, 30),
    ];

    const plan = createEditPlanFromCandidates(projectId, candidates, "podcast", "4:5");
    const { timeline, errors } = applyEditPlanToTimeline(plan);

    assert.equal(errors.length, 0);
    assert.equal(timeline.settings.targetAspectRatio, "4:5");

    const videoTrack = timeline.tracks.find((t) => t.type === "video");
    assert.ok(videoTrack !== undefined);
    assert.equal(videoTrack.clips.length, 2);

    // Verify Clip 1
    assert.equal(videoTrack.clips[0].assetId, "asset-1");
    assert.equal(videoTrack.clips[0].startTime, 0);
    assert.equal(videoTrack.clips[0].sourceIn, 0);
    assert.equal(videoTrack.clips[0].sourceOut, 12);

    // Verify Clip 2
    assert.equal(videoTrack.clips[1].assetId, "asset-2");
    assert.equal(videoTrack.clips[1].startTime, 12);
    assert.equal(videoTrack.clips[1].sourceIn, 15);
    assert.equal(videoTrack.clips[1].sourceOut, 30);

    // Validate using existing timeline validator
    const validationErrors = validateTimeline(timeline);
    assert.equal(validationErrors.length, 0);
  });
});
