/**
 * Project document validation, sanitization, and serialization.
 *
 * Rules:
 * - Treat project.json as untrusted local input.
 * - Enforce schemaVersion: 1 strictly.
 * - Reject malformed UUIDs, unsafe paths, oversized names, and corrupt dates.
 * - Never execute or evaluate any content from the document.
 */

import type { ProjectDocument, ProjectAsset, MediaKind, MediaCategory, ProjectExport, ExportOutputSettings } from "../types/project.ts";
import type {
  TimelineDocument,
  TimelineTrack,
  TimelineClip,
  ClipFitMode,
  ClipCrop,
  CaptionPresetId,
  TextOverlay,
  TimelineMarker,
  TrackType,
  SequenceDocument,
  ColorPresetId,
  ColorAdjustments,
  TrackAudioRole,
  TrackDuckingConfig,
} from "../types/timeline.ts";
import type { InspectedMediaMetadata, InspectedVideoTrack, InspectedAudioTrack } from "./media/types.ts";
import { validateTimeline } from "./timeline/model.ts";

export const CURRENT_SCHEMA_VERSION = 1;
export const MAX_PROJECT_NAME_LENGTH = 100;
export const MIN_PROJECT_NAME_LENGTH = 1;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Checks if a string is a valid UUID (v1-v5).
 */
export function isValidUuid(id: unknown): id is string {
  return typeof id === "string" && UUID_REGEX.test(id.trim());
}

/**
 * Checks whether an ISO 8601 date string is parseable and valid.
 */
export function isValidIsoDate(dateStr: unknown): boolean {
  if (typeof dateStr !== "string" || dateStr.trim().length === 0) return false;
  const parsed = Date.parse(dateStr);
  return !Number.isNaN(parsed);
}

/**
 * Checks if a relative path is safe (no directory traversal, no drive letters,
 * no absolute paths, no null bytes).
 */
export function isSafeRelativePath(path: unknown): boolean {
  if (typeof path !== "string") return false;
  const normalized = path.replace(/\\/g, "/").trim();
  if (normalized.length === 0) return false;
  if (normalized.startsWith("/") || normalized.startsWith("~")) return false;
  if (/^[a-zA-Z]:/.test(normalized)) return false; // Windows drive letters
  const segments = normalized.split("/");
  for (const seg of segments) {
    if (seg === ".." || seg === "." || seg === "" || seg.includes("\0")) {
      return false;
    }
  }
  return true;
}

/**
 * Validates and sanitizes a project display name.
 */
export function sanitizeProjectName(name: unknown): string {
  if (typeof name !== "string") return "Untitled Project";
  const trimmed = name.trim().replace(/[\x00-\x1F\x7F]/g, ""); // strip control chars
  if (trimmed.length === 0) return "Untitled Project";
  return trimmed.slice(0, MAX_PROJECT_NAME_LENGTH);
}

/**
 * Validates an individual asset record.
 */
