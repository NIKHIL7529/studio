import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeFrameHistograms,
  computeFrameDifference,
  isSceneCutCandidate,
} from "../src/lib/repurpose/frameSampling.ts";
import {
  computeAudioMetrics,
  buildIntervalsFromSignals,
} from "../src/lib/repurpose/audioAnalysis.ts";
import type { AudioSampleSignal } from "../src/types/repurpose.ts";

describe("Repurpose Signal Analysis — Video Frame Difference & Scene Cut Proxies", () => {
  test("computeFrameHistograms generates valid normalized histograms", () => {
    // 160x90 = 14400 pixels = 57600 bytes RGBA
    const rgba = new Uint8ClampedArray(160 * 90 * 4);
    // Fill half black (0,0,0) and half white (255,255,255)
    for (let i = 0; i < rgba.length / 2; i += 4) {
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = 255;
    }
    for (let i = rgba.length / 2; i < rgba.length; i += 4) {
      rgba[i] = 255;
      rgba[i + 1] = 255;
      rgba[i + 2] = 255;
      rgba[i + 3] = 255;
    }

    const { luminanceHist, colorHist, luminanceMean } = computeFrameHistograms(rgba);

    assert.equal(luminanceHist.length, 16);
    assert.equal(colorHist.length, 24);

    // Sum of luminance histogram should equal 1.0 (normalized)
    const lumSum = luminanceHist.reduce((acc, v) => acc + v, 0);
    assert.ok(Math.abs(lumSum - 1.0) < 0.001, `lumSum is ${lumSum}`);

    // Luminance mean should be ~127.5
    assert.ok(Math.abs(luminanceMean - 127.5) < 1.0);
  });

  test("computeFrameDifference returns 0 for identical frames", () => {
    const rgba = new Uint8ClampedArray(160 * 90 * 4).fill(128);
    const { colorHist } = computeFrameHistograms(rgba);

    const diff = computeFrameDifference(rgba, rgba, colorHist, colorHist);
    assert.equal(diff.luminanceDiff, 0);
    assert.equal(diff.colorHistDiff, 0);
    assert.equal(diff.visualDiff, 0);
  });

  test("computeFrameDifference returns high difference for opposite frames (black to white)", () => {
    const black = new Uint8ClampedArray(160 * 90 * 4);
    for (let i = 0; i < black.length; i += 4) {
      black[i] = 0;
      black[i + 1] = 0;
      black[i + 2] = 0;
      black[i + 3] = 255;
    }

    const white = new Uint8ClampedArray(160 * 90 * 4);
    for (let i = 0; i < white.length; i += 4) {
      white[i] = 255;
      white[i + 1] = 255;
      white[i + 2] = 255;
      white[i + 3] = 255;
    }

    const blackHist = computeFrameHistograms(black).colorHist;
    const whiteHist = computeFrameHistograms(white).colorHist;

    const diff = computeFrameDifference(white, black, whiteHist, blackHist);

    assert.ok(diff.luminanceDiff > 0.95, `luminanceDiff: ${diff.luminanceDiff}`);
    assert.ok(diff.colorHistDiff > 0.95, `colorHistDiff: ${diff.colorHistDiff}`);
    assert.ok(diff.visualDiff > 0.95, `visualDiff: ${diff.visualDiff}`);
  });

  test("isSceneCutCandidate detects sharp spikes and rejects small gradual changes", () => {
    const recentFlat = [0.05, 0.04, 0.06, 0.05, 0.05];

    // Sharp spike (e.g. cut to another angle)
    assert.equal(isSceneCutCandidate(0.45, recentFlat), true);

    // Hard cut threshold
    assert.equal(isSceneCutCandidate(0.60, [0.2, 0.25]), true);

    // Low gradual change (panning or minor motion)
    assert.equal(isSceneCutCandidate(0.12, recentFlat), false);

    // Moderate change that does not exceed local peak contrast
    assert.equal(isSceneCutCandidate(0.36, [0.30, 0.35, 0.32]), false);
  });
});

describe("Repurpose Signal Analysis — Acoustic RMS, Silence & Speech Dynamics", () => {
  test("computeAudioMetrics identifies silence for zero or low-amplitude signal", () => {
    const silence = new Float32Array(4800).fill(0.001); // 100ms at 48kHz
    const metrics = computeAudioMetrics(silence);

    assert.ok(metrics.isSilence);
    assert.ok(metrics.rms < 0.01);
    assert.equal(metrics.isSpeechLike, false);
  });

  test("computeAudioMetrics identifies speech-like activity on modulated signal", () => {
    // Generate 100ms sine wave at 250Hz (human voice fundamental range) with moderate amplitude (0.2)
    const sampleRate = 48000;
    const samples = new Float32Array(4800);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = 0.2 * Math.sin((2 * Math.PI * 250 * i) / sampleRate);
    }

    const metrics = computeAudioMetrics(samples);

    assert.equal(metrics.isSilence, false);
    assert.ok(metrics.rms > 0.1 && metrics.rms < 0.25);
    assert.ok(metrics.zcr > 0.005 && metrics.zcr < 0.1);
    assert.equal(metrics.isSpeechLike, true);
  });

  test("buildIntervalsFromSignals merges contiguous matching windows into intervals", () => {
    const signals: AudioSampleSignal[] = [
      { timestamp: 0.0, rms: 0.1, isSilence: false, isSpeechLikeActivity: true, isTransient: false },
      { timestamp: 0.5, rms: 0.15, isSilence: false, isSpeechLikeActivity: true, isTransient: false },
      { timestamp: 1.0, rms: 0.12, isSilence: false, isSpeechLikeActivity: true, isTransient: false },
      { timestamp: 1.5, rms: 0.002, isSilence: true, isSpeechLikeActivity: false, isTransient: false },
      { timestamp: 2.0, rms: 0.001, isSilence: true, isSpeechLikeActivity: false, isTransient: false },
      { timestamp: 2.5, rms: 0.18, isSilence: false, isSpeechLikeActivity: true, isTransient: true },
      { timestamp: 3.0, rms: 0.16, isSilence: false, isSpeechLikeActivity: true, isTransient: false },
    ];

    const speechIntervals = buildIntervalsFromSignals(signals, 0.5, (s) => s.isSpeechLikeActivity, 0.4);
    const silenceIntervals = buildIntervalsFromSignals(signals, 0.5, (s) => s.isSilence, 0.4);

    assert.equal(speechIntervals.length, 2);
    assert.equal(speechIntervals[0].start, 0.0);
    assert.equal(speechIntervals[0].end, 1.5);
    assert.equal(speechIntervals[1].start, 2.5);
    assert.equal(speechIntervals[1].end, 3.5);

    assert.equal(silenceIntervals.length, 1);
    assert.equal(silenceIntervals[0].start, 1.5);
    assert.equal(silenceIntervals[0].end, 2.5);
  });
});
