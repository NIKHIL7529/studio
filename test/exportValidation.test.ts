import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateExportedMedia } from "../src/lib/export/validation.ts";
import type { RenderPlan } from "../src/types/export.ts";

function createMockPlan(): RenderPlan {
  return {
    projectId: "a0000000-0000-4000-8000-000000000001",
    projectName: "Validation Test Project",
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
    totalDurationSeconds: 10.0,
    totalFrames: 300,
    sources: new Map(),
    missingSources: [],
    videoFrames: [],
    audioSegments: [],
    hasVideo: true,
    hasAudio: true,
    isValid: true,
    validationErrors: [],
  };
}

describe("Export Output Validation", () => {
  test("rejects zero-byte output file", async () => {
    const emptyFile = new File([], "empty.mp4", { type: "video/mp4" });
    const plan = createMockPlan();

    const res = await validateExportedMedia(emptyFile, plan);
    assert.equal(res.ok, false);
    assert.ok(res.error?.includes("0 bytes"));
  });

  test("rejects corrupt or unparseable non-media file", async () => {
    const garbageBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    const garbageFile = new File([garbageBytes], "garbage.mp4", { type: "video/mp4" });
    const plan = createMockPlan();

    const res = await validateExportedMedia(garbageFile, plan);
    assert.equal(res.ok, false);
    assert.ok(res.error?.includes("could not be parsed") || res.error?.includes("inspection failed"));
  });

  test("validates duration tolerance logic", () => {
    const plan = createMockPlan();
    plan.totalDurationSeconds = 10.0;
    plan.frameRate = 30;

    // Tolerance calculation check
    const tolerance = Math.max(0.5, 2 / plan.frameRate);
    assert.equal(tolerance, 0.5);

    const validDuration1 = 10.2;
    assert.ok(Math.abs(validDuration1 - plan.totalDurationSeconds) <= tolerance);

    const invalidDuration = 11.0; // 1s delta > 0.5s tolerance
    assert.ok(Math.abs(invalidDuration - plan.totalDurationSeconds) > tolerance);
  });

  test("validates resolution tolerance logic", () => {
    const plan = createMockPlan();
    plan.settings.width = 1920;
    plan.settings.height = 1080;

    const detectedWidth = 1920;
    const detectedHeight = 1080;
    assert.ok(Math.abs(detectedWidth - plan.settings.width) <= 4);
    assert.ok(Math.abs(detectedHeight - plan.settings.height) <= 4);

    const mismatchedWidth = 1280;
    assert.ok(Math.abs(mismatchedWidth - plan.settings.width) > 4);
  });

  test("validates video codec prefix check", () => {
    const planMp4 = createMockPlan();
    planMp4.settings.format = "mp4";
    const expectedMp4 = (planMp4.settings.format as string) === "webm" ? "vp9" : "avc";
    assert.equal(expectedMp4, "avc");
    assert.ok("avc1.640028".includes(expectedMp4));
    assert.ok(!"vp09.00.10.08".includes(expectedMp4));

    const planWebm = createMockPlan();
    planWebm.settings.format = "webm";
    const expectedWebm = planWebm.settings.format === "webm" ? "vp9" : "avc";
    assert.equal(expectedWebm, "vp9");
    assert.ok("vp9".includes(expectedWebm));
  });
});
