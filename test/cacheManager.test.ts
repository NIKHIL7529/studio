import test from "node:test";
import assert from "node:assert/strict";
import {
  scanWorkspaceCache,
  cleanWorkspaceCache,
  lockCacheResource,
  unlockCacheResource,
} from "../src/lib/cache/cacheManager.ts";

function createMockWorkspaceWithFiles() {
  const files = new Map<string, { content: string; size: number }>();

  function createDirHandle(currentPath: string): FileSystemDirectoryHandle {
    return {
      kind: "directory",
      name: currentPath.split("/").pop() || "",
      getDirectoryHandle: async (name: string, opts?: { create?: boolean }) => {
        const subPath = `${currentPath}/${name}`;
        // If not creating and no files under subPath, throw NotFoundError
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
            };
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
              abort: async () => {},
            };
          },
        };
      },
      removeEntry: async (name: string) => {
        const filePath = `${currentPath}/${name}`;
        if (!files.has(filePath)) {
          const err = new Error(`File not found for removal: ${filePath}`);
          err.name = "NotFoundError";
          throw err;
        }
        files.delete(filePath);
      },
      async *[Symbol.asyncIterator]() {
        const prefix = `${currentPath}/`;
        const yielded = new Set<string>();
        for (const fullPath of files.keys()) {
          if (fullPath.startsWith(prefix)) {
            const remainder = fullPath.slice(prefix.length);
            const firstSegment = remainder.split("/")[0];
            if (!yielded.has(firstSegment)) {
              yielded.add(firstSegment);
              const isDir = remainder.includes("/");
              if (isDir) {
                yield [firstSegment, createDirHandle(`${currentPath}/${firstSegment}`)];
              } else {
                yield [
                  firstSegment,
                  {
                    kind: "file",
                    name: firstSegment,
                    getFile: async () => ({
                      name: firstSegment,
                      size: files.get(fullPath)?.size || 0,
                      lastModified: Date.now(),
                    }),
                  },
                ];
              }
            }
          }
        }
      },
    } as unknown as FileSystemDirectoryHandle;
  }

  const workspaceHandle = createDirHandle("root");
  return { workspaceHandle, files };
}

test("scanWorkspaceCache accurately catalogs derived, temporary, and orphaned entries", async () => {
  const { workspaceHandle, files } = createMockWorkspaceWithFiles();
  const projId = "a0000000-0000-4000-8000-000000000001";

  // 1. Durable files (must NOT be counted as cache)
  files.set(`root/projects/${projId}/project.json`, { content: '{"name":"test"}', size: 15 });
  files.set(`root/projects/${projId}/revisions/rev-1.json`, { content: '{"snapshot":1}', size: 20 });
  files.set(`root/projects/${projId}/exports/completed-video.mp4`, { content: "rendered-mp4", size: 1000 });

  // 2. Derived assets (projects/<id>/cache/)
  files.set(`root/projects/${projId}/cache/thumb-001.jpg`, { content: "thumbnail", size: 200 });
  files.set(`root/projects/${projId}/cache/waveform.dat`, { content: "waveform", size: 300 });

  // 3. Temporary files (incomplete render chunks and temp save files)
  files.set(`root/projects/${projId}/exports/.tmp_render_123.mp4`, { content: "incomplete-video", size: 500 });
  files.set(`root/projects/${projId}/.tmp_save_abc.json`, { content: "temp-save", size: 100 });

  // 4. Orphaned cache in root .cache/
  files.set("root/.cache/stale-preview.dat", { content: "orphan", size: 150 });

  const report = await scanWorkspaceCache(workspaceHandle);

  assert.equal(report.derivedCount, 3); // 2 in project cache + 1 in root .cache
  assert.equal(report.derivedBytes, 650); // 200 + 300 + 150
  assert.equal(report.temporaryCount, 2); // .tmp_render + .tmp_save
  assert.equal(report.temporaryBytes, 600); // 500 + 100
  assert.equal(report.orphanedCount, 1);
  assert.equal(report.orphanedBytes, 150);
  assert.equal(report.totalBytes, 1250);
  assert.equal(report.reclaimableBytes, 1250);
});

