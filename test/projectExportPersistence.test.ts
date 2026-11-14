import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateProjectExport,
  validateProjectDocument,
  serializeProjectDocument,
} from "../src/lib/projectValidation.ts";
import type { ProjectDocument, ProjectExport } from "../src/types/project.ts";

function createValidExportRecord(): ProjectExport {
  return {
    id: "e0000000-0000-4000-8000-000000000001",
    name: "my-video-1080p.mp4",
    relativePath: "projects/a0000000-0000-4000-8000-000000000001/exports/my-video-1080p.mp4",
    createdAt: new Date().toISOString(),
    settings: {
      targetAspectRatio: "16:9",
      width: 1920,
      height: 1080,
      frameRate: 30,
      videoCodec: "avc",
      audioCodec: "aac",
      format: "mp4",
    },
    duration: 15.5,
    width: 1920,
    height: 1080,
    fileSize: 12_450_000,
    status: "completed",
  };
}

describe("Project Export Persistence & Schema 1 Validation", () => {
  test("validates valid ProjectExport record", () => {
    const validExp = createValidExportRecord();
    const result = validateProjectExport(validExp);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.id, validExp.id);
      assert.equal(result.data.name, "my-video-1080p.mp4");
      assert.equal(result.data.width, 1920);
      assert.equal(result.data.height, 1080);
      assert.equal(result.data.duration, 15.5);
      assert.equal(result.data.fileSize, 12_450_000);
      assert.equal(result.data.status, "completed");
    }
  });

  test("rejects export with invalid UUID", () => {
    const invalid = { ...createValidExportRecord(), id: "not-a-uuid" };
    const result = validateProjectExport(invalid);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("UUID"));
  });

  test("rejects export with empty or invalid name", () => {
    const invalid = { ...createValidExportRecord(), name: "   " };
    const result = validateProjectExport(invalid);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("name"));
  });

  test("rejects export with unsafe relative path", () => {
    const invalid = { ...createValidExportRecord(), relativePath: "../../outside/video.mp4" };
    const result = validateProjectExport(invalid);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("unsafe path"));
  });

  test("rejects export with invalid duration or dimensions", () => {
    const invalidDuration = { ...createValidExportRecord(), duration: 0 };
    assert.equal(validateProjectExport(invalidDuration).ok, false);

    const invalidWidth = { ...createValidExportRecord(), width: -100 };
    assert.equal(validateProjectExport(invalidWidth).ok, false);
  });

  test("backward compatibility: project without exports field is valid", () => {
    const legacyProject: ProjectDocument = {
      schemaVersion: 1,
      id: "a0000000-0000-4000-8000-000000000001",
      name: "Legacy Project",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      assets: [],
    };

    const res = validateProjectDocument(legacyProject);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.data.exports, undefined);
    }
  });

  test("validates and persists exports list in ProjectDocument", () => {
    const validExp1 = createValidExportRecord();
    const validExp2 = {
      ...createValidExportRecord(),
      id: "e0000000-0000-4000-8000-000000000002",
      name: "my-video-720p.mp4",
      width: 1280,
      height: 720,
    };

    const projectWithExports: ProjectDocument = {
      schemaVersion: 1,
      id: "a0000000-0000-4000-8000-000000000001",
      name: "Project with Exports",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      assets: [],
      exports: [validExp1, validExp2],
    };

    const res = validateProjectDocument(projectWithExports);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.data.exports?.length, 2);
      assert.equal(res.data.exports?.[0].id, validExp1.id);
      assert.equal(res.data.exports?.[1].id, validExp2.id);
    }
  });

  test("rejects project if any export in the array is invalid", () => {
    const projectWithBadExport = {
      schemaVersion: 1,
      id: "a0000000-0000-4000-8000-000000000001",
      name: "Project with Bad Export",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      assets: [],
      exports: [
        createValidExportRecord(),
        { id: "not-a-uuid", name: "bad.mp4" },
      ],
    };

    const res = validateProjectDocument(projectWithBadExport);
    assert.equal(res.ok, false);
    assert.ok(res.error.includes("Export at index 1 is invalid"));
  });

  test("full serialization and reopen roundtrip", () => {
    const validExp = createValidExportRecord();
    const doc: ProjectDocument = {
      schemaVersion: 1,
      id: "a0000000-0000-4000-8000-000000000001",
      name: "Roundtrip Test",
      createdAt: "2026-11-14T10:00:00.000Z",
      updatedAt: "2026-11-14T10:30:00.000Z",
      assets: [],
      exports: [validExp],
    };

    const serialized = serializeProjectDocument(doc);
    const parsed = JSON.parse(serialized);
    const validated = validateProjectDocument(parsed);

    assert.equal(validated.ok, true);
    if (validated.ok) {
      assert.deepEqual(validated.data, doc);
    }
  });
});
