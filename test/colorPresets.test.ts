import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLOR_PRESETS,
  DEFAULT_COLOR_ADJUSTMENTS,
  isDefaultColor,
  buildCanvasColorFilter,
  getTemperatureTint,
} from "../src/lib/color/colorPresets.ts";
import { renderClipFrameToCanvas } from "../src/lib/composition/evaluator.ts";
import { createClip } from "../src/lib/timeline/model.ts";
import type { TimelineClip } from "../src/types/timeline.ts";

describe("Color Presets & Canvas Filter Rendering", () => {
  it("defines all 6 canonical color presets within valid [-100, 100] ranges", () => {
    const presetKeys = ["none", "vivid", "warm", "cool", "bw", "cinematic"] as const;

    for (const key of presetKeys) {
      const preset = COLOR_PRESETS[key];
      assert.ok(preset, `Preset "${key}" must exist`);
      assert.equal(preset.presetId, key);

      for (const prop of ["brightness", "contrast", "saturation", "exposure", "temperature"] as const) {
        const val = preset[prop];
        assert.ok(
          typeof val === "number" && Number.isFinite(val) && val >= -100 && val <= 100,
          `Preset "${key}" property "${prop}" (${val}) must be between -100 and 100`
        );
      }
    }
  });

  it("identifies default color adjustments via isDefaultColor fast path", () => {
    assert.equal(isDefaultColor(DEFAULT_COLOR_ADJUSTMENTS), true);
    assert.equal(isDefaultColor(COLOR_PRESETS.none), true);

    assert.equal(
      isDefaultColor({
        presetId: "none",
        brightness: 5,
        contrast: 0,
        saturation: 0,
        exposure: 0,
        temperature: 0,
      }),
      false
    );

    assert.equal(isDefaultColor(COLOR_PRESETS.vivid), false);
    assert.equal(isDefaultColor(COLOR_PRESETS.warm), false);
    assert.equal(isDefaultColor(COLOR_PRESETS.cool), false);
    assert.equal(isDefaultColor(COLOR_PRESETS.bw), false);
    assert.equal(isDefaultColor(COLOR_PRESETS.cinematic), false);
  });

  it("builds valid Canvas 2D filter strings combining brightness, contrast, and saturation", () => {
    const filterNone = buildCanvasColorFilter(DEFAULT_COLOR_ADJUSTMENTS);
    assert.equal(filterNone, "none");

    const filterVivid = buildCanvasColorFilter(COLOR_PRESETS.vivid);
    assert.ok(filterVivid.includes("brightness("));
    assert.ok(filterVivid.includes("contrast("));
    assert.ok(filterVivid.includes("saturate("));

    // B&W should have saturate(0.000)
    const filterBw = buildCanvasColorFilter(COLOR_PRESETS.bw);
    assert.ok(filterBw.includes("saturate(0.000)"));

    // Extreme values clamping
    const extreme = buildCanvasColorFilter({
      presetId: "none",
      brightness: -100,
      contrast: -100,
      saturation: -100,
      exposure: -100,
      temperature: 0,
    });
    assert.ok(extreme.includes("brightness(0.000)"));
    assert.ok(extreme.includes("contrast(0.000)"));
    assert.ok(extreme.includes("saturate(0.000)"));
  });

  it("evaluates temperature tint with subtle warm amber or cool blue and alpha <= 0.18", () => {
    assert.equal(getTemperatureTint(0), null);

    const warmTint = getTemperatureTint(50);
    assert.ok(warmTint);
    assert.equal(warmTint.color, "#ff8c32");
    assert.ok(warmTint.alpha > 0 && warmTint.alpha <= 0.18);

    const maxWarmTint = getTemperatureTint(100);
    assert.ok(maxWarmTint);
    assert.equal(maxWarmTint.alpha, 0.18);

    const coolTint = getTemperatureTint(-50);
    assert.ok(coolTint);
    assert.equal(coolTint.color, "#3b82f6");
    assert.ok(coolTint.alpha > 0 && coolTint.alpha <= 0.18);

    const maxCoolTint = getTemperatureTint(-100);
    assert.ok(maxCoolTint);
    assert.equal(maxCoolTint.alpha, 0.18);
  });

  it("renders clip frame to mock canvas with color filters and restores filter cleanly", () => {
    let activeFilter = "initial";
    const calls: string[] = [];

    const mockCtx = {
      save: () => calls.push("save"),
      restore: () => {
        calls.push("restore");
        activeFilter = "none";
      },
      translate: () => calls.push("translate"),
      rotate: () => calls.push("rotate"),
      scale: () => calls.push("scale"),
      drawImage: () => calls.push("drawImage"),
      fillRect: () => calls.push("fillRect"),
      get filter() {
        return activeFilter;
      },
      set filter(val: string) {
        activeFilter = val;
        calls.push(`filter:${val}`);
      },
      globalAlpha: 1,
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;

    const clip: TimelineClip = {
      ...createClip("asset-1", "track-1", 0, 0, 10),
      color: { ...COLOR_PRESETS.cinematic },
    };

    renderClipFrameToCanvas(mockCtx, {} as CanvasImageSource, 1920, 1080, 1920, 1080, clip);

    // Verify filter was applied during draw and restored
    assert.ok(calls.some((c) => c.startsWith("filter:brightness")));
    assert.ok(calls.includes("drawImage"));
    assert.ok(calls.includes("restore"));
    assert.equal(activeFilter, "none");
  });
});
