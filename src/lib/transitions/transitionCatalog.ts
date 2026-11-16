/**
 * Transition Catalog and Definitions for Content Studio.
 *
 * Rules:
 * - Deterministic, parameter-driven transitions.
 * - Organized into distinct families: Dissolves/Fades, Directional Wipes, Movement, Stylized, Audio.
 * - Every transition has a typed schema, default duration, adjustable parameters, and real renderer.
 * - Serializable, testable in Node.js, reusable across preview and export.
 */

import type {
  TransitionType,
  TransitionFamily,
  TransitionParams,
  TimelineTransition,
  TimelineClip,
  TimelineDocument,
} from "../../types/timeline.ts";

export interface TransitionDefinition {
  type: TransitionType;
  family: TransitionFamily;
  label: string;
  description: string;
  defaultDuration: number;
  availableParams: Array<{
    name: keyof TransitionParams;
    label: string;
    type: "color" | "number" | "select";
    default: any;
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
  }>;
}

export const TRANSITION_CATALOG: TransitionDefinition[] = [
  // ── Dissolves & Fades ───────────────────────────────────────────────────────
  {
    type: "cross_dissolve",
    family: "dissolve",
    label: "Cross Dissolve",
    description: "Smooth linear/cosine cross-blend between two adjacent clips.",
    defaultDuration: 0.8,
    availableParams: [
      { name: "easing", label: "Easing", type: "select", default: "ease-in-out", options: ["linear", "ease-in", "ease-out", "ease-in-out"] },
    ],
  },
  {
    type: "fade_from_black",
    family: "dissolve",
    label: "Fade From Black",
    description: "Fades in from solid black to the incoming clip.",
    defaultDuration: 0.6,
    availableParams: [],
  },
  {
    type: "fade_to_black",
    family: "dissolve",
    label: "Fade To Black",
    description: "Fades out from the outgoing clip to solid black.",
    defaultDuration: 0.6,
    availableParams: [],
  },
  {
    type: "dip_black",
    family: "dissolve",
    label: "Dip Through Black",
    description: "Dips from outgoing clip through solid black to incoming clip.",
    defaultDuration: 1.0,
    availableParams: [],
  },
  {
    type: "fade_from_white",
    family: "dissolve",
    label: "Fade From White",
    description: "Fades in from brilliant white to the incoming clip.",
    defaultDuration: 0.5,
    availableParams: [],
  },
  {
    type: "fade_to_white",
    family: "dissolve",
    label: "Fade To White",
    description: "Fades out from outgoing clip to brilliant white.",
    defaultDuration: 0.5,
    availableParams: [],
  },
  {
    type: "dip_color",
    family: "dissolve",
    label: "Dip Through Color",
    description: "Dips through a user-selected background color.",
    defaultDuration: 1.0,
    availableParams: [
      { name: "color", label: "Dip Color", type: "color", default: "#3b82f6" },
    ],
  },
  {
    type: "additive_dissolve",
    family: "dissolve",
    label: "Additive Dissolve",
    description: "Blends clips using additive color math for a bright glow transition.",
    defaultDuration: 0.7,
    availableParams: [],
  },

  // ── Directional Wipes ───────────────────────────────────────────────────────
  {
    type: "wipe_left",
    family: "wipe",
    label: "Wipe Left",
    description: "Reveals incoming clip from right to left edge.",
    defaultDuration: 0.8,
    availableParams: [
      { name: "softness", label: "Edge Softness", type: "number", default: 0.05, min: 0, max: 0.5, step: 0.01 },
    ],
  },
  {
    type: "wipe_right",
    family: "wipe",
    label: "Wipe Right",
    description: "Reveals incoming clip from left to right edge.",
    defaultDuration: 0.8,
    availableParams: [
      { name: "softness", label: "Edge Softness", type: "number", default: 0.05, min: 0, max: 0.5, step: 0.01 },
    ],
  },
  {
    type: "wipe_up",
    family: "wipe",
    label: "Wipe Up",
    description: "Reveals incoming clip from bottom to top.",
    defaultDuration: 0.8,
    availableParams: [
      { name: "softness", label: "Edge Softness", type: "number", default: 0.05, min: 0, max: 0.5, step: 0.01 },
    ],
  },
  {
    type: "wipe_down",
    family: "wipe",
    label: "Wipe Down",
    description: "Reveals incoming clip from top to bottom.",
    defaultDuration: 0.8,
    availableParams: [
      { name: "softness", label: "Edge Softness", type: "number", default: 0.05, min: 0, max: 0.5, step: 0.01 },
    ],
  },
  {
    type: "wipe_diagonal_tl_br",
    family: "wipe",
    label: "Diagonal Wipe (Top-Left to Bottom-Right)",
    description: "Diagonal wipe starting from top-left corner across to bottom-right.",
    defaultDuration: 0.9,
    availableParams: [
      { name: "softness", label: "Edge Softness", type: "number", default: 0.05, min: 0, max: 0.5, step: 0.01 },
    ],
  },
  {
    type: "wipe_diagonal_tr_bl",
    family: "wipe",
    label: "Diagonal Wipe (Top-Right to Bottom-Left)",
    description: "Diagonal wipe starting from top-right corner across to bottom-left.",
    defaultDuration: 0.9,
    availableParams: [
      { name: "softness", label: "Edge Softness", type: "number", default: 0.05, min: 0, max: 0.5, step: 0.01 },
    ],
  },
  {
    type: "wipe_center_out",
    family: "wipe",
    label: "Center-Out Wipe",
    description: "Horizontal wipe opening symmetrically outward from screen center.",
    defaultDuration: 0.8,
    availableParams: [],
  },
  {
    type: "wipe_edge_in",
    family: "wipe",
    label: "Edge-In Wipe",
    description: "Wipe closing symmetrically inward from outer edges toward center.",
    defaultDuration: 0.8,
    availableParams: [],
  },
  {
    type: "barn_door_horizontal",
    family: "wipe",
    label: "Barn Door Horizontal",
    description: "Vertical split opening like horizontal barn doors.",
    defaultDuration: 0.8,
    availableParams: [],
  },
  {
    type: "barn_door_vertical",
    family: "wipe",
    label: "Barn Door Vertical",
    description: "Horizontal split opening like vertical elevator doors.",
    defaultDuration: 0.8,
    availableParams: [],
  },
  {
    type: "clock_wipe",
    family: "wipe",
    label: "Clock Radial Wipe",
    description: "Circular sweep revealing incoming clip around the center clockwise.",
    defaultDuration: 1.0,
    availableParams: [],
  },
  {
    type: "iris_open",
    family: "wipe",
    label: "Iris Open",
    description: "Circular iris expanding from center outward.",
    defaultDuration: 0.8,
    availableParams: [
      { name: "softness", label: "Feather", type: "number", default: 0.05, min: 0, max: 0.3, step: 0.01 },
    ],
  },
  {
    type: "iris_close",
    family: "wipe",
    label: "Iris Close",
    description: "Circular iris contracting from outside edges inward.",
    defaultDuration: 0.8,
    availableParams: [
      { name: "softness", label: "Feather", type: "number", default: 0.05, min: 0, max: 0.3, step: 0.01 },
    ],
  },
  {
    type: "shape_mask_circle",
    family: "wipe",
    label: "Circle Mask Reveal",
    description: "Smooth expanding circle mask with soft feathered perimeter.",
    defaultDuration: 0.8,
    availableParams: [
      { name: "softness", label: "Edge Feather", type: "number", default: 0.1, min: 0, max: 0.4, step: 0.01 },
    ],
  },
  {
    type: "shape_mask_diamond",
    family: "wipe",
    label: "Diamond Mask Reveal",
    description: "Expanding diamond/rhombus reveal from center.",
    defaultDuration: 0.8,
    availableParams: [],
  },
  {
    type: "shape_mask_box",
    family: "wipe",
    label: "Box / Rectangle Reveal",
    description: "Symmetric expanding rectangle reveal matching sequence aspect ratio.",
    defaultDuration: 0.8,
    availableParams: [],
  },
  {
    type: "luma_wipe",
    family: "wipe",
    label: "Luma Wipe (Procedural Matte)",
    description: "Procedural gradient luminance threshold wipe with soft transition threshold.",
    defaultDuration: 1.0,
    availableParams: [
      { name: "softness", label: "Threshold Softness", type: "number", default: 0.1, min: 0.01, max: 0.3, step: 0.01 },
    ],
  },

  // ── Movement Transitions ───────────────────────────────────────────────────
  {
    type: "push_left",
    family: "movement",
    label: "Push Left",
    description: "Incoming clip pushes outgoing clip off screen to the left.",
    defaultDuration: 0.7,
    availableParams: [
      { name: "easing", label: "Easing", type: "select", default: "ease-in-out", options: ["linear", "ease-in", "ease-out", "ease-in-out"] },
    ],
  },
  {
    type: "push_right",
    family: "movement",
    label: "Push Right",
    description: "Incoming clip pushes outgoing clip off screen to the right.",
    defaultDuration: 0.7,
    availableParams: [
      { name: "easing", label: "Easing", type: "select", default: "ease-in-out", options: ["linear", "ease-in", "ease-out", "ease-in-out"] },
    ],
  },
  {
    type: "push_up",
    family: "movement",
    label: "Push Up",
    description: "Incoming clip pushes outgoing clip upward off screen.",
    defaultDuration: 0.7,
    availableParams: [
      { name: "easing", label: "Easing", type: "select", default: "ease-in-out", options: ["linear", "ease-in", "ease-out", "ease-in-out"] },
    ],
  },
  {
    type: "push_down",
    family: "movement",
    label: "Push Down",
    description: "Incoming clip pushes outgoing clip downward off screen.",
    defaultDuration: 0.7,
    availableParams: [
      { name: "easing", label: "Easing", type: "select", default: "ease-in-out", options: ["linear", "ease-in", "ease-out", "ease-in-out"] },
    ],
  },
  {
    type: "slide_left",
    family: "movement",
    label: "Slide Left",
    description: "Incoming clip slides over outgoing clip from right to left.",
    defaultDuration: 0.7,
    availableParams: [],
  },
  {
    type: "slide_right",
    family: "movement",
    label: "Slide Right",
    description: "Incoming clip slides over outgoing clip from left to right.",
    defaultDuration: 0.7,
    availableParams: [],
  },
  {
    type: "slide_up",
    family: "movement",
    label: "Slide Up",
    description: "Incoming clip slides over outgoing clip from bottom to top.",
    defaultDuration: 0.7,
    availableParams: [],
  },
  {
    type: "slide_down",
    family: "movement",
    label: "Slide Down",
    description: "Incoming clip slides over outgoing clip from top to bottom.",
    defaultDuration: 0.7,
    availableParams: [],
  },
  {
    type: "cover_left",
    family: "movement",
    label: "Cover Left",
    description: "Incoming clip covers outgoing clip moving from right edge.",
    defaultDuration: 0.7,
    availableParams: [],
  },
  {
    type: "reveal_left",
    family: "movement",
    label: "Reveal Left",
    description: "Outgoing clip slides away to the left revealing stationary incoming clip.",
    defaultDuration: 0.7,
    availableParams: [],
  },
  {
    type: "split_push",
    family: "movement",
    label: "Split Push",
    description: "Incoming clip expands from horizontal split pushing top and bottom away.",
    defaultDuration: 0.8,
    availableParams: [],
  },
  {
    type: "split_slide",
    family: "movement",
    label: "Split Slide",
    description: "Outgoing clip splits vertically and slides outward to both sides.",
    defaultDuration: 0.8,
    availableParams: [],
  },
  {
    type: "zoom_in",
    family: "movement",
    label: "Zoom In Transition",
    description: "Scales incoming clip up from center while cross-dissolving.",
    defaultDuration: 0.7,
    availableParams: [],
  },
  {
    type: "zoom_out",
    family: "movement",
    label: "Zoom Out Transition",
    description: "Scales outgoing clip down to center while incoming clip appears.",
    defaultDuration: 0.7,
    availableParams: [],
  },
  {
    type: "directional_zoom",
    family: "movement",
    label: "Directional Zoom",
    description: "Continuous forward optical zoom through the cut.",
    defaultDuration: 0.6,
    availableParams: [],
  },

  // ── Blur, Focus & Stylized ──────────────────────────────────────────────────
  {
    type: "blur_dissolve",
    family: "stylized",
    label: "Blur Dissolve",
    description: "Blurs out the outgoing clip and blurs into the incoming clip.",
    defaultDuration: 0.8,
    availableParams: [
      { name: "intensity", label: "Blur Radius (px)", type: "number", default: 16, min: 4, max: 40, step: 2 },
    ],
  },
  {
    type: "zoom_blur",
    family: "stylized",
    label: "Radial Zoom Blur",
    description: "High-energy zoom motion blur bursting across the transition.",
    defaultDuration: 0.6,
    availableParams: [],
  },
  {
    type: "defocus",
    family: "stylized",
    label: "Defocus / Focus",
    description: "Simulates camera lens defocusing at cut point and refocusing.",
    defaultDuration: 0.8,
    availableParams: [],
  },
  {
    type: "flash_white",
    family: "stylized",
    label: "White Flash",
    description: "Quick photographic strobe flash concealing the cut point.",
    defaultDuration: 0.4,
    availableParams: [],
  },
  {
    type: "flash_color",
    family: "stylized",
    label: "Color Flash",
    description: "Vibrant single-color strobe flash concealing the cut point.",
    defaultDuration: 0.4,
    availableParams: [
      { name: "color", label: "Flash Color", type: "color", default: "#f59e0b" },
    ],
  },
  {
    type: "glitch",
    family: "stylized",
    label: "Glitch (Deterministic)",
    description: "Digital artifact displacement with deterministic seed.",
    defaultDuration: 0.5,
    availableParams: [
      { name: "seed", label: "Random Seed", type: "number", default: 42, min: 1, max: 9999, step: 1 },
      { name: "intensity", label: "Displacement", type: "number", default: 1.0, min: 0.2, max: 3.0, step: 0.1 },
    ],
  },
  {
    type: "pixelate",
    family: "stylized",
    label: "Pixelate Mosaic",
    description: "Pixelates outgoing clip into coarse blocks then sharpens incoming clip.",
    defaultDuration: 0.7,
    availableParams: [
      { name: "intensity", label: "Max Block Size", type: "number", default: 24, min: 8, max: 64, step: 4 },
    ],
  },

  // ── Audio Transitions ───────────────────────────────────────────────────────
  {
    type: "audio_linear_crossfade",
    family: "audio",
    label: "Audio Linear Crossfade",
    description: "Linear slope audio volume blend between adjacent audio clips.",
    defaultDuration: 0.5,
    availableParams: [],
  },
  {
    type: "audio_equal_power_crossfade",
    family: "audio",
    label: "Audio Equal-Power Crossfade",
    description: "Constant-power sinusoidal crossfade preventing a volume dip in the center.",
    defaultDuration: 0.5,
    availableParams: [],
  },
  {
    type: "audio_linear_fade_in",
    family: "audio",
    label: "Audio Linear Fade In",
    description: "Ramps audio gain linearly from silence to 100%.",
    defaultDuration: 0.4,
    availableParams: [],
  },
  {
    type: "audio_linear_fade_out",
    family: "audio",
    label: "Audio Linear Fade Out",
    description: "Ramps audio gain linearly from 100% to silence.",
    defaultDuration: 0.4,
    availableParams: [],
  },
  {
    type: "audio_equal_power_fade_in",
    family: "audio",
    label: "Audio Equal-Power Fade In",
    description: "Natural curve audio fade in from silence.",
    defaultDuration: 0.4,
    availableParams: [],
  },
  {
    type: "audio_equal_power_fade_out",
    family: "audio",
    label: "Audio Equal-Power Fade Out",
    description: "Natural curve audio fade out to silence.",
    defaultDuration: 0.4,
    availableParams: [],
  },
  {
    type: "audio_dip_silence",
    family: "audio",
    label: "Audio Dip To Silence",
    description: "Quick dip to silence at the edit boundary.",
    defaultDuration: 0.6,
    availableParams: [],
  },
];

