import test from "node:test";
import assert from "node:assert/strict";
import {
  moveToTrash,
  listTrashedProjects,
  restoreFromTrash,
  permanentlyDeleteProject,
  emptyTrash,
} from "../src/lib/trash.ts";
import { createDefaultProject, serializeProjectDocument } from "../src/lib/projectValidation.ts";

function createMockWorkspaceWithFiles() {
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
                else if (data instanceof ArrayBuffer) buffer += new TextDecoder().decode(new Uint8Array(data));
              },
              close: async () => {
                files.set(filePath, { content: buffer, size: buffer.length });
              },
              abort: async () => {},
            };
          },
        };
      },
      removeEntry: async (name: string, opts?: { recursive?: boolean }) => {
        const targetPath = `${currentPath}/${name}`;
        const prefix = `${targetPath}/`;
        let removed = false;
        for (const k of Array.from(files.keys())) {
          if (k === targetPath || (opts?.recursive && k.startsWith(prefix))) {
            files.delete(k);
            removed = true;
          }
        }
        if (!removed && !files.has(targetPath)) {
          // If already gone, non-fatal
        }
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
                    getFile: async () => {
                      const entry = files.get(fullPath);
                      return {
                        name: firstSegment,
                        size: entry?.size || 0,
                        lastModified: Date.now(),
                        text: async () => entry?.content || "",
                        arrayBuffer: async () => new TextEncoder().encode(entry?.content || "").buffer,
                      };
                    },
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

test("moveToTrash safely moves project data to trash/ without touching original source media", async () => {
  const { workspaceHandle, files } = createMockWorkspaceWithFiles();
  const doc = createDefaultProject("Project To Trash");

  // Active project data
  files.set(`root/projects/${doc.id}/project.json`, {
    content: serializeProjectDocument(doc),
    size: 100,
  });
  files.set(`root/projects/${doc.id}/exports/export.mp4`, {
    content: "export-video-data",
    size: 500,
  });

  // Original source media referenced by user, located outside application folders
  files.set("root/my-media/footage.mp4", {
    content: "raw-camera-file",
    size: 20000,
  });

  // 1. Move to trash
  await moveToTrash(workspaceHandle, doc.id);

  // Active project folder no longer has the files
  assert.equal(files.has(`root/projects/${doc.id}/project.json`), false);
  assert.equal(files.has(`root/projects/${doc.id}/exports/export.mp4`), false);

  // Files now reside in trash/<projectId>/
  assert.equal(files.has(`root/trash/${doc.id}/project.json`), true);
  assert.equal(files.has(`root/trash/${doc.id}/exports/export.mp4`), true);

  // Original source file is untouched
  assert.equal(files.has("root/my-media/footage.mp4"), true);

  // 2. Listing trashed projects
  const trashed = await listTrashedProjects(workspaceHandle);
  assert.equal(trashed.length, 1);
  assert.equal(trashed[0].id, doc.id);
  assert.equal(trashed[0].name, "Project To Trash");

  // 3. Restore from trash
  const restoredDoc = await restoreFromTrash(workspaceHandle, doc.id);
  assert.equal(restoredDoc.id, doc.id);
  assert.equal(restoredDoc.name, "Project To Trash");

  // Verified restored to projects/<projectId>/
  assert.equal(files.has(`root/projects/${doc.id}/project.json`), true);
  assert.equal(files.has(`root/projects/${doc.id}/exports/export.mp4`), true);
  assert.equal(files.has(`root/trash/${doc.id}/project.json`), false);

  // 4. Move to trash again and permanently delete
  await moveToTrash(workspaceHandle, doc.id);
  assert.equal(files.has(`root/trash/${doc.id}/project.json`), true);

  await permanentlyDeleteProject(workspaceHandle, doc.id);
  assert.equal(files.has(`root/trash/${doc.id}/project.json`), false);
  assert.equal(files.has(`root/trash/${doc.id}/exports/export.mp4`), false);

  // Original source remains completely untouched!
  assert.equal(files.has("root/my-media/footage.mp4"), true);
});

test("emptyTrash permanently deletes multiple trashed projects", async () => {
  const { workspaceHandle, files } = createMockWorkspaceWithFiles();
  const doc1 = createDefaultProject("Trash 1");
  const doc2 = createDefaultProject("Trash 2");

  files.set(`root/projects/${doc1.id}/project.json`, { content: serializeProjectDocument(doc1), size: 100 });
  files.set(`root/projects/${doc2.id}/project.json`, { content: serializeProjectDocument(doc2), size: 100 });

  await moveToTrash(workspaceHandle, doc1.id);
  await moveToTrash(workspaceHandle, doc2.id);

  const beforeEmpty = await listTrashedProjects(workspaceHandle);
  assert.equal(beforeEmpty.length, 2);

  const cleared = await emptyTrash(workspaceHandle);
  assert.equal(cleared, 2);

  const afterEmpty = await listTrashedProjects(workspaceHandle);
  assert.equal(afterEmpty.length, 0);
});
