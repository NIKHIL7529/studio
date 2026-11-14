/**
 * Local cache persistence and lifecycle for repurposing analysis results (Phase 7).
 *
 * Rules:
 * - Stores compact analysis metadata and candidate results inside projects/<id>/cache/repurpose/.
 * - Never persists decoded video frames or full audio buffers.
 * - Cache key incorporates asset ID, bounded fingerprint/size, and algorithm version.
 * - Invalidation is explicit when source metadata, fingerprint, or algorithm changes.
 * - Integrates with Phase 6 lockCacheResource / unlockCacheResource during active writes.
 * - Fully protected by Phase 6 cache boundaries: original media, documents, and exports are untouched.
 */

import type { SourceAnalysisResult } from "../../types/repurpose.ts";
import { getProjectsDirectory, PROJECTS_DIR_NAME } from "../workspace.ts";
import { lockCacheResource, unlockCacheResource } from "../cache/cacheManager.ts";
import { ALGORITHM_VERSION_VIDEO } from "./frameSampling.ts";
import { ALGORITHM_VERSION_AUDIO } from "./audioAnalysis.ts";

export const REPURPOSE_COMBINED_ALGO_VERSION = `${ALGORITHM_VERSION_VIDEO}__${ALGORITHM_VERSION_AUDIO}`;

/**
 * Computes a stable cache file identifier for an asset's analysis.
 */
export function computeAnalysisCacheKey(
  assetId: string,
  fingerprint: string | undefined,
  size: number,
  lastModified?: number
): string {
  const fp = fingerprint ? fingerprint.slice(0, 16) : `sz${size}_lm${lastModified || 0}`;
  return `repurpose-analysis-${assetId.slice(0, 8)}-${fp}-${REPURPOSE_COMBINED_ALGO_VERSION}.json`;
}

/**
 * Ensures or retrieves the projects/<id>/cache/ directory handle.
 */
export async function getRepurposeCacheDirectory(
  workspaceHandle: FileSystemDirectoryHandle,
  projectId: string,
  create = false
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const projectsDir = await getProjectsDirectory(workspaceHandle, create);
    const projectDir = await projectsDir.getDirectoryHandle(projectId, { create });
    return await projectDir.getDirectoryHandle("cache", { create });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "NotFoundError" && !create) {
      return null;
    }
    throw err;
  }
}

/**
 * Reads cached analysis results for a source asset if valid.
 */
export async function readCachedAnalysis(
  workspaceHandle: FileSystemDirectoryHandle,
  projectId: string,
  assetId: string,
  fingerprint: string | undefined,
  size: number,
  lastModified?: number
): Promise<SourceAnalysisResult | null> {
  try {
    const cacheDir = await getRepurposeCacheDirectory(workspaceHandle, projectId, false);
    if (!cacheDir) return null;

    const cacheKey = computeAnalysisCacheKey(assetId, fingerprint, size, lastModified);
    const fileHandle = await cacheDir.getFileHandle(cacheKey, { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    const data = JSON.parse(text) as SourceAnalysisResult;

    // Validate algorithm version and asset identity match
    if (
      data &&
      data.assetId === assetId &&
      data.algorithmVersion === REPURPOSE_COMBINED_ALGO_VERSION &&
      Array.isArray(data.frameSignals) &&
      Array.isArray(data.audioSignals)
    ) {
      return data;
    }
  } catch {
    // Cache miss, unreadable, or invalid JSON
  }

  return null;
}

/**
 * Writes analysis result to projects/<id>/cache/repurpose/<cacheKey>.json.
 */
export async function writeCachedAnalysis(
  workspaceHandle: FileSystemDirectoryHandle,
  projectId: string,
  result: SourceAnalysisResult,
  size: number,
  lastModified?: number
): Promise<void> {
  try {
    const cacheDir = await getRepurposeCacheDirectory(workspaceHandle, projectId, true);
    if (!cacheDir) return;

    const cacheKey = computeAnalysisCacheKey(result.assetId, result.fingerprint, size, lastModified);
    const relPath = `${PROJECTS_DIR_NAME}/${projectId}/cache/${cacheKey}`;

    lockCacheResource(relPath);

    try {
      const fileHandle = await cacheDir.getFileHandle(cacheKey, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(result));
      await writable.close();
    } finally {
      unlockCacheResource(relPath);
    }
  } catch (err) {
    console.warn("Failed to persist analysis cache:", err);
  }
}
