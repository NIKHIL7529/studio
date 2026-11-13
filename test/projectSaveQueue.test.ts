import test from "node:test";
import assert from "node:assert/strict";
import { ProjectSaveQueue } from "../src/lib/projectSaveQueue.ts";
import { createDefaultProject } from "../src/lib/projectValidation.ts";
import type { SaveState } from "../src/types/project.ts";

test("ProjectSaveQueue notifies subscribers and handles save states", async () => {
  let writeCount = 0;
  // Mock directory handle with writable
  const mockWorkspaceHandle = {
    name: "MockWorkspace",
    getDirectoryHandle: async () => ({
      getDirectoryHandle: async () => ({
        getFileHandle: async () => ({
          createWritable: async () => ({
            write: async () => {
              writeCount++;
            },
            close: async () => {},
            abort: async () => {},
          }),
        }),
      }),
    }),
  } as unknown as FileSystemDirectoryHandle;

  const queue = new ProjectSaveQueue(mockWorkspaceHandle, 50);

  const states: SaveState[] = [];
  const unsubscribe = queue.subscribe((state) => {
    states.push(state);
  });

  const doc = createDefaultProject("Autosave Test");

  queue.enqueue(doc);
  assert.equal(queue.state, "saving");

  // Immediate flush should serialize and complete
  await queue.flush();
  assert.equal(queue.state, "saved");
  assert.equal(writeCount, 1);

  unsubscribe();
});