test("cleanWorkspaceCache supports dry run and strictly protects durable user data", async () => {
  const { workspaceHandle, files } = createMockWorkspaceWithFiles();
  const projId = "a0000000-0000-4000-8000-000000000001";

  // Durable files
  files.set(`root/projects/${projId}/project.json`, { content: '{"name":"test"}', size: 15 });
  files.set(`root/projects/${projId}/revisions/rev-1.json`, { content: '{"snapshot":1}', size: 20 });
  files.set(`root/projects/${projId}/exports/my-precious-output.mp4`, { content: "final-video", size: 5000 });

  // Disposable files
  files.set(`root/projects/${projId}/cache/thumb.jpg`, { content: "thumb", size: 250 });
  files.set(`root/projects/${projId}/exports/.tmp_abandoned.mp4`, { content: "abandoned", size: 400 });

  // 1. Dry run
  const dryResult = await cleanWorkspaceCache(workspaceHandle, { dryRun: true });
  assert.equal(dryResult.dryRun, true);
  assert.equal(dryResult.deletedCount, 2);
  assert.equal(dryResult.reclaimedBytes, 650);

  // Files still exist after dry run
  assert.equal(files.has(`root/projects/${projId}/cache/thumb.jpg`), true);
  assert.equal(files.has(`root/projects/${projId}/exports/.tmp_abandoned.mp4`), true);

  // 2. Real cleanup
  const realResult = await cleanWorkspaceCache(workspaceHandle, { dryRun: false });
  assert.equal(realResult.dryRun, false);
  assert.equal(realResult.deletedCount, 2);
  assert.equal(realResult.reclaimedBytes, 650);

  // Disposable files deleted
  assert.equal(files.has(`root/projects/${projId}/cache/thumb.jpg`), false);
  assert.equal(files.has(`root/projects/${projId}/exports/.tmp_abandoned.mp4`), false);

  // CRITICAL: Durable files must remain untouched!
  assert.equal(files.has(`root/projects/${projId}/project.json`), true);
  assert.equal(files.has(`root/projects/${projId}/revisions/rev-1.json`), true);
  assert.equal(files.has(`root/projects/${projId}/exports/my-precious-output.mp4`), true);
});

test("cleanWorkspaceCache skips resources currently locked in-use", async () => {
  const { workspaceHandle, files } = createMockWorkspaceWithFiles();
  const projId = "a0000000-0000-4000-8000-000000000001";
  const lockedPath = `projects/${projId}/exports/.tmp_rendering.mp4`;

  files.set(`root/${lockedPath}`, { content: "actively-writing-data", size: 800 });
  files.set(`root/projects/${projId}/cache/old.dat`, { content: "old-data", size: 200 });

  // Acquire active lock
  lockCacheResource(lockedPath);

  try {
    const report = await scanWorkspaceCache(workspaceHandle);
    assert.equal(report.inUseCount, 1);
    assert.equal(report.reclaimableBytes, 200);

    const cleanup = await cleanWorkspaceCache(workspaceHandle);
    assert.equal(cleanup.deletedCount, 1); // only old.dat deleted
    assert.equal(cleanup.skippedFiles.length, 1);
    assert.ok(cleanup.skippedFiles[0].reason.includes("active task"));

    // Locked file remains on disk
    assert.equal(files.has(`root/${lockedPath}`), true);
    assert.equal(files.has(`root/projects/${projId}/cache/old.dat`), false);
  } finally {
    unlockCacheResource(lockedPath);
  }
});

test("cleanWorkspaceCache is idempotent and safe to retry", async () => {
  const { workspaceHandle, files } = createMockWorkspaceWithFiles();
  const projId = "a0000000-0000-4000-8000-000000000001";

  files.set(`root/projects/${projId}/cache/thumb.jpg`, { content: "thumb", size: 100 });

  const run1 = await cleanWorkspaceCache(workspaceHandle);
  assert.equal(run1.deletedCount, 1);

  // Second run on clean workspace: no errors, 0 deleted
  const run2 = await cleanWorkspaceCache(workspaceHandle);
  assert.equal(run2.deletedCount, 0);
  assert.equal(run2.reclaimedBytes, 0);
  assert.equal(run2.skippedFiles.length, 0);
});
