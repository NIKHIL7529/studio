import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  calculateExportDimensions,
  getDefaultExportSettings,
  buildRenderPlan,
} from "../src/lib/export/renderPlan.ts";
import { createTimeline, addClipToTrack, addTextOverlay } from "../src/lib/timeline/model.ts";
import type { ProjectDocument, LiveAssetItem } from "../src/types/project.ts";

function createMockProject(): ProjectDocument {
  return {
    schemaVersion: 1,
    id: "a0000000-0000-4000-8000-000000000001",
    name: "Test Render Project",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    assets: [
      {
        id: "b0000000-0000-4000-8000-000000000001",
        name: "clip1.mp4",
        mediaType: "video",
        mimeType: "video/mp4",
        size: 10_000_000,
        handleRefId: "handle-1",
        metadata: {
          containerFormat: "mp4",
          duration: 30,
          inspectedAt: "2026-01-01T00:00:00.000Z",
          videoTracks: [{ trackNumber: 1, codec: "avc1.640028", displayWidth: 1920, displayHeight: 1080, frameRate: 30 }],
          audioTracks: [{ trackNumber: 2, codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2 }],
        },
      },
      {
        id: "b0000000-0000-4000-8000-000000000002",
        name: "music.mp3",
        mediaType: "audio",
        mimeType: "audio/mpeg",
        size: 5_000_000,
        handleRefId: "handle-2",
        metadata: {
          containerFormat: "mp3",
          duration: 60,
          inspectedAt: "2026-01-01T00:00:00.000Z",
          videoTracks: [],
          audioTracks: [{ trackNumber: 1, codec: "mp3", sampleRate: 44100, numberOfChannels: 2 }],
        },
      },
    ],
  };
}

function createMockLiveAssets(): Map<string, LiveAssetItem> {
  const map = new Map<string, LiveAssetItem>();
  const proj = createMockProject();

  map.set(proj.assets[0].id, {
    asset: proj.assets[0],
    status: "ready",
    file: new File([new Uint8Array(100)], "clip1.mp4", { type: "video/mp4" }),
  });

  map.set(proj.assets[1].id, {
    asset: proj.assets[1],
    status: "ready",
    file: new File([new Uint8Array(100)], "music.mp3", { type: "audio/mpeg" }),
  });

  return map;
}

describe("calculateExportDimensions", () => {
  test("computes even dimensions for 16:9", () => {
    assert.deepEqual(calculateExportDimensions("16:9", "1080p"), { width: 1920, height: 1080 });
    assert.deepEqual(calculateExportDimensions("16:9", "720p"), { width: 1280, height: 720 });
    assert.deepEqual(calculateExportDimensions("16:9", "540p"), { width: 960, height: 540 });
  });

  test("computes even dimensions for 9:16", () => {
    assert.deepEqual(calculateExportDimensions("9:16", "1080p"), { width: 1080, height: 1920 });
    assert.deepEqual(calculateExportDimensions("9:16", "720p"), { width: 720, height: 1280 });
    assert.deepEqual(calculateExportDimensions("9:16", "540p"), { width: 540, height: 960 });
  });

  test("computes even dimensions for 1:1", () => {
    assert.deepEqual(calculateExportDimensions("1:1", "1080p"), { width: 1080, height: 1080 });
    assert.deepEqual(calculateExportDimensions("1:1", "720p"), { width: 720, height: 720 });
  });

  test("computes even dimensions for 4:5", () => {
    const dim1080 = calculateExportDimensions("4:5", "1080p");
    assert.equal(dim1080.width % 2, 0);
    assert.equal(dim1080.height % 2, 0);

    const dim540 = calculateExportDimensions("4:5", "540p");
    assert.equal(dim540.width % 2, 0);
    assert.equal(dim540.height % 2, 0);
  });
});

