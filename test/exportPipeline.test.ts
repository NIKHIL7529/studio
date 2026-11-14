import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderAndExport, renderTextOverlayToCanvas } from "../src/lib/export/pipeline.ts";
import type { RenderPlan } from "../src/types/export.ts";
import type { TextOverlay } from "../src/types/timeline.ts";

function createMockInvalidPlan(): RenderPlan {
  return {
    projectId: "a0000000-0000-4000-8000-000000000001",
    projectName: "Invalid Plan",
    timelineId: "t0000000-0000-4000-8000-000000000001",
    createdAt: new Date().toISOString(),
    settings: {
      targetAspectRatio: "16:9",
      width: 1920,
      height: 1080,
      frameRate: 30,
      videoCodec: "avc",
      audioCodec: "aac",
      format: "mp4",
      quality: "high",
      audioSampleRate: 48000,
      audioChannels: 2,
      filename: "test.mp4",
    },
    frameRate: 30,
    totalDurationSeconds: 0,
    totalFrames: 0,
    sources: new Map(),
    missingSources: ["missing-asset-1"],
    videoFrames: [],
    audioSegments: [],
    hasVideo: false,
    hasAudio: false,
    isValid: false,
    validationErrors: ["Timeline is empty.", "Source media missing."],
  };
}

describe("Export Pipeline Architecture & Safeguards", () => {
  test("pipeline rejects invalid plan early without performing file writes", async () => {
    const invalidPlan = createMockInvalidPlan();

    await assert.rejects(async () => {
      await renderAndExport(invalidPlan);
    }, /Cannot export.*Timeline is empty/);
  });

  test("pipeline halts cleanly when cancelled via AbortSignal", async () => {
    const validPlan: RenderPlan = {
      projectId: "a0000000-0000-4000-8000-000000000001",
      projectName: "Cancelled Plan",
      timelineId: "t0000000-0000-4000-8000-000000000001",
      createdAt: new Date().toISOString(),
      settings: {
        targetAspectRatio: "16:9",
        width: 1920,
        height: 1080,
        frameRate: 30,
        videoCodec: "avc",
        audioCodec: "aac",
        format: "mp4",
        quality: "high",
        audioSampleRate: 48000,
        audioChannels: 2,
        filename: "cancelled.mp4",
      },
      frameRate: 30,
      totalDurationSeconds: 5,
      totalFrames: 150,
      sources: new Map(),
      missingSources: [],
      videoFrames: [],
      audioSegments: [],
      hasVideo: false,
      hasAudio: false,
      isValid: true,
      validationErrors: [],
    };

    const abortController = new AbortController();
    abortController.abort(); // already aborted

    await assert.rejects(async () => {
      await renderAndExport(validPlan, {
        signal: abortController.signal,
      });
    }, /Export was cancelled/);
  });

  test("renderTextOverlayToCanvas handles multiline text, scaling and alignment", () => {
    const calls: { text: string; x: number; y: number }[] = [];
    const mockCtx = {
      save: () => {},
      restore: () => {},
      font: "",
      fillStyle: "",
      textAlign: "",
      textBaseline: "",
      shadowColor: "",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      fillText: (text: string, x: number, y: number) => {
        calls.push({ text, x, y });
      },
    } as unknown as CanvasRenderingContext2D;

    const overlay: TextOverlay = {
      id: "overlay-test",
      text: "Line 1\nLine 2",
      startTime: 0,
      endTime: 5,
      x: 0.5,
      y: 0.5,
      fontSize: 32,
      color: "#ff0000",
      align: "center",
    };

    renderTextOverlayToCanvas(mockCtx, overlay, 1920, 1080);

    // Font scaling: 1080 / 720 = 1.5, so 32 * 1.5 = 48px
    assert.equal(mockCtx.font, "600 48px sans-serif");
    assert.equal(mockCtx.fillStyle, "#ff0000");
    assert.equal(mockCtx.textAlign, "center");

    // Two lines rendered
    assert.equal(calls.length, 2);
    assert.equal(calls[0].text, "Line 1");
    assert.equal(calls[1].text, "Line 2");
    assert.equal(calls[0].x, 960);
    assert.equal(calls[1].x, 960);
    // Line 1 is above Line 2
    assert.ok(calls[0].y < calls[1].y);
  });
});
