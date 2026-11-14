import test from "node:test";
import assert from "node:assert/strict";
import { MediaInspectionQueue } from "../src/lib/media/inspectionQueue.ts";

test("MediaInspectionQueue processes tasks and delivers results", async () => {
  const queue = new MediaInspectionQueue(1);
  const blob = new Blob(["sample content"]);
  const file = new File([blob], "sample.txt", { type: "text/plain" });

  let completedResult: unknown = null;
  await new Promise<void>((resolve) => {
    queue.enqueue("asset-1", file, (res) => {
      completedResult = res;
      resolve();
    });
  });

  assert.ok(completedResult !== null);
});

test("MediaInspectionQueue ignores stale results when an asset is re-enqueued", async () => {
  const queue = new MediaInspectionQueue(1);
  const blob = new Blob(["sample content"]);
  const file1 = new File([blob], "sample1.txt");
  const file2 = new File([blob], "sample2.txt");

  const results: string[] = [];

  // Enqueue asset-1, then immediately re-enqueue with a new file
  queue.enqueue("asset-1", file1, () => {
    results.push("first-call");
  });

  await new Promise<void>((resolve) => {
    queue.enqueue("asset-1", file2, () => {
      results.push("second-call");
      resolve();
    });
  });

  // Only the second callback should have been invoked
  assert.equal(results.length, 1);
  assert.equal(results[0], "second-call");
});

test("MediaInspectionQueue cancel prevents callback invocation", async () => {
  const queue = new MediaInspectionQueue(1);
  const blob = new Blob(["sample content"]);
  const file = new File([blob], "sample.txt");

  let called = false;
  const cancel = queue.enqueue("asset-to-cancel", file, () => {
    called = true;
  });

  cancel();

  // Allow pump cycle to complete
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(called, false);
});

