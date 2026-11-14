/**
 * Media import, handle persistence, and source-file relinking for Content Studio (Phase 2).
 *
 * Rules:
 * - Media files are NEVER copied into the workspace, IndexedDB, or OPFS.
 * - Handles are persisted in IndexedDB; project documents reference them via opaque handleRefId.
 * - Inspects only basic File metadata (name, size, lastModified, MIME hint).
 * - Codec, duration, and thumbnail generation belong to later phases.
 * - Removing an asset removes the reference, never the original file.
 */

import type { ProjectAsset, MediaCategory, LiveAssetItem } from "../types/project.ts";
import { saveFileHandle, loadFileHandle, removeFileHandle } from "./idb.ts";

// In-memory registry for session-only files (from fallback file input)
const sessionFileRegistry = new Map<string, File>();

/**
 * Categorizes a file as "video" | "audio" | "unknown" using MIME and extension hints.
 */
export function inferMediaCategory(fileName: string, mimeType?: string): MediaCategory {
  const mime = (mimeType || "").toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";

  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  const videoExts = [".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi", ".wmv", ".flv", ".ogv", ".ts"];
  const audioExts = [".mp3", ".wav", ".aac", ".m4a", ".ogg", ".flac", ".opus", ".wma", ".aiff"];

  if (videoExts.includes(ext)) return "video";
  if (audioExts.includes(ext)) return "audio";

  return "unknown";
}

/**
 * Generates an asset UUID.
 */
function generateAssetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Picker filter configuration for video and audio files.
 */
const FILE_PICKER_TYPES: FilePickerAcceptType[] = [
  {
    description: "Video and Audio Files",
    accept: {
      "video/*": [".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"],
      "audio/*": [".mp3", ".wav", ".aac", ".m4a", ".ogg", ".flac", ".opus"],
    },
  },
];

/**
 * Prompts user to select video/audio files via showOpenFilePicker.
 * Returns newly created ProjectAsset records. Files are NOT copied.
 */
export async function pickAndImportFiles(
  existingAssets: ProjectAsset[]
): Promise<ProjectAsset[]> {
  if (typeof window === "undefined" || typeof window.showOpenFilePicker !== "function") {
    throw new Error("File System Access picker is not supported in this browser. Use the standard file input fallback.");
  }

  let handles: FileSystemFileHandle[];
  try {
    const showFiles = window.showOpenFilePicker;
    handles = await showFiles({
      multiple: true,
      types: FILE_PICKER_TYPES,
      excludeAcceptAllOption: false,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      // User cancelled picker
      return [];
    }
    throw err;
  }

  const newAssets: ProjectAsset[] = [];

  for (const handle of handles) {
    const file = await handle.getFile();

    // Check if this file is already in the project (by matching name + size + lastModified)
    const isDuplicate = existingAssets.some(
      (a) => a.name === file.name && a.size === file.size && a.lastModified === file.lastModified
    ) || newAssets.some(
      (a) => a.name === file.name && a.size === file.size && a.lastModified === file.lastModified
    );

    if (isDuplicate) {
      continue;
    }

    const handleRefId = generateAssetId();

    // Persist handle in IndexedDB
    await saveFileHandle(handleRefId, handle, {
      fileName: file.name,
      size: file.size,
      lastModified: file.lastModified,
    });

    const category = inferMediaCategory(file.name, file.type);

    newAssets.push({
      id: generateAssetId(),
      name: file.name,
      mediaType: category,
      mimeType: file.type || "",
      size: file.size,
      lastModified: file.lastModified,
      handleRefId,
    });
  }

  return newAssets;
}

/**
 * Fallback import for browsers without showOpenFilePicker using standard File objects.
 * Files are kept in memory for the current session only.
 */
export async function importFallbackFiles(
  files: FileList | File[],
  existingAssets: ProjectAsset[]
): Promise<ProjectAsset[]> {
  const newAssets: ProjectAsset[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    const isDuplicate = existingAssets.some(
      (a) => a.name === file.name && a.size === file.size && a.lastModified === file.lastModified
    ) || newAssets.some(
      (a) => a.name === file.name && a.size === file.size && a.lastModified === file.lastModified
    );

    if (isDuplicate) continue;

    const handleRefId = `session-${generateAssetId()}`;
    sessionFileRegistry.set(handleRefId, file);

    const category = inferMediaCategory(file.name, file.type);

    newAssets.push({
      id: generateAssetId(),
      name: file.name,
      mediaType: category,
      mimeType: file.type || "",
      size: file.size,
      lastModified: file.lastModified,
      handleRefId,
    });
  }

  return newAssets;
}

/**
 * Resolves live accessibility status for an asset without opening a permission prompt automatically.
 */
export async function resolveAssetStatus(asset: ProjectAsset): Promise<LiveAssetItem> {
  // Check if it's a session-only fallback file
  if (asset.handleRefId.startsWith("session-")) {
    const file = sessionFileRegistry.get(asset.handleRefId);
    if (file) {
      return { asset, status: "session-only", file };
    }
    return {
      asset,
      status: "missing",
      errorMessage: "Session expired. Standard file input selections must be reselected after reload.",
    };
  }

  // Load handle from IndexedDB
  const handle = await loadFileHandle(asset.handleRefId);
  if (!handle) {
    return {
      asset,
      status: "missing",
      errorMessage: "File handle was not found in browser storage. Relinking is required.",
    };
  }

  // Check read permission without prompting
  if (typeof handle.queryPermission === "function") {
    try {
      const perm = await handle.queryPermission({ mode: "read" });
      if (perm === "prompt") {
        return { asset, status: "prompt-required" };
      }
      if (perm === "denied") {
        return { asset, status: "denied", errorMessage: "Permission to read this file was denied." };
      }
    } catch {
      // Ignore queryPermission errors and attempt getFile()
    }
  }

  // Permission is granted; verify file still exists
  try {
    const file = await handle.getFile();
    return { asset, status: "ready", file };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "NotFoundError") {
      return {
        asset,
        status: "missing",
        errorMessage: "Source file no longer exists at its original location.",
      };
    }
    if (err instanceof Error && err.name === "NotAllowedError") {
      return { asset, status: "prompt-required" };
    }
    return {
      asset,
      status: "missing",
      errorMessage: err instanceof Error ? err.message : "Unable to read source file.",
    };
  }
}

