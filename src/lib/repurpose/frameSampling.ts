/**
 * Deterministic frame sampling and scene-change proxy detection (Phase 7).
 *
 * Rules:
 * - 100% deterministic, local-first in-browser analysis.
 * - Extracts downscaled frames (160x90) to maintain strictly bounded memory (~58KB per frame buffer).
 * - Computes normalized luminance differences and color histograms.
 * - Releases every canvas, VideoFrame, and decoder resource immediately.
 * - Strictly labeled as "scene-change candidates" or "visual transitions", not semantic scene understanding.
 * - No object detection, OCR, face detection, or semantic labeling.
 */

import { CanvasSink } from "mediabunny";
import { createMediaInput, disposeMediaInput } from "../media/input.ts";
import type { FrameSampleSignal } from "../../types/repurpose.ts";

export const SAMPLE_WIDTH = 160;
export const SAMPLE_HEIGHT = 90;
export const MAX_SAMPLE_FRAMES = 300;
export const MIN_SAMPLE_INTERVAL_SECONDS = 0.5;
export const ALGORITHM_VERSION_VIDEO = "v1-hist16-down160x90";

export interface FrameSamplingOptions {
  signal?: AbortSignal;
  onProgress?: (percent: number, statusText: string) => void;
  maxFrames?: number;
  minIntervalSeconds?: number;
}

export interface FrameHistogram {
  luminance: Float32Array; // 16 bins
  colorR: Float32Array; // 8 bins
  colorG: Float32Array; // 8 bins
  colorB: Float32Array; // 8 bins
}

/**
 * Computes normalized luminance and color histograms for a 160x90 RGBA pixel buffer.
 */
export function computeFrameHistograms(rgbaData: Uint8ClampedArray): {
  luminanceHist: Float32Array;
  colorHist: Float32Array;
  luminanceMean: number;
} {
  const pixelCount = rgbaData.length / 4;
  const lumBins = new Float32Array(16);
  const colorBins = new Float32Array(24); // 8 R + 8 G + 8 B
  let lumSum = 0;

  for (let i = 0; i < rgbaData.length; i += 4) {
    const r = rgbaData[i];
    const g = rgbaData[i + 1];
    const b = rgbaData[i + 2];

    // Standard Rec. 601 / Rec. 709 approximate luminance
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    lumSum += lum;

    // Luminance 16-bin bucket
    const lumIdx = Math.min(15, Math.floor((lum / 256) * 16));
    lumBins[lumIdx]++;

    // RGB 8-bin buckets
    const rIdx = Math.min(7, Math.floor((r / 256) * 8));
    const gIdx = Math.min(7, Math.floor((g / 256) * 8));
    const bIdx = Math.min(7, Math.floor((b / 256) * 8));

    colorBins[rIdx]++;
    colorBins[8 + gIdx]++;
    colorBins[16 + bIdx]++;
  }

  // Normalize histograms to sum to 1.0
  const invPixels = 1 / pixelCount;
  for (let j = 0; j < 16; j++) {
    lumBins[j] *= invPixels;
  }
  const invColorTotal = 1 / (pixelCount * 3);
  for (let j = 0; j < 24; j++) {
    colorBins[j] *= invColorTotal;
  }

  return {
    luminanceHist: lumBins,
    colorHist: colorBins,
    luminanceMean: lumSum * invPixels,
  };
}

/**
 * Computes normalized difference metrics between two frames given their pixel buffers and histograms.
 * Returns values strictly bounded within [0, 1].
 */
export function computeFrameDifference(
  currRgba: Uint8ClampedArray,
  prevRgba: Uint8ClampedArray,
  currColorHist: Float32Array,
  prevColorHist: Float32Array
): { luminanceDiff: number; colorHistDiff: number; visualDiff: number } {
  const minLen = Math.min(currRgba.length, prevRgba.length);
  const pixelCount = minLen / 4;
  if (pixelCount === 0) {
    return { luminanceDiff: 0, colorHistDiff: 0, visualDiff: 0 };
  }

  // 1. Mean absolute pixel luminance difference
  let diffSum = 0;
  for (let i = 0; i < minLen; i += 4) {
    const lumCurr = 0.299 * currRgba[i] + 0.587 * currRgba[i + 1] + 0.114 * currRgba[i + 2];
    const lumPrev = 0.299 * prevRgba[i] + 0.587 * prevRgba[i + 1] + 0.114 * prevRgba[i + 2];
    diffSum += Math.abs(lumCurr - lumPrev);
  }
  const luminanceDiff = Math.min(1, diffSum / (pixelCount * 255));

  // 2. Color histogram L1 Manhattan distance (bounded [0, 1])
  let histDiffSum = 0;
  for (let k = 0; k < 24; k++) {
    histDiffSum += Math.abs(currColorHist[k] - prevColorHist[k]);
  }
  const colorHistDiff = Math.min(1, histDiffSum * 0.5);

  // 3. Combined weighted visual difference metric
  const visualDiff = Math.min(1, 0.4 * luminanceDiff + 0.6 * colorHistDiff);

  return { luminanceDiff, colorHistDiff, visualDiff };
}

/**
 * Determines whether a frame difference qualifies as a scene-change candidate
 * based on absolute difference and peak contrast against local baseline.
 */