export function validateAsset(raw: unknown): { ok: true; data: ProjectAsset } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Asset must be an object." };
  }

  const obj = raw as Record<string, unknown>;

  if (!isValidUuid(obj.id)) {
    return { ok: false, error: `Asset id must be a valid UUID. Received: ${String(obj.id)}` };
  }

  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    return { ok: false, error: "Asset name must be a non-empty string." };
  }

  const validKinds: MediaKind[] = ["video", "audio", "image"];
  if (typeof obj.kind !== "string" || !validKinds.includes(obj.kind as MediaKind)) {
    return { ok: false, error: `Asset kind must be one of: ${validKinds.join(", ")}. Received: ${String(obj.kind)}` };
  }
  const kind = obj.kind as MediaKind;

  if (kind === "image") {
    const nameLower = (obj.name as string).toLowerCase();
    const ext = nameLower.slice(nameLower.lastIndexOf("."));
    const validImageExts = [".png", ".jpg", ".jpeg", ".webp"];
    if (ext && !validImageExts.includes(ext)) {
      return { ok: false, error: `Image asset extension "${ext}" is not supported. Supported extensions: .png, .jpg, .jpeg, .webp.` };
    }
  }

  const validCategories: MediaCategory[] = ["video", "audio", "image", "unknown"];
  const mediaType: MediaCategory = validCategories.includes(obj.mediaType as MediaCategory)
    ? (obj.mediaType as MediaCategory)
    : "unknown";

  if (typeof obj.size !== "number" || Number.isNaN(obj.size) || obj.size < 0) {
    return { ok: false, error: "Asset size must be a non-negative number." };
  }

  if (typeof obj.handleRefId !== "string" || obj.handleRefId.trim().length === 0) {
    return { ok: false, error: "Asset handleRefId must be a non-empty string." };
  }

  let sourceLocator: string | undefined = undefined;
  if (obj.sourceLocator !== undefined) {
    if (!isSafeRelativePath(obj.sourceLocator)) {
      return { ok: false, error: `Asset sourceLocator contains unsafe path: ${String(obj.sourceLocator)}` };
    }
    sourceLocator = (obj.sourceLocator as string).replace(/\\/g, "/").trim();
  }

  let lastModified: number | undefined = undefined;
  if (typeof obj.lastModified === "number" && !Number.isNaN(obj.lastModified) && obj.lastModified > 0) {
    lastModified = obj.lastModified;
  }

  const metadata = validateInspectedMetadata(obj.metadata);

  let fingerprint: string | undefined = undefined;
  if (typeof obj.fingerprint === "string" && obj.fingerprint.trim().length > 0) {
    fingerprint = obj.fingerprint.trim();
  }

  return {
    ok: true,
    data: {
      id: (obj.id as string).trim(),
      name: (obj.name as string).trim(),
      kind,
      mediaType,
      mimeType: typeof obj.mimeType === "string" ? obj.mimeType.trim() : "",
      size: Math.floor(obj.size),
      lastModified,
      handleRefId: (obj.handleRefId as string).trim(),
      sourceLocator,
      metadata,
      ...(fingerprint ? { fingerprint } : {}),
    },
  };
}

/**
 * Validates and sanitizes inspected media metadata for durable persistence in project.json.
 * Ensures only primitive, valid technical values are stored (no live files, decoders, or URLs).
 */
export function validateInspectedMetadata(raw: unknown): InspectedMediaMetadata | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;

  const videoTracks: InspectedVideoTrack[] = [];
  if (Array.isArray(obj.videoTracks)) {
    for (const t of obj.videoTracks) {
      if (typeof t === "object" && t !== null) {
        const tr = t as Record<string, unknown>;
        videoTracks.push({
          trackNumber: typeof tr.trackNumber === "number" ? tr.trackNumber : 1,
          codec: typeof tr.codec === "string" ? tr.codec : null,
          codecParameterString: typeof tr.codecParameterString === "string" ? tr.codecParameterString : null,
          codedWidth: typeof tr.codedWidth === "number" && Number.isFinite(tr.codedWidth) ? tr.codedWidth : undefined,
          codedHeight: typeof tr.codedHeight === "number" && Number.isFinite(tr.codedHeight) ? tr.codedHeight : undefined,
          displayWidth: typeof tr.displayWidth === "number" && Number.isFinite(tr.displayWidth) ? tr.displayWidth : undefined,
          displayHeight: typeof tr.displayHeight === "number" && Number.isFinite(tr.displayHeight) ? tr.displayHeight : undefined,
          rotation: typeof tr.rotation === "number" && Number.isFinite(tr.rotation) ? tr.rotation : undefined,
          frameRate: typeof tr.frameRate === "number" && Number.isFinite(tr.frameRate) ? tr.frameRate : undefined,
          isConstantFrameRate: typeof tr.isConstantFrameRate === "boolean" ? tr.isConstantFrameRate : undefined,
        });
      }
    }
  }

  const audioTracks: InspectedAudioTrack[] = [];
  if (Array.isArray(obj.audioTracks)) {
    for (const t of obj.audioTracks) {
      if (typeof t === "object" && t !== null) {
        const tr = t as Record<string, unknown>;
        audioTracks.push({
          trackNumber: typeof tr.trackNumber === "number" ? tr.trackNumber : 1,
          codec: typeof tr.codec === "string" ? tr.codec : null,
          codecParameterString: typeof tr.codecParameterString === "string" ? tr.codecParameterString : null,
          numberOfChannels: typeof tr.numberOfChannels === "number" && Number.isFinite(tr.numberOfChannels) ? tr.numberOfChannels : undefined,
          sampleRate: typeof tr.sampleRate === "number" && Number.isFinite(tr.sampleRate) ? tr.sampleRate : undefined,
        });
      }
    }
  }

  return {
    containerFormat: typeof obj.containerFormat === "string" ? obj.containerFormat : undefined,
    mimeType: typeof obj.mimeType === "string" ? obj.mimeType : undefined,
    duration: typeof obj.duration === "number" && Number.isFinite(obj.duration) && obj.duration >= 0 ? obj.duration : undefined,
    videoTracks,
    audioTracks,
    displayWidth: typeof obj.displayWidth === "number" && Number.isFinite(obj.displayWidth) ? obj.displayWidth : undefined,
    displayHeight: typeof obj.displayHeight === "number" && Number.isFinite(obj.displayHeight) ? obj.displayHeight : undefined,
    codedWidth: typeof obj.codedWidth === "number" && Number.isFinite(obj.codedWidth) ? obj.codedWidth : undefined,
    codedHeight: typeof obj.codedHeight === "number" && Number.isFinite(obj.codedHeight) ? obj.codedHeight : undefined,
    rotation: typeof obj.rotation === "number" && Number.isFinite(obj.rotation) ? obj.rotation : undefined,
    frameRate: typeof obj.frameRate === "number" && Number.isFinite(obj.frameRate) ? obj.frameRate : undefined,
    isConstantFrameRate: typeof obj.isConstantFrameRate === "boolean" ? obj.isConstantFrameRate : undefined,
    sampleRate: typeof obj.sampleRate === "number" && Number.isFinite(obj.sampleRate) ? obj.sampleRate : undefined,
    numberOfChannels: typeof obj.numberOfChannels === "number" && Number.isFinite(obj.numberOfChannels) ? obj.numberOfChannels : undefined,
    inspectedAt: typeof obj.inspectedAt === "string" ? obj.inspectedAt : new Date().toISOString(),
  };
}

