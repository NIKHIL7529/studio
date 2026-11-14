import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { discoverSourceCandidates } from "../src/lib/repurpose/candidateDiscovery.ts";
import { scoreAndRankCandidates } from "../src/lib/repurpose/scoring.ts";
import { selectCandidateSequence } from "../src/lib/repurpose/sequenceSelector.ts";
import type { SourceAnalysisResult, RepurposeConfig } from "../src/types/repurpose.ts";
import type { SourceTranscript } from "../src/types/transcription.ts";

describe("Adaptive Content-Aware Repurposing (Phase 8 Editorial Rules)", () => {
  const mockTranscript: SourceTranscript = {
    sourceAssetId: "asset-1",
    sourceAssetName: "long-keynote.mp4",
    engine: "srt-vtt",
    duration: 120.0,
    cues: [
      { id: "c1", start: 2.0, end: 6.8, text: "Privacy is the foundation of local-first software." },
      { id: "c2", start: 7.2, end: 11.5, text: "When you edit in the browser, your data stays on your machine." },
      // Gap
      { id: "c3", start: 25.0, end: 32.4, text: "Now let us examine how the WebCodecs decoding pipeline streams frames." },
      { id: "c4", start: 33.0, end: 41.2, text: "Mediabunny demuxes MP4 containers directly from disk chunks without loading the whole file into RAM." },
      { id: "c5", start: 41.8, end: 49.0, text: "This bounded memory approach prevents out-of-memory browser tab crashes." },
      // Gap
      { id: "c6", start: 75.0, end: 81.0, text: "In conclusion, browser performance is now comparable to desktop tools." },
    ],
    fullText: "Privacy is the foundation of local-first software. When you edit in the browser, your data stays on your machine. Now let us examine how the WebCodecs decoding pipeline streams frames. Mediabunny demuxes MP4 containers directly from disk chunks without loading the whole file into RAM. This bounded memory approach prevents out-of-memory browser tab crashes. In conclusion, browser performance is now comparable to desktop tools.",
    coverage: [{ start: 2.0, end: 81.0 }],
    createdAt: new Date().toISOString(),
    isWordLevel: false,
  };

  const mockAnalysis: SourceAnalysisResult = {
    assetId: "asset-1",
    assetName: "long-keynote.mp4",
    fingerprint: "fp-keynote-120s",
    duration: 120.0,
    hasVideo: true,
    hasAudio: true,
    frameSignals: [
      { timestamp: 0, luminanceDiff: 0, colorHistDiff: 0, visualDiff: 0, isSceneCutCandidate: false },
      { timestamp: 25, luminanceDiff: 0.6, colorHistDiff: 0.6, visualDiff: 0.6, isSceneCutCandidate: true },
      { timestamp: 75, luminanceDiff: 0.5, colorHistDiff: 0.5, visualDiff: 0.5, isSceneCutCandidate: true },
    ],
    audioSignals: [
      { timestamp: 4, rms: 0.3, isSilence: false, isSpeechLikeActivity: true, isTransient: false },
      { timestamp: 35, rms: 0.35, isSilence: false, isSpeechLikeActivity: true, isTransient: false },
      { timestamp: 78, rms: 0.28, isSilence: false, isSpeechLikeActivity: true, isTransient: false },
    ],
    sceneCutTimes: [25, 75],
    silenceIntervals: [
      { start: 12, end: 24.5 },
      { start: 50, end: 74.5 },
    ],
    speechActivityIntervals: [
      { start: 2, end: 11.5 },
      { start: 25, end: 49 },
      { start: 75, end: 81 },
    ],
    algorithmVersion: "2.0.0",
    sampledAt: new Date().toISOString(),
    transcript: mockTranscript,
  };

  test("Rule 2.1: Excerpt lengths are variable and content-derived, NOT hardcoded to 10s", () => {
    const config: RepurposeConfig = {
      objective: "educational",
      targetClipCount: 3,
      minClipDuration: 5,
      maxClipDuration: 60,
      targetAspectRatio: "9:16",
      keywords: [],
      selectedAssetIds: ["asset-1"],
    };

    const rawWindows = discoverSourceCandidates(mockAnalysis, config);
    assert.ok(rawWindows.length > 0, "Discovered candidates");

    // Check durations
    const durations = rawWindows.map((r) => r.duration);
    const hasDistinctDurations = new Set(durations).size > 1;
    assert.ok(hasDistinctDurations, "Candidates have varied, content-derived durations");

    // Verify not all 10s
    const allTenSeconds = durations.every((d) => Math.abs(d - 10.0) < 0.1);
    assert.equal(allTenSeconds, false, "Durations are NOT hardcoded to 10s");

    // Verify a longer multi-sentence thought (c3+c4+c5 ~ 24s) exists
    const hasExtendedThought = durations.some((d) => d >= 20.0);
    assert.ok(hasExtendedThought, "Identified extended thought (>20s) without artificial truncation");
  });

  test("Rule 2.2: Allows multiple moments from the same source without artificial quota suppression", () => {
    const config: RepurposeConfig = {
      objective: "educational",
      targetClipCount: 4,
      minClipDuration: 5,
      maxClipDuration: 60,
      targetAspectRatio: "9:16",
      keywords: [],
      selectedAssetIds: ["asset-1"],
    };

    const rawWindows = discoverSourceCandidates(mockAnalysis, config);
    const candidates = scoreAndRankCandidates(rawWindows, config, "test");
    const seq = selectCandidateSequence(candidates, config);

    // From asset-1 alone, it should be able to select multiple moments
    assert.ok(seq.selectedCandidates.length >= 2, "Selected multiple distinct moments from single source");
    const asset1Selected = seq.selectedCandidates.filter((c) => c.sourceAssetId === "asset-1");
    assert.ok(asset1Selected.length >= 2, "Did not artificially cap source-1 to 1 candidate");
  });

  test("Rule 2.4: Zero whole-source fallback when footage has no valid candidates", () => {
    // Empty source analysis with no audio, video, or speech
    const emptyAnalysis: SourceAnalysisResult = {
      assetId: "empty-asset",
      assetName: "silence.mp4",
      fingerprint: "fp-empty",
      duration: 60.0,
      hasVideo: false,
      hasAudio: false,
      frameSignals: [],
      audioSignals: [],
      sceneCutTimes: [],
      silenceIntervals: [{ start: 0, end: 60 }],
      speechActivityIntervals: [],
      algorithmVersion: "2.0.0",
      sampledAt: new Date().toISOString(),
    };

    const config: RepurposeConfig = {
      objective: "highlights",
      targetClipCount: 3,
      minClipDuration: 5,
      maxClipDuration: 30,
      targetAspectRatio: "9:16",
      keywords: [],
      selectedAssetIds: ["empty-asset"],
    };

    const rawWindows = discoverSourceCandidates(emptyAnalysis, config);
    assert.equal(rawWindows.length, 0, "Returns 0 candidates for empty footage");

    const candidates = scoreAndRankCandidates(rawWindows, config, "test");
    assert.equal(candidates.length, 0);

    const seq = selectCandidateSequence(candidates, config);
    assert.equal(seq.selectedCandidates.length, 0, "Zero candidates selected");
    // Verify no full-source candidate (0 -> 60s) was created
    const hasWholeSource = seq.selectedCandidates.some((c) => c.sourceIn === 0 && c.sourceOut === 60.0);
    assert.equal(hasWholeSource, false, "Did NOT substitute whole source as fallback");
  });

  test("User Brief Relevance: Scores moments higher when transcript matches brief", () => {
    const memoryBriefConfig: RepurposeConfig = {
      objective: "educational",
      userBrief: "Explain memory management, RAM, and browser tab crash prevention",
      targetClipCount: 3,
      minClipDuration: 5,
      maxClipDuration: 60,
      targetAspectRatio: "9:16",
      keywords: ["RAM", "memory"],
      selectedAssetIds: ["asset-1"],
    };

    const rawWindows = discoverSourceCandidates(mockAnalysis, memoryBriefConfig);
    const scored = scoreAndRankCandidates(rawWindows, memoryBriefConfig, "test");

    // The top candidate should reference memory/RAM/crashes
    const top = scored[0];
    assert.ok(
      top.transcriptSnippet?.toLowerCase().includes("memory") ||
      top.transcriptSnippet?.toLowerCase().includes("ram") ||
      top.explanation.toLowerCase().includes("matches brief"),
      "Top candidate reflects user brief topic"
    );
    assert.ok(top.scoreBreakdown.briefRelevance && top.scoreBreakdown.briefRelevance > 60);
  });
});
