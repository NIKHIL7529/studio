/**
 * Timeline data model for Content Studio.
 *
 * Rules:
 * - All types are JSON-serializable (no File, Blob, HTMLElement, etc.)
 * - All IDs are stable string UUIDs
 * - Source time (sourceIn/sourceOut within the source file) is strictly
 *   separate from timeline time (startTime/duration on the track)
 * - TimelineDocument is embedded in ProjectDocument as an optional field;
 *   schemaVersion remains 1
 */

/** Embedded timeline document, stored inside ProjectDocument.timeline */
export interface TimelineDocument {
  /** Stable UUID for this timeline */
  id: string;
  tracks: TimelineTrack[];
  textOverlays: TextOverlay[];
  settings: TimelineSettings;
}

export interface TimelineSettings {
  targetAspectRatio?: "16:9" | "9:16" | "1:1" | "4:5";
}

export type TrackType = "video" | "audio";

export interface TimelineTrack {
  /** Stable UUID */
  id: string;
  type: TrackType;
  name: string;
  /** Display order — lower numbers appear higher/earlier in the UI */
  order: number;
  muted: boolean;
  clips: TimelineClip[];
}

export interface TimelineClip {
  /** Stable UUID */
  id: string;
  /** References ProjectAsset.id */
  assetId: string;
  /** References TimelineTrack.id */
  trackId: string;

  // ── Timeline position ────────────────────────────────────────────────────
  /** Seconds from the timeline origin where this clip begins */
  startTime: number;

  // ── Source range ─────────────────────────────────────────────────────────
  /** Start of the used region in the source file (seconds, inclusive) */
  sourceIn: number;
  /** End of the used region in the source file (seconds, exclusive) */
  sourceOut: number;

  // Derived: duration = sourceOut - sourceIn

  /** Playback volume, 0–1 (default 1) */
  volume: number;
  muted: boolean;
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
}
