/**
 * Media Compatibility & Correctness Matrix Test Suite
 *
 * Covers:
 * - Resolutions & aspect ratios (16:9, 9:16, 1:1, 4:5)
 * - Orientation calculations and formatting
 * - Audio-only assets (WAV)
 * - Media without usable audio or video tracks
 * - Variable-frame-rate (VFR) vs Constant-frame-rate (CFR) metadata handling
 * - Long-duration media streaming access simulation
 * - Unsupported and corrupt files
 * - Timeline timestamp mapping across trimming, splitting and ordering
 * - Text overlay positioning and time window matching
 * - Render plan missing-source preflight and export output validation
 *
 * Provenance & Licensing:
 * Synthetic test fixtures generated strictly in-memory using standard RIFF/WAVE
 * and ISOBMFF box format specifications. No copyrighted or external media used.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { inspectMediaFile, formatDuration, formatResolution } from "../src/lib/media/inspector.ts";
import { validateInspectedMetadata } from "../src/lib/projectValidation.ts";
import { buildRenderPlan, calculateExportDimensions } from "../src/lib/export/renderPlan.ts";
import { validateExportedMedia } from "../src/lib/export/validation.ts";
import {
  createTimeline,
  createClip,
  addClipToTrack,
  splitClip,
  createTextOverlay,
  addTextOverlay,
  getTimelineDuration,
  getActiveClipAtTime,
  getActiveTextOverlaysAtTime,
} from "../src/lib/timeline/model.ts";
import type { ProjectDocument, LiveAssetItem } from "../src/types/project.ts";
import type { ExportSettings } from "../src/types/export.ts";

// ─── Synthetic Fixture Generators ─────────────────────────────────────────────

/**
 * Creates an in-memory RIFF/WAV audio blob with configurable parameters.
 */
function createSyntheticWav(sampleRate = 48000, channels = 2, durationSec = 1.0): Blob {
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * channels * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeStr(offset: number, s: string) {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  }

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true); // 16-bit
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Creates an in-memory ISOBMFF container blob with basic ftyp and moov boxes.
 */