/**
 * Finds definition for a transition type.
 */
export function getTransitionDefinition(type: TransitionType): TransitionDefinition | undefined {
  return TRANSITION_CATALOG.find((t) => t.type === type);
}

/**
 * Filter transition catalog by family or search term.
 */
export function filterTransitions(family?: TransitionFamily | "all", query?: string): TransitionDefinition[] {
  let list = TRANSITION_CATALOG;
  if (family && family !== "all") {
    list = list.filter((t) => t.family === family);
  }
  if (query && query.trim()) {
    const q = query.trim().toLowerCase();
    list = list.filter((t) => t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
  }
  return list;
}

/**
 * Creates a valid TimelineTransition object between two clips or at a clip boundary.
 */
export function createTimelineTransition(
  type: TransitionType,
  editPoint: number,
  trackId: string,
  options?: {
    fromClipId?: string;
    toClipId?: string;
    duration?: number;
    alignment?: "center" | "start" | "end";
    params?: TransitionParams;
  }
): TimelineTransition {
  const def = getTransitionDefinition(type);
  const family: TransitionFamily = def?.family || "dissolve";
  const duration = options?.duration ?? def?.defaultDuration ?? 0.8;
  const alignment = options?.alignment ?? "center";

  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `trans-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  return {
    id,
    type,
    family,
    duration,
    editPoint,
    trackId,
    fromClipId: options?.fromClipId,
    toClipId: options?.toClipId,
    alignment,
    params: options?.params,
  };
}

/**
 * Calculates transition boundary window [startTime, endTime].
 */
export function getTransitionTimeWindow(transition: TimelineTransition): { start: number; end: number } {
  const dur = transition.duration;
  switch (transition.alignment) {
    case "start":
      return { start: transition.editPoint, end: transition.editPoint + dur };
    case "end":
      return { start: Math.max(0, transition.editPoint - dur), end: transition.editPoint };
    case "center":
    default:
      return {
        start: Math.max(0, transition.editPoint - dur / 2),
        end: transition.editPoint + dur / 2,
      };
  }
}

/**
 * Calculates normalized progress t in [0, 1] for a given timestamp.
 */
export function getTransitionProgress(transition: TimelineTransition, time: number): number {
  const { start, end } = getTransitionTimeWindow(transition);
  if (end <= start) return 1;
  if (time <= start) return 0;
  if (time >= end) return 1;

  const rawT = (time - start) / (end - start);
  const easing = transition.params?.easing || "ease-in-out";

  switch (easing) {
    case "linear":
      return rawT;
    case "ease-in":
      return rawT * rawT;
    case "ease-out":
      return rawT * (2 - rawT);
    case "ease-in-out":
    default:
      return rawT < 0.5 ? 2 * rawT * rawT : -1 + (4 - 2 * rawT) * rawT;
  }
}
