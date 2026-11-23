import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  createTimeline,
  createClip,
  addClipToTrack,
  getActiveClipAtTime,
} from "../src/lib/timeline/model.ts";
import {
  addTrack,
  insertEdit,
  overwriteEdit,
} from "../src/lib/timeline/editingOperations.ts";
import { buildRenderPlan, getDefaultExportSettings } from "../src/lib/export/renderPlan.ts";
import { renderTextOverlayToCanvas } from "../src/lib/export/pipeline.ts";
import { createDefaultProject } from "../src/lib/projectValidation.ts";
import type { LiveAssetItem } from "../src/types/project.ts";

describe("Content Studio Remediation Tests", () => {
  test("insertEdit with audioTrackId creates linked video and audio clips", () => {
    let tl = createTimeline();
    const videoTrack = tl.tracks.find((t) => t.type === "video")!;
    const audioTrack = tl.tracks.find((t) => t.type === "audio")!;

    // Initial video clip
    const initialClip = {
      ...createClip("asset-1", videoTrack.id, 0, 0, 10),
      id: "v1",
    };
    tl = addClipToTrack(tl, videoTrack.id, initialClip);

    // Initial audio clip
    const initialAudio = {
      ...createClip("asset-1", audioTrack.id, 0, 0, 10),
      id: "a1",
    };
    tl = addClipToTrack(tl, audioTrack.id, initialAudio);

    // Insert edit at t=5s for 3s with linked audio
    const result = insertEdit(tl, videoTrack.id, "asset-2", 1, 4, 5, true, audioTrack.id);

    const vTrackResult = result.tracks.find((t) => t.id === videoTrack.id)!;
    const aTrackResult = result.tracks.find((t) => t.id === audioTrack.id)!;

    // Both tracks should have 3 clips (0-5, 5-8 inserted, 8-13 rippled)
    assert.equal(vTrackResult.clips.length, 3);
    assert.equal(aTrackResult.clips.length, 3);

    const insertedVideo = vTrackResult.clips.find((c) => c.startTime === 5)!;
    const insertedAudio = aTrackResult.clips.find((c) => c.startTime === 5)!;

    assert.ok(insertedVideo);
    assert.ok(insertedAudio);
    assert.equal(insertedVideo.linkedClipId, insertedAudio.id);
    assert.equal(insertedAudio.linkedClipId, insertedVideo.id);
    assert.equal(insertedVideo.sourceIn, 1);
    assert.equal(insertedVideo.sourceOut, 4);
    assert.equal(insertedAudio.sourceIn, 1);
    assert.equal(insertedAudio.sourceOut, 4);
  });

  test("overwriteEdit with audioTrackId places linked video and audio clips", () => {
    let tl = createTimeline();
    const videoTrack = tl.tracks.find((t) => t.type === "video")!;
    const audioTrack = tl.tracks.find((t) => t.type === "audio")!;

    // Add 10s video and audio clips
    tl = addClipToTrack(tl, videoTrack.id, {
      ...createClip("asset-1", videoTrack.id, 0, 0, 10),
      id: "v1",
    });
    tl = addClipToTrack(tl, audioTrack.id, {
      ...createClip("asset-1", audioTrack.id, 0, 0, 10),
      id: "a1",
    });

    // Overwrite from 3s to 6s (duration 3s)
    const result = overwriteEdit(tl, videoTrack.id, "asset-new", 0, 3, 3, audioTrack.id);

    const vTrackResult = result.tracks.find((t) => t.id === videoTrack.id)!;
    const aTrackResult = result.tracks.find((t) => t.id === audioTrack.id)!;

    const placedVideo = vTrackResult.clips.find((c) => c.assetId === "asset-new")!;
    const placedAudio = aTrackResult.clips.find((c) => c.assetId === "asset-new")!;

    assert.ok(placedVideo);
    assert.ok(placedAudio);
    assert.equal(placedVideo.startTime, 3);
    assert.equal(placedAudio.startTime, 3);
    assert.equal(placedVideo.linkedClipId, placedAudio.id);
    assert.equal(placedAudio.linkedClipId, placedVideo.id);
  });

  test("getActiveClipAtTime suppresses clips on hidden video tracks", () => {
    let tl = createTimeline();
    const v1 = tl.tracks.find((t) => t.type === "video")!;
    tl = addTrack(tl, "video");
    const v2 = tl.tracks.find((t) => t.id !== v1.id && t.type === "video")!;

    // v1 clip from 0 to 10
    tl = addClipToTrack(tl, v1.id, {
      ...createClip("asset-v1", v1.id, 0, 0, 10),
      id: "c-v1",
    });

    // v2 clip from 0 to 10
    tl = addClipToTrack(tl, v2.id, {
      ...createClip("asset-v2", v2.id, 0, 0, 10),
      id: "c-v2",
    });

    // Without hiding, top track is returned
    const activeNormal = getActiveClipAtTime(tl, 2);
    assert.equal(activeNormal?.id, "c-v1");

    // Hide v1 track
    const tlHidden = {
      ...tl,
      tracks: tl.tracks.map((t) => (t.id === v1.id ? { ...t, hidden: true } : t)),
    };

    const activeWhenV1Hidden = getActiveClipAtTime(tlHidden, 2);
    assert.equal(activeWhenV1Hidden?.id, "c-v2");

    // Hide both tracks
    const tlBothHidden = {
      ...tl,
      tracks: tl.tracks.map((t) => ({ ...t, hidden: true })),
    };
    assert.equal(getActiveClipAtTime(tlBothHidden, 2), null);
  });

  test("buildRenderPlan excludes hidden video tracks from active clip rendering", () => {
    const project = createDefaultProject("Test Render Plan");
    let tl = createTimeline();
    const v1 = tl.tracks.find((t) => t.type === "video")!;

    tl = addClipToTrack(tl, v1.id, {
      ...createClip("asset-1", v1.id, 0, 0, 5),
      id: "c1",
    });

    // Mark track hidden
    tl = {
      ...tl,
      tracks: tl.tracks.map((t) => (t.id === v1.id ? { ...t, hidden: true } : t)),
    };

    const liveAssets = new Map<string, LiveAssetItem>();
    liveAssets.set("asset-1", {
      asset: {
        id: "asset-1",
        name: "Test.mp4",
        kind: "video",
        mediaType: "video",
        mimeType: "video/mp4",
        size: 1024,
        handleRefId: "ref-1",
      },
      status: "ready",
      file: {} as File,
    });

    const settings = getDefaultExportSettings("16:9", "720p", "test");
    const plan = buildRenderPlan(project, tl, settings, liveAssets);

    // Active clip should be null on all frames because track is hidden
    assert.equal(plan.videoFrames[10].activeClip, null);
  });

  test("renderTextOverlayToCanvas breaks long unbroken words and clamps within safe margins", () => {
    const recordedOps: string[] = [];
    const mockCtx = {
      save: () => recordedOps.push("save"),
      restore: () => recordedOps.push("restore"),
      measureText: (txt: string) => ({ width: txt.length * 10 }),
      font: "",
      fillStyle: "",
      textAlign: "",
      textBaseline: "",
      beginPath: () => recordedOps.push("beginPath"),
      roundRect: (x: number, y: number, w: number, h: number, r: number) => {
        void r;
        recordedOps.push(`roundRect:x=${Math.round(x)},y=${Math.round(y)},w=${Math.round(w)},h=${Math.round(h)}`);
      },
      fill: () => recordedOps.push("fill"),
      fillText: (txt: string, x: number, y: number) => {
        void x;
        void y;
        recordedOps.push(`fillText:${txt}`);
      },
      strokeText: () => { },
    } as unknown as CanvasRenderingContext2D;

    const overlay = {
      id: "ov-long",
      text: "https://verylongunbrokenurlthatwouldnormallyoverflowthecanvasentirelyandclipoffscreen.com/subpath",
      startTime: 0,
      endTime: 5,
      x: 0.98, // Extreme right position (outside safe margin)
      y: 0.98, // Extreme bottom position (outside safe margin)
      fontSize: 24,
      color: "#ffffff",
      align: "center" as const,
      presetId: "classic" as const,
      activeWordColor: "#facc15",
      overlayType: "caption" as const,
      preset: "clean" as const,
      boxWidthRatio: 0.5,
    };

    renderTextOverlayToCanvas(mockCtx, overlay, 600, 400);

    // Should have split into multiple lines and drawn fillText for each chunk
    const fillOps = recordedOps.filter((op) => op.startsWith("fillText:"));
    assert.ok(fillOps.length > 1, "Should have broken long unbroken word into multiple lines");

    // The roundRect should have been clamped within safe margins (5% safe area = minX: 30, maxX: 570)
    const rectOp = recordedOps.find((op) => op.startsWith("roundRect:"))!;
    assert.ok(rectOp, "Should have rendered background pill");
    const match = /roundRect:x=(\d+),y=(\d+),w=(\d+),h=(\d+)/.exec(rectOp);
    assert.ok(match);
    const boxX = parseInt(match[1], 10);
    const boxW = parseInt(match[3], 10);
    // Box must not exceed canvas width minus right safe margin (600 - 30 = 570)
    assert.ok(boxX + boxW <= 575, `boxX + boxW (${boxX + boxW}) should not exceed right margin`);
  });
});
