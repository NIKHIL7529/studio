import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeIntervalOverlap,
  selectCandidateSequence,
} from "../src/lib/repurpose/sequenceSelector.ts";
import type { RepurposeCandidate, RepurposeConfig } from "../src/types/repurpose.ts";

function createMockCandidate(
  id: string,
  assetId: string,
  sourceIn: number,
  sourceOut: number,
  score: number
): RepurposeCandidate {
  return {
    id,
    sourceAssetId: assetId,
    sourceAssetName: `video-${assetId}.mp4`,
    sourceIn,
    sourceOut,
    duration: Number((sourceOut - sourceIn).toFixed(2)),
    objective: "highlights",
    score,
    scoreBreakdown: {
      signalStrength: score,
      durationFit: score,
      boundaryQuality: score,
      pacingOrContinuity: score,
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
    explanation: "Mock candidate explanation",
    selected: false,
    cacheKey: `cache-${id}`,
  };
}

describe("Repurpose Sequence Selection & Overlap Suppression", () => {
  test("computeIntervalOverlap accurately measures overlap relative to shorter window", () => {
    // Exact match
    assert.equal(computeIntervalOverlap(10, 20, 10, 20), 1.0);

    // No overlap
    assert.equal(computeIntervalOverlap(0, 10, 10, 20), 0.0);
    assert.equal(computeIntervalOverlap(0, 10, 15, 25), 0.0);

    // Partial overlap: [10, 20] and [15, 25]. Overlap is [15, 20] = 5s. Duration is 10s. Overlap = 5/10 = 0.5
    assert.equal(computeIntervalOverlap(10, 20, 15, 25), 0.5);

    // Sub-interval: [12, 16] inside [10, 20]. Min duration is 4s. Overlap is 4s / 4s = 1.0
    assert.equal(computeIntervalOverlap(10, 20, 12, 16), 1.0);
  });

  test("selectCandidateSequence suppresses overlapping candidates on the same source", () => {
    const assetId = "asset-1";
    const candidates: RepurposeCandidate[] = [
      createMockCandidate("c1", assetId, 0, 15, 90), // High score [0, 15]
      createMockCandidate("c2", assetId, 5, 20, 85), // Overlaps [0, 15] by 10s (> 60% overlap) -> must be suppressed
      createMockCandidate("c3", assetId, 25, 40, 80), // Disjoint [25, 40] -> accepted
    ];

    const config: RepurposeConfig = {
      objective: "highlights",
      targetClipCount: 3,
      minClipDuration: 10,
      maxClipDuration: 20,
      targetAspectRatio: "9:16",
      keywords: [],
      selectedAssetIds: [assetId],
    };

    const result = selectCandidateSequence(candidates, config);

    assert.equal(result.selectedCandidates.length, 2);
    assert.equal(result.selectedCandidates[0].id, "c1");
    assert.equal(result.selectedCandidates[1].id, "c3");

    // c2 should not be selected due to overlap suppression
    assert.ok(!result.selectedCandidates.some((c) => c.id === "c2"));
  });

  test("selectCandidateSequence balances multiple source assets", () => {
    const candidates: RepurposeCandidate[] = [
      createMockCandidate("c1", "source-A", 0, 15, 95),
      createMockCandidate("c2", "source-A", 20, 35, 90),
      createMockCandidate("c3", "source-B", 0, 15, 88),
      createMockCandidate("c4", "source-B", 20, 35, 85),
    ];

    const config: RepurposeConfig = {
      objective: "highlights",
      targetClipCount: 3,
      minClipDuration: 10,
      maxClipDuration: 20,
      targetAspectRatio: "9:16",
      keywords: [],
      selectedAssetIds: ["source-A", "source-B"],
    };

    const result = selectCandidateSequence(candidates, config);

    assert.equal(result.selectedCandidates.length, 3);
    const selectedSourceIds = result.selectedCandidates.map((c) => c.sourceAssetId);

    // Both source-A and source-B should be represented
    assert.ok(selectedSourceIds.includes("source-A"));
    assert.ok(selectedSourceIds.includes("source-B"));
  });

  test("insufficient candidate behaviour: returns valid candidates without fabricating or duplicating", () => {
    const candidates: RepurposeCandidate[] = [
      createMockCandidate("c1", "source-1", 0, 15, 80),
      // Only 1 candidate available
    ];

    const config: RepurposeConfig = {
      objective: "highlights",
      targetClipCount: 5, // user asked for 5 clips
      minClipDuration: 10,
      maxClipDuration: 20,
      targetAspectRatio: "9:16",
      keywords: [],
      selectedAssetIds: ["source-1"],
    };

    const result = selectCandidateSequence(candidates, config);

    assert.equal(result.actualCount, 1);
    assert.equal(result.selectedCandidates.length, 1);
    assert.equal(result.isShortage, true);
    assert.ok(result.shortageExplanation !== undefined);
    assert.ok(result.shortageExplanation.includes("Found 1 valid moment"));
    assert.ok(result.shortageExplanation.includes("5 requested"));
  });
});