/**
 * Validates and sanitizes a TimelineDocument from untrusted JSON.
 */
export function validateTimelineDocument(raw: unknown): { ok: true; data: TimelineDocument } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Timeline must be an object." };
  }
  const obj = raw as Record<string, unknown>;
  if (!isValidUuid(obj.id)) {
    return { ok: false, error: `Invalid timeline UUID: ${String(obj.id)}` };
  }
  if (!Array.isArray(obj.tracks)) {
    return { ok: false, error: "Timeline tracks must be an array." };
  }
  const tracks: TimelineTrack[] = [];
  for (let i = 0; i < obj.tracks.length; i++) {
    const t = obj.tracks[i];
    if (typeof t !== "object" || t === null) {
      return { ok: false, error: `Track at index ${i} is invalid.` };
    }
    const tr = t as Record<string, unknown>;
    if (!isValidUuid(tr.id)) {
      return { ok: false, error: `Invalid track UUID at index ${i}: ${String(tr.id)}` };
    }
    const validTrackTypes = ["video", "audio", "title", "caption"];
    if (typeof tr.type !== "string" || !validTrackTypes.includes(tr.type)) {
      return { ok: false, error: `Invalid track type "${String(tr.type)}" at index ${i}. Must be one of: ${validTrackTypes.join(", ")}.` };
    }
    if (typeof tr.name !== "string" || tr.name.trim().length === 0) {
      return { ok: false, error: `Track at index ${i} must have a non-empty name.` };
    }
    if (!Array.isArray(tr.clips)) {
      return { ok: false, error: `Track "${tr.name}" clips must be an array.` };
    }
    const clips: TimelineClip[] = [];
    for (let j = 0; j < tr.clips.length; j++) {
      const c = tr.clips[j];
      if (typeof c !== "object" || c === null) {
        return { ok: false, error: `Clip at index ${j} in track "${tr.name}" is invalid.` };
      }
      const cl = c as Record<string, unknown>;
      if (!isValidUuid(cl.id)) {
        return { ok: false, error: `Invalid clip UUID: ${String(cl.id)}` };
      }
      if (!isValidUuid(cl.assetId)) {
        return { ok: false, error: `Invalid clip assetId: ${String(cl.assetId)}` };
      }
      if (!isValidUuid(cl.trackId)) {
        return { ok: false, error: `Invalid clip trackId: ${String(cl.trackId)}` };
      }
      const startTime = typeof cl.startTime === "number" && Number.isFinite(cl.startTime) ? cl.startTime : -1;
      const sourceIn = typeof cl.sourceIn === "number" && Number.isFinite(cl.sourceIn) ? cl.sourceIn : -1;
      const sourceOut = typeof cl.sourceOut === "number" && Number.isFinite(cl.sourceOut) ? cl.sourceOut : -1;
      const volume = typeof cl.volume === "number" && Number.isFinite(cl.volume) ? Math.max(0, Math.min(1, cl.volume)) : 1;
      const muted = typeof cl.muted === "boolean" ? cl.muted : false;

      const validFitModes: ClipFitMode[] = ["fit", "fill", "blur-bg"];
      const fitMode: ClipFitMode = validFitModes.includes(cl.fitMode as ClipFitMode)
        ? (cl.fitMode as ClipFitMode)
        : "fit";

      let crop: ClipCrop = { top: 0, right: 0, bottom: 0, left: 0 };
      if (typeof cl.crop === "object" && cl.crop !== null) {
        const cr = cl.crop as Record<string, unknown>;
        const parseSide = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 0.5 ? v : 0);
        crop = {
          top: parseSide(cr.top),
          right: parseSide(cr.right),
          bottom: parseSide(cr.bottom),
          left: parseSide(cr.left),
        };
      }

      const flipH = typeof cl.flipH === "boolean" ? cl.flipH : false;
      const flipV = typeof cl.flipV === "boolean" ? cl.flipV : false;
      const fadeIn = typeof cl.fadeIn === "number" && Number.isFinite(cl.fadeIn) && cl.fadeIn >= 0 ? cl.fadeIn : 0;
      const fadeOut = typeof cl.fadeOut === "number" && Number.isFinite(cl.fadeOut) && cl.fadeOut >= 0 ? cl.fadeOut : 0;
      const audioDetached = typeof cl.audioDetached === "boolean" ? cl.audioDetached : false;

      if (typeof cl.playbackRate !== "number" || !Number.isFinite(cl.playbackRate) || cl.playbackRate < 0.25 || cl.playbackRate > 4.0) {
        return { ok: false, error: `Clip "${String(cl.id)}" playbackRate must be a number between 0.25 and 4.0.` };
      }
      const playbackRate = cl.playbackRate;

      if (typeof cl.preservePitch !== "boolean") {
        return { ok: false, error: `Clip "${String(cl.id)}" preservePitch must be a boolean.` };
      }
      const preservePitch = cl.preservePitch;

      let freezeFrameSourceTime: number | null = null;
      if (cl.freezeFrameSourceTime !== null && cl.freezeFrameSourceTime !== undefined) {
        if (typeof cl.freezeFrameSourceTime !== "number" || !Number.isFinite(cl.freezeFrameSourceTime) || cl.freezeFrameSourceTime < 0) {
          return { ok: false, error: `Clip "${String(cl.id)}" freezeFrameSourceTime must be null or a non-negative number.` };
        }
        freezeFrameSourceTime = cl.freezeFrameSourceTime;
      }

      if (typeof cl.color !== "object" || cl.color === null) {
        return { ok: false, error: `Clip "${String(cl.id)}" color must be an object.` };
      }
      const rawColor = cl.color as Record<string, unknown>;
      const validColorPresets: ColorPresetId[] = ["none", "vivid", "warm", "cool", "bw", "cinematic"];
      if (typeof rawColor.presetId !== "string" || !validColorPresets.includes(rawColor.presetId as ColorPresetId)) {
        return { ok: false, error: `Clip "${String(cl.id)}" color.presetId must be one of: ${validColorPresets.join(", ")}.` };
      }
      for (const prop of ["brightness", "contrast", "saturation", "exposure", "temperature"] as const) {
        const v = rawColor[prop];
        if (typeof v !== "number" || !Number.isFinite(v) || v < -100 || v > 100) {
          return { ok: false, error: `Clip "${String(cl.id)}" color.${prop} must be a number between -100 and 100.` };
        }
      }
      const color: ColorAdjustments = {
        presetId: rawColor.presetId as ColorPresetId,
        brightness: rawColor.brightness as number,
        contrast: rawColor.contrast as number,
        saturation: rawColor.saturation as number,
        exposure: rawColor.exposure as number,
        temperature: rawColor.temperature as number,
      };

      const clipItem: TimelineClip = {
        id: (cl.id as string).trim(),
        assetId: (cl.assetId as string).trim(),
        trackId: (cl.trackId as string).trim(),
        startTime,
        sourceIn,
        sourceOut,
        volume,
        muted,
        fitMode,
        crop,
        flipH,
        flipV,
        fadeIn,
        fadeOut,
        audioDetached,
        playbackRate,
        preservePitch,
        freezeFrameSourceTime,
        color,
      };

      if (typeof cl.groupId === "string" && cl.groupId.trim().length > 0) {
        clipItem.groupId = cl.groupId.trim();
      }
      if (typeof cl.linkedClipId === "string" && cl.linkedClipId.trim().length > 0) {
        clipItem.linkedClipId = cl.linkedClipId.trim();
      }

      clips.push(clipItem);
    }

    const validRoles: TrackAudioRole[] = ["dialogue", "music", "sfx", "general"];
    if (typeof tr.audioRole !== "string" || !validRoles.includes(tr.audioRole as TrackAudioRole)) {
      return { ok: false, error: `Track "${String(tr.id)}" audioRole must be one of: ${validRoles.join(", ")}.` };
    }
    const audioRole = tr.audioRole as TrackAudioRole;

    if (typeof tr.ducking !== "object" || tr.ducking === null) {
      return { ok: false, error: `Track "${String(tr.id)}" ducking configuration must be an object.` };
    }
    const rawDucking = tr.ducking as Record<string, unknown>;
    if (typeof rawDucking.enabled !== "boolean") {
      return { ok: false, error: `Track "${String(tr.id)}" ducking.enabled must be a boolean.` };
    }
    if (
      typeof rawDucking.reductionDb !== "number" ||
      !Number.isFinite(rawDucking.reductionDb) ||
      rawDucking.reductionDb < -30 ||
      rawDucking.reductionDb > -3
    ) {
      return { ok: false, error: `Track "${String(tr.id)}" ducking.reductionDb must be a number between -30 and -3.` };
    }
    if (
      typeof rawDucking.attackMs !== "number" ||
      !Number.isFinite(rawDucking.attackMs) ||
      rawDucking.attackMs < 20 ||
      rawDucking.attackMs > 1000
    ) {
      return { ok: false, error: `Track "${String(tr.id)}" ducking.attackMs must be a number between 20 and 1000.` };
    }
    if (
      typeof rawDucking.releaseMs !== "number" ||
      !Number.isFinite(rawDucking.releaseMs) ||
      rawDucking.releaseMs < 50 ||
      rawDucking.releaseMs > 2000
    ) {
      return { ok: false, error: `Track "${String(tr.id)}" ducking.releaseMs must be a number between 50 and 2000.` };
    }
    const ducking: TrackDuckingConfig = {
      enabled: rawDucking.enabled,
      reductionDb: rawDucking.reductionDb,
      attackMs: rawDucking.attackMs,
      releaseMs: rawDucking.releaseMs,
    };

    const trackItem: TimelineTrack = {
      id: (tr.id as string).trim(),
      type: tr.type as TrackType,
      name: (tr.name as string).trim(),
      order: typeof tr.order === "number" && Number.isFinite(tr.order) ? tr.order : i,
      locked: typeof tr.locked === "boolean" ? tr.locked : false,
      muted: typeof tr.muted === "boolean" ? tr.muted : false,
      hidden: typeof tr.hidden === "boolean" ? tr.hidden : false,
      clips,
      audioRole,
      ducking,
    };

    if (typeof tr.solo === "boolean") trackItem.solo = tr.solo;
    if (typeof tr.syncLocked === "boolean") trackItem.syncLocked = tr.syncLocked;
    if (typeof tr.volume === "number" && Number.isFinite(tr.volume)) trackItem.volume = tr.volume;
    if (tr.height === "compact" || tr.height === "normal" || tr.height === "expanded") trackItem.height = tr.height;

    tracks.push(trackItem);
  }

  const textOverlays: TextOverlay[] = [];
  if (Array.isArray(obj.textOverlays)) {
    for (let k = 0; k < obj.textOverlays.length; k++) {
      const o = obj.textOverlays[k];
      if (typeof o !== "object" || o === null) {
        return { ok: false, error: `Text overlay at index ${k} is invalid.` };
      }
      const ov = o as Record<string, unknown>;
      if (!isValidUuid(ov.id)) {
        return { ok: false, error: `Invalid text overlay UUID: ${String(ov.id)}` };
      }
      const startTime = typeof ov.startTime === "number" && Number.isFinite(ov.startTime) ? ov.startTime : 0;
      const endTime = typeof ov.endTime === "number" && Number.isFinite(ov.endTime) ? ov.endTime : 0;
      const x = typeof ov.x === "number" && Number.isFinite(ov.x) ? Math.max(0, Math.min(1, ov.x)) : 0.1;
      const y = typeof ov.y === "number" && Number.isFinite(ov.y) ? Math.max(0, Math.min(1, ov.y)) : 0.8;
      const fontSize = typeof ov.fontSize === "number" && Number.isFinite(ov.fontSize) ? Math.max(8, Math.min(200, ov.fontSize)) : 32;
      const color = typeof ov.color === "string" && ov.color.trim().length > 0 ? ov.color.trim() : "#ffffff";
      const align = ov.align === "left" || ov.align === "right" ? ov.align : "center";
      const validPresets: CaptionPresetId[] = ["classic", "bold-karaoke", "pill", "minimal", "custom"];
      const presetId: CaptionPresetId = validPresets.includes(ov.presetId as CaptionPresetId)
        ? (ov.presetId as CaptionPresetId)
        : "classic";
      const activeWordColor = typeof ov.activeWordColor === "string" && ov.activeWordColor.trim().length > 0
        ? ov.activeWordColor.trim()
        : "#facc15";

      textOverlays.push({
        id: (ov.id as string).trim(),
        text: typeof ov.text === "string" ? ov.text : "",
        startTime,
        endTime,
        x,
        y,
        fontSize,
        color,
        align,
        presetId,
        activeWordColor,
      });
    }
  }

  let settings: TimelineDocument["settings"] = {};
  if (typeof obj.settings === "object" && obj.settings !== null) {
    const rawSet = obj.settings as Record<string, unknown>;
    const allowedRatios = ["16:9", "9:16", "1:1", "4:5"] as const;
    if (typeof rawSet.targetAspectRatio === "string" && allowedRatios.includes(rawSet.targetAspectRatio as typeof allowedRatios[number])) {
      settings = { targetAspectRatio: rawSet.targetAspectRatio as typeof allowedRatios[number] };
    }
  }

  const markers: TimelineMarker[] = [];
  if (Array.isArray(obj.markers)) {
    for (const m of obj.markers) {
      if (typeof m === "object" && m !== null) {
        const mrk = m as Record<string, unknown>;
        if (typeof mrk.time === "number" && Number.isFinite(mrk.time) && mrk.time >= 0) {
          markers.push({
            id: typeof mrk.id === "string" && mrk.id.trim() ? mrk.id.trim() : crypto.randomUUID(),
            time: mrk.time,
            label: typeof mrk.label === "string" ? mrk.label.trim() : "Marker",
            color: typeof mrk.color === "string" ? mrk.color.trim() : "#3b82f6",
            notes: typeof mrk.notes === "string" ? mrk.notes : undefined,
            duration: typeof mrk.duration === "number" && Number.isFinite(mrk.duration) ? mrk.duration : undefined,
          });
        }
      }
    }
  }

  const timelineDoc: TimelineDocument = {
    id: (obj.id as string).trim(),
    tracks,
    textOverlays,
    markers,
    settings,
  };
  if (typeof obj.inPoint === "number" && Number.isFinite(obj.inPoint)) timelineDoc.inPoint = obj.inPoint;
  if (typeof obj.outPoint === "number" && Number.isFinite(obj.outPoint)) timelineDoc.outPoint = obj.outPoint;
  if (typeof obj.timebase === "object" && obj.timebase !== null) {
    const tb = obj.timebase as Record<string, unknown>;
    if (typeof tb.fps === "number" && Number.isFinite(tb.fps) && tb.fps > 0) {
      timelineDoc.timebase = { fps: tb.fps };
    }
  }

  const modelErrors = validateTimeline(timelineDoc);
  if (modelErrors.length > 0) {
    return { ok: false, error: `Invalid timeline: ${modelErrors.join("; ")}` };
  }

  return { ok: true, data: timelineDoc };
}