describe("getDefaultExportSettings", () => {
  test("produces complete settings with clean filename", () => {
    const settings = getDefaultExportSettings("16:9", "1080p", "My Cool Video! / Test");
    assert.equal(settings.targetAspectRatio, "16:9");
    assert.equal(settings.width, 1920);
    assert.equal(settings.height, 1080);
    assert.equal(settings.frameRate, 30);
    assert.equal(settings.format, "mp4");
    assert.ok(settings.filename.endsWith(".mp4"));
    assert.ok(!settings.filename.includes("/"));
    assert.ok(!settings.filename.includes("!"));
  });
});

describe("buildRenderPlan", () => {
  test("flags empty timeline as invalid", () => {
    const proj = createMockProject();
    const timeline = createTimeline();
    const settings = getDefaultExportSettings("16:9", "1080p", proj.name);
    const liveAssets = createMockLiveAssets();

    const plan = buildRenderPlan(proj, timeline, settings, liveAssets);
    assert.equal(plan.isValid, false);
    assert.equal(plan.totalFrames, 0);
    assert.ok(plan.validationErrors.some((e) => e.includes("empty")));
  });

  test("builds deterministic frame sequence with integer frame arithmetic", () => {
    const proj = createMockProject();
    let timeline = createTimeline();
    const videoTrack = timeline.tracks.find((t) => t.type === "video")!;

    // Clip 1: 0s to 5s (source 10s to 15s)
    timeline = addClipToTrack(timeline, videoTrack.id, {
      id: "clip-1",
      assetId: proj.assets[0].id,
      trackId: videoTrack.id,
      startTime: 0,
      sourceIn: 10,
      sourceOut: 15,
      volume: 1,
      muted: false,
    });

    const settings = getDefaultExportSettings("16:9", "1080p", proj.name);
    settings.frameRate = 30;
    const liveAssets = createMockLiveAssets();

    const plan = buildRenderPlan(proj, timeline, settings, liveAssets);

    assert.equal(plan.isValid, true);
    assert.equal(plan.totalDurationSeconds, 5);
    assert.equal(plan.totalFrames, 150); // 5s * 30fps
    assert.equal(plan.videoFrames.length, 150);

    // Frame 0
    assert.equal(plan.videoFrames[0].frameIndex, 0);
    assert.equal(plan.videoFrames[0].presentationTimeSeconds, 0);
    assert.equal(plan.videoFrames[0].presentationTimeUs, BigInt(0));
    assert.equal(plan.videoFrames[0].activeClip?.clipId, "clip-1");
    assert.equal(plan.videoFrames[0].activeClip?.sourceTimeSeconds, 10);

    // Frame 30 (1 second in)
    assert.equal(plan.videoFrames[30].frameIndex, 30);
    assert.equal(plan.videoFrames[30].presentationTimeSeconds, 1.0);
    assert.equal(plan.videoFrames[30].presentationTimeUs, BigInt(1_000_000));
    assert.equal(plan.videoFrames[30].activeClip?.sourceTimeSeconds, 11);

    // Frame 149 (last frame)
    assert.equal(plan.videoFrames[149].frameIndex, 149);
    assert.ok(plan.videoFrames[149].activeClip !== null);
    assert.ok((plan.videoFrames[149].activeClip?.sourceTimeSeconds ?? 0) < 15);
  });

  test("handles timeline gaps correctly (activeClip is null)", () => {
    const proj = createMockProject();
    let timeline = createTimeline();
    const videoTrack = timeline.tracks.find((t) => t.type === "video")!;

    // Clip 1: 2s to 4s (gap before at 0-2s)
    timeline = addClipToTrack(timeline, videoTrack.id, {
      id: "clip-gap",
      assetId: proj.assets[0].id,
      trackId: videoTrack.id,
      startTime: 2,
      sourceIn: 0,
      sourceOut: 2,
      volume: 1,
      muted: false,
    });

    const settings = getDefaultExportSettings("16:9", "1080p", proj.name);
    settings.frameRate = 30;
    const liveAssets = createMockLiveAssets();

    const plan = buildRenderPlan(proj, timeline, settings, liveAssets);
    assert.equal(plan.isValid, true);
    assert.equal(plan.totalDurationSeconds, 4);

    // Frame 0 (time 0s): gap!
    assert.equal(plan.videoFrames[0].activeClip, null);
    // Frame 30 (time 1s): gap!
    assert.equal(plan.videoFrames[30].activeClip, null);
    // Frame 60 (time 2s): active!
    assert.notEqual(plan.videoFrames[60].activeClip, null);
    assert.equal(plan.videoFrames[60].activeClip?.clipId, "clip-gap");
  });

  test("resolves overlapping video tracks deterministically (top track order priority)", () => {
    const proj = createMockProject();
    let timeline = createTimeline();

    // Track 1 (order 0)
    const topTrack = timeline.tracks.find((t) => t.type === "video")!;
    topTrack.order = 0;

    // Track 2 (order 1)
    const bottomTrack = {
      id: "track-video-2",
      type: "video" as const,
      name: "Video 2",
      order: 1,
      muted: false,
      clips: [],
    };
    timeline.tracks.push(bottomTrack);

    // Clip on bottom track from 0 to 4s
    timeline = addClipToTrack(timeline, bottomTrack.id, {
      id: "clip-bottom",
      assetId: proj.assets[0].id,
      trackId: bottomTrack.id,
      startTime: 0,
      sourceIn: 0,
      sourceOut: 4,
      volume: 1,
      muted: false,
    });

    // Clip on top track from 1 to 3s
    timeline = addClipToTrack(timeline, topTrack.id, {
      id: "clip-top",
      assetId: proj.assets[0].id,
      trackId: topTrack.id,
      startTime: 1,
      sourceIn: 0,
      sourceOut: 2,
      volume: 1,
      muted: false,
    });

    const settings = getDefaultExportSettings("16:9", "1080p", proj.name);
    settings.frameRate = 30;
    const liveAssets = createMockLiveAssets();

    const plan = buildRenderPlan(proj, timeline, settings, liveAssets);

    // At t=0.5s: only bottom track has clip
    assert.equal(plan.videoFrames[15].activeClip?.clipId, "clip-bottom");

    // At t=1.5s: both tracks have clip, top track (order 0) wins!
    assert.equal(plan.videoFrames[45].activeClip?.clipId, "clip-top");

    // At t=3.5s: top track ended, bottom track resumes!
    assert.equal(plan.videoFrames[105].activeClip?.clipId, "clip-bottom");
  });

  test("respects audio volume and muting rules", () => {
    const proj = createMockProject();
    let timeline = createTimeline();
    const audioTrack = timeline.tracks.find((t) => t.type === "audio")!;

    // Audio clip with 0.7 volume
    timeline = addClipToTrack(timeline, audioTrack.id, {
      id: "audio-clip-1",
      assetId: proj.assets[1].id,
      trackId: audioTrack.id,
      startTime: 0,
      sourceIn: 5,
      sourceOut: 15,
      volume: 0.7,
      muted: false,
    });

    const settings = getDefaultExportSettings("16:9", "1080p", proj.name);
    const liveAssets = createMockLiveAssets();

    const plan = buildRenderPlan(proj, timeline, settings, liveAssets);
    assert.equal(plan.audioSegments.length, 1);
    assert.equal(plan.audioSegments[0].volume, 0.7);
    assert.equal(plan.audioSegments[0].sourceInSeconds, 5);
    assert.equal(plan.audioSegments[0].sourceOutSeconds, 15);

    // If track is muted, volume becomes 0
    timeline.tracks.find((t) => t.id === audioTrack.id)!.muted = true;
    const planMuted = buildRenderPlan(proj, timeline, settings, liveAssets);
    assert.equal(planMuted.audioSegments[0].volume, 0);
  });

  test("associates active text overlays with exact time boundaries", () => {
    const proj = createMockProject();
    let timeline = createTimeline();
    const videoTrack = timeline.tracks.find((t) => t.type === "video")!;

    timeline = addClipToTrack(timeline, videoTrack.id, {
      id: "clip-1",
      assetId: proj.assets[0].id,
      trackId: videoTrack.id,
      startTime: 0,
      sourceIn: 0,
      sourceOut: 6,
      volume: 1,
      muted: false,
    });

    // Overlay active from 2s to 4s
    timeline = addTextOverlay(timeline, {
      id: "overlay-1",
      text: "Hello World",
      startTime: 2,
      endTime: 4,
      x: 0.5,
      y: 0.8,
      fontSize: 32,
      color: "#ffffff",
      align: "center",
    });

    const settings = getDefaultExportSettings("16:9", "1080p", proj.name);
    settings.frameRate = 30;
    const liveAssets = createMockLiveAssets();

    const plan = buildRenderPlan(proj, timeline, settings, liveAssets);

    // At t=1.0s (frame 30): no overlays
    assert.equal(plan.videoFrames[30].activeOverlays.length, 0);

    // At t=2.0s (frame 60): overlay active
    assert.equal(plan.videoFrames[60].activeOverlays.length, 1);
    assert.equal(plan.videoFrames[60].activeOverlays[0].text, "Hello World");

    // At t=3.5s (frame 105): overlay active
    assert.equal(plan.videoFrames[105].activeOverlays.length, 1);

    // At t=4.0s (frame 120): overlay expired (exclusive boundary)
    assert.equal(plan.videoFrames[120].activeOverlays.length, 0);
  });

  test("flags missing source assets and marks plan invalid", () => {
    const proj = createMockProject();
    let timeline = createTimeline();
    const videoTrack = timeline.tracks.find((t) => t.type === "video")!;

    timeline = addClipToTrack(timeline, videoTrack.id, {
      id: "clip-offline",
      assetId: "nonexistent-asset-id",
      trackId: videoTrack.id,
      startTime: 0,
      sourceIn: 0,
      sourceOut: 5,
      volume: 1,
      muted: false,
    });

    const settings = getDefaultExportSettings("16:9", "1080p", proj.name);
    const liveAssets = createMockLiveAssets();

    const plan = buildRenderPlan(proj, timeline, settings, liveAssets);
    assert.equal(plan.isValid, false);
    assert.equal(plan.missingSources.length, 1);
    assert.equal(plan.missingSources[0], "nonexistent-asset-id");
    assert.ok(plan.validationErrors.some((e) => e.includes("missing or inaccessible")));
  });

  test("immutability: subsequent timeline mutations do not affect generated plan", () => {
    const proj = createMockProject();
    let timeline = createTimeline();
    const videoTrack = timeline.tracks.find((t) => t.type === "video")!;

    timeline = addClipToTrack(timeline, videoTrack.id, {
      id: "clip-immutable",
      assetId: proj.assets[0].id,
      trackId: videoTrack.id,
      startTime: 0,
      sourceIn: 0,
      sourceOut: 5,
      volume: 1,
      muted: false,
    });

    const settings = getDefaultExportSettings("16:9", "1080p", proj.name);
    const liveAssets = createMockLiveAssets();

    const plan = buildRenderPlan(proj, timeline, settings, liveAssets);
    assert.equal(plan.totalFrames, 150);

    // Now mutate timeline by adding another clip
    timeline.tracks[0].clips.push({
      id: "clip-later",
      assetId: proj.assets[0].id,
      trackId: videoTrack.id,
      startTime: 10,
      sourceIn: 0,
      sourceOut: 5,
      volume: 1,
      muted: false,
    });

    // Plan total frames remains 150
    assert.equal(plan.totalFrames, 150);
  });
});
