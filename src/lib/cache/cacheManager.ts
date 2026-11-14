/**
 * Local cache inventory and lifecycle management (Phase 6).
 *
 * Distinguishes 5 storage categories:
 * 1. Original source media: User-owned files at original locations. NEVER treated as cache.
 * 2. Project documents and revisions: Durable user data. NEVER treated as cache.
 * 3. Completed exports: Durable user outputs. NEVER treated as cache.
 * 4. Regenerable derived assets: Thumbnails, waveforms, preview proxies in projects/<id>/cache/.
 * 5. Temporary processing files: Incomplete render chunks (.tmp_*), abandoned scratch files.
 *
 * Rules:
 * - Scans ONLY application-owned folders (projects/<id>/cache/, projects/<id>/.tmp_*, projects/<id>/exports/.tmp_*).
 * - Tracks active locks so in-use files are never deleted during active playback, preview or export.
 * - Supports dry-run preview before destructive cleanup.
 * - Completely idempotent and safe to retry.
 */

import { isValidUuid } from "../projectValidation.ts";
import { getProjectsDirectory, PROJECTS_DIR_NAME } from "../workspace.ts";

export type CacheCategory = "derived" | "temporary";

export interface CacheEntry {
  /** Relative path within workspace (e.g. "projects/<id>/cache/waveform.dat") */
  relativePath: string;
  category: CacheCategory;
  sizeBytes: number;
  lastModified?: number;
  projectId?: string;
  isOrphaned: boolean;
  isInUse: boolean;
}

export interface CacheInventoryReport {
  totalBytes: number;
  reclaimableBytes: number;
  derivedCount: number;
  derivedBytes: number;
  temporaryCount: number;
  temporaryBytes: number;
  orphanedCount: number;
  orphanedBytes: number;
  inUseCount: number;
  entries: CacheEntry[];
}

export interface CacheCleanupOptions {
  categories?: CacheCategory[];
  cleanOrphans?: boolean;
  dryRun?: boolean;
  projectIds?: string[];
}

export interface CacheCleanupResult {
  dryRun: boolean;
  deletedCount: number;
  reclaimedBytes: number;
  deletedFiles: { path: string; category: CacheCategory; bytes: number }[];
  skippedFiles: { path: string; reason: string }[];
}

// Global active lock registry for in-use assets / operations
const activeLocks = new Set<string>();

/**
 * Registers an active lock on a path or resource ID, preventing cleanup while active.
 */
export function lockCacheResource(resourceKey: string): void {
  activeLocks.add(resourceKey);
}

/**
 * Releases an active lock.
 */
export function unlockCacheResource(resourceKey: string): void {
  activeLocks.delete(resourceKey);
}

/**
 * Checks if a path or resource key is currently locked.
 */
export function isCacheResourceLocked(resourceKey: string): boolean {
  for (const lock of activeLocks) {
    if (resourceKey === lock || resourceKey.startsWith(lock + "/") || lock.startsWith(resourceKey + "/")) {
      return true;
    }
  }
  return false;
}

/**
 * Scans application-managed directories in the workspace to catalog all disposable cache entries.
 */