/**
 * Validates an entire ProjectDocument against schema version 1.
 */
export function validateProjectDocument(
  input: unknown
): { ok: true; data: ProjectDocument } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Project document must be an object." };
  }

  const obj = input as Record<string, unknown>;

  if (obj.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported schema version: ${String(obj.schemaVersion)}. Expected: ${CURRENT_SCHEMA_VERSION}.`,
    };
  }

  if (!isValidUuid(obj.id)) {
    return { ok: false, error: `Invalid project UUID: ${String(obj.id)}` };
  }

  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    return { ok: false, error: "Project name must be a non-empty string." };
  }

  const sanitizedName = sanitizeProjectName(obj.name);

  if (!isValidIsoDate(obj.createdAt)) {
    return { ok: false, error: `Invalid createdAt timestamp: ${String(obj.createdAt)}` };
  }

  if (!isValidIsoDate(obj.updatedAt)) {
    return { ok: false, error: `Invalid updatedAt timestamp: ${String(obj.updatedAt)}` };
  }

  if (!Array.isArray(obj.assets)) {
    return { ok: false, error: "Project assets must be an array." };
  }

  const validatedAssets: ProjectAsset[] = [];
  const seenAssetIds = new Set<string>();

  for (let i = 0; i < obj.assets.length; i++) {
    const assetValidation = validateAsset(obj.assets[i]);
    if (!assetValidation.ok) {
      return { ok: false, error: `Asset at index ${i} is invalid: ${assetValidation.error}` };
    }
    if (seenAssetIds.has(assetValidation.data.id)) {
      return { ok: false, error: `Duplicate asset UUID found: ${assetValidation.data.id}` };
    }
    seenAssetIds.add(assetValidation.data.id);
    validatedAssets.push(assetValidation.data);
  }

  let settings: ProjectDocument["settings"] = undefined;
  if (typeof obj.settings === "object" && obj.settings !== null) {
    const rawSettings = obj.settings as Record<string, unknown>;
    const allowedRatios = ["16:9", "9:16", "1:1", "4:5"] as const;
    if (typeof rawSettings.targetAspectRatio === "string" && allowedRatios.includes(rawSettings.targetAspectRatio as typeof allowedRatios[number])) {
      settings = { targetAspectRatio: rawSettings.targetAspectRatio as typeof allowedRatios[number] };
    }
  }

  let timeline: TimelineDocument | undefined = undefined;
  if (obj.timeline !== undefined) {
    const timelineRes = validateTimelineDocument(obj.timeline);
    if (!timelineRes.ok) {
      return { ok: false, error: `Project timeline is invalid: ${timelineRes.error}` };
    }
    timeline = timelineRes.data;
  }

  let exportsList: ProjectExport[] | undefined = undefined;
  if (Array.isArray(obj.exports)) {
    exportsList = [];
    for (let i = 0; i < obj.exports.length; i++) {
      const expRes = validateProjectExport(obj.exports[i]);
      if (!expRes.ok) {
        return { ok: false, error: `Export at index ${i} is invalid: ${expRes.error}` };
      }
      exportsList.push(expRes.data);
    }
  }

  let sequencesList: SequenceDocument[] | undefined = undefined;
  if (Array.isArray(obj.sequences)) {
    sequencesList = [];
    for (let i = 0; i < obj.sequences.length; i++) {
      const s = obj.sequences[i];
      if (typeof s !== "object" || s === null) continue;
      const seq = s as Record<string, unknown>;
      if (!isValidUuid(seq.id) || typeof seq.name !== "string" || !seq.name.trim()) continue;

      const tRes = validateTimelineDocument(seq.timeline);
      if (!tRes.ok) continue;

      sequencesList.push({
        id: (seq.id as string).trim(),
        name: (seq.name as string).trim(),
        fps: typeof seq.fps === "number" && seq.fps > 0 ? seq.fps : 30,
        width: typeof seq.width === "number" && seq.width > 0 ? Math.floor(seq.width) : 1920,
        height: typeof seq.height === "number" && seq.height > 0 ? Math.floor(seq.height) : 1080,
        aspectRatio: (seq.aspectRatio as "16:9" | "9:16" | "1:1" | "4:5") || "16:9",
        timeline: tRes.data,
        createdAt: isValidIsoDate(seq.createdAt) ? (seq.createdAt as string) : new Date().toISOString(),
        updatedAt: isValidIsoDate(seq.updatedAt) ? (seq.updatedAt as string) : new Date().toISOString(),
      });
    }
  }

  const docData: ProjectDocument = {
    schemaVersion: 1,
    id: (obj.id as string).trim(),
    name: sanitizedName,
    createdAt: (obj.createdAt as string).trim(),
    updatedAt: (obj.updatedAt as string).trim(),
    assets: validatedAssets,
  };

  if (settings !== undefined) {
    docData.settings = settings;
  }
  if (timeline !== undefined) {
    docData.timeline = timeline;
  }
  if (sequencesList !== undefined && sequencesList.length > 0) {
    docData.sequences = sequencesList;
  }
  if (typeof obj.activeSequenceId === "string" && isValidUuid(obj.activeSequenceId)) {
    docData.activeSequenceId = obj.activeSequenceId.trim();
  }
  if (exportsList !== undefined) {
    docData.exports = exportsList;
  }

  return {
    ok: true,
    data: docData,
  };
}

/**
 * Validates an individual project export record.
 */
export function validateProjectExport(
  raw: unknown
): { ok: true; data: ProjectExport } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Project export must be an object." };
  }

  const obj = raw as Record<string, unknown>;

  if (!isValidUuid(obj.id)) {
    return { ok: false, error: `Export id must be a valid UUID. Received: ${String(obj.id)}` };
  }

  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    return { ok: false, error: "Export name must be a non-empty string." };
  }

  if (typeof obj.relativePath !== "string" || !isSafeRelativePath(obj.relativePath)) {
    return { ok: false, error: `Export relativePath contains unsafe path: ${String(obj.relativePath)}` };
  }

  if (!isValidIsoDate(obj.createdAt)) {
    return { ok: false, error: `Invalid createdAt timestamp for export: ${String(obj.createdAt)}` };
  }

  if (typeof obj.duration !== "number" || Number.isNaN(obj.duration) || obj.duration <= 0) {
    return { ok: false, error: "Export duration must be a positive number." };
  }

  if (typeof obj.width !== "number" || obj.width <= 0 || typeof obj.height !== "number" || obj.height <= 0) {
    return { ok: false, error: "Export width and height must be positive numbers." };
  }

  if (typeof obj.fileSize !== "number" || Number.isNaN(obj.fileSize) || obj.fileSize < 0) {
    return { ok: false, error: "Export fileSize must be a non-negative number." };
  }

  const status = obj.status === "failed" ? "failed" : "completed";

  let settings: ExportOutputSettings = {
    targetAspectRatio: "16:9",
    width: Math.floor(obj.width),
    height: Math.floor(obj.height),
    frameRate: 30,
    videoCodec: "avc",
    format: "mp4",
  };

  if (typeof obj.settings === "object" && obj.settings !== null) {
    const rawSet = obj.settings as Record<string, unknown>;
    const allowedRatios = ["16:9", "9:16", "1:1", "4:5"] as const;
    const ratio = (typeof rawSet.targetAspectRatio === "string" && allowedRatios.includes(rawSet.targetAspectRatio as typeof allowedRatios[number]))
      ? (rawSet.targetAspectRatio as typeof allowedRatios[number])
      : "16:9";
    const width = typeof rawSet.width === "number" && rawSet.width > 0 ? Math.floor(rawSet.width) : Math.floor(obj.width);
    const height = typeof rawSet.height === "number" && rawSet.height > 0 ? Math.floor(rawSet.height) : Math.floor(obj.height);
    const frameRate = typeof rawSet.frameRate === "number" && rawSet.frameRate > 0 ? rawSet.frameRate : 30;
    const videoCodec = typeof rawSet.videoCodec === "string" ? rawSet.videoCodec : "avc";
    const audioCodec = typeof rawSet.audioCodec === "string" ? rawSet.audioCodec : undefined;
    const format = rawSet.format === "webm" ? "webm" : "mp4";

    settings = {
      targetAspectRatio: ratio,
      width,
      height,
      frameRate,
      videoCodec,
      format,
    };
    if (audioCodec !== undefined) {
      settings.audioCodec = audioCodec;
    }
  }

  const exportData: ProjectExport = {
    id: (obj.id as string).trim(),
    name: (obj.name as string).trim(),
    relativePath: (obj.relativePath as string).replace(/\\/g, "/").trim(),
    createdAt: (obj.createdAt as string).trim(),
    settings,
    duration: obj.duration,
    width: Math.floor(obj.width),
    height: Math.floor(obj.height),
    fileSize: Math.floor(obj.fileSize),
    status,
  };

  if (typeof obj.error === "string") {
    exportData.error = obj.error;
  }

  return {
    ok: true,
    data: exportData,
  };
}

/**
 * Serializes a ProjectDocument to formatted JSON string.
 */
export function serializeProjectDocument(doc: ProjectDocument): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Creates a new default ProjectDocument with a fresh UUID and timestamps.
 */
export function createDefaultProject(name: string): ProjectDocument {
  const now = new Date().toISOString();
  // Use crypto.randomUUID() when available, otherwise fall back to a standard UUID generation
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });

  return {
    schemaVersion: 1,
    id,
    name: sanitizeProjectName(name),
    createdAt: now,
    updatedAt: now,
    assets: [],
  };
}

/**
 * Formats a byte count into a human-readable string (e.g. "14.2 MB").
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const unitIndex = Math.min(i, units.length - 1);
  const val = bytes / Math.pow(1024, unitIndex);
  return `${val.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
