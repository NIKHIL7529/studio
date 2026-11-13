import test from "node:test";
import assert from "node:assert/strict";
import {
  listProjects,
  readProject,
  writeProject,
  deleteProject,
} from "../src/lib/workspace.ts";
import { createDefaultProject, serializeProjectDocument } from "../src/lib/projectValidation.ts";

test("listProjects correctly enumerates projects and handles corrupted entries without failing", async () => {
  const validDoc = createDefaultProject("Valid Project 1");
  const corruptUuid = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";

  // Mock directory and file structure
  const filesMap = new Map<string, string>();
  filesMap.set(`projects/${validDoc.id}/project.json`, serializeProjectDocument(validDoc));
  filesMap.set(`projects/${corruptUuid}/project.json`, "{ malformed json ");

  const mockProjectsDirHandle = {
    kind: "directory",
    name: "projects",
    getFileHandle: async () => {
      throw new Error("Not implemented");
    },
    getDirectoryHandle: async (dirName: string) => {
      return {
        kind: "directory",
        name: dirName,
        getFileHandle: async (fileName: string) => {
          const path = `projects/${dirName}/${fileName}`;
          if (!filesMap.has(path)) {
            const err = new Error("File not found");
            err.name = "NotFoundError";
            throw err;
          }
          const content = filesMap.get(path)!;
          return {
            kind: "file",
            name: fileName,
            getFile: async () => ({
              text: async () => content,
              lastModified: Date.now(),
            }),
          };
        },
      };
    },
    // Async iterator for entries in projects/
    async *[Symbol.asyncIterator]() {
      yield [
        validDoc.id,
        {
          kind: "directory",
          name: validDoc.id,
          getFileHandle: async (fileName: string) => ({
            kind: "file",
            name: fileName,
            getFile: async () => ({
              text: async () => filesMap.get(`projects/${validDoc.id}/${fileName}`)!,
              lastModified: Date.now(),
            }),
          }),
        },
      ];
      yield [
        corruptUuid,
        {
          kind: "directory",
          name: corruptUuid,
          getFileHandle: async (fileName: string) => ({
            kind: "file",
            name: fileName,
            getFile: async () => ({
              text: async () => filesMap.get(`projects/${corruptUuid}/${fileName}`)!,
              lastModified: Date.now(),
            }),
          }),
        },
      ];
      // An unrelated folder that is not a UUID should be skipped
      yield [
        "unrelated-folder",
        {
          kind: "directory",
          name: "unrelated-folder",
        },
      ];
    },
  };

  const mockWorkspaceHandle = {
    kind: "directory",
    name: "WorkspaceRoot",
    getDirectoryHandle: async (dirName: string) => {
      if (dirName === "projects") return mockProjectsDirHandle;
      throw new Error("Unexpected directory");
    },
  } as unknown as FileSystemDirectoryHandle;

  const summaries = await listProjects(mockWorkspaceHandle);
  assert.equal(summaries.length, 2);

  const validSummary = summaries.find((s) => s.id === validDoc.id);
  assert.ok(validSummary);
  assert.equal(validSummary.valid, true);
  assert.equal(validSummary.name, "Valid Project 1");

  const corruptSummary = summaries.find((s) => s.id === corruptUuid);
  assert.ok(corruptSummary);
  assert.equal(corruptSummary.valid, false);
  assert.ok(corruptSummary.error?.includes("JSON syntax error"));
});

test("readProject, writeProject, and deleteProject execute safe project lifecycle operations", async () => {
  const doc = createDefaultProject("Lifecycle Project");
  let writtenData: string | null = null;
  let deletedTarget: string | null = null;

  const mockWorkspaceHandle = {
    name: "WorkspaceRoot",
    getDirectoryHandle: async (dirName: string) => {
      assert.equal(dirName, "projects");
      return {
        name: "projects",
        getDirectoryHandle: async (projId: string) => {
          assert.equal(projId, doc.id);
          return {
            name: projId,
            getFileHandle: async (fileName: string) => {
              assert.equal(fileName, "project.json");
              return {
                name: fileName,
                getFile: async () => ({
                  text: async () => writtenData || serializeProjectDocument(doc),
                  lastModified: Date.now(),
                }),
                createWritable: async () => ({
                  write: async (data: string) => {
                    writtenData = data;
                  },
                  close: async () => {},
                  abort: async () => {},
                }),
              };
            },
          };
        },
        removeEntry: async (entryName: string, opts?: { recursive?: boolean }) => {
          deletedTarget = entryName;
          assert.equal(opts?.recursive, true);
        },
      };
    },
  } as unknown as FileSystemDirectoryHandle;

  // Write project
  const updatedDoc = await writeProject(mockWorkspaceHandle, doc);
  assert.ok(writtenData);
  assert.equal(updatedDoc.name, "Lifecycle Project");

  // Read project back
  const readBack = await readProject(mockWorkspaceHandle, doc.id);
  assert.equal(readBack.id, doc.id);
  assert.equal(readBack.name, "Lifecycle Project");

  // Delete project
  await deleteProject(mockWorkspaceHandle, doc.id);
  assert.equal(deletedTarget, doc.id);
});