function createSyntheticIsoBox(): Blob {
  const ftyp = new Uint8Array([
    0x00, 0x00, 0x00, 0x18, // size 24
    0x66, 0x74, 0x79, 0x70, // 'ftyp'
    0x69, 0x73, 0x6f, 0x6d, // 'isom'
    0x00, 0x00, 0x02, 0x00, // minor version
    0x69, 0x73, 0x6f, 0x6d, // compatible brands
    0x6d, 0x70, 0x34, 0x31,
  ]);
  const moov = new Uint8Array([
    0x00, 0x00, 0x00, 0x08, // size 8
    0x6d, 0x6f, 0x6f, 0x76, // 'moov' (empty moov, no track sample tables)
  ]);

  return new Blob([ftyp, moov], { type: "video/mp4" });
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("Media Matrix & Correctness", () => {
  describe("Resolution, Aspect Ratio & Dimension Calculations", () => {
    test("calculates correct output dimensions across standard aspect ratios", () => {
      // 16:9 Landscape
      const r169_1080 = calculateExportDimensions("16:9", "1080p");
      assert.equal(r169_1080.width, 1920);
      assert.equal(r169_1080.height, 1080);

      const r169_720 = calculateExportDimensions("16:9", "720p");
      assert.equal(r169_720.width, 1280);
      assert.equal(r169_720.height, 720);

      // 9:16 Portrait / Vertical (Shorts/Reels)
      const r916_1080 = calculateExportDimensions("9:16", "1080p");
      assert.equal(r916_1080.width, 1080);
      assert.equal(r916_1080.height, 1920);

      const r916_720 = calculateExportDimensions("9:16", "720p");
      assert.equal(r916_720.width, 720);
      assert.equal(r916_720.height, 1280);

      // 1:1 Square
      const r11_1080 = calculateExportDimensions("1:1", "1080p");
      assert.equal(r11_1080.width, 1080);
      assert.equal(r11_1080.height, 1080);

      // 4:5 Portrait
      const r45_1080 = calculateExportDimensions("4:5", "1080p");
      assert.equal(r45_1080.width, 1080);
      assert.equal(r45_1080.height, 1350);

      const r45_720 = calculateExportDimensions("4:5", "720p");
      assert.equal(r45_720.width, 720);
      assert.equal(r45_720.height, 900);
    });

    test("formats resolution strings cleanly for display and inspector", () => {
      assert.equal(formatResolution(1920, 1080), "1920 × 1080");
      assert.equal(formatResolution(1080, 1920), "1080 × 1920");
      assert.equal(formatResolution(1080, 1080), "1080 × 1080");
      assert.equal(formatResolution(undefined, undefined), "Unknown");
    });
  });

  describe("Audio Assets & Track Inspection", () => {
    test("inspects audio-only WAV assets accurately", async () => {
      const wav = createSyntheticWav(44100, 2, 2.5);
      const res = await inspectMediaFile(wav);

      assert.equal(res.status, "ready");
      assert.ok(res.metadata);
      assert.equal(res.metadata.containerFormat, "WAVE");
      assert.equal(res.metadata.audioTracks.length, 1);
      assert.equal(res.metadata.videoTracks.length, 0);
      assert.equal(res.metadata.numberOfChannels, 2);
      assert.equal(res.metadata.sampleRate, 44100);
      assert.ok(res.metadata.duration && res.metadata.duration >= 2.4);
    });

    test("inspects mono and high sample rate audio files", async () => {
      const wavMono = createSyntheticWav(48000, 1, 1.0);
      const res = await inspectMediaFile(wavMono);

      assert.equal(res.status, "ready");
      assert.ok(res.metadata);
      assert.equal(res.metadata.numberOfChannels, 1);
      assert.equal(res.metadata.sampleRate, 48000);
    });

    test("detects containers lacking usable decodable tracks as corrupt or unsupported", async () => {
      const isoBox = createSyntheticIsoBox();
      const res = await inspectMediaFile(isoBox);
      assert.ok(res.status === "no-usable-tracks" || res.status === "corrupt" || res.status === "unsupported");
    });
  });

  describe("Variable vs Constant Frame Rate Metadata Safeguards", () => {
    test("does not invent fixed frame rates for unknown or variable frame rate content", () => {
      const sanitized = validateInspectedMetadata({
        containerFormat: "MP4",
        duration: 10.0,
        isConstantFrameRate: false,
        videoTracks: [
          {
            trackNumber: 1,
            codedWidth: 1920,
            codedHeight: 1080,
            frameRate: undefined, // Variable or uncomputable
            isConstantFrameRate: false,
          },
        ],
        audioTracks: [],
      });

      assert.ok(sanitized);
      assert.equal(sanitized?.frameRate, undefined, "Must not fabricate a fixed frame rate");
      assert.equal(sanitized?.isConstantFrameRate, false);
      assert.equal(sanitized?.videoTracks[0].isConstantFrameRate, false);
    });

    test("preserves genuine constant frame rate when verified", () => {
      const sanitized = validateInspectedMetadata({
        containerFormat: "MP4",
        duration: 10.0,
        frameRate: 29.97,
        isConstantFrameRate: true,
        videoTracks: [
          {
            trackNumber: 1,
            codedWidth: 1920,
            codedHeight: 1080,
            frameRate: 29.97,
            isConstantFrameRate: true,
          },
        ],
        audioTracks: [],
      });

      assert.ok(sanitized);
      assert.equal(sanitized?.frameRate, 29.97);
      assert.equal(sanitized?.isConstantFrameRate, true);
    });
  });

  describe("Long Duration Media Streaming Access", () => {
    test("inspectMediaFile reads headers and computes duration accurately", async () => {
      // 10-second WAV fixture
      const wav10s = createSyntheticWav(48000, 2, 10.0);
      const res = await inspectMediaFile(wav10s);
      assert.equal(res.status, "ready");
      assert.ok(res.metadata?.duration !== undefined);
      assert.ok(res.metadata.duration >= 9.9);
      assert.equal(formatDuration(res.metadata.duration), "00:10");
    });
  });

  describe("Corrupt, Empty and Unsupported Media Handling", () => {
    test("reports corrupt for 0-byte file", async () => {
      const empty = new Blob([], { type: "video/mp4" });
      const res = await inspectMediaFile(empty);
      assert.equal(res.status, "corrupt");
      assert.ok(res.error?.includes("0 bytes"));
    });

    test("reports unsupported for unrecognized plain text file", async () => {
      const text = new Blob(["This is plain text and not a video container."], { type: "text/plain" });
      const res = await inspectMediaFile(text);
      assert.equal(res.status, "unsupported");
    });

    test("reports corrupt or unsupported for truncated binary garbage", async () => {
      const garbage = new Blob([new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])]);
      const res = await inspectMediaFile(garbage);
      assert.ok(res.status === "unsupported" || res.status === "corrupt" || res.status === "error");
    });
  });

  describe("Timeline Editing & Timestamp Correctness across Multiple Sources", () => {
    test("timeline timestamps map accurately across trimming, splitting and ordering", () => {
      let tl = createTimeline();
      const trackId = tl.tracks[0].id;

      // Clip 1: Asset A from 0s to 5s (source 10s to 15s)
      const clip1 = createClip("asset-A", trackId, 0, 10, 15);

      // Clip 2: Asset B from 5s to 12s (source 0s to 7s)
      const clip2 = createClip("asset-B", trackId, 5, 0, 7);

      tl = addClipToTrack(tl, trackId, clip1);
      tl = addClipToTrack(tl, trackId, clip2);

      assert.equal(getTimelineDuration(tl), 12.0);

      // Verify active clip at t = 2.5s (inside Clip 1)
      const activeAt2_5 = getActiveClipAtTime(tl, 2.5);
      assert.equal(activeAt2_5?.id, clip1.id);
      assert.equal(activeAt2_5?.assetId, "asset-A");

      // Verify active clip at t = 7.0s (inside Clip 2)
      const activeAt7 = getActiveClipAtTime(tl, 7.0);
      assert.equal(activeAt7?.id, clip2.id);
      assert.equal(activeAt7?.assetId, "asset-B");

      // Split Clip 2 at source time = 3.0s (which corresponds to timeline t = 8.0s)
      const splitTl = splitClip(tl, clip2.id, 3.0);
      assert.ok(splitTl);
      const trackClips = splitTl!.tracks[0].clips;
      assert.equal(trackClips.length, 3);

      // First part: 5.0s to 8.0s (source 0.0s to 3.0s)
      assert.equal(trackClips[1].startTime, 5.0);
      assert.equal(trackClips[1].sourceIn, 0.0);
      assert.equal(trackClips[1].sourceOut, 3.0);

      // Second part: 8.0s to 12.0s (source 3.0s to 7.0s)
      assert.equal(trackClips[2].startTime, 8.0);
      assert.equal(trackClips[2].sourceIn, 3.0);
      assert.equal(trackClips[2].sourceOut, 7.0);
    });

    test("text overlays appear at exact configured times and positions", () => {
      let tl = createTimeline();
      const overlay1 = createTextOverlay(1.0, 4.0);
      overlay1.text = "Intro Title";
      overlay1.x = 0.5;
      overlay1.y = 0.8;

      const overlay2 = createTextOverlay(8.0, 10.0);
      overlay2.text = "Outro Credits";
      overlay2.x = 0.5;
      overlay2.y = 0.5;

      tl = addTextOverlay(tl, overlay1);
      tl = addTextOverlay(tl, overlay2);

      // At t = 0.5: no overlay
      assert.equal(getActiveTextOverlaysAtTime(tl, 0.5).length, 0);

      // At t = 2.0: overlay1 active
      const at2 = getActiveTextOverlaysAtTime(tl, 2.0);
      assert.equal(at2.length, 1);
      assert.equal(at2[0].text, "Intro Title");

      // At t = 5.0: gap
      assert.equal(getActiveTextOverlaysAtTime(tl, 5.0).length, 0);

      // At t = 9.0: overlay2 active
      const at9 = getActiveTextOverlaysAtTime(tl, 9.0);
      assert.equal(at9.length, 1);
      assert.equal(at9[0].text, "Outro Credits");
    });
  });

  describe("Export Validation & Preflight Correctness", () => {
    test("rejects corrupt or zero-byte export files", async () => {
      const mockPlan = {
        totalDurationSeconds: 10.0,
        frameRate: 30,
        settings: {
          width: 1920,
          height: 1080,
          videoCodec: "avc",
          audioCodec: "aac",
          format: "mp4" as const,
        },
      };

      const emptyFile = new File([], "empty.mp4", { type: "video/mp4" });
      const emptyValidation = await validateExportedMedia(emptyFile, mockPlan as unknown as Parameters<typeof validateExportedMedia>[1]);
      assert.equal(emptyValidation.ok, false);
      assert.ok(emptyValidation.error?.includes("0 bytes"));

      const corruptFile = new File([new Uint8Array([1, 2, 3, 4])], "bad.mp4", { type: "video/mp4" });
      const corruptValidation = await validateExportedMedia(corruptFile, mockPlan as unknown as Parameters<typeof validateExportedMedia>[1]);
      assert.equal(corruptValidation.ok, false);
    });

    test("buildRenderPlan identifies missing source assets before rendering", () => {
      const project: ProjectDocument = {
        schemaVersion: 1,
        id: "p0000000-0000-4000-8000-000000000001",
        name: "Test Project",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        assets: [],
      };

      let tl = createTimeline();
      const trackId = tl.tracks[0].id;
      tl = addClipToTrack(
        tl,
        trackId,
        createClip("missing-asset-id", trackId, 0, 0, 5)
      );

      const liveAssets = new Map<string, LiveAssetItem>();
      // "missing-asset-id" is NOT present in liveAssets

      const settings: ExportSettings = {
        targetAspectRatio: "16:9",
        width: 1920,
        height: 1080,
        frameRate: 30,
        format: "mp4",
        videoCodec: "avc",
        audioCodec: "aac",
        audioSampleRate: 48000,
        audioChannels: 2,
        quality: "high",
        filename: "test.mp4",
      };

      const plan = buildRenderPlan(project, tl, settings, liveAssets);
      assert.equal(plan.isValid, false);
      assert.ok(plan.missingSources.includes("missing-asset-id"));
      assert.ok(plan.validationErrors.some((e) => e.includes("missing-asset-id")));
    });
  });
});
