import test from "node:test";
import assert from "node:assert/strict";
import { ObjectUrlManager } from "../src/lib/media/previewSource.ts";

test("ObjectUrlManager creates, tracks, and revokes object URLs without leaks", () => {
  // Mock URL methods in Node environment
  const createdUrls = new Set<string>();
  const revokedUrls = new Set<string>();
  let urlCounter = 0;

  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  URL.createObjectURL = () => {
    const url = `blob:http://localhost/mock-${++urlCounter}`;
    createdUrls.add(url);
    return url;
  };

  URL.revokeObjectURL = (url: string) => {
    revokedUrls.add(url);
  };

  try {
    const manager = new ObjectUrlManager();
    assert.equal(manager.size, 0);

    const blob1 = new Blob(["test-data-1"]);
    const blob2 = new Blob(["test-data-2"]);

    const url1 = manager.create(blob1);
    const url2 = manager.create(blob2);

    assert.equal(manager.size, 2);
    assert.ok(createdUrls.has(url1));
    assert.ok(createdUrls.has(url2));

    // Revoke individual URL
    manager.revoke(url1);
    assert.equal(manager.size, 1);
    assert.ok(revokedUrls.has(url1));

    // Revoke remaining URLs
    manager.revokeAll();
    assert.equal(manager.size, 0);
    assert.ok(revokedUrls.has(url2));

    // Subsequent revoke on untracked URL does not throw
    manager.revoke("non-existent-url");
    manager.revokeAll();
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

