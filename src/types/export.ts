/**
 * Export and rendering type definitions for Content Studio (Phase 5).
 *
 * Rules:
 * - All persistent records stored in project.json match ProjectExport in project.ts.
 * - RenderPlan is an immutable snapshot of timeline editing state at export start.
 * - Float timestamps use integer frame arithmetic to prevent cumulative drift.
 */

import type { TextOverlay } from "./timeline.ts";
import type { ExportOutputSettings, ProjectExport } from "./project.ts";

export type ExportPreset = "1080p" | "720p" | "540p";
export type ExportAspectRatio = "16:9" | "9:16" | "1:1" | "4:5";
export type ExportFormat = "mp4" | "webm";
export type ExportQuality = "high" | "medium" | "low";

export interface ExportSettings extends ExportOutputSettings {
  quality: ExportQuality;
  videoBitrate?: number;
  audioBitrate?: number;
  audioSampleRate: number;
  audioChannels: number;
  filename: string;
}

export interface RenderPlanSource {
  assetId: string;
  name: string;
  handleRefId: string;
  file?: File;
  hasVideo: boolean;
  hasAudio: boolean;
  duration?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  rotation?: number;
}

export interface RenderPlanVideoFrame {
  frameIndex: number;
  presentationTimeUs: bigint;
  presentationTimeSeconds: number;
  durationSeconds: number;
  activeClip: {
    clipId: string;
    assetId: string;
    sourceTimeSeconds: number;
  } | null;
  activeOverlays: TextOverlay[];
}

export interface RenderPlanAudioSegment {
  clipId: string;
  assetId: string;
  timelineStartSeconds: number;
  timelineEndSeconds: number;
  sourceInSeconds: number;
  sourceOutSeconds: number;
  volume: number;
  trackId: string;
  trackOrder: number;
}

export interface RenderPlan {
  projectId: string;
  projectName: string;
  timelineId: string;
  createdAt: string;
  settings: ExportSettings;
  frameRate: number;
  totalDurationSeconds: number;
  totalFrames: number;
  sources: Map<string, RenderPlanSource>;
  missingSources: string[];
  videoFrames: RenderPlanVideoFrame[];
  audioSegments: RenderPlanAudioSegment[];
  hasVideo: boolean;
  hasAudio: boolean;
  isValid: boolean;
  validationErrors: string[];
}

export type ExportStage =
  | "validating-timeline"
  | "checking-capabilities"
  | "preparing-writer"
  | "rendering-audio"
  | "rendering-video"
  | "finalizing-output"
  | "validating-output"
  | "completed"
  | "failed"
  | "cancelled";

export interface ExportProgress {
  stage: ExportStage;
  percent: number; // 0-100
  currentFrame?: number;
  totalFrames?: number;
  elapsedMs: number;
  statusText: string;
}

export interface ExportValidationResult {
  ok: boolean;
  error?: string;
  metadata?: {
    format: string;
    mimeType: string;
    hasVideo: boolean;
    hasAudio: boolean;
    videoCodec?: string;
    audioCodec?: string;
    width: number;
    height: number;
    frameRate?: number;
    duration: number;
    fileSize: number;
  };
}

export interface ExportCapabilitiesReport {
  hasWebCodecs: boolean;
  canExportMp4AvcAac: boolean;
  canExportWebmOpus: boolean;
  supportedVideoCodecs: string[];
  supportedAudioCodecs: string[];
  supportedPresets: ExportPreset[];
  fileSystemAccessWritable: boolean;
  notes: string[];
}

export type { ProjectExport, ExportOutputSettings };
