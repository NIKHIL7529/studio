/**
 * Color grading presets and deterministic Canvas 2D filter generation.
 *
 * Rules:
 * - Deterministic, pure-TypeScript calculations.
 * - Fast-path check `isDefaultColor` prevents unnecessary `ctx.filter` overhead.
 * - Valid Canvas 2D filter strings matching Chromium and Node.js environments.
 * - Temperature tint capped at alpha <= 0.18 for natural cinematic warming / cooling.
 */

import type { ColorAdjustments, ColorPresetId } from "../../types/timeline.ts";

export const DEFAULT_COLOR_ADJUSTMENTS: ColorAdjustments = {
  presetId: "none",
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  temperature: 0,
};

export const COLOR_PRESETS: Record<ColorPresetId, ColorAdjustments> = {
  none: {
    presetId: "none",
    brightness: 0,
    contrast: 0,
    saturation: 0,
    exposure: 0,
    temperature: 0,
  },
  vivid: {
    presetId: "vivid",
    brightness: 5,
    contrast: 15,
    saturation: 35,
    exposure: 5,
    temperature: 0,
  },
  warm: {
    presetId: "warm",
    brightness: 5,
    contrast: 10,
    saturation: 10,
    exposure: 0,
    temperature: 35,
  },
  cool: {
    presetId: "cool",
    brightness: 0,
    contrast: 10,
    saturation: -5,
    exposure: 0,
    temperature: -35,
  },
  bw: {
    presetId: "bw",
    brightness: 0,
    contrast: 20,
    saturation: -100,
    exposure: 0,
    temperature: 0,
  },
  cinematic: {
    presetId: "cinematic",
    brightness: -5,
    contrast: 25,
    saturation: -15,
    exposure: 0,
    temperature: 15,
  },
};

/**
 * Fast-path check so unmodified clips incur zero ctx.filter overhead.
 */
export function isDefaultColor(color?: ColorAdjustments | null): boolean {
  if (!color) return true;
  return (
    color.brightness === 0 &&
    color.contrast === 0 &&
    color.saturation === 0 &&
    color.exposure === 0 &&
    color.temperature === 0
  );
}

/**
 * Maps brightness, exposure, contrast, and saturation to a valid Canvas 2D ctx.filter string.
 */
export function buildCanvasColorFilter(color: ColorAdjustments): string {
  if (isDefaultColor(color)) {
    return "none";
  }

  // Combine brightness and exposure cleanly into a brightness multiplier
  const totalBrightnessMultiplier = Math.max(0, 1 + (color.brightness + color.exposure) / 100);
  const contrastMultiplier = Math.max(0, 1 + color.contrast / 100);
  const saturationMultiplier = Math.max(0, 1 + color.saturation / 100);

  return `brightness(${totalBrightnessMultiplier.toFixed(3)}) contrast(${contrastMultiplier.toFixed(3)}) saturate(${saturationMultiplier.toFixed(3)})`;
}

/**
 * Computes a subtle warm amber (#ff8c32) or cool blue (#3b82f6) tint overlay.
 * Alpha is capped strictly at <= 0.18 to maintain image clarity.
 */
export function getTemperatureTint(
  temperature: number
): { color: string; alpha: number } | null {
  if (temperature === 0 || Math.abs(temperature) < 0.5) {
    return null;
  }

  const clampedTemp = Math.max(-100, Math.min(100, temperature));
  const normalizedMagnitude = Math.abs(clampedTemp) / 100;
  const alpha = Number((normalizedMagnitude * 0.18).toFixed(4));

  if (clampedTemp > 0) {
    return {
      color: "#ff8c32", // warm amber
      alpha,
    };
  } else {
    return {
      color: "#3b82f6", // cool blue
      alpha,
    };
  }
}
