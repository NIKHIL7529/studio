/**
 * Project document validation, sanitization, and serialization.
 *
 * Rules:
 * - Treat project.json as untrusted local input.
 * - Enforce schemaVersion: 1 strictly.
 * - Reject malformed UUIDs, unsafe paths, oversized names, and corrupt dates.
 * - Never execute or evaluate any content from the document.
 */

import type { ProjectDocument, ProjectAsset, MediaCategory } from "../types/project.ts";

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

  const validCategories: MediaCategory[] = ["video", "audio", "unknown"];
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

  return {
    ok: true,
    data: {
      id: (obj.id as string).trim(),
      name: (obj.name as string).trim(),
      mediaType,
      mimeType: typeof obj.mimeType === "string" ? obj.mimeType.trim() : "",
      size: Math.floor(obj.size),
      lastModified,
      handleRefId: (obj.handleRefId as string).trim(),
      sourceLocator,
    },
  };
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

  return {
    ok: true,
    data: {
      schemaVersion: 1,
      id: (obj.id as string).trim(),
      name: sanitizedName,
      createdAt: (obj.createdAt as string).trim(),
      updatedAt: (obj.updatedAt as string).trim(),
      assets: validatedAssets,
      settings,
    },
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
