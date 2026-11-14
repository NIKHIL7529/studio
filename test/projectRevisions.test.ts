import test from "node:test";
import assert from "node:assert/strict";
import {
  createProjectRevision,
  listProjectRevisions,
  readProjectRevision,
  restoreProjectRevision,
} from "../src/lib/projectRevisions.ts";
import { createDefaultProject } from "../src/lib/projectValidation.ts";
import type { ProjectDocument, ProjectExport } from "../src/types/project.ts";

/**
 * Creates an in-memory directory handle structure for testing revisions.
 */
function createMockWorkspace() {
  const files = new Map<string, string>();

  function createDirHandle(currentPath: string): FileSystemDirectoryHandle {
    return {
      kind: "directory",
      name: currentPath.split("/").pop() || "",
      getDirectoryHandle: async (name: string) => {
        const subPath = `${currentPath}/${name}`;
        return createDirHandle(subPath);
      },
      getFileHandle: async (name: string, opts?: { create?: boolean }) => {
        const filePath = `${currentPath}/${name}`;
        if (!files.has(filePath) && !opts?.create) {
          const err = new Error(`File ${filePath} not found.`);
          err.name = "NotFoundError";
          throw err;
        }
        return {
          kind: "file",
          name,
          getFile: async () => ({
            name,
            size: files.has(filePath) ? new TextEncoder().encode(files.get(filePath)!).length : 0,
            lastModified: Date.now(),
            text: async () => files.get(filePath) || "",
          }),
          createWritable: async () => {
            let buffer = "";
            return {
              write: async (data: string) => {
                buffer += data;
              },
              close: async () => {
                files.set(filePath, buffer);
              },
              abort: async () => {},
            };
          },
        };
      },
      removeEntry: async (name: string) => {
        const targetPath = `${currentPath}/${name}`;
        files.delete(targetPath);
      },
      async *[Symbol.asyncIterator]() {
        const prefix = `${currentPath}/`;
        for (const [path, content] of files.entries()) {
          if (path.startsWith(prefix)) {
            const rel = path.slice(prefix.length);
            if (!rel.includes("/")) {
              yield [
                rel,
                {
                  kind: "file",
                  name: rel,
                  getFile: async () => ({
                    name: rel,
                    size: new TextEncoder().encode(content).length,
                    lastModified: Date.now(),
                    text: async () => content,
                  }),
                },
              ];
            }
          }
        }
      },
    } as unknown as FileSystemDirectoryHandle;
  }

  const workspaceHandle = createDirHandle("root");
  return { workspaceHandle, files };
}

test("createProjectRevision stores snapshots and suppresses identical duplicates", async () => {
  const { workspaceHandle } = createMockWorkspace();
  const doc = createDefaultProject("Revision Test Project");

  // Initial revision
  const rev1 = await createProjectRevision(workspaceHandle, doc, "Initial Save");
  assert.ok(rev1);
  assert.equal(rev1.reason, "Initial Save");
  assert.equal(rev1.assetCount, 0);

  // Duplicate check: without modifications, should return null (suppressed)
  const rev2 = await createProjectRevision(workspaceHandle, doc, "Second Save Without Edits");
  assert.equal(rev2, null);

  // With modification: should create new revision
  const modifiedDoc: ProjectDocument = {
    ...doc,
    name: "Renamed Revision Project",
  };
  const rev3 = await createProjectRevision(workspaceHandle, modifiedDoc, "Name Changed");
  assert.ok(rev3);
  assert.equal(rev3.reason, "Name Changed");

  // Listing revisions returns both in newest-first order
  const list = await listProjectRevisions(workspaceHandle, doc.id);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, rev3.id);
  assert.equal(list[1].id, rev1.id);
});

test("readProjectRevision reads and validates an exact snapshot", async () => {
  const { workspaceHandle } = createMockWorkspace();
  const doc = createDefaultProject("Snapshot Read Project");

  const rev = await createProjectRevision(workspaceHandle, doc, "Snapshot 1");
  assert.ok(rev);

  const readBack = await readProjectRevision(workspaceHandle, doc.id, rev.id);
  assert.equal(readBack.id, doc.id);
  assert.equal(readBack.name, "Snapshot Read Project");
});

test("restoreProjectRevision creates a pre-restore safety checkpoint and merges exports", async () => {
  const { workspaceHandle } = createMockWorkspace();
  const doc = createDefaultProject("Restoration Base");

  // Step 1: Create initial revision
  const rev1 = await createProjectRevision(workspaceHandle, doc, "V1 Initial");
  assert.ok(rev1);

  // Step 2: Simulate edits and an export completed in active state (V2)
  const completedExport: ProjectExport = {
    id: "e0000000-0000-4000-8000-000000000099",
    name: "output-v2.mp4",
    relativePath: `projects/${doc.id}/exports/output-v2.mp4`,
    createdAt: new Date().toISOString(),
    settings: {
      targetAspectRatio: "16:9",
      width: 1920,
      height: 1080,
      frameRate: 30,
      videoCodec: "avc",
      format: "mp4",
    },
    duration: 10,
    width: 1920,
    height: 1080,
    fileSize: 5000000,
    status: "completed",
  };

  const currentDocWithEdits: ProjectDocument = {
    ...doc,
    name: "V2 Current With Edits",
    exports: [completedExport],
  };

  // Step 3: Restore V1 from the active V2 state
  const { restoredDoc, checkpoint } = await restoreProjectRevision(
    workspaceHandle,
    doc.id,
    rev1.id,
    currentDocWithEdits
  );

  // Safety Guarantee 1: Checkpoint created for V2 state before restoring V1
  assert.ok(checkpoint);
  assert.ok(checkpoint.reason.includes("Before restoring revision"));

  // Safety Guarantee 2: Restored doc has V1 attributes (e.g. original name)
  assert.equal(restoredDoc.name, "Restoration Base");

  // Safety Guarantee 3: Exports from active state are preserved, never deleted or lost
  assert.ok(restoredDoc.exports);
  assert.equal(restoredDoc.exports.length, 1);
  assert.equal(restoredDoc.exports[0].id, completedExport.id);

  // All 3 revisions now exist in history: V1, V2 pre-restore checkpoint
  const allRevs = await listProjectRevisions(workspaceHandle, doc.id);
  assert.equal(allRevs.length, 2);
  assert.equal(allRevs[0].id, checkpoint.id);
  assert.equal(allRevs[1].id, rev1.id);
});

test("createProjectRevision enforces bounded retention", async () => {
  const { workspaceHandle } = createMockWorkspace();
  const doc = createDefaultProject("Retention Test");

  // Create 6 revisions with maxRevisions: 4
  for (let i = 1; i <= 6; i++) {
    const updated = { ...doc, name: `Rev ${i}` };
    await createProjectRevision(workspaceHandle, updated, `Revision ${i}`, {
      force: true,
      maxRevisions: 4,
    });
  }

  const revisions = await listProjectRevisions(workspaceHandle, doc.id);
  assert.equal(revisions.length, 4);
  assert.equal(revisions[0].reason, "Revision 6");
  assert.equal(revisions[3].reason, "Revision 3");
});