/**
 * Requests permission for a specific asset handle from an explicit user action.
 */
export async function authorizeAssetAccess(asset: ProjectAsset): Promise<LiveAssetItem> {
  const handle = await loadFileHandle(asset.handleRefId);
  if (!handle) {
    return {
      asset,
      status: "missing",
      errorMessage: "File handle not found in storage.",
    };
  }

  if (typeof handle.requestPermission === "function") {
    try {
      const perm = await handle.requestPermission({ mode: "read" });
      if (perm !== "granted") {
        return { asset, status: "denied", errorMessage: "User denied permission." };
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        return { asset, status: "denied" };
      }
      return { asset, status: "error" as unknown as LiveAssetItem["status"] };
    }
  }

  try {
    const file = await handle.getFile();
    return { asset, status: "ready", file };
  } catch (err) {
    return {
      asset,
      status: "missing",
      errorMessage: err instanceof Error ? err.message : "Could not open file.",
    };
  }
}

/**
 * Metadata comparison result for relinking.
 */
export interface RelinkComparison {
  match: boolean;
  nameDiffers: boolean;
  sizeDiffers: boolean;
  dateDiffers: boolean;
  original: { name: string; size: number; lastModified?: number };
  replacement: { name: string; size: number; lastModified?: number };
}

/**
 * Inspects a replacement file before relinking to compare against the original asset record.
 */
export function compareRelinkMetadata(asset: ProjectAsset, newFile: File): RelinkComparison {
  const nameDiffers = asset.name !== newFile.name;
  const sizeDiffers = asset.size !== newFile.size;
  const dateDiffers = asset.lastModified !== undefined && asset.lastModified !== newFile.lastModified;

  return {
    match: !nameDiffers && !sizeDiffers && !dateDiffers,
    nameDiffers,
    sizeDiffers,
    dateDiffers,
    original: {
      name: asset.name,
      size: asset.size,
      lastModified: asset.lastModified,
    },
    replacement: {
      name: newFile.name,
      size: newFile.size,
      lastModified: newFile.lastModified,
    },
  };
}

/**
 * Relinks an asset to a newly picked file handle.
 * Updates the handle in IndexedDB and updates the asset metadata.
 */
export async function relinkAssetHandle(
  asset: ProjectAsset,
  newHandle: FileSystemFileHandle,
  newFile: File
): Promise<ProjectAsset> {
  // Update handle in IndexedDB
  await saveFileHandle(asset.handleRefId, newHandle, {
    fileName: newFile.name,
    size: newFile.size,
    lastModified: newFile.lastModified,
  });

  return {
    ...asset,
    name: newFile.name,
    size: newFile.size,
    lastModified: newFile.lastModified,
    mediaType: inferMediaCategory(newFile.name, newFile.type),
    mimeType: newFile.type || asset.mimeType,
    metadata: undefined, // Clear metadata so relinked file is freshly inspected
  };
}

/**
 * Removes an asset reference.
 * Note: Never deletes the original source file on the user's computer.
 */
export async function removeAssetReference(handleRefId: string): Promise<void> {
  if (handleRefId.startsWith("session-")) {
    sessionFileRegistry.delete(handleRefId);
    return;
  }
  await removeFileHandle(handleRefId);
}
