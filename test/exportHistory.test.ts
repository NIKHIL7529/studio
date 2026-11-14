import test from "node:test";
import assert from "node:assert/strict";
import {
  checkExportFileStatus,
  renameExport,
  deleteExport,
} from "../src/lib/export/history.ts";
import type { ProjectExport } from "../src/types/project.ts";

function createMockWorkspaceWithFiles() {
  const files = new Map<string, { content: string; size: number }>();

  function createDirHandle(currentPath: string): FileSystemDirectoryHandle {
    return {
      kind: "directory",
      name: currentPath.split("/").pop() || "",
      getDirectoryHandle: async (name: string) => {
        return createDirHandle(`${currentPath}/${name}`);
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
              stream: () => {
                const stream = new ReadableStream({
                  start(controller) {
                    controller.enqueue(new TextEncoder().encode(entry?.content || ""));
                    controller.close();
                  },
                });
                return stream;
              },
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
        files.delete(filePath);
      },
    } as unknown as FileSystemDirectoryHandle;
  }

  const workspaceHandle = createDirHandle("root");
  return { workspaceHandle, files };
}

test("checkExportFileStatus detects existing outputs and surfaces missing file state", async () => {
  const { workspaceHandle, files } = createMockWorkspaceWithFiles();
  const projectId = "a0000000-0000-4000-8000-000000000001";
  const existingName = "interview-1080p.mp4";
  const missingName = "deleted-by-user.mp4";

  files.set(`root/projects/${projectId}/exports/${existingName}`, {
    content: "dummy-video-data",
    size: 16,
  });

  // Check existing file
  const status1 = await checkExportFileStatus(workspaceHandle, projectId, existingName);
  assert.equal(status1.exists, true);
  assert.equal(status1.file?.size, 16);

  // Check missing file
  const status2 = await checkExportFileStatus(workspaceHandle, projectId, missingName);
  assert.equal(status2.exists, false);
  assert.ok(status2.error?.includes("Output file not found"));
});

test("renameExport renames file on disk and updates ProjectExport record", async () => {
  const { workspaceHandle, files } = createMockWorkspaceWithFiles();
  const projectId = "a0000000-0000-4000-8000-000000000001";
  const oldName = "initial-export.mp4";
  const exportId = "e0000000-0000-4000-8000-000000000001";

  files.set(`root/projects/${projectId}/exports/${oldName}`, {
    content: "mp4-stream-content",
    size: 18,
  });

  const exportRecord: ProjectExport = {
    id: exportId,
    name: oldName,
    relativePath: `projects/${projectId}/exports/${oldName}`,
    createdAt: new Date().toISOString(),
    settings: {
      targetAspectRatio: "16:9",
      width: 1920,
      height: 1080,
      frameRate: 30,
      videoCodec: "avc",
      format: "mp4",
    },
    duration: 5,
    width: 1920,
    height: 1080,
    fileSize: 18,
    status: "completed",
  };

  const { updatedExports, renamedExport } = await renameExport(
    workspaceHandle,
    projectId,
    exportId,
    [exportRecord],
    "final-cut"
  );

  assert.equal(renamedExport.name, "final-cut.mp4");
  assert.equal(renamedExport.relativePath, `projects/${projectId}/exports/final-cut.mp4`);
  assert.equal(updatedExports[0].name, "final-cut.mp4");

  // Verify file was renamed on disk
  assert.equal(files.has(`root/projects/${projectId}/exports/${oldName}`), false);
  assert.equal(files.has(`root/projects/${projectId}/exports/final-cut.mp4`), true);
});

test("deleteExport safely removes file from exports directory and updates history without touching sources", async () => {
  const { workspaceHandle, files } = createMockWorkspaceWithFiles();
  const projectId = "a0000000-0000-4000-8000-000000000001";
  const exportName = "to-be-deleted.mp4";
  const exportId = "e0000000-0000-4000-8000-000000000002";

  // Simulate export file on disk
  files.set(`root/projects/${projectId}/exports/${exportName}`, {
    content: "render-data",
    size: 11,
  });

  // Simulate original source media located elsewhere
  files.set("root/user-sources/original-video.mp4", {
    content: "valuable-original-media",
    size: 100,
  });

  const exportRecord: ProjectExport = {
    id: exportId,
    name: exportName,
    relativePath: `projects/${projectId}/exports/${exportName}`,
    createdAt: new Date().toISOString(),
    settings: {
      targetAspectRatio: "16:9",
      width: 1920,
      height: 1080,
      frameRate: 30,
      videoCodec: "avc",
      format: "mp4",
    },
    duration: 5,
    width: 1920,
    height: 1080,
    fileSize: 11,
    status: "completed",
  };

  const remaining = await deleteExport(
    workspaceHandle,
    projectId,
    exportId,
    [exportRecord],
    true
  );

  assert.equal(remaining.length, 0);

  // Export file was deleted
  assert.equal(files.has(`root/projects/${projectId}/exports/${exportName}`), false);

  // Original source media is strictly preserved untouched
  assert.equal(files.has("root/user-sources/original-video.mp4"), true);
});
