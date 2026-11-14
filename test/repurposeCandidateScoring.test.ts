import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  discoverSourceCandidates,
  snapToNaturalBoundary,
} from "../src/lib/repurpose/candidateDiscovery.ts";
import {
  scoreAndRankCandidates,
  calculateDurationFit,
  checkLiteralKeywords,
} from "../src/lib/repurpose/scoring.ts";
import type {
  SourceAnalysisResult,
  RepurposeConfig,
} from "../src/types/repurpose.ts";

function createMockAnalysisResult(overrides: Partial<SourceAnalysisResult> = {}): SourceAnalysisResult {
  return {
    assetId: "a0000000-0000-4000-8000-000000000001",
    assetName: "interview-clip.mp4",
    fingerprint: "fp1234567890abcdef",
    duration: 60.0,
    hasVideo: true,
    hasAudio: true,
    frameSignals: [
      { timestamp: 0, luminanceDiff: 0, colorHistDiff: 0, visualDiff: 0, isSceneCutCandidate: false },
      { timestamp: 10, luminanceDiff: 0.5, colorHistDiff: 0.5, visualDiff: 0.5, isSceneCutCandidate: true },
      { timestamp: 25, luminanceDiff: 0.6, colorHistDiff: 0.6, visualDiff: 0.6, isSceneCutCandidate: true },
      { timestamp: 40, luminanceDiff: 0.45, colorHistDiff: 0.45, visualDiff: 0.45, isSceneCutCandidate: true },
    ],
    audioSignals: [
      { timestamp: 0, rms: 0.15, isSilence: false, isSpeechLikeActivity: true, isTransient: false },
      { timestamp: 10, rms: 0.005, isSilence: true, isSpeechLikeActivity: false, isTransient: false },
      { timestamp: 12, rms: 0.18, isSilence: false, isSpeechLikeActivity: true, isTransient: true },
      { timestamp: 24, rms: 0.005, isSilence: true, isSpeechLikeActivity: false, isTransient: false },
      { timestamp: 26, rms: 0.16, isSilence: false, isSpeechLikeActivity: true, isTransient: false },
      { timestamp: 40, rms: 0.005, isSilence: true, isSpeechLikeActivity: false, isTransient: false },
    ],
    sceneCutTimes: [10.0, 25.0, 40.0],
    silenceIntervals: [
      { start: 9.5, end: 11.5 },
      { start: 23.5, end: 25.5 },
      { start: 39.5, end: 41.5 },
    ],
    speechActivityIntervals: [
      { start: 0, end: 9.5 },
      { start: 11.5, end: 23.5 },
      { start: 25.5, end: 39.5 },
    ],
    algorithmVersion: "test-v1",
    sampledAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Repurpose Candidate Window Discovery & Boundary Snapping", () => {
  test("snapToNaturalBoundary snaps to closest boundary within tolerance", () => {
    const boundaries = [10.0, 25.0, 40.0];

    // Target 10.4 is within 1.5s tolerance of 10.0
    const res1 = snapToNaturalBoundary(10.4, boundaries, 1.5);
    assert.equal(res1.snapped, true);
    assert.equal(res1.time, 10.0);

    // Target 18.0 is not within tolerance
    const res2 = snapToNaturalBoundary(18.0, boundaries, 1.5);
    assert.equal(res2.snapped, false);
    assert.equal(res2.time, 18.0);
  });

  test("discoverSourceCandidates builds overlapping candidate intervals respecting duration bounds", () => {
    const analysis = createMockAnalysisResult();
    const config: RepurposeConfig = {
      objective: "highlights",
      targetClipCount: 3,
      minClipDuration: 10,
      maxClipDuration: 20,
      targetAspectRatio: "9:16",
      keywords: [],
      selectedAssetIds: [analysis.assetId],
    };

    const candidates = discoverSourceCandidates(analysis, config);

    assert.ok(candidates.length > 0, "Should generate candidates");
    for (const c of candidates) {
      assert.equal(c.sourceAssetId, analysis.assetId);
      assert.ok(c.sourceIn >= 0, "sourceIn >= 0");
      assert.ok(c.sourceOut <= analysis.duration + 0.1, "sourceOut within duration");
      assert.ok(c.duration >= 8.5 && c.duration <= 23.0, `Duration ${c.duration} within bounds`);
    }
  });

  test("discoverSourceCandidates handles short footage without crashing", () => {
    const shortAnalysis = createMockAnalysisResult({ duration: 5.0 });
    const config: RepurposeConfig = {
      objective: "highlights",
      targetClipCount: 3,
      minClipDuration: 10,
      maxClipDuration: 20,
      targetAspectRatio: "9:16",
      keywords: [],
      selectedAssetIds: [shortAnalysis.assetId],
    };

    const candidates = discoverSourceCandidates(shortAnalysis, config);
    assert.equal(candidates.length, 0); // Correctly returns 0 without crashing
  });
});

