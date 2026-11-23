import test from "node:test";
import assert from "node:assert/strict";
import {
  scanSpeechModelStorage,
  SPEECH_MODEL_CATALOG,
} from "../src/lib/transcription/modelStorage.ts";

test("Speech Model Storage — catalog specifications and sizes", () => {
  assert.equal(SPEECH_MODEL_CATALOG.length, 4);

  const tinyTimestamped = SPEECH_MODEL_CATALOG.find((m) => m.id === "whisper-tiny_timestamped");
  assert.ok(tinyTimestamped);
  assert.equal(tinyTimestamped.estimatedSizeFormatted, "~120 MB");
  assert.equal(tinyTimestamped.estimatedSizeBytes, 120 * 1024 * 1024);

  const baseTimestamped = SPEECH_MODEL_CATALOG.find((m) => m.id === "whisper-base_timestamped");
  assert.ok(baseTimestamped);
  assert.equal(baseTimestamped.estimatedSizeFormatted, "~206 MB");
  assert.equal(baseTimestamped.estimatedSizeBytes, 206 * 1024 * 1024);

  const tiny = SPEECH_MODEL_CATALOG.find((m) => m.id === "whisper-tiny");
  assert.ok(tiny);
  assert.equal(tiny.estimatedSizeFormatted, "~120 MB");

  const base = SPEECH_MODEL_CATALOG.find((m) => m.id === "whisper-base");
  assert.ok(base);
  assert.equal(base.estimatedSizeFormatted, "~206 MB");
});

test("Speech Model Storage — handles environment without OPFS gracefully", async () => {
  // In Node.js environment without window/navigator.storage
  const report = await scanSpeechModelStorage();
  assert.equal(report.isSupported, false);
  assert.equal(report.totalBytes, 0);
  assert.equal(report.totalFormatted, "0 B");
  assert.equal(report.models.length, 4);
  assert.ok(report.models.every((m) => !m.isDownloaded && m.actualSizeBytes === 0));
});
