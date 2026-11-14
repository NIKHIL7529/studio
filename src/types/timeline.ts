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

export type TrackType = "video" | "audio";

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

  // ── Caption & Spoken Word Styling ──────────────────────────────
  /** Distinct overlay role: "title" headline vs timed "caption" */
  overlayType?: TextOverlayType;
  /** Caption visual styling preset */
  preset?: CaptionPreset;
  /** Background pill/box color (e.g. "rgba(0,0,0,0.75)" or "#000000") */
  backgroundColor?: string;
  /** Outline stroke color for high contrast text */
  strokeColor?: string;
  /** Outline stroke width in px */
  strokeWidth?: number;
  /** Font weight: e.g. 600, 700, 800 */
  fontWeight?: string | number;
  /** Safe margin wrapping width as fraction of canvas width (e.g. 0.85) */
  boxWidthRatio?: number;
  /** Reference to originating source asset */
  sourceAssetId?: string;
  /** Reference to originating subtitle cue */
  sourceCueId?: string;
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
}

export interface TimelineSettings {
  targetAspectRatio?: ExportAspectRatio;
}

export interface TimelineDocument {
  id: string;
  tracks: TimelineTrack[];
  textOverlays: TextOverlay[];
  settings: TimelineSettings;
}