describe("Repurpose Deterministic Scoring & Objective Weighting", () => {
  test("scoreAndRankCandidates normalizes scores strictly to [0, 100]", () => {
    const analysis = createMockAnalysisResult();
    const config: RepurposeConfig = {
      objective: "highlights",
      targetClipCount: 3,
      minClipDuration: 10,
      maxClipDuration: 25,
      targetAspectRatio: "9:16",
      keywords: [],
      selectedAssetIds: [analysis.assetId],
    };

    const raw = discoverSourceCandidates(analysis, config);
    const scored = scoreAndRankCandidates(raw, config, "test");

    for (const s of scored) {
      assert.ok(s.score >= 0 && s.score <= 100, `Score ${s.score} is between 0 and 100`);
      assert.ok(s.scoreBreakdown.signalStrength >= 0 && s.scoreBreakdown.signalStrength <= 100);
      assert.ok(s.scoreBreakdown.durationFit >= 0 && s.scoreBreakdown.durationFit <= 100);
      assert.ok(s.scoreBreakdown.boundaryQuality >= 0 && s.scoreBreakdown.boundaryQuality <= 100);
      assert.ok(s.explanation.length > 0);
    }
  });

  test("different objectives alter rankings deterministically", () => {
    const analysis = createMockAnalysisResult();
    const baseConfig: RepurposeConfig = {
      objective: "highlights",
      targetClipCount: 3,
      minClipDuration: 10,
      maxClipDuration: 25,
      targetAspectRatio: "9:16",
      keywords: [],
      selectedAssetIds: [analysis.assetId],
    };

    const raw = discoverSourceCandidates(analysis, baseConfig);

    const highlightsScored = scoreAndRankCandidates(raw, { ...baseConfig, objective: "highlights" }, "test");
    const educationalScored = scoreAndRankCandidates(raw, { ...baseConfig, objective: "educational" }, "test");
    const podcastScored = scoreAndRankCandidates(raw, { ...baseConfig, objective: "podcast" }, "test");

    assert.ok(highlightsScored.length > 0);
    assert.ok(educationalScored.length > 0);
    assert.ok(podcastScored.length > 0);

    // Explanations reflect the objective used
    assert.ok(podcastScored[0].explanation.includes("speech activity") || podcastScored[0].explanation.includes("pause"));
    assert.ok(educationalScored[0].explanation.includes("explanation pacing") || educationalScored[0].explanation.includes("stability"));
  });

  test("literal keyword matching rewards matching asset names without hallucinating transcripts", () => {
    const match = checkLiteralKeywords("interview-keynote-part1.mp4", ["interview", "keynote"]);
    assert.equal(match.hasMatch, true);
    assert.deepEqual(match.matched, ["interview", "keynote"]);

    const noMatch = checkLiteralKeywords("random-scenery.mp4", ["podcast", "interview"]);
    assert.equal(noMatch.hasMatch, false);
    assert.deepEqual(noMatch.matched, []);
  });

  test("handles video-only sources without audio track without penalty or false silence", () => {
    const videoOnlyAnalysis = createMockAnalysisResult({
      hasAudio: false,
      audioSignals: [],
      silenceIntervals: [],
      speechActivityIntervals: [],
    });

    const config: RepurposeConfig = {
      objective: "highlights",
      targetClipCount: 2,
      minClipDuration: 10,
      maxClipDuration: 20,
      targetAspectRatio: "9:16",
      keywords: [],
      selectedAssetIds: [videoOnlyAnalysis.assetId],
    };

    const raw = discoverSourceCandidates(videoOnlyAnalysis, config);
    const scored = scoreAndRankCandidates(raw, config, "test");

    assert.ok(scored.length > 0);
    for (const c of scored) {
      assert.equal(c.contributingEvidence.hasAudio, false);
      assert.ok(c.explanation.includes("video-only source"));
      assert.ok(c.score > 30, `Score is reasonable (${c.score}) without audio`);
    }
  });
});
