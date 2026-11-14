import test from "node:test";
import assert from "node:assert/strict";
import { inspectMediaFile, formatDuration, formatResolution } from "../src/lib/media/inspector.ts";

function createMockWavBlob(sampleRate = 44100, channels = 2, durationSeconds = 1): Blob {
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * channels * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  return new Blob([buffer], { type: "audio/wav" });
}

test("inspectMediaFile handles zero-byte files as corrupt", async () => {
  const emptyBlob = new Blob([]);
  const result = await inspectMediaFile(emptyBlob);
  assert.equal(result.status, "corrupt");
  assert.ok(result.error?.includes("empty"));
});

test("inspectMediaFile handles unsupported or random non-media files", async () => {
  const textBlob = new Blob(["this is clearly not a video file header"]);
  const result = await inspectMediaFile(textBlob);
  assert.equal(result.status, "unsupported");
  assert.ok(result.error);
});

test("inspectMediaFile inspects valid WAV audio with correct metadata", async () => {
  const wavBlob = createMockWavBlob(48000, 2, 0.5);
  const result = await inspectMediaFile(wavBlob);

  assert.equal(result.status, "ready");
  assert.ok(result.metadata);
  assert.equal(result.metadata.containerFormat, "WAVE");
  assert.equal(result.metadata.audioTracks.length, 1);
  assert.equal(result.metadata.numberOfChannels, 2);
  assert.equal(result.metadata.sampleRate, 48000);
  assert.ok(result.metadata.duration !== undefined);
  assert.ok(result.metadata.duration > 0.4);
});

test("inspectMediaFile aborts when signal is cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  const wavBlob = createMockWavBlob();

  await assert.rejects(
    async () => {
      await inspectMediaFile(wavBlob, { signal: controller.signal });
    },
    (err: unknown) => {
      return err instanceof DOMException && err.name === "AbortError";
    }
  );
});

test("formatDuration formats seconds cleanly", () => {
  assert.equal(formatDuration(undefined), "--:--");
  assert.equal(formatDuration(NaN), "--:--");
  assert.equal(formatDuration(-5), "--:--");
  assert.equal(formatDuration(0), "00:00");
  assert.equal(formatDuration(45), "00:45");
  assert.equal(formatDuration(75), "01:15");
  assert.equal(formatDuration(3665), "1:01:05");
});

test("formatResolution formats dimensions cleanly", () => {
  assert.equal(formatResolution(undefined, undefined), "Unknown");
  assert.equal(formatResolution(1920, 1080), "1920 × 1080");
  assert.equal(formatResolution(1080, 1920), "1080 × 1920");
});

