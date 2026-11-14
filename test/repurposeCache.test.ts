import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeAnalysisCacheKey,
  readCachedAnalysis,
  writeCachedAnalysis,
  REPURPOSE_COMBINED_ALGO_VERSION,
} from "../src/lib/repurpose/cache.ts";
import { scanWorkspaceCache } from "../src/lib/cache/cacheManager.ts";
import type { SourceAnalysisResult } from "../src/types/repurpose.ts";

function createMockWorkspace() {
  const files = new Map<string, { content: string; size: number }>();

  function createDirHandle(currentPath: string): FileSystemDirectoryHandle {
    return {
      kind: "directory",
      name: currentPath.split("/").pop() || "",
      getDirectoryHandle: async (name: string, opts?: { create?: boolean }) => {
        const subPath = `${currentPath}/${name}`;
        if (!opts?.create) {
          const prefix = `${subPath}/`;
          let hasChild = false;
          for (const k of files.keys()) {
            if (k.startsWith(prefix) || k === subPath) {
              hasChild = true;
              break;
            }
          }
          if (!hasChild) {
            const err = new Error(`Directory not found: ${subPath}`);
            err.name = "NotFoundError";
            throw err;
          }
        }
        return createDirHandle(subPath);
      },
      getFileHandle: async (name: string, opts?: { create?: boolean }) => {
        const filePath = `${currentPath}/${name}`;
        if (!files.has(filePath) && !opts?.create) {
          const err = new Error(`File not found: ${filePath}`);
          err.name = "NotFoundError";
          throw err;
        }
        return {
          kind: "file",
          name,
          getFile: async () => {
            const entry = files.get(filePath);
            return {
              name,
              size: entry ? entry.size : 0,
              lastModified: Date.now(),
              text: async () => entry?.content || "",
            } as unknown as File;
          },
          createWritable: async () => {
            let buffer = "";
            return {
              write: async (data: unknown) => {
                if (typeof data === "string") buffer += data;
                else if (data instanceof Uint8Array) buffer += new TextDecoder().decode(data);
              },
              close: async () => {
                files.set(filePath, { content: buffer, size: buffer.length });
              },
            } as unknown as FileSystemWritableFileStream;
          },
        } as unknown as FileSystemFileHandle;
      },
      removeEntry: async (name: string) => {
        const filePath = `${currentPath}/${name}`;
        files.delete(filePath);
      },
      async *[Symbol.asyncIterator]() {
        const prefix = `${currentPath}/`;
        const subItems = new Set<string>();
        for (const k of files.keys()) {
          if (k.startsWith(prefix)) {
            const rel = k.slice(prefix.length);
            const firstSeg = rel.split("/")[0];
            subItems.add(firstSeg);
          }
        }
        for (const item of subItems) {
          const isDir = Array.from(files.keys()).some((k) => k.startsWith(`${prefix}${item}/`));
          if (isDir) {
            yield [item, createDirHandle(`${prefix}${item}`)] as [string, FileSystemHandle];
          } else {
            const fileHandle = {
              kind: "file",
              name: item,
              getFile: async () => {
                const entry = files.get(`${prefix}${item}`);
                return {
                  name: item,
                  size: entry?.size || 0,
                  lastModified: Date.now(),
                  text: async () => entry?.content || "",
                };
              },
            };
            yield [item, fileHandle as unknown as FileSystemHandle] as [string, FileSystemHandle];
          }
        }
      },
    } as unknown as FileSystemDirectoryHandle;
  }

  return { rootHandle: createDirHandle(""), files };
}

