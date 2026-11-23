import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEditPlanToTimeline } from "../src/lib/repurpose/editPlan.ts";
import {
  serializeTextOverlaysToSrt,
  serializeTextOverlaysToVtt,
} from "../src/lib/transcription/subtitleParser.ts";
import { createTimeline } from "../src/lib/timeline/model.ts";
import type { EditPlan } from "../src/types/repurpose.ts";
import type { TextOverlay } from "../src/types/timeline.ts";
import type { SourceTranscript } from "../src/types/transcription.ts";

describe("Repurpose Captions & Subtitle Serialization", () => {
  const samplePlan: EditPlan = {
    id: "plan-1",
    projectId: "proj-1",
    objective: "educational",
    targetAspectRatio: "9:16",
    segments: [
      {
        id: "seg-1",
        sourceAssetId: "asset-1",
        sourceAssetName: "asset-1.mp4",
        sourceIn: 10,
        sourceOut: 20,
        timelineStart: 0,
        duration: 10,
        candidateId: "cand-1",
        explanation: "Introductory concept",
      },
      {
        id: "seg-2",
        sourceAssetId: "asset-1",
        sourceAssetName: "asset-1.mp4",
        sourceIn: 30,
        sourceOut: 45,
        timelineStart: 10,
        duration: 15,
        candidateId: "cand-2",
        explanation: "Main explanation",
      },
    ],
    totalDuration: 25,
    isValid: true,
    validationErrors: [],
    createdAt: new Date().toISOString(),
  };

  const sampleCues = [
    { id: "cue-1", start: 12, end: 16, text: "Welcome to Content Studio" },
    { id: "cue-2", start: 17, end: 19, text: "Local browser video editing" },
    { id: "cue-3", start: 22, end: 25, text: "Unselected moment" }, // Outside seg-1 and seg-2
    { id: "cue-4", start: 32, end: 36, text: "No cloud dependencies required" },
  ];

  it("applies edit plan WITHOUT captions when captions are not provided or disabled (default off)", () => {
    const baseTimeline = createTimeline();
    const result = applyEditPlanToTimeline(samplePlan, baseTimeline, undefined, { generateCaptions: false });

    assert.equal(result.errors.length, 0);
    assert.equal(result.timeline.textOverlays.length, 0, "No captions should be created when cues are omitted");
  });

  it("maps transcript cues into sequence-relative timeline time when provided", () => {
    const baseTimeline = createTimeline();
    const transcriptsMap = new Map<string, SourceTranscript>([
      [
        "asset-1",
        {
          sourceAssetId: "asset-1",
          sourceAssetName: "asset-1.mp4",
          language: "en",
          engine: "browser-whisper",
          cues: sampleCues,
          fullText: "Welcome to Content Studio...",
          duration: 45,
          coverage: [{ start: 0, end: 45 }],
          createdAt: new Date().toISOString(),
          isWordLevel: false,
        },
      ],
    ]);
    const result = applyEditPlanToTimeline(samplePlan, baseTimeline, transcriptsMap, { generateCaptions: true });

    assert.equal(result.errors.length, 0);
    const captions = result.timeline.textOverlays.filter((o) => o.overlayType === "caption");

    // Cue 1 (12s - 16s in source, seg starts at source 10s, timeline 0s) -> [2s, 6s]
    const cap1 = captions.find((c) => c.text === "Welcome to Content Studio");
    assert.ok(cap1, "Cue 1 should be mapped into timeline");
    assert.equal(cap1.startTime, 2.0);
    assert.equal(cap1.endTime, 6.0);

    // Cue 2 (17s - 19s in source, seg starts at source 10s, timeline 0s) -> [7s, 9s]
    const cap2 = captions.find((c) => c.text === "Local browser video editing");
    assert.ok(cap2, "Cue 2 should be mapped into timeline");
    assert.equal(cap2.startTime, 7.0);
    assert.equal(cap2.endTime, 9.0);

    // Cue 3 (22s - 25s in source) is outside all segments and must be excluded!
    const cap3 = captions.find((c) => c.text === "Unselected moment");
    assert.equal(cap3, undefined, "Cue 3 must be excluded because it is in a cut section");

    // Cue 4 (32s - 36s in source, seg-2 starts at source 30s, timeline 10s) -> [12s, 16s]
    const cap4 = captions.find((c) => c.text === "No cloud dependencies required");
    assert.ok(cap4, "Cue 4 should be mapped into timeline");
    assert.equal(cap4.startTime, 12.0);
    assert.equal(cap4.endTime, 16.0);
  });

  it("serializes TextOverlay caption cues into standard SRT format", () => {
    const overlays: TextOverlay[] = [
      {
        id: "o-1",
        text: "First caption line",
        startTime: 1.5,
        endTime: 4.25,
        x: 0.5,
        y: 0.8,
        fontSize: 24,
        color: "#ffffff",
        align: "center",
        presetId: "classic",
        activeWordColor: "#facc15",
        overlayType: "caption",
      },
      {
        id: "o-2",
        text: "Second caption line",
        startTime: 5.0,
        endTime: 8.0,
        x: 0.5,
        y: 0.8,
        fontSize: 24,
        color: "#ffffff",
        align: "center",
        presetId: "classic",
        activeWordColor: "#facc15",
        overlayType: "caption",
      },
    ];

    const srt = serializeTextOverlaysToSrt(overlays);
    assert.ok(srt.includes("1\n00:00:01,500 --> 00:00:04,250\nFirst caption line"));
    assert.ok(srt.includes("2\n00:00:05,000 --> 00:00:08,000\nSecond caption line"));
  });

  it("serializes TextOverlay caption cues into standard WebVTT format", () => {
    const overlays: TextOverlay[] = [
      {
        id: "o-1",
        text: "First caption line",
        startTime: 1.5,
        endTime: 4.25,
        x: 0.5,
        y: 0.8,
        fontSize: 24,
        color: "#ffffff",
        align: "center",
        presetId: "classic",
        activeWordColor: "#facc15",
        overlayType: "caption",
      },
    ];

    const vtt = serializeTextOverlaysToVtt(overlays);
    assert.ok(vtt.startsWith("WEBVTT\n"));
    assert.ok(vtt.includes("00:00:01.500 --> 00:00:04.250\nFirst caption line"));
  });
});
