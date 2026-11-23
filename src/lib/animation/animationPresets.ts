/**
 * Animation Presets and Keyframe Evaluator for Content Studio.
 *
 * Rules:
 * - Deterministic, parameter-driven motion and keyframe system.
 * - Interpolates position, scale, rotation, opacity, and audio volume.
 * - Supports entrance, exit, continuous motion (Ken Burns, float, deterministic shake),
 *   text typewriter/reveals, and caption word-level highlighting.
 * - Presets can be applied directly to generate editable keyframes or evaluated on-the-fly.
 * - 100% parity between TimelinePreview and export renderer.
 */

import type {
  ClipKeyframe,
  KeyframeProperty,
  KeyframeInterpolation,
  AnimationPresetId,
  AnimationCategory,
  ClipAnimationPreset,
  TimelineClip,
  TextOverlay,
} from "../../types/timeline.ts";

export interface AnimationPresetDefinition {
  id: AnimationPresetId;
  category: AnimationCategory;
  label: string;
  description: string;
  defaultDuration: number;
  generateKeyframes: (duration: number, clipDuration: number, params?: Record<string, unknown>) => ClipKeyframe[];
}

/**
 * Evaluates an interpolation curve for t in [0, 1].
 */
export function interpolate(t: number, mode: KeyframeInterpolation = "linear"): number {
  const clamped = Math.max(0, Math.min(1, t));
  switch (mode) {
    case "linear":
      return clamped;
    case "ease-in":
      return clamped * clamped;
    case "ease-out":
      return clamped * (2 - clamped);
    case "ease-in-out":
      return clamped < 0.5 ? 2 * clamped * clamped : -1 + (4 - 2 * clamped) * clamped;
    case "hold":
      return clamped >= 1 ? 1 : 0;
    default:
      return clamped;
  }
}

/**
 * Evaluates a single keyframed property value at a specific time offset (in seconds).
 */
export function evaluatePropertyAtTime(
  keyframes: ClipKeyframe[],
  property: KeyframeProperty,
  offsetSeconds: number,
  defaultValue: number
): number {
  const matching = keyframes
    .filter((k) => k.property === property)
    .sort((a, b) => a.time - b.time);

  if (matching.length === 0) return defaultValue;
  if (offsetSeconds <= matching[0].time) return matching[0].value;
  if (offsetSeconds >= matching[matching.length - 1].time) return matching[matching.length - 1].value;

  // Find bounding keyframe interval
  for (let i = 0; i < matching.length - 1; i++) {
    const k0 = matching[i];
    const k1 = matching[i + 1];

    if (offsetSeconds >= k0.time && offsetSeconds <= k1.time) {
      const span = k1.time - k0.time;
      if (span <= 0.00001) return k1.value;

      const progress = (offsetSeconds - k0.time) / span;
      const t = interpolate(progress, k0.interpolation);
      return k0.value + (k1.value - k0.value) * t;
    }
  }

  return defaultValue;
}

/**
 * Resolves the complete evaluated transform & audio volume for a clip at a given offset.
 */
