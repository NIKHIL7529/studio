/**
 * Timeline domain types for Content Studio.
 *
 * Rules:
 * - Timestamps are in seconds as non-negative floating-point numbers.
 * - Microsecond precision is preserved during calculations.
 * - Timeline is strictly local, validated, and JSON-serializable.
 * - Tracks are ordered: lower order renders higher in the layer stack.
 * - TextOverlays support both distinct title/headline overlays and timed spoken captions.
 */

import type { ExportAspectRatio } from "./export.ts";

export type TrackType = "video" | "audio" | "title" | "caption";

// ─── Keyframe & Animation Types ──────────────────────────────────────────────

export type KeyframeProperty =
  | "positionX"
  | "positionY"
  | "scaleX"
  | "scaleY"
  | "scale"
  | "rotation"
  | "opacity"
  | "volume";

export type KeyframeInterpolation = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold";

export interface ClipKeyframe {
  id: string;
  property: KeyframeProperty;
  /** Offset in seconds relative to clip startTime */
  time: number;
  value: number;
  interpolation: KeyframeInterpolation;
}

export type AnimationCategory = "entrance" | "exit" | "continuous" | "text" | "caption";

export type AnimationPresetId =
  // Entrance
  | "fade_in"
  | "slide_in_left"
  | "slide_in_right"
  | "slide_in_top"
  | "slide_in_bottom"
  | "push_in_left"
  | "push_in_right"
  | "zoom_in"
  | "zoom_out"
  | "pop_in"
  | "rotate_in"
  | "blur_in"
  | "soft_bounce_in"
  // Exit
  | "fade_out"
  | "slide_out_left"
  | "slide_out_right"
  | "slide_out_top"
  | "slide_out_bottom"
  | "zoom_out_exit"
  | "rotate_out"
  | "blur_out"
  | "shrink_out"
  // Continuous
  | "slow_pan_left"
  | "slow_pan_right"
  | "ken_burns_in"
  | "ken_burns_out"
  | "subtle_float"
  | "shake"
  | "pulse"
  // Text specific
  | "typewriter"
  | "character_reveal"
  | "word_reveal"
  | "line_reveal"
  | "text_tracking";

export interface ClipAnimationPreset {
  id: string;
  presetId: AnimationPresetId;
  category: AnimationCategory;
  duration: number; // Duration of entrance/exit in seconds
  intensity?: number; // e.g. 1.0 = standard
  seed?: number; // for deterministic shake/continuous
  customParams?: Record<string, number | string | boolean>;
}

export interface ClipTransform {
  x: number; // Offset in px or normalized (-1 to 1, default 0)
  y: number; // Offset in px or normalized (-1 to 1, default 0)
  scaleX: number; // multiplier (default 1)
  scaleY: number; // multiplier (default 1)
  rotation: number; // degrees (-360 to 360, default 0)
  opacity: number; // 0 to 1 (default 1)
}

// ─── Transition Types ────────────────────────────────────────────────────────

export type TransitionFamily =
  | "dissolve"
  | "wipe"
  | "movement"
  | "stylized"
  | "audio";

export type TransitionType =
  // Dissolves & Fades
  | "cross_dissolve"
  | "fade_from_black"
  | "fade_to_black"
  | "dip_black"
  | "fade_from_white"
  | "fade_to_white"
  | "dip_color"
  | "additive_dissolve"
  // Directional Wipes
  | "wipe_left"
  | "wipe_right"
  | "wipe_up"
  | "wipe_down"
  | "wipe_diagonal_tl_br"
  | "wipe_diagonal_tr_bl"
  | "wipe_center_out"
  | "wipe_edge_in"
  | "barn_door_horizontal"
  | "barn_door_vertical"
  | "clock_wipe"
  | "iris_open"
  | "iris_close"
  | "shape_mask_circle"
  | "shape_mask_diamond"
  | "shape_mask_box"
  | "luma_wipe"
  // Movement
  | "push_left"
  | "push_right"
  | "push_up"
  | "push_down"
  | "slide_left"
  | "slide_right"
  | "slide_up"
  | "slide_down"
  | "cover_left"
  | "cover_right"
  | "reveal_left"
  | "reveal_right"
  | "split_push"
  | "split_slide"
  | "zoom_in"
  | "zoom_out"
  | "directional_zoom"
  // Stylized & Blur
  | "blur_dissolve"
  | "zoom_blur"
  | "defocus"
  | "flash_white"
  | "flash_color"
  | "glitch"
  | "pixelate"
  // Audio
  | "audio_linear_fade_in"
  | "audio_linear_fade_out"
  | "audio_equal_power_fade_in"
  | "audio_equal_power_fade_out"
  | "audio_linear_crossfade"
  | "audio_equal_power_crossfade"
  | "audio_dip_silence";

