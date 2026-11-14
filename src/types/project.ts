/**
 * Project and workspace type definitions for Content Studio (Phase 2, Phase 3 & Phase 4).
 *
 * Rules:
 * - Durable source of truth is the project.json file on disk.
 * - Project documents store only metadata and opaque handle reference IDs,
 *   never raw file bytes, blobs, full filesystem paths, or signed URLs.
 * - Schema version is strictly 1 for the initial release.
 */

import type { InspectedMediaMetadata, MediaInspectionResult } from "../lib/media/types.ts";
import type { TimelineDocument } from "./timeline.ts";

export interface ProjectSettings {
  /** Output aspect ratio preference (e.g. "16:9", "9:16", "1:1", "4:5") */
  targetAspectRatio?: "16:9" | "9:16" | "1:1" | "4:5";
}

export type MediaCategory = "video" | "audio" | "unknown";

export interface ProjectAsset {
  /** Stable UUID identifying this asset within the project */
  id: string;

  /** Display filename (e.g. "interview-raw.mp4") */
  name: string;

  /** Media category inferred from MIME/extension hint */
  mediaType: MediaCategory;

  /** MIME type hint from the file or picker, may be empty or unreliable */
  mimeType: string;

  /** File byte size */
  size: number;

  /** Timestamp of file's last modification if available */
  lastModified?: number;

  /**
   * Opaque handle reference ID used to retrieve the FileSystemFileHandle
   * from IndexedDB.
   */
  handleRefId: string;

  /**
   * Optional verified path relative to the workspace folder if safely resolvable.
   * Never contains '..', leading slashes, or absolute drive paths.
   */
  sourceLocator?: string;

  /**
   * Persisted technical media metadata inspected by Mediabunny (Phase 3).
   * Contains only stable JSON-serializable values (no live objects or URLs).
   */
  metadata?: InspectedMediaMetadata;
}

export interface ProjectDocument {
  /** Current schema version, strictly 1 */
  schemaVersion: 1;

  /** Project UUID */
  id: string;

  /** Human-readable project display name */
  name: string;

  /** ISO 8601 creation timestamp */
  createdAt: string;

  /** ISO 8601 last modified timestamp */
  updatedAt: string;

  /** Imported source media references */
  assets: ProjectAsset[];

  /** Minimal project preferences */
  settings?: ProjectSettings;

  /**
   * Optional timeline document embedded in the project.
   * Added in Phase 4; schemaVersion remains 1.
   * Absent on projects created before Phase 4.
   */
  timeline?: TimelineDocument;

  /**
   * Optional registered exports for this project.
   * Added in Phase 5; schemaVersion remains 1.
   * Absent on projects created before Phase 5.
   */
  exports?: ProjectExport[];
}

/**
 * Output settings recorded with a completed project export.
 */
export interface ExportOutputSettings {
  targetAspectRatio: "16:9" | "9:16" | "1:1" | "4:5";
  width: number;
  height: number;
  frameRate: number;
  videoCodec: string;
  audioCodec?: string;
  format: "mp4" | "webm";
}

/**
 * Persistent metadata for a completed local export.
 */
export interface ProjectExport {
  /** Stable UUID identifying this export */
  id: string;

  /** Display output filename (e.g. "interview-1080p.mp4") */
  name: string;

  /** Verified relative path within workspace (e.g. "projects/<id>/exports/interview-1080p.mp4") */
  relativePath: string;

  /** ISO 8601 completion timestamp */
  createdAt: string;

  /** Export configuration profile */
  settings: ExportOutputSettings;

  /** Verified duration in seconds */
  duration: number;

  /** Verified output dimensions */
  width: number;
  height: number;

  /** Verified file size in bytes */
  fileSize: number;

  /** Validation / completion state */
  status: "completed" | "failed";

  /** Actionable error if validation failed */
  error?: string;
}

/**
 * Summary for listing projects in a workspace without loading entire documents.
 */
export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  valid: boolean;
  error?: string;
}

/**
 * Live accessibility status of an imported asset.
 */
export type AssetAccessStatus =
  | "ready"             // Handle valid and read permission granted
  | "prompt-required"   // Handle exists in IndexedDB but user prompt needed to renew permission
  | "missing"           // Handle absent from IndexedDB or file deleted/moved (NotFoundError)
  | "session-only"      // Fallback file input; valid for this browser tab session only
  | "denied"            // Permission explicitly denied by user
  | "unsupported";      // Browser does not support persistent handles

export interface LiveAssetItem {
  asset: ProjectAsset;
  status: AssetAccessStatus;
  file?: File;
  errorMessage?: string;
  inspection?: MediaInspectionResult;
  isInspecting?: boolean;
}

/**
 * Workspace permission state machine.
 */
export type WorkspacePermissionState =
  | "not-selected"     // No workspace folder has been chosen
  | "checking"         // Querying stored handle permission
  | "granted"          // Read/write access is active
  | "prompt-required"  // Stored handle exists but user gesture needed to requestPermission
  | "denied"           // User denied directory access
  | "unsupported"      // Browser lacks showDirectoryPicker
  | "error";           // Unexpected error accessing workspace handle

/**
 * Save state indicator for active project editing.
 */
export type SaveState = "saved" | "saving" | "error";