export function evaluateClipTransform(
  clip: TimelineClip,
  offsetSeconds: number
): {
  positionX: number;
  positionY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  volume: number;
} {
  const clipDur = clip.sourceOut - clip.sourceIn;
  const staticTransform = clip.transform;

  let posX = staticTransform?.x ?? 0;
  let posY = staticTransform?.y ?? 0;
  let sX = staticTransform?.scaleX ?? 1;
  let sY = staticTransform?.scaleY ?? 1;
  let rot = staticTransform?.rotation ?? 0;
  let op = staticTransform?.opacity ?? 1;
  let vol = clip.muted ? 0 : clip.volume;

  // 1. Evaluate explicit keyframes if present
  if (clip.keyframes && clip.keyframes.length > 0) {
    posX = evaluatePropertyAtTime(clip.keyframes, "positionX", offsetSeconds, posX);
    posY = evaluatePropertyAtTime(clip.keyframes, "positionY", offsetSeconds, posY);
    const uniformScale = evaluatePropertyAtTime(clip.keyframes, "scale", offsetSeconds, 1);
    sX = evaluatePropertyAtTime(clip.keyframes, "scaleX", offsetSeconds, sX) * uniformScale;
    sY = evaluatePropertyAtTime(clip.keyframes, "scaleY", offsetSeconds, sY) * uniformScale;
    rot = evaluatePropertyAtTime(clip.keyframes, "rotation", offsetSeconds, rot);
    op = evaluatePropertyAtTime(clip.keyframes, "opacity", offsetSeconds, op);
    vol = evaluatePropertyAtTime(clip.keyframes, "volume", offsetSeconds, vol);
  }

  // 2. Evaluate preset if present (and keyframes don't override)
  if (clip.animationPreset) {
    const preset = clip.animationPreset;
    const pDur = Math.min(clipDur, preset.duration || 0.8);
    const intensity = preset.intensity ?? 1.0;
    const seed = preset.seed ?? 42;

    switch (preset.presetId) {
      // Entrance
      case "fade_in": {
        if (offsetSeconds < pDur) {
          const t = interpolate(offsetSeconds / pDur, "ease-out");
          op *= t;
        }
        break;
      }
      case "slide_in_left": {
        if (offsetSeconds < pDur) {
          const t = interpolate(offsetSeconds / pDur, "ease-out");
          posX += (t - 1) * 400 * intensity;
        }
        break;
      }
      case "slide_in_right": {
        if (offsetSeconds < pDur) {
          const t = interpolate(offsetSeconds / pDur, "ease-out");
          posX += (1 - t) * 400 * intensity;
        }
        break;
      }
      case "slide_in_top": {
        if (offsetSeconds < pDur) {
          const t = interpolate(offsetSeconds / pDur, "ease-out");
          posY += (t - 1) * 300 * intensity;
        }
        break;
      }
      case "slide_in_bottom": {
        if (offsetSeconds < pDur) {
          const t = interpolate(offsetSeconds / pDur, "ease-out");
          posY += (1 - t) * 300 * intensity;
        }
        break;
      }
      case "zoom_in": {
        if (offsetSeconds < pDur) {
          const t = interpolate(offsetSeconds / pDur, "ease-out");
          const s = 0.6 + 0.4 * t;
          sX *= s;
          sY *= s;
          op *= t;
        }
        break;
      }
      case "zoom_out": {
        if (offsetSeconds < pDur) {
          const t = interpolate(offsetSeconds / pDur, "ease-out");
          const s = 1.4 - 0.4 * t;
          sX *= s;
          sY *= s;
          op *= t;
        }
        break;
      }
      case "pop_in": {
        if (offsetSeconds < pDur) {
          const raw = offsetSeconds / pDur;
          // Overshoot pop: reaches 1.08 then settles at 1.0
          const s = raw < 0.7 ? (raw / 0.7) * 1.08 : 1.08 - ((raw - 0.7) / 0.3) * 0.08;
          sX *= s;
          sY *= s;
          op *= Math.min(1, raw * 2);
        }
        break;
      }
      case "rotate_in": {
        if (offsetSeconds < pDur) {
          const t = interpolate(offsetSeconds / pDur, "ease-out");
          rot += (1 - t) * -90 * intensity;
          op *= t;
        }
        break;
      }

      // Exit
      case "fade_out": {
        const exitStart = Math.max(0, clipDur - pDur);
        if (offsetSeconds >= exitStart) {
          const t = interpolate((clipDur - offsetSeconds) / pDur, "ease-in");
          op *= t;
        }
        break;
      }
      case "slide_out_left": {
        const exitStart = Math.max(0, clipDur - pDur);
        if (offsetSeconds >= exitStart) {
          const t = interpolate((offsetSeconds - exitStart) / pDur, "ease-in");
          posX -= t * 400 * intensity;
        }
        break;
      }
      case "slide_out_right": {
        const exitStart = Math.max(0, clipDur - pDur);
        if (offsetSeconds >= exitStart) {
          const t = interpolate((offsetSeconds - exitStart) / pDur, "ease-in");
          posX += t * 400 * intensity;
        }
        break;
      }
      case "zoom_out_exit": {
        const exitStart = Math.max(0, clipDur - pDur);
        if (offsetSeconds >= exitStart) {
          const t = interpolate((offsetSeconds - exitStart) / pDur, "ease-in");
          const s = 1.0 - 0.4 * t;
          sX *= s;
          sY *= s;
          op *= (1 - t);
        }
        break;
      }

      // Continuous
      case "ken_burns_in": {
        const progress = Math.max(0, Math.min(1, offsetSeconds / Math.max(0.1, clipDur)));
        const s = 1.0 + 0.15 * progress * intensity;
        sX *= s;
        sY *= s;
        break;
      }
      case "ken_burns_out": {
        const progress = Math.max(0, Math.min(1, offsetSeconds / Math.max(0.1, clipDur)));
        const s = 1.15 - 0.15 * progress * intensity;
        sX *= s;
        sY *= s;
        break;
      }
      case "slow_pan_left": {
        const progress = Math.max(0, Math.min(1, offsetSeconds / Math.max(0.1, clipDur)));
        posX -= progress * 80 * intensity;
        break;
      }
      case "slow_pan_right": {
        const progress = Math.max(0, Math.min(1, offsetSeconds / Math.max(0.1, clipDur)));
        posX += progress * 80 * intensity;
        break;
      }
      case "subtle_float": {
        const freq = 1.2;
        posY += Math.sin(offsetSeconds * freq) * 8 * intensity;
        break;
      }
      case "shake": {
        // Deterministic pseudo-random displacement using seed and time
        const step = Math.floor(offsetSeconds * 18);
        const randX = Math.sin(seed * 73 + step * 31.3);
        const randY = Math.cos(seed * 51 + step * 47.7);
        posX += randX * 10 * intensity;
        posY += randY * 10 * intensity;
        break;
      }
      case "pulse": {
        const freq = 2.0;
        const s = 1.0 + Math.sin(offsetSeconds * freq * Math.PI) * 0.04 * intensity;
        sX *= s;
        sY *= s;
        break;
      }
    }
  }

  return {
    positionX: posX,
    positionY: posY,
    scaleX: sX,
    scaleY: sY,
    rotation: rot,
    opacity: Math.max(0, Math.min(1, op)),
    volume: Math.max(0, vol),
  };
}

