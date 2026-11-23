import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidUuid,
  isValidIsoDate,
  isSafeRelativePath,
  sanitizeProjectName,
  validateAsset,
  validateProjectDocument,
  serializeProjectDocument,
  createDefaultProject,
  formatBytes,
} from "../src/lib/projectValidation.ts";

test("isValidUuid correctly validates standard UUIDs", () => {
  assert.equal(isValidUuid("c81d4e2e-bcf2-11e6-869b-7df92533d2db"), true);
  assert.equal(isValidUuid("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"), true);
  assert.equal(isValidUuid("invalid-uuid"), false);
  assert.equal(isValidUuid("../projects/123"), false);
  assert.equal(isValidUuid(""), false);
  assert.equal(isValidUuid(12345), false);
});

test("isValidIsoDate validates parseable date strings", () => {
  assert.equal(isValidIsoDate("2026-11-14T00:00:00.000Z"), true);
  assert.equal(isValidIsoDate("not-a-date"), false);
  assert.equal(isValidIsoDate(""), false);
});

test("isSafeRelativePath rejects dangerous or absolute paths", () => {
  assert.equal(isSafeRelativePath("media/clip1.mp4"), true);
  assert.equal(isSafeRelativePath("assets/audio/voiceover.wav"), true);
  assert.equal(isSafeRelativePath("../secret.txt"), false);
  assert.equal(isSafeRelativePath("/etc/passwd"), false);
  assert.equal(isSafeRelativePath("C:/Windows/System32"), false);
  assert.equal(isSafeRelativePath("D:\\Projects\\file.mp4"), false);
  assert.equal(isSafeRelativePath("media/../unsafe"), false);
  assert.equal(isSafeRelativePath("media/./unsafe"), false);
  assert.equal(isSafeRelativePath(""), false);
});

test("sanitizeProjectName trims, strips control characters, and enforces length bounds", () => {
  assert.equal(sanitizeProjectName("  My Vacation Video  "), "My Vacation Video");
  assert.equal(sanitizeProjectName(""), "Untitled Project");
  assert.equal(sanitizeProjectName("   "), "Untitled Project");
  assert.equal(sanitizeProjectName("Bad\x00Name\x1F"), "BadName");
  const longName = "A".repeat(150);
  assert.equal(sanitizeProjectName(longName).length, 100);
});

test("validateAsset checks asset schema and fields", () => {
  const validAsset = {
    id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    name: "video.mp4",
    kind: "video" as const,
    mediaType: "video",
    mimeType: "video/mp4",
    size: 10485760,
    handleRefId: "h-12345",
  };

  const res = validateAsset(validAsset);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.name, "video.mp4");
    assert.equal(res.data.size, 10485760);
    assert.equal(res.data.kind, "video");
  }

  // Validate image kind asset
  const imageAsset = validateAsset({
    ...validAsset,
    id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
    name: "logo.png",
    kind: "image" as const,
    mediaType: "image",
    mimeType: "image/png",
  });
  assert.equal(imageAsset.ok, true);
  if (imageAsset.ok) {
    assert.equal(imageAsset.data.kind, "image");
  }

  // Missing UUID
  const invalidId = validateAsset({ ...validAsset, id: "bad-id" });
  assert.equal(invalidId.ok, false);

  // Missing or invalid kind
  const invalidKind = validateAsset({ ...validAsset, kind: "pdf" });
  assert.equal(invalidKind.ok, false);

  // Unsupported image extension
  const invalidImgExt = validateAsset({
    ...validAsset,
    id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
    name: "vector.svg",
    kind: "image" as const,
  });
  assert.equal(invalidImgExt.ok, false);

  // Negative size
  const negativeSize = validateAsset({ ...validAsset, size: -1 });
  assert.equal(negativeSize.ok, false);

  // Unsafe source locator
  const unsafeLoc = validateAsset({ ...validAsset, sourceLocator: "../outside/file.mp4" });
  assert.equal(unsafeLoc.ok, false);
});

test("validateProjectDocument accepts valid schema 1 documents and rejects invalid", () => {
  const validDoc = {
    schemaVersion: 1,
    id: "c81d4e2e-bcf2-11e6-869b-7df92533d2db",
    name: "Summer Trip",
    createdAt: "2026-06-01T12:00:00.000Z",
    updatedAt: "2026-06-01T13:00:00.000Z",
    assets: [
      {
        id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        name: "clip1.mp4",
        kind: "video" as const,
        mediaType: "video",
        mimeType: "video/mp4",
        size: 5000000,
        handleRefId: "ref-1",
      },
    ],
  };

  const result = validateProjectDocument(validDoc);
  assert.equal(result.ok, true);

  // Reject unsupported schema version
  const badVersion = validateProjectDocument({ ...validDoc, schemaVersion: 2 });
  assert.equal(badVersion.ok, false);

  // Reject invalid project UUID
  const badId = validateProjectDocument({ ...validDoc, id: "not-a-uuid" });
  assert.equal(badId.ok, false);

  // Reject duplicate asset UUIDs
  const duplicateAssets = validateProjectDocument({
    ...validDoc,
    assets: [validDoc.assets[0], validDoc.assets[0]],
  });
  assert.equal(duplicateAssets.ok, false);
});

test("createDefaultProject creates a compliant schema 1 document", () => {
  const doc = createDefaultProject("Test Project");
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.name, "Test Project");
  assert.equal(isValidUuid(doc.id), true);
  assert.equal(doc.assets.length, 0);
  assert.equal(isValidIsoDate(doc.createdAt), true);
  assert.equal(isValidIsoDate(doc.updatedAt), true);

  const serialized = serializeProjectDocument(doc);
  const reParsed = JSON.parse(serialized);
  const reValidated = validateProjectDocument(reParsed);
  assert.equal(reValidated.ok, true);
});

test("formatBytes produces clear human-readable strings", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1048576), "1.0 MB");
  assert.equal(formatBytes(1073741824 * 2.5), "2.5 GB");
});

