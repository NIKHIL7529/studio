import test from "node:test";
import assert from "node:assert/strict";
import {
  scanSpeechModelStorage,
  SPEECH_MODEL_CATALOG,
  getDefaultModelTier,
  getDefaultModelId,
  isModelTierSupported,
  isModelIdSupported,
} from "../src/lib/transcription/modelStorage.ts";
import { LocalTranscriptionEngine, LOCAL_WHISPER_MODELS } from "../src/lib/transcription/engine.ts";

test("Speech Model Storage — 5-tier catalog specifications and hardware metadata", () => {
  assert.equal(SPEECH_MODEL_CATALOG.length, 5);

  const lite = SPEECH_MODEL_CATALOG.find((m) => m.tier === "lite");
  assert.ok(lite);
  assert.equal(lite.id, "whisper-tiny_timestamped");
  assert.equal(lite.label, "Lite (Default / Low-End)");
  assert.equal(lite.estimatedSizeFormatted, "~120 MB");
  assert.equal(lite.estimatedSizeBytes, 120 * 1024 * 1024);
  assert.equal(lite.languages, "Multilingual (99)");
  assert.equal(lite.requiresWebGpu, false);
  assert.equal(lite.supportsWordTimestamps, true);

  const fastEn = SPEECH_MODEL_CATALOG.find((m) => m.tier === "fast-en");
  assert.ok(fastEn);
  assert.equal(fastEn.id, "moonshine-base");
  assert.equal(fastEn.label, "Fast English");
  assert.equal(fastEn.estimatedSizeFormatted, "~98 MB");
  assert.equal(fastEn.estimatedSizeBytes, 98 * 1024 * 1024);
  assert.equal(fastEn.languages, "English only");
  assert.equal(fastEn.requiresWebGpu, false);
  assert.equal(fastEn.supportsWordTimestamps, false);

  const balanced = SPEECH_MODEL_CATALOG.find((m) => m.tier === "balanced");
  assert.ok(balanced);
  assert.equal(balanced.id, "whisper-base_timestamped");
  assert.equal(balanced.label, "Balanced (Recommended)");
  assert.equal(balanced.estimatedSizeFormatted, "~206 MB");
  assert.equal(balanced.estimatedSizeBytes, 206 * 1024 * 1024);
  assert.equal(balanced.languages, "Multilingual (99)");
  assert.equal(balanced.requiresWebGpu, false);
  assert.equal(balanced.supportsWordTimestamps, true);

  const high = SPEECH_MODEL_CATALOG.find((m) => m.tier === "high");
  assert.ok(high);
  assert.equal(high.id, "whisper-small_timestamped");
  assert.equal(high.label, "High Accuracy");
  assert.equal(high.estimatedSizeFormatted, "~586 MB");
  assert.equal(high.estimatedSizeBytes, 586 * 1024 * 1024);
  assert.equal(high.languages, "Multilingual (99)");
  assert.equal(high.requiresWebGpu, false);
  assert.equal(high.recommendedBadge, "Recommended: WebGPU / 8 GB+ RAM");
  assert.equal(high.supportsWordTimestamps, true);

  const pro = SPEECH_MODEL_CATALOG.find((m) => m.tier === "pro");
  assert.ok(pro);
  assert.equal(pro.id, "parakeet-tdt-0.6b-v3");
  assert.equal(pro.label, "Pro (WebGPU Only)");
  assert.equal(pro.estimatedSizeFormatted, "~1.26 GB");
  assert.equal(pro.languages, "25 languages");
  assert.equal(pro.requiresWebGpu, true);
  assert.equal(pro.supportsWordTimestamps, true);
});

test("Speech Model Storage — WebGPU capability gating", () => {
  // Pro tier requires WebGPU
  assert.equal(isModelTierSupported("pro", { hasWebGpu: false }), false);
  assert.equal(isModelTierSupported("pro", { hasWebGpu: true }), true);

  assert.equal(isModelIdSupported("parakeet-tdt-0.6b-v3", { hasWebGpu: false }), false);
  assert.equal(isModelIdSupported("parakeet-tdt-0.6b-v3", { hasWebGpu: true }), true);

  // Other tiers run on CPU WASM as well as WebGPU
  for (const tier of ["lite", "fast-en", "balanced", "high"] as const) {
    assert.equal(isModelTierSupported(tier, { hasWebGpu: false }), true);
    assert.equal(isModelTierSupported(tier, { hasWebGpu: true }), true);
  }

  assert.equal(isModelIdSupported("whisper-tiny_timestamped", { hasWebGpu: false }), true);
  assert.equal(isModelIdSupported("moonshine-base", { hasWebGpu: false }), true);
  assert.equal(isModelIdSupported("whisper-base_timestamped", { hasWebGpu: false }), true);
  assert.equal(isModelIdSupported("whisper-small_timestamped", { hasWebGpu: false }), true);
});

test("Speech Model Storage — auto-selection defaults", () => {
  // CPU-only defaults to lite
  assert.equal(getDefaultModelTier(false), "lite");
  assert.equal(getDefaultModelId(false), "whisper-tiny_timestamped");

  // WebGPU available defaults to balanced (whisper-base_timestamped)
  assert.equal(getDefaultModelTier(true), "balanced");
  assert.equal(getDefaultModelId(true), "whisper-base_timestamped");
});

test("Speech Model Storage — handles environment without OPFS gracefully", async () => {
  // In Node.js environment without window/navigator.storage
  const report = await scanSpeechModelStorage();
  assert.equal(report.isSupported, false);
  assert.equal(report.totalBytes, 0);
  assert.equal(report.totalFormatted, "0 B");
  assert.equal(report.models.length, 5);
  assert.ok(report.models.every((m) => !m.isDownloaded && m.actualSizeBytes === 0));
});

test("LocalTranscriptionEngine — exposes all 5 models and disposes cleanly", async () => {
  assert.equal(LOCAL_WHISPER_MODELS.length, 5);
  const engine = new LocalTranscriptionEngine();
  const available = await engine.isAvailable();
  assert.ok(available);
  assert.equal(available.availableModels.length, 5);
  assert.equal(available.recommendedModel, "whisper-tiny_timestamped"); // Node environment lacks WebGPU

  // Dispose cleanly without active instance
  assert.doesNotThrow(() => engine.dispose());
});