// ─── Preset Catalog ──────────────────────────────────────────────────────────

export const ANIMATION_PRESETS: AnimationPresetDefinition[] = [
  // ── Entrance ────────────────────────────────────────────────────────────────
  {
    id: "fade_in",
    category: "entrance",
    label: "Fade In",
    description: "Smooth opacity ramp from 0 to 100%.",
    defaultDuration: 0.8,
    generateKeyframes: (dur) => [
      { id: "kf-1", property: "opacity", time: 0, value: 0, interpolation: "ease-out" },
      { id: "kf-2", property: "opacity", time: dur, value: 1, interpolation: "linear" },
    ],
  },
  {
    id: "slide_in_left",
    category: "entrance",
    label: "Slide In From Left",
    description: "Enters from left boundary to original position.",
    defaultDuration: 0.8,
    generateKeyframes: (dur) => [
      { id: "kf-1", property: "positionX", time: 0, value: -400, interpolation: "ease-out" },
      { id: "kf-2", property: "positionX", time: dur, value: 0, interpolation: "linear" },
      { id: "kf-3", property: "opacity", time: 0, value: 0, interpolation: "ease-out" },
      { id: "kf-4", property: "opacity", time: dur * 0.5, value: 1, interpolation: "linear" },
    ],
  },
  {
    id: "slide_in_right",
    category: "entrance",
    label: "Slide In From Right",
    description: "Enters from right boundary to original position.",
    defaultDuration: 0.8,
    generateKeyframes: (dur) => [
      { id: "kf-1", property: "positionX", time: 0, value: 400, interpolation: "ease-out" },
      { id: "kf-2", property: "positionX", time: dur, value: 0, interpolation: "linear" },
    ],
  },
  {
    id: "slide_in_bottom",
    category: "entrance",
    label: "Slide In From Bottom",
    description: "Enters upward from bottom edge to center.",
    defaultDuration: 0.8,
    generateKeyframes: (dur) => [
      { id: "kf-1", property: "positionY", time: 0, value: 300, interpolation: "ease-out" },
      { id: "kf-2", property: "positionY", time: dur, value: 0, interpolation: "linear" },
    ],
  },
  {
    id: "zoom_in",
    category: "entrance",
    label: "Zoom In Entrance",
    description: "Scales up smoothly from 60% to 100% scale.",
    defaultDuration: 0.8,
    generateKeyframes: (dur) => [
      { id: "kf-1", property: "scale", time: 0, value: 0.6, interpolation: "ease-out" },
      { id: "kf-2", property: "scale", time: dur, value: 1.0, interpolation: "linear" },
      { id: "kf-3", property: "opacity", time: 0, value: 0, interpolation: "ease-out" },
      { id: "kf-4", property: "opacity", time: dur, value: 1.0, interpolation: "linear" },
    ],
  },
  {
    id: "zoom_out",
    category: "entrance",
    label: "Zoom Out Entrance",
    description: "Scales down smoothly from 140% to 100% scale.",
    defaultDuration: 0.8,
    generateKeyframes: (dur) => [
      { id: "kf-1", property: "scale", time: 0, value: 1.4, interpolation: "ease-out" },
      { id: "kf-2", property: "scale", time: dur, value: 1.0, interpolation: "linear" },
      { id: "kf-3", property: "opacity", time: 0, value: 0, interpolation: "ease-out" },
      { id: "kf-4", property: "opacity", time: dur, value: 1.0, interpolation: "linear" },
    ],
  },
  {
    id: "pop_in",
    category: "entrance",
    label: "Pop In (Overshoot)",
    description: "Dynamic pop with subtle bouncy overshoot.",
    defaultDuration: 0.6,
    generateKeyframes: (dur) => [
      { id: "kf-1", property: "scale", time: 0, value: 0.2, interpolation: "ease-out" },
      { id: "kf-2", property: "scale", time: dur * 0.7, value: 1.08, interpolation: "ease-in-out" },
      { id: "kf-3", property: "scale", time: dur, value: 1.0, interpolation: "linear" },
    ],
  },
  {
    id: "rotate_in",
    category: "entrance",
    label: "Rotate In",
    description: "Rotates from -90 degrees while fading in.",
    defaultDuration: 0.8,
    generateKeyframes: (dur) => [
      { id: "kf-1", property: "rotation", time: 0, value: -90, interpolation: "ease-out" },
      { id: "kf-2", property: "rotation", time: dur, value: 0, interpolation: "linear" },
      { id: "kf-3", property: "opacity", time: 0, value: 0, interpolation: "ease-out" },
      { id: "kf-4", property: "opacity", time: dur, value: 1, interpolation: "linear" },
    ],
  },

  // ── Exit ────────────────────────────────────────────────────────────────────
  {
    id: "fade_out",
    category: "exit",
    label: "Fade Out",
    description: "Smooth opacity drop to 0% at clip end.",
    defaultDuration: 0.8,
    generateKeyframes: (dur, clipDur) => [
      { id: "kf-1", property: "opacity", time: Math.max(0, clipDur - dur), value: 1, interpolation: "ease-in" },
      { id: "kf-2", property: "opacity", time: clipDur, value: 0, interpolation: "linear" },
    ],
  },
  {
    id: "slide_out_left",
    category: "exit",
    label: "Slide Out Left",
    description: "Slides away off the left edge at clip end.",
    defaultDuration: 0.8,
    generateKeyframes: (dur, clipDur) => [
      { id: "kf-1", property: "positionX", time: Math.max(0, clipDur - dur), value: 0, interpolation: "ease-in" },
      { id: "kf-2", property: "positionX", time: clipDur, value: -400, interpolation: "linear" },
    ],
  },
  {
    id: "slide_out_right",
    category: "exit",
    label: "Slide Out Right",
    description: "Slides away off the right edge at clip end.",
    defaultDuration: 0.8,
    generateKeyframes: (dur, clipDur) => [
      { id: "kf-1", property: "positionX", time: Math.max(0, clipDur - dur), value: 0, interpolation: "ease-in" },
      { id: "kf-2", property: "positionX", time: clipDur, value: 400, interpolation: "linear" },
    ],
  },
  {
    id: "zoom_out_exit",
    category: "exit",
    label: "Zoom Out Exit",
    description: "Scales down to 60% and disappears.",
    defaultDuration: 0.8,
    generateKeyframes: (dur, clipDur) => [
      { id: "kf-1", property: "scale", time: Math.max(0, clipDur - dur), value: 1.0, interpolation: "ease-in" },
      { id: "kf-2", property: "scale", time: clipDur, value: 0.6, interpolation: "linear" },
      { id: "kf-3", property: "opacity", time: Math.max(0, clipDur - dur), value: 1.0, interpolation: "ease-in" },
      { id: "kf-4", property: "opacity", time: clipDur, value: 0, interpolation: "linear" },
    ],
  },

  // ── Continuous ──────────────────────────────────────────────────────────────
  {
    id: "ken_burns_in",
    category: "continuous",
    label: "Ken Burns (Push In)",
    description: "Slow optical zoom from 100% to 115% across clip duration.",
    defaultDuration: 5.0,
    generateKeyframes: (_, clipDur) => [
      { id: "kf-1", property: "scale", time: 0, value: 1.0, interpolation: "linear" },
      { id: "kf-2", property: "scale", time: clipDur, value: 1.15, interpolation: "linear" },
    ],
  },
  {
    id: "ken_burns_out",
    category: "continuous",
    label: "Ken Burns (Pull Out)",
    description: "Slow optical zoom out from 115% to 100% across clip duration.",
    defaultDuration: 5.0,
    generateKeyframes: (_, clipDur) => [
      { id: "kf-1", property: "scale", time: 0, value: 1.15, interpolation: "linear" },
      { id: "kf-2", property: "scale", time: clipDur, value: 1.0, interpolation: "linear" },
    ],
  },
  {
    id: "slow_pan_left",
    category: "continuous",
    label: "Slow Pan Left",
    description: "Gentle camera pan toward the left edge.",
    defaultDuration: 5.0,
    generateKeyframes: (_, clipDur) => [
      { id: "kf-1", property: "positionX", time: 0, value: 0, interpolation: "linear" },
      { id: "kf-2", property: "positionX", time: clipDur, value: -80, interpolation: "linear" },
    ],
  },
  {
    id: "slow_pan_right",
    category: "continuous",
    label: "Slow Pan Right",
    description: "Gentle camera pan toward the right edge.",
    defaultDuration: 5.0,
    generateKeyframes: (_, clipDur) => [
      { id: "kf-1", property: "positionX", time: 0, value: 0, interpolation: "linear" },
      { id: "kf-2", property: "positionX", time: clipDur, value: 80, interpolation: "linear" },
    ],
  },
  {
    id: "subtle_float",
    category: "continuous",
    label: "Subtle Float",
    description: "Delicate vertical floating motion.",
    defaultDuration: 4.0,
    generateKeyframes: (_, clipDur) => [
      { id: "kf-1", property: "positionY", time: 0, value: 0, interpolation: "ease-in-out" },
      { id: "kf-2", property: "positionY", time: clipDur * 0.5, value: -10, interpolation: "ease-in-out" },
      { id: "kf-3", property: "positionY", time: clipDur, value: 0, interpolation: "linear" },
    ],
  },
  {
    id: "pulse",
    category: "continuous",
    label: "Pulse / Scale Emphasis",
    description: "Subtle rhythmic heartbeat pulse.",
    defaultDuration: 2.0,
    generateKeyframes: () => [],
  },
  {
    id: "shake",
    category: "continuous",
    label: "Camera Shake (Deterministic)",
    description: "Handheld camera vibration with deterministic seed.",
    defaultDuration: 3.0,
    generateKeyframes: () => [],
  },

  // ── Text / Title Animations ─────────────────────────────────────────────────
  {
    id: "typewriter",
    category: "text",
    label: "Typewriter Reveal",
    description: "Reveals text letter-by-letter as if typed in real-time.",
    defaultDuration: 1.5,
    generateKeyframes: () => [],
  },
  {
    id: "word_reveal",
    category: "text",
    label: "Word-by-Word Reveal",
    description: "Reveals sentence word-by-word.",
    defaultDuration: 1.2,
    generateKeyframes: () => [],
  },
  {
    id: "character_reveal",
    category: "text",
    label: "Character Sweep Reveal",
    description: "Progressive character reveal with optical tracking.",
    defaultDuration: 1.0,
    generateKeyframes: () => [],
  },
];