export interface TransitionParams {
  color?: string; // hex color for dip_color, flash_color
  softness?: number; // feather edge 0 to 1
  borderWidth?: number;
  borderColor?: string;
  seed?: number; // deterministic seed for glitch
  intensity?: number;
  easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out";
}

export interface TimelineTransition {
  id: string;
  type: TransitionType;
  family: TransitionFamily;
  duration: number; // in seconds (e.g. 0.5s)
  /** Timeline time of the edit point between fromClip and toClip */
  editPoint: number;
  /** Incoming clip ID (if transition connects two clips or starts at clip end) */
  fromClipId?: string;
  /** Outgoing clip ID (if transition connects two clips or starts at clip start) */
  toClipId?: string;
  /** Associated track ID */
  trackId: string;
  alignment: "center" | "start" | "end";
  params?: TransitionParams;
}

export interface TimelineClip {
  /** Stable UUID */
  id: string;
  /** References ProjectAsset.id */
  assetId: string;
  /** References TimelineTrack.id */
  trackId: string;
  /** Seconds on the timeline where the clip starts (>= 0) */
  startTime: number;
  /** Seconds into the source asset where playback begins (>= 0) */
  sourceIn: number;
  /** Seconds into the source asset where playback ends (> sourceIn) */
  sourceOut: number;
  /** Volume multiplier: 0 = mute, 1 = 100% normal, > 1 = boost */
  volume: number;
  muted: boolean;
  /** Optional grouping identifier for multi-clip group selection */
  groupId?: string;
  /** Optional linked clip ID (e.g. video linked to its corresponding audio track) */
  linkedClipId?: string;
  /** Playback speed factor (1.0 = normal, 0.5 = 2x slow motion, 2.0 = 2x fast) */
  speed?: number;
  /** Keyframe automation for position, scale, opacity, volume, etc. */
  keyframes?: ClipKeyframe[];
  /** Animation preset (entrance, exit, continuous) */
  animationPreset?: ClipAnimationPreset;
  /** Static transform properties */
  transform?: ClipTransform;
  /** If audio was detached, whether this clip's embedded audio is disabled */
  embeddedAudioDisabled?: boolean;
}

export type TextOverlayType = "title" | "caption";

export type CaptionPreset = "clean" | "bold" | "minimal";

export interface TextOverlay {
  /** Stable UUID */
  id: string;
  text: string;
  /** Seconds on the timeline where the overlay starts (inclusive) */
  startTime: number;
  /** Seconds on the timeline where the overlay ends (exclusive) */
  endTime: number;

  // ── Position: normalized 0–1 from top-left ───────────────────────────────
  x: number;
  y: number;

  // ── Style ────────────────────────────────────────────────────────────────
  /** Font size in px (e.g. 32) */
  fontSize: number;
  /** CSS color string */
  color: string;
  align: "left" | "center" | "right";
  /** Font family (e.g. "sans-serif", "Inter", "Impact", "Georgia", etc.) */
  fontFamily?: string;
  /** Rotation in degrees */
  rotation?: number;
  /** Letter spacing in px */
  letterSpacing?: number;
  /** Line height multiplier (default 1.35) */
  lineHeight?: number;

