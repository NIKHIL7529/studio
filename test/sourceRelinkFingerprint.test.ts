import test from "node:test";
import assert from "node:assert/strict";
import { computeMediaFingerprint } from "../src/lib/media/fingerprint.ts";
import { compareRelinkWithFingerprint } from "../src/lib/mediaImport.ts";
import type { ProjectAsset } from "../src/types/project.ts";

test("computeMediaFingerprint computes deterministic SHA-256 fingerprint", async () => {
  const contentA = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const fileA1 = new File([contentA], "clip1.mp4", { type: "video/mp4" });
  const fileA2 = new File([contentA], "clip1.mp4", { type: "video/mp4" });

  const fp1 = await computeMediaFingerprint(fileA1);
  const fp2 = await computeMediaFingerprint(fileA2);

  assert.ok(fp1);
  assert.equal(fp1.length >= 16, true);
  assert.equal(fp1, fp2); // Identical files produce identical fingerprint

  // Different content produces different fingerprint
  const contentB = new Uint8Array([1, 2, 3, 4, 9, 9, 9, 9]);
  const fileB = new File([contentB], "clip1.mp4", { type: "video/mp4" });
  const fpB = await computeMediaFingerprint(fileB);

  assert.notEqual(fp1, fpB);
});

test("compareRelinkMetadata accurately compares fingerprints and flags mismatches", async () => {
  const contentA = new Uint8Array([10, 20, 30, 40]);
  const fileA = new File([contentA], "original.mp4", {
    type: "video/mp4",
    lastModified: 1700000000000,
  });
  const fpA = await computeMediaFingerprint(fileA);

  const asset: ProjectAsset = {
    id: "a0000000-0000-4000-8000-000000000001",
    name: "original.mp4",
    kind: "video",
    mediaType: "video",
    mimeType: "video/mp4",
    size: 4,
    lastModified: 1700000000000,
    handleRefId: "ref-1",
    fingerprint: fpA,
  };

  // Case 1: Identical file with matching fingerprint
  const res1 = await compareRelinkWithFingerprint(asset, fileA);
  assert.equal(res1.match, true);
  assert.equal(res1.fingerprintMatched, true);
  assert.equal(res1.fingerprintDiffers, false);

  // Case 2: Same name, size, date, but different content (tampered or overwritten file)
  const contentTampered = new Uint8Array([99, 99, 99, 99]);
  const fileTampered = new File([contentTampered], "original.mp4", {
    type: "video/mp4",
    lastModified: 1700000000000,
  });

  const res2 = await compareRelinkWithFingerprint(asset, fileTampered);
  assert.equal(res2.match, false); // must fail match!
  assert.equal(res2.nameDiffers, false);
  assert.equal(res2.sizeDiffers, false);
  assert.equal(res2.dateDiffers, false);
  assert.equal(res2.fingerprintDiffers, true);
  assert.equal(res2.fingerprintMatched, false);
});
