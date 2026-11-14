import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkVideoEncoderConfig,
  checkAudioEncoderConfig,
  findSupportedVideoCodec,
  findSupportedAudioCodec,
  detectExportCapabilities,
  H264_CODEC_CANDIDATES,
  AAC_CODEC_CANDIDATES,
} from "../src/lib/export/capabilities.ts";

describe("Export Capability Detection", () => {
  test("handles missing WebCodecs APIs gracefully without throwing", async () => {
    // In Node.js environment without WebCodecs globals
    const resVideo = await checkVideoEncoderConfig({ codec: "avc1.42001f", width: 1920, height: 1080 });
    assert.equal(resVideo, false);

    const resAudio = await checkAudioEncoderConfig({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2 });
    assert.equal(resAudio, false);

    const report = await detectExportCapabilities();
    assert.equal(report.hasWebCodecs, false);
    assert.equal(report.canExportMp4AvcAac, false);
    assert.ok(report.notes.some((n) => n.includes("not available")));
  });

  test("uses VideoEncoder.isConfigSupported when available", async () => {
    const originalVideoEncoder = (globalThis as unknown as Record<string, unknown>)["VideoEncoder"];

    try {
      // Mock VideoEncoder
      (globalThis as unknown as Record<string, unknown>)["VideoEncoder"] = {
        isConfigSupported: async (config: { codec: string }) => {
          if (config.codec.startsWith("avc1")) {
            return { supported: true, config };
          }
          return { supported: false };
        },
      };

      const codec = await findSupportedVideoCodec(H264_CODEC_CANDIDATES, 1920, 1080);
      assert.ok(codec);
      assert.ok(codec?.startsWith("avc1"));

      const unsupported = await findSupportedVideoCodec(["unsupported-codec"], 1920, 1080);
      assert.equal(unsupported, null);
    } finally {
      if (originalVideoEncoder) {
        (globalThis as unknown as Record<string, unknown>)["VideoEncoder"] = originalVideoEncoder;
      } else {
        delete (globalThis as unknown as Record<string, unknown>)["VideoEncoder"];
      }
    }
  });

  test("uses AudioEncoder.isConfigSupported when available", async () => {
    const originalAudioEncoder = (globalThis as unknown as Record<string, unknown>)["AudioEncoder"];

    try {
      // Mock AudioEncoder
      (globalThis as unknown as Record<string, unknown>)["AudioEncoder"] = {
        isConfigSupported: async (config: { codec: string }) => {
          if (config.codec === "mp4a.40.2") {
            return { supported: true, config };
          }
          return { supported: false };
        },
      };

      const codec = await findSupportedAudioCodec(AAC_CODEC_CANDIDATES, 48000, 2);
      assert.equal(codec, "mp4a.40.2");
    } finally {
      if (originalAudioEncoder) {
        (globalThis as unknown as Record<string, unknown>)["AudioEncoder"] = originalAudioEncoder;
      } else {
        delete (globalThis as unknown as Record<string, unknown>)["AudioEncoder"];
      }
    }
  });

  test("correctly reports canExportMp4AvcAac when both encoders are supported", async () => {
    const origVE = (globalThis as unknown as Record<string, unknown>)["VideoEncoder"];
    const origAE = (globalThis as unknown as Record<string, unknown>)["AudioEncoder"];

    try {
      (globalThis as unknown as Record<string, unknown>)["VideoEncoder"] = function () {};
      ((globalThis as unknown as Record<string, unknown>)["VideoEncoder"] as unknown as Record<string, unknown>).isConfigSupported =
        async (c: { codec: string }) => ({ supported: c.codec.startsWith("avc1") });

      (globalThis as unknown as Record<string, unknown>)["AudioEncoder"] = function () {};
      ((globalThis as unknown as Record<string, unknown>)["AudioEncoder"] as unknown as Record<string, unknown>).isConfigSupported =
        async (c: { codec: string }) => ({ supported: c.codec === "mp4a.40.2" });

      const report = await detectExportCapabilities();
      assert.equal(report.hasWebCodecs, true);
      assert.equal(report.canExportMp4AvcAac, true);
      assert.ok(report.supportedVideoCodecs.length > 0);
      assert.ok(report.supportedAudioCodecs.includes("mp4a.40.2"));
      assert.ok(report.supportedPresets.includes("1080p"));
    } finally {
      if (origVE) (globalThis as unknown as Record<string, unknown>)["VideoEncoder"] = origVE;
      else delete (globalThis as unknown as Record<string, unknown>)["VideoEncoder"];

      if (origAE) (globalThis as unknown as Record<string, unknown>)["AudioEncoder"] = origAE;
      else delete (globalThis as unknown as Record<string, unknown>)["AudioEncoder"];
    }
  });

  test("correctly reports canExportWebmOpus when VP9 and Opus are supported but H264 is not", async () => {
    const origVE = (globalThis as unknown as Record<string, unknown>)["VideoEncoder"];
    const origAE = (globalThis as unknown as Record<string, unknown>)["AudioEncoder"];

    try {
      (globalThis as unknown as Record<string, unknown>)["VideoEncoder"] = function () {};
      ((globalThis as unknown as Record<string, unknown>)["VideoEncoder"] as unknown as Record<string, unknown>).isConfigSupported =
        async (c: { codec: string }) => ({ supported: c.codec.startsWith("vp") });

      (globalThis as unknown as Record<string, unknown>)["AudioEncoder"] = function () {};
      ((globalThis as unknown as Record<string, unknown>)["AudioEncoder"] as unknown as Record<string, unknown>).isConfigSupported =
        async (c: { codec: string }) => ({ supported: c.codec === "opus" });

      const report = await detectExportCapabilities();
      assert.equal(report.hasWebCodecs, true);
      assert.equal(report.canExportMp4AvcAac, false);
      assert.equal(report.canExportWebmOpus, true);
      assert.ok(report.notes.some((n) => n.includes("H.264")));
    } finally {
      if (origVE) (globalThis as unknown as Record<string, unknown>)["VideoEncoder"] = origVE;
      else delete (globalThis as unknown as Record<string, unknown>)["VideoEncoder"];

      if (origAE) (globalThis as unknown as Record<string, unknown>)["AudioEncoder"] = origAE;
      else delete (globalThis as unknown as Record<string, unknown>)["AudioEncoder"];
    }
  });

  test("safely catches errors thrown by isConfigSupported", async () => {
    const origVE = (globalThis as unknown as Record<string, unknown>)["VideoEncoder"];

    try {
      (globalThis as unknown as Record<string, unknown>)["VideoEncoder"] = {
        isConfigSupported: async () => {
          throw new TypeError("Simulated hardware error");
        },
      };

      const res = await checkVideoEncoderConfig({ codec: "avc1.42001f", width: 1920, height: 1080 });
      assert.equal(res, false);
    } finally {
      if (origVE) (globalThis as unknown as Record<string, unknown>)["VideoEncoder"] = origVE;
      else delete (globalThis as unknown as Record<string, unknown>)["VideoEncoder"];
    }
  });
});