  // ── Caption & Spoken Word Styling ──────────────────────────────
  /** Distinct overlay role: "title" headline vs timed "caption" */
  overlayType?: TextOverlayType;
  /** Caption visual styling preset */
  preset?: CaptionPreset;
  /** Background pill/box color (e.g. "rgba(0,0,0,0.75)" or "#000000") */
  backgroundColor?: string;
  /** Corner radius for background pill in px */
  backgroundCornerRadius?: number;
  /** Padding for background pill in px */
  backgroundPadding?: number;
  /** Outline stroke color for high contrast text */
  strokeColor?: string;
  /** Outline stroke width in px */
  strokeWidth?: number;
  /** Text shadow styling */
  shadowColor?: string;
  shadowBlur?: number;
  /** Font weight: e.g. 600, 700, 800 */
  fontWeight?: string | number;
  /** Safe margin wrapping width as fraction of canvas width (e.g. 0.85) */
  boxWidthRatio?: number;
  /** Animation preset for title or caption */
  animationPreset?: AnimationPresetId;
  /** Reference to originating source asset */
  sourceAssetId?: string;
  /** Reference to originating subtitle cue */
  sourceCueId?: string;
  /** Word-level timing tokens if available */
  wordTimings?: Array<{ word: string; start: number; end: number }>;
}

export interface TimelineTrack {
  /** Stable UUID */
  id: string;
  type: TrackType;
  name: string;
  /** Display and z-order index (0 = top-most / primary) */
  order: number;
  muted: boolean;
  clips: TimelineClip[];
  /** Whether track edits are locked against accidental modification */
  locked?: boolean;
  /** Whether track video is hidden / suppressed in preview and export */
  hidden?: boolean;
  /** Solo mode: when active, only solo tracks play audio */
  solo?: boolean;
  /** Sync-lock flag for ripple operations: shifting clips also ripples sync-locked tracks */
  syncLocked?: boolean;
  /** Track-level gain multiplier (1.0 = unity) */
  volume?: number;
  /** Track vertical height setting */
  height?: "compact" | "normal" | "expanded" | number;
}

export interface TimelineMarker {
  /** Stable UUID */
  id: string;
  /** Timeline position in seconds */
  time: number;
  /** Optional marker duration for spanned ranges */
  duration?: number;
  /** Label/title */
  label: string;
  /** Marker badge color (e.g. hex #3b82f6 or name) */
  color: string;
  /** Optional creator notes */
  notes?: string;
}

export interface TimelineSettings {
  targetAspectRatio?: ExportAspectRatio;
  /** Whether captions should be included by default in exports */
  includeCaptionsInExport?: boolean;
  /** Caption track enabled / visible in preview */
  captionsVisible?: boolean;
  /** Default font family for titles/captions */
  defaultFontFamily?: string;
}

export interface TimelineDocument {
  id: string;
  tracks: TimelineTrack[];
  textOverlays: TextOverlay[];
  settings: TimelineSettings;
  /** Transitions applied between clips or at clip edges */
  transitions?: TimelineTransition[];
  /** Optional timeline markers */
  markers?: TimelineMarker[];
  /** In-point for sequence export or playback boundary (seconds) */
  inPoint?: number | null;
  /** Out-point for sequence export or playback boundary (seconds) */
  outPoint?: number | null;
  /** Sequence frame rate / timebase configuration */
  timebase?: { fps: number };
}

export interface SequenceDocument {
  /** Stable UUID */
  id: string;
  /** Display name of the sequence */
  name: string;
  /** Frame rate (e.g. 24, 25, 29.97, 30, 60) */
  fps: number;
  /** Frame width in pixels */
  width: number;
  /** Frame height in pixels */
  height: number;
  /** Aspect ratio profile */
  aspectRatio: ExportAspectRatio;
  /** Active timeline document for this sequence */
  timeline: TimelineDocument;
  /** Creation timestamp */
  createdAt: string;
  /** Modification timestamp */
  updatedAt: string;
}
