/**
 * Project and workspace type definitions for Content Studio (Phase 2).
 *
 * Rules:
 * - Durable source of truth is the project.json file on disk.
 * - Project documents store only metadata and opaque handle reference IDs,
 *   never raw file bytes, blobs, full filesystem paths, or signed URLs.
 * - Schema version is strictly 1 for the initial release.
 */

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