export function isSceneCutCandidate(
  visualDiff: number,
  localRecentDiffs: number[],
  threshold = 0.35
): boolean {
  if (visualDiff >= 0.55) {
    return true; // Strong absolute cut
  }

  if (visualDiff < threshold) {
    return false;
  }

  if (localRecentDiffs.length === 0) {
    return visualDiff >= threshold;
  }

  // Peak comparison against recent local average
  const localSum = localRecentDiffs.reduce((a, b) => a + b, 0);
  const localAvg = localSum / localRecentDiffs.length;

  return visualDiff >= threshold && visualDiff >= localAvg * 1.8;
}

/**
 * Samples video frames from a File/Blob using Mediabunny's CanvasSink.
 * Strictly bounds concurrency, dimensions (160x90), and sampled frames count.
 */
export async function sampleVideoFrames(
  file: File | Blob,
  duration: number,
  options: FrameSamplingOptions = {}
): Promise<{ frameSignals: FrameSampleSignal[]; sceneCutTimes: number[] }> {
  const {
    signal,
    onProgress,
    maxFrames = MAX_SAMPLE_FRAMES,
    minIntervalSeconds = MIN_SAMPLE_INTERVAL_SECONDS,
  } = options;

  if (duration <= 0 || !Number.isFinite(duration)) {
    return { frameSignals: [], sceneCutTimes: [] };
  }

  // Determine sampling interval
  const sampleInterval = Math.max(minIntervalSeconds, duration / maxFrames);
  const sampleTimes: number[] = [];
  for (let t = 0; t < duration; t += sampleInterval) {
    sampleTimes.push(t);
  }
  if (sampleTimes.length === 0) {
    sampleTimes.push(0);
  }

  // Check if Canvas / OffscreenCanvas is available
  const hasOffscreen = typeof OffscreenCanvas !== "undefined";
  const hasDocCanvas = typeof document !== "undefined" && typeof document.createElement === "function";

  if (!hasOffscreen && !hasDocCanvas) {
    // Canvas context not available in this environment (e.g. basic Node.js test without mock canvas)
    return { frameSignals: [], sceneCutTimes: [] };
  }

  let masterCanvas: HTMLCanvasElement | OffscreenCanvas;
  if (hasOffscreen) {
    masterCanvas = new OffscreenCanvas(SAMPLE_WIDTH, SAMPLE_HEIGHT);
  } else {
    masterCanvas = document.createElement("canvas");
    masterCanvas.width = SAMPLE_WIDTH;
    masterCanvas.height = SAMPLE_HEIGHT;
  }

  const ctx = masterCanvas.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;

  if (!ctx) {
    return { frameSignals: [], sceneCutTimes: [] };
  }

  const input = createMediaInput(file);
  const frameSignals: FrameSampleSignal[] = [];
  const sceneCutTimes: number[] = [];

  try {
    const videoTracks = await input.getVideoTracks();
    if (videoTracks.length === 0) {
      return { frameSignals: [], sceneCutTimes: [] };
    }

    const canvasSink = new CanvasSink(videoTracks[0], {
      width: SAMPLE_WIDTH,
      height: SAMPLE_HEIGHT,
      fit: "contain",
      poolSize: 2,
    });

    let prevRgba: Uint8ClampedArray | null = null;
    let prevColorHist: Float32Array | null = null;
    const recentDiffs: number[] = [];
    let lastSceneCutTime = -10;

    for (let idx = 0; idx < sampleTimes.length; idx++) {
      if (signal?.aborted) {
        throw new DOMException("Frame sampling aborted by user", "AbortError");
      }

      const timestamp = sampleTimes[idx];

      let wrapped: { canvas: HTMLCanvasElement | OffscreenCanvas } | null = null;
      try {
        wrapped = await canvasSink.getCanvas(timestamp);
      } catch (err) {
        // Individual frame decode failures are non-fatal; continue to next sample
        console.warn(`Frame sample error at ${timestamp.toFixed(2)}s:`, err);
      }

      if (wrapped?.canvas) {
        // Draw into our reusable sampling canvas
        ctx.clearRect(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        ctx.drawImage(wrapped.canvas, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        const imgData = ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        const currRgba = imgData.data;
        const { colorHist } = computeFrameHistograms(currRgba);

        let luminanceDiff = 0;
        let colorHistDiff = 0;
        let visualDiff = 0;
        let isCut = false;

        if (prevRgba && prevColorHist) {
          const diff = computeFrameDifference(currRgba, prevRgba, colorHist, prevColorHist);
          luminanceDiff = diff.luminanceDiff;
          colorHistDiff = diff.colorHistDiff;
          visualDiff = diff.visualDiff;

          // Check for scene-cut candidate (with minimum 1.0s spacing)
          if (timestamp - lastSceneCutTime >= 1.0) {
            isCut = isSceneCutCandidate(visualDiff, recentDiffs);
            if (isCut) {
              sceneCutTimes.push(timestamp);
              lastSceneCutTime = timestamp;
            }
          }

          recentDiffs.push(visualDiff);
          if (recentDiffs.length > 5) {
            recentDiffs.shift();
          }
        }

        frameSignals.push({
          timestamp,
          luminanceDiff,
          colorHistDiff,
          visualDiff,
          isSceneCutCandidate: isCut,
        });

        prevRgba = new Uint8ClampedArray(currRgba);
        prevColorHist = colorHist;
      }

      if (onProgress && idx % 10 === 0) {
        const percent = Math.round(((idx + 1) / sampleTimes.length) * 100);
        onProgress(percent, `Sampling video frames: ${idx + 1}/${sampleTimes.length}`);
      }
    }
  } finally {
    disposeMediaInput(input);
  }

  return { frameSignals, sceneCutTimes };
}
