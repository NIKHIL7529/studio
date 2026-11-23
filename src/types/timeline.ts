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

export type ClipFitMode = "fit" | "fill" | "blur-bg";

export interface ClipCrop {
  top: number; // 0 to 0.45 (normalized fraction)
  right: number; // 0 to 0.45
  bottom: number; // 0 to 0.45
  left: number; // 0 to 0.45
}

export type ColorPresetId = "none" | "vivid" | "warm" | "cool" | "bw" | "cinematic";

export interface ColorAdjustments {
  presetId: ColorPresetId;
  brightness: number;  // -100 to 100 (default 0)
  contrast: number;    // -100 to 100 (default 0)
  saturation: number;  // -100 to 100 (default 0)
  exposure: number;    // -100 to 100 (default 0)
  temperature: number; // -100 to 100 (default 0; negative = cool, positive = warm)
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
  fitMode: ClipFitMode;
  crop: ClipCrop;
  flipH: boolean;
  flipV: boolean;
  fadeIn: number;
  fadeOut: number;
  audioDetached: boolean;
  /** Color grading and filter parameters */
  color: ColorAdjustments;
  /** Optional grouping identifier for multi-clip group selection */
  groupId?: string;
  /** Optional linked clip ID (e.g. video linked to its corresponding audio track) */
  linkedClipId?: string;
  /** Playback rate factor between 0.25 and 4.0 (1.0 = normal) */
  playbackRate: number;
  /** Whether to preserve audio pitch when playbackRate !== 1.0 */
  preservePitch: boolean;
  /** When non-null (>= 0), clip freezes and displays this single source timestamp */
  freezeFrameSourceTime: number | null;
  /** Keyframe automation for position, scale, opacity, volume, etc. */
  keyframes?: ClipKeyframe[];
  /** Animation preset (entrance, exit, continuous) */
  animationPreset?: ClipAnimationPreset;
  /** Static transform properties */
  transform?: ClipTransform;
}

export type TextOverlayType = "title" | "caption";

export type CaptionPreset = "clean" | "bold" | "minimal";

export type CaptionPresetId = "classic" | "bold-karaoke" | "pill" | "minimal" | "custom";

export interface CaptionStyle {
  presetId: CaptionPresetId;
  activeWordColor: string;
}

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
  presetId: CaptionPresetId;
  activeWordColor: string;
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

export type TrackAudioRole = "dialogue" | "music" | "sfx" | "general";

export interface TrackDuckingConfig {
  enabled: boolean;     // default false
  reductionDb: number;  // -30 to -3 dB (default -12)
  attackMs: number;     // 20 to 1000 ms (default 150)
  releaseMs: number;    // 50 to 2000 ms (default 400)
}

export interface TimelineTrack {
  /** Stable UUID */
  id: string;
  type: TrackType;
  name: string;
  /** Display and z-order index (0 = top-most / primary) */
  order: number;
  locked: boolean;
  muted: boolean;
  hidden: boolean;
  clips: TimelineClip[];
  /** Semantic role for mixing, ducking, and routing */
  audioRole: TrackAudioRole;
  /** Automatic dialogue-aware ducking configuration */
  ducking: TrackDuckingConfig;
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
  /** Label/title */
  label: string;
  /** Marker badge color (e.g. hex #3b82f6 or name) */
  color: string;
  /** Optional marker duration for spanned ranges */
  duration?: number;
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
  markers: TimelineMarker[];
  settings: TimelineSettings;
  /** Transitions applied between clips or at clip edges */
  transitions?: TimelineTransition[];
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