describe("Repurpose Cache Lifecycle & Invalidation", () => {
  const projectId = "c0000000-0000-4000-8000-000000000001";
  const assetId = "a0000000-0000-4000-8000-000000000001";

  test("computeAnalysisCacheKey includes asset ID, fingerprint, and combined algorithm version", () => {
    const key1 = computeAnalysisCacheKey(assetId, "fingerprint1234567890", 100000, 1700000000);
    const key2 = computeAnalysisCacheKey(assetId, "fingerprint1234567890", 100000, 1700000000);
    const keyDifferentFp = computeAnalysisCacheKey(assetId, "differentfp000000000", 100000, 1700000000);

    assert.equal(key1, key2, "Identical source parameters produce identical cache keys");
    assert.notEqual(key1, keyDifferentFp, "Different fingerprint produces distinct cache key");
    assert.ok(key1.includes(REPURPOSE_COMBINED_ALGO_VERSION), "Includes algorithm version");
  });

  test("writes and reads cached analysis roundtrip", async () => {
    const { rootHandle } = createMockWorkspace();

    const analysisData: SourceAnalysisResult = {
      assetId,
      assetName: "interview.mp4",
      fingerprint: "fp123456",
      duration: 30.0,
      hasVideo: true,
      hasAudio: true,
      frameSignals: [{ timestamp: 0, luminanceDiff: 0, colorHistDiff: 0, visualDiff: 0, isSceneCutCandidate: false }],
      audioSignals: [{ timestamp: 0, rms: 0.2, isSilence: false, isSpeechLikeActivity: true, isTransient: false }],
      sceneCutTimes: [10.0],
      silenceIntervals: [{ start: 9.0, end: 11.0 }],
      speechActivityIntervals: [{ start: 0, end: 9.0 }],
      algorithmVersion: REPURPOSE_COMBINED_ALGO_VERSION,
      sampledAt: new Date().toISOString(),
    };

    // Initial read should return null (miss)
    const miss = await readCachedAnalysis(rootHandle, projectId, assetId, "fp123456", 50000, 1700000000);
    assert.equal(miss, null);

    // Write to cache
    await writeCachedAnalysis(rootHandle, projectId, analysisData, 50000, 1700000000);

    // Subsequent read should hit and restore data
    const hit = await readCachedAnalysis(rootHandle, projectId, assetId, "fp123456", 50000, 1700000000);
    assert.ok(hit !== null);
    assert.equal(hit.assetId, assetId);
    assert.equal(hit.duration, 30.0);
    assert.equal(hit.frameSignals.length, 1);
    assert.equal(hit.audioSignals.length, 1);
  });

  test("cache invalidation: modified file size or fingerprint misses old cache", async () => {
    const { rootHandle } = createMockWorkspace();

    const analysisData: SourceAnalysisResult = {
      assetId,
      assetName: "interview.mp4",
      fingerprint: "fp_original",
      duration: 30.0,
      hasVideo: true,
      hasAudio: false,
      frameSignals: [],
      audioSignals: [],
      sceneCutTimes: [],
      silenceIntervals: [],
      speechActivityIntervals: [],
      algorithmVersion: REPURPOSE_COMBINED_ALGO_VERSION,
      sampledAt: new Date().toISOString(),
    };

    await writeCachedAnalysis(rootHandle, projectId, analysisData, 50000, 1700000000);

    // Reading with changed fingerprint should return null
    const missChangedFp = await readCachedAnalysis(rootHandle, projectId, assetId, "fp_modified", 50000, 1700000000);
    assert.equal(missChangedFp, null);
  });

  test("scanWorkspaceCache accurately catalogs repurpose cache as derived regenerable data", async () => {
    const { rootHandle, files } = createMockWorkspace();

    // Seed dummy project.json
    files.set(`projects/${projectId}/project.json`, { content: "{}", size: 100 });

    const analysisData: SourceAnalysisResult = {
      assetId,
      assetName: "interview.mp4",
      fingerprint: "fp_test",
      duration: 20.0,
      hasVideo: true,
      hasAudio: true,
      frameSignals: [],
      audioSignals: [],
      sceneCutTimes: [],
      silenceIntervals: [],
      speechActivityIntervals: [],
      algorithmVersion: REPURPOSE_COMBINED_ALGO_VERSION,
      sampledAt: new Date().toISOString(),
    };

    await writeCachedAnalysis(rootHandle, projectId, analysisData, 40000, 1700000000);

    const report = await scanWorkspaceCache(rootHandle, [projectId]);
    assert.ok(report.derivedCount > 0, "Repurpose cache is detected under derived category");
    assert.ok(report.derivedBytes > 0);
  });
});
