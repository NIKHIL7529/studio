import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateContextIntegrity,
  buildThoughtClustersFromCues,
} from "../src/lib/repurpose/contextIntegrity.ts";
import type { TranscriptionCue } from "../src/types/transcription.ts";

describe("Context Integrity & Sentence Boundary Assessment", () => {
  const cues: TranscriptionCue[] = [
    { id: "1", start: 0.0, end: 3.5, text: "Why do browsers need local video processing?" },
    { id: "2", start: 4.0, end: 8.5, text: "Because uploading gigabytes of media over mobile networks is slow and expensive." },
    { id: "3", start: 9.0, end: 14.2, text: "Therefore, WebCodecs and Mediabunny let us process frames directly on the CPU and GPU." },
    { id: "4", start: 15.0, end: 20.0, text: "This architecture ensures user privacy and instant feedback." },
    { id: "5", start: 20.5, end: 24.0, text: "And that is why we built it this way, but" },
    { id: "6", start: 24.5, end: 29.0, text: "we still need to verify device capabilities before encoding." },
  ];

  test("assesses all 5 context integrity dimensions for a self-contained thought", () => {
    // Cue 4: "This architecture ensures user privacy and instant feedback."
    const rep = evaluateContextIntegrity(cues, 15.0, 20.0);

    assert.equal(rep.speechBoundaryIntegrity.isSatisfied, true);
    assert.equal(rep.thoughtCompleteness.isSatisfied, true);
    assert.equal(rep.endingClosure.isSatisfied, true);
  });

  test("detects incomplete thoughts with trailing conjunctions", () => {
    // Cue 5: "And that is why we built it this way, but"
    const rep = evaluateContextIntegrity(cues, 20.5, 24.0);

    assert.equal(rep.thoughtCompleteness.isSatisfied, false);
    assert.equal(rep.endingClosure.isSatisfied, false);
    assert.ok(rep.endingClosure.reason.toLowerCase().includes("conjunction"));
  });

  test("detects prerequisite context dependency for dependent answers", () => {
    // Cue 2: "Because uploading gigabytes of media..." -> Dependent on Cue 1 "Why do browsers need..."
    const rep = evaluateContextIntegrity(cues, 4.0, 8.5);

    assert.equal(rep.contextSufficiency.isSatisfied, false);
    assert.ok(
      rep.contextSufficiency.reason.includes("Because") ||
      rep.contextSufficiency.reason.includes("question") ||
      rep.unresolvedDependencies.length > 0
    );

    // Verifies backward expansion recommendation
    assert.ok(rep.expansionRecommendation !== undefined);
    assert.equal(rep.expansionRecommendation?.suggestedSourceIn, 0.0);
    assert.ok(
      rep.expansionRecommendation?.reason.includes("question") ||
      rep.expansionRecommendation?.reason.includes("setup")
    );
  });

  test("buildThoughtClustersFromCues creates natural thought units from dialogue", () => {
    const clusters = buildThoughtClustersFromCues(cues, 30.0);

    assert.ok(clusters.length > 0);
    for (const cluster of clusters) {
      assert.ok(cluster.duration >= 3.0);
      assert.ok(cluster.sourceIn >= 0);
      assert.ok(cluster.sourceOut <= 30.0);
      assert.ok(cluster.transcriptSnippet.length > 0);
    }
  });

  test("expands context across sentence boundaries to produce a complete thought", () => {
    // Spanning cue 1 to cue 2 gives question + answer
    const rep = evaluateContextIntegrity(cues, 0.0, 8.5);

    assert.equal(rep.speechBoundaryIntegrity.isSatisfied, true);
    assert.equal(rep.thoughtCompleteness.isSatisfied, true);
    assert.equal(rep.contextSufficiency.isSatisfied, true);
    assert.equal(rep.endingClosure.isSatisfied, true);
  });
});
