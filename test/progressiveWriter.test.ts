import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeExportFilename,
  findAvailableFilename,
  createMemoryFallbackWriter,
  createWorkspaceProgressiveWriter,
} from "../src/lib/export/progressiveWriter.ts";

describe("Progressive Writer & File Safety", () => {
  test("sanitizeExportFilename cleans dangerous characters and enforces extension", () => {
    assert.equal(sanitizeExportFilename("my-video.mp4"), "my-video.mp4");
    assert.equal(sanitizeExportFilename("my/video:name*.mp4"), "video_name_.mp4");
    assert.equal(sanitizeExportFilename("../../etc/passwd"), "passwd.mp4");
    assert.equal(sanitizeExportFilename("clean-webm.webm"), "clean-webm.webm");
    assert.equal(sanitizeExportFilename("no-ext"), "no-ext.mp4");
  });

  test("findAvailableFilename avoids overwriting existing files", async () => {
    const existingFiles = new Set(["video.mp4", "video (1).mp4"]);

    const mockExportsDir = {
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        if (existingFiles.has(name)) {
          return {}; // exists
        }
        if (!options?.create) {
          const err = new Error("File not found");
          err.name = "NotFoundError";
          throw err;
        }
        return {};
      },
    } as unknown as FileSystemDirectoryHandle;

    const chosenName = await findAvailableFilename(mockExportsDir, "video.mp4");
    assert.equal(chosenName, "video (2).mp4");
  });

  test("MemoryFallbackWriter creates and finalizes output File", async () => {
    const writer = createMemoryFallbackWriter("test-output.mp4");
    assert.equal(writer.targetType, "memory-fallback");
    assert.equal(writer.finalFilename, "test-output.mp4");

    // Simulate Mediabunny writing into buffer
    (writer.target as unknown as { buffer: ArrayBuffer }).buffer = new Uint8Array([1, 2, 3, 4]).buffer;

    const file = await writer.finalize();
    assert.equal(file.name, "test-output.mp4");
    assert.equal(file.size, 4);

    // Cannot finalize twice
    await assert.rejects(async () => {
      await writer.finalize();
    }, /already been closed/);
  });

  test("MemoryFallbackWriter rejects zero-byte output", async () => {
    const writer = createMemoryFallbackWriter("empty.mp4");
    await assert.rejects(async () => {
      await writer.finalize();
    }, /empty/);
  });

  test("MemoryFallbackWriter abort clears buffer", async () => {
    const writer = createMemoryFallbackWriter("aborted.mp4");
    (writer.target as unknown as { buffer: ArrayBuffer }).buffer = new Uint8Array([1, 2, 3]).buffer;

    await writer.abort();
    assert.equal((writer.target as unknown as { buffer: ArrayBuffer | null }).buffer, null);
  });

  test("WorkspaceProgressiveWriter staged write and promotion lifecycle", async () => {
    const createdFiles = new Map<string, Uint8Array>();
    const removedFiles = new Set<string>();

    const mockFileHandle = (filename: string) => ({
      getFile: async () => new File([(createdFiles.get(filename) || new Uint8Array([1, 2, 3])).buffer as ArrayBuffer], filename),
      createWritable: async () =>
        new WritableStream({
          write(chunk) {
            createdFiles.set(filename, chunk);
          },
          close() {},
          abort() {},
        }),
    });

    const mockExportsDir = {
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        if (!options?.create && !createdFiles.has(name)) {
          const err = new Error("File not found");
          err.name = "NotFoundError";
          throw err;
        }
        return mockFileHandle(name);
      },
      removeEntry: async (name: string) => {
        removedFiles.add(name);
        createdFiles.delete(name);
      },
    };

    const mockProjectsDir = {
      getDirectoryHandle: async () => ({
        getDirectoryHandle: async () => mockExportsDir,
      }),
    };

    const mockWorkspace = {
      getDirectoryHandle: async () => mockProjectsDir,
    } as unknown as FileSystemDirectoryHandle;

    const writer = await createWorkspaceProgressiveWriter({
      workspaceHandle: mockWorkspace,
      projectId: "proj-123",
      preferredFilename: "final-video.mp4",
    });

    assert.equal(writer.targetType, "filesystem-stream");
    assert.equal(writer.finalFilename, "final-video.mp4");
    assert.equal(writer.relativePath, "projects/proj-123/exports/final-video.mp4");

    const file = await writer.finalize();
    assert.equal(file.name, "final-video.mp4");
  });

  test("WorkspaceProgressiveWriter abort cleans up temporary file", async () => {
    const removedFiles = new Set<string>();
    let tempNameCreated = "";

    const mockExportsDir = {
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        if (!options?.create) {
          const err = new Error("File not found");
          err.name = "NotFoundError";
          throw err;
        }
        tempNameCreated = name;
        return {
          getFile: async () => new File([], name),
          createWritable: async () =>
            new WritableStream({
              write() {},
              close() {},
              abort() {},
            }),
        };
      },
      removeEntry: async (name: string) => {
        removedFiles.add(name);
      },
    };

    const mockWorkspace = {
      getDirectoryHandle: async () => ({
        getDirectoryHandle: async () => ({
          getDirectoryHandle: async () => mockExportsDir,
        }),
      }),
    } as unknown as FileSystemDirectoryHandle;

    const writer = await createWorkspaceProgressiveWriter({
      workspaceHandle: mockWorkspace,
      projectId: "proj-123",
      preferredFilename: "aborted-video.mp4",
    });

    await writer.abort();
    assert.ok(tempNameCreated.startsWith(".tmp_"));
    assert.ok(removedFiles.has(tempNameCreated));
  });
});