/**
 * Filter animation presets by category.
 */
export function filterAnimationPresets(category?: AnimationCategory | "all"): AnimationPresetDefinition[] {
  if (!category || category === "all") return ANIMATION_PRESETS;
  return ANIMATION_PRESETS.filter((p) => p.category === category);
}

/**
 * Creates a ClipAnimationPreset record for a clip.
 */
export function createClipAnimationPreset(
  presetId: AnimationPresetId,
  options?: { duration?: number; intensity?: number; seed?: number }
): ClipAnimationPreset {
  const def = ANIMATION_PRESETS.find((p) => p.id === presetId);
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `anim-${Date.now()}`;

  return {
    id,
    presetId,
    category: def?.category || "entrance",
    duration: options?.duration ?? def?.defaultDuration ?? 0.8,
    intensity: options?.intensity ?? 1.0,
    seed: options?.seed ?? 42,
  };
}

/**
 * Applies a preset as explicit keyframes onto a TimelineClip.
 */
export function applyPresetAsKeyframes(clip: TimelineClip, presetId: AnimationPresetId, duration?: number): TimelineClip {
  const def = ANIMATION_PRESETS.find((p) => p.id === presetId);
  if (!def) return clip;

  const clipDuration = clip.sourceOut - clip.sourceIn;
  const pDur = duration ?? def.defaultDuration;
  const newKfs = def.generateKeyframes(pDur, clipDuration);

  return {
    ...clip,
    keyframes: [...(clip.keyframes || []), ...newKfs],
    animationPreset: undefined, // converted to explicit keyframes
  };
}

