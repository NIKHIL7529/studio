import test from "node:test";
import assert from "node:assert/strict";
import {
  detectWebCodecsCapabilities,
  checkVideoDecoderSupport,
  checkAudioDecoderSupport,
  checkVideoEncoderSupport,
  checkAudioEncoderSupport,
  checkAssetDecoderSupport,
} from "../src/lib/media/webcodecsCapabilities.ts";
import type { InspectedMediaMetadata } from "../src/lib/media/types.ts";

test("detectWebCodecsCapabilities returns typed capability report", () => {
  const caps = detectWebCodecsCapabilities();
  assert.equal(typeof caps.hasVideoDecoder, "boolean");
  assert.equal(typeof caps.hasVideoEncoder, "boolean");
  assert.equal(typeof caps.hasAudioDecoder, "boolean");
  assert.equal(typeof caps.hasAudioEncoder, "boolean");
  assert.equal(typeof caps.isSupported, "boolean");
  assert.equal(typeof caps.workerSupported, "boolean");
});

test("checkVideoDecoderSupport handles missing API safely without throwing", async () => {
  const res = await checkVideoDecoderSupport({
    codec: "avc1.640028",
    codedWidth: 1920,
    codedHeight: 1080,
  });
  assert.equal(typeof res.supported, "boolean");
});

test("checkAudioDecoderSupport handles missing API safely without throwing", async () => {
  const res = await checkAudioDecoderSupport({
    codec: "mp4a.40.2",
    sampleRate: 44100,
    numberOfChannels: 2,
  });
  assert.equal(typeof res.supported, "boolean");
});

test("checkVideoEncoderSupport and checkAudioEncoderSupport handle missing APIs gracefully", async () => {
  const vRes = await checkVideoEncoderSupport({
    codec: "avc1.640028",
    width: 1920,
    height: 1080,
  });
  assert.equal(typeof vRes.supported, "boolean");

  const aRes = await checkAudioEncoderSupport({
    codec: "mp4a.40.2",
    sampleRate: 44100,
    numberOfChannels: 2,
  });
  assert.equal(typeof aRes.supported, "boolean");
});

test("checkAssetDecoderSupport runs on inspected media metadata safely", async () => {
  const mockMetadata: InspectedMediaMetadata = {
    containerFormat: "MP4",
    duration: 10,
    videoTracks: [
      {
        trackNumber: 1,
        codec: "avc1.640028",
        codedWidth: 1920,
        codedHeight: 1080,
      },
    ],
    audioTracks: [
      {
        trackNumber: 2,
        codec: "mp4a.40.2",
        sampleRate: 48000,
        numberOfChannels: 2,
      },
    ],
    inspectedAt: new Date().toISOString(),
  };

  const support = await checkAssetDecoderSupport(mockMetadata);
  assert.ok(support !== undefined);
});