export async function scanWorkspaceCache(
  workspaceHandle: FileSystemDirectoryHandle,
  targetProjectIds?: string[]
): Promise<CacheInventoryReport> {
  const entries: CacheEntry[] = [];

  let projectsDir: FileSystemDirectoryHandle;
  try {
    projectsDir = await getProjectsDirectory(workspaceHandle, false);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "NotFoundError") {
      return emptyReport();
    }
    throw err;
  }

  // Collect all known project UUIDs
  const knownProjectIds = new Set<string>();
  const projectEntries: [string, FileSystemDirectoryHandle][] = [];

  for await (const [name, handle] of (projectsDir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    if (handle.kind === "directory" && isValidUuid(name)) {
      knownProjectIds.add(name);
      projectEntries.push([name, handle as FileSystemDirectoryHandle]);
    }
  }

  for (const [projectId, projectDir] of projectEntries) {
    if (targetProjectIds && !targetProjectIds.includes(projectId)) {
      continue;
    }

    // 1. Scan projects/<projectId>/cache/ (Category: "derived")
    try {
      const cacheDir = await projectDir.getDirectoryHandle("cache", { create: false });
      for await (const [cacheFileName, cacheFileHandle] of (cacheDir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
        if (cacheFileHandle.kind === "file") {
          try {
            const file = await (cacheFileHandle as FileSystemFileHandle).getFile();
            const relPath = `${PROJECTS_DIR_NAME}/${projectId}/cache/${cacheFileName}`;
            const inUse = isCacheResourceLocked(relPath);

            entries.push({
              relativePath: relPath,
              category: "derived",
              sizeBytes: file.size,
              lastModified: file.lastModified,
              projectId,
              isOrphaned: false,
              isInUse: inUse,
            });
          } catch {
            // Ignore unreadable file
          }
        }
      }
    } catch {
      // cache directory does not exist for this project
    }

    // 2. Scan projects/<projectId>/ for temporary files starting with .tmp_ (Category: "temporary")
    try {
      for await (const [fileName, fileHandle] of (projectDir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
        if (fileHandle.kind === "file" && fileName.startsWith(".tmp_")) {
          try {
            const file = await (fileHandle as FileSystemFileHandle).getFile();
            const relPath = `${PROJECTS_DIR_NAME}/${projectId}/${fileName}`;
            const inUse = isCacheResourceLocked(relPath);

            entries.push({
              relativePath: relPath,
              category: "temporary",
              sizeBytes: file.size,
              lastModified: file.lastModified,
              projectId,
              isOrphaned: false,
              isInUse: inUse,
            });
          } catch {}
        }
      }
    } catch {}

    // 3. Scan projects/<projectId>/exports/ for abandoned temporary files starting with .tmp_ (Category: "temporary")
    try {
      const exportsDir = await projectDir.getDirectoryHandle("exports", { create: false });
      for await (const [expFileName, expFileHandle] of (exportsDir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
        if (expFileHandle.kind === "file" && (expFileName.startsWith(".tmp_") || expFileName.startsWith(".temp_"))) {
          try {
            const file = await (expFileHandle as FileSystemFileHandle).getFile();
            const relPath = `${PROJECTS_DIR_NAME}/${projectId}/exports/${expFileName}`;
            const inUse = isCacheResourceLocked(relPath);

            entries.push({
              relativePath: relPath,
              category: "temporary",
              sizeBytes: file.size,
              lastModified: file.lastModified,
              projectId,
              isOrphaned: false,
              isInUse: inUse,
            });
          } catch {}
        }
      }
    } catch {}
  }

  // 4. Scan for root .cache/ or orphaned project cache if present
  try {
    const rootCacheDir = await workspaceHandle.getDirectoryHandle(".cache", { create: false });
    for await (const [orphName, orphHandle] of (rootCacheDir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
      if (orphHandle.kind === "file") {
        try {
          const file = await (orphHandle as FileSystemFileHandle).getFile();
          entries.push({
            relativePath: `.cache/${orphName}`,
            category: "derived",
            sizeBytes: file.size,
            lastModified: file.lastModified,
            isOrphaned: true,
            isInUse: false,
          });
        } catch {}
      }
    }
  } catch {}

  // Compute aggregations
  let derivedCount = 0;
  let derivedBytes = 0;
  let temporaryCount = 0;
  let temporaryBytes = 0;
  let orphanedCount = 0;
  let orphanedBytes = 0;
  let inUseCount = 0;
  let reclaimableBytes = 0;
  let totalBytes = 0;

  for (const entry of entries) {
    totalBytes += entry.sizeBytes;

    if (entry.category === "derived") {
      derivedCount++;
      derivedBytes += entry.sizeBytes;
    } else {
      temporaryCount++;
      temporaryBytes += entry.sizeBytes;
    }

    if (entry.isOrphaned) {
      orphanedCount++;
      orphanedBytes += entry.sizeBytes;
    }

    if (entry.isInUse) {
      inUseCount++;
    } else {
      reclaimableBytes += entry.sizeBytes;
    }
  }

  return {
    totalBytes,
    reclaimableBytes,
    derivedCount,
    derivedBytes,
    temporaryCount,
    temporaryBytes,
    orphanedCount,
    orphanedBytes,
    inUseCount,
    entries,
  };
}

/**
 * Safely cleans eligible cache and temporary files.
 * Strictly guarantees that project documents, revisions, and completed exports are never removed.
 */
export async function cleanWorkspaceCache(
  workspaceHandle: FileSystemDirectoryHandle,
  options: CacheCleanupOptions = {}
): Promise<CacheCleanupResult> {
  const {
    categories = ["derived", "temporary"],
    cleanOrphans = true,
    dryRun = false,
    projectIds,
  } = options;

  const inventory = await scanWorkspaceCache(workspaceHandle, projectIds);

  const deletedFiles: { path: string; category: CacheCategory; bytes: number }[] = [];
  const skippedFiles: { path: string; reason: string }[] = [];
  let reclaimedBytes = 0;

  for (const entry of inventory.entries) {
    // Check if category is enabled for cleanup
    if (!categories.includes(entry.category)) {
      continue;
    }

    // Skip if orphans disabled and entry is orphaned
    if (!cleanOrphans && entry.isOrphaned) {
      continue;
    }

    // Protection rule 1: In-use lock
    if (entry.isInUse) {
      skippedFiles.push({ path: entry.relativePath, reason: "Resource currently in use by an active task." });
      continue;
    }

    // Protection rule 2: Strict path verification to avoid deleting user data
    const isSafeDerived = entry.relativePath.includes("/cache/") || entry.relativePath.startsWith(".cache/");
    const isSafeTemp = entry.relativePath.includes("/.tmp_") || entry.relativePath.includes("/.temp_");

    if (!isSafeDerived && !isSafeTemp) {
      skippedFiles.push({ path: entry.relativePath, reason: "Path does not match verified disposable cache pattern." });
      continue;
    }

    // Dry-run mode: record eligibility without deleting
    if (dryRun) {
      deletedFiles.push({
        path: entry.relativePath,
        category: entry.category,
        bytes: entry.sizeBytes,
      });
      reclaimedBytes += entry.sizeBytes;
      continue;
    }

    // Actual deletion
    try {
      await removeFileByRelativePath(workspaceHandle, entry.relativePath);
      deletedFiles.push({
        path: entry.relativePath,
        category: entry.category,
        bytes: entry.sizeBytes,
      });
      reclaimedBytes += entry.sizeBytes;
    } catch (err: unknown) {
      skippedFiles.push({
        path: entry.relativePath,
        reason: err instanceof Error ? err.message : "Filesystem deletion error",
      });
    }
  }

  return {
    dryRun,
    deletedCount: deletedFiles.length,
    reclaimedBytes,
    deletedFiles,
    skippedFiles,
  };
}

/**
 * Traverses directory hierarchy to safely remove a specific file entry.
 */
async function removeFileByRelativePath(
  workspaceHandle: FileSystemDirectoryHandle,
  relativePath: string
): Promise<void> {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length === 0) return;

  const fileName = parts.pop()!;
  let currentDir = workspaceHandle;

  for (const dirName of parts) {
    currentDir = await currentDir.getDirectoryHandle(dirName, { create: false });
  }

  await currentDir.removeEntry(fileName);
}

function emptyReport(): CacheInventoryReport {
  return {
    totalBytes: 0,
    reclaimableBytes: 0,
    derivedCount: 0,
    derivedBytes: 0,
    temporaryCount: 0,
    temporaryBytes: 0,
    orphanedCount: 0,
    orphanedBytes: 0,
    inUseCount: 0,
    entries: [],
  };
}