/**
 * Evaluates text overlay animations (typewriter, word reveal, karaoke word-level highlighting).
 */
export function evaluateOverlayAnimation(
  overlay: TextOverlay,
  time: number
): { renderedText: string; opacity: number; offsetY: number; activeWordIndex: number | null } {
  const dur = overlay.endTime - overlay.startTime;
  const offset = time - overlay.startTime;
  let renderedText = overlay.text;
  let activeWordIndex: number | null = null;
  const opacity = 1.0;
  const offsetY = 0;

  if (overlay.animationPreset === "typewriter") {
    const animDur = Math.min(dur * 0.8, 1.8);
    const progress = Math.min(1, Math.max(0, offset) / Math.max(0.01, animDur));
    const chars = Math.floor(overlay.text.length * progress);
    renderedText = overlay.text.slice(0, chars);
  } else if (overlay.animationPreset === "word_reveal") {
    const words = overlay.text.split(/\s+/);
    const animDur = Math.min(dur * 0.8, words.length * 0.25);
    const progress = Math.min(1, Math.max(0, offset) / Math.max(0.01, animDur));
    const wordCount = Math.max(1, Math.floor(words.length * progress));
    renderedText = words.slice(0, wordCount).join(" ");
  }

  if (overlay.wordTimings && overlay.wordTimings.length > 0) {
    for (let w = 0; w < overlay.wordTimings.length; w++) {
      const wt = overlay.wordTimings[w];
      if (time >= wt.start && time < wt.end) {
        activeWordIndex = w;
        break;
      }
    }
  }

  return { renderedText, opacity, offsetY, activeWordIndex };
}
