import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createSequence,
  ensureSequencesInitialized,
  getActiveSequence,
  setActiveSequence,
  addSequenceToProject,
  duplicateSequence,
  renameSequence,
  deleteSequence,
  updateActiveSequenceTimeline,
} from "../src/lib/timeline/sequenceManager.ts";
import type { ProjectDocument } from "../src/types/project.ts";

function createMockProject(): ProjectDocument {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name: "Test Project",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    assets: [],
  };
}

describe("Sequence and Multi-Composition Management", () => {
  test("createSequence produces valid SequenceDocument with correct dimensions", () => {
    const seq16x9 = createSequence({ name: "Wide Edit", aspectRatio: "16:9", fps: 30 });
    assert.equal(seq16x9.name, "Wide Edit");
    assert.equal(seq16x9.aspectRatio, "16:9");
    assert.equal(seq16x9.width, 1920);
    assert.equal(seq16x9.height, 1080);
    assert.equal(seq16x9.fps, 30);

    const seq9x16 = createSequence({ name: "Vertical Short", aspectRatio: "9:16", fps: 60 });
    assert.equal(seq9x16.aspectRatio, "9:16");
    assert.equal(seq9x16.width, 1080);
    assert.equal(seq9x16.height, 1920);
    assert.equal(seq9x16.fps, 60);
  });

  test("ensureSequencesInitialized wraps single-timeline project into default sequence", () => {
    const rawProject = createMockProject();
    const initialized = ensureSequencesInitialized(rawProject);

    assert.ok(initialized.sequences);
    assert.equal(initialized.sequences.length, 1);
    assert.equal(initialized.activeSequenceId, initialized.sequences[0].id);
    assert.ok(initialized.timeline);
  });

  test("addSequenceToProject adds and activates new sequence", () => {
    const project = ensureSequencesInitialized(createMockProject());
    const withNewSeq = addSequenceToProject(project, { name: "Trailer", aspectRatio: "1:1" });

    assert.equal(withNewSeq.sequences?.length, 2);
    const active = getActiveSequence(withNewSeq);
    assert.equal(active.name, "Trailer");
    assert.equal(active.aspectRatio, "1:1");
    assert.equal(withNewSeq.activeSequenceId, active.id);
  });

  test("duplicateSequence creates independent copy", () => {
    const project = ensureSequencesInitialized(createMockProject());
    const seq1Id = project.sequences![0].id;

    const withDup = duplicateSequence(project, seq1Id);
    assert.equal(withDup.sequences?.length, 2);
    const dup = withDup.sequences![1];
    assert.ok(dup.name.includes("Copy"));
    assert.notEqual(dup.id, seq1Id);
    assert.notEqual(dup.timeline.id, project.sequences![0].timeline.id);
  });

  test("renameSequence updates name", () => {
    const project = ensureSequencesInitialized(createMockProject());
    const seqId = project.sequences![0].id;

    const renamed = renameSequence(project, seqId, "Final Cut v1");
    assert.equal(renamed.sequences![0].name, "Final Cut v1");
  });

  test("deleteSequence removes sequence and updates active ID", () => {
    let project = ensureSequencesInitialized(createMockProject());
    project = addSequenceToProject(project, { name: "Teaser" });
    assert.equal(project.sequences?.length, 2);

    const teaserId = project.activeSequenceId!;
    const afterDelete = deleteSequence(project, teaserId);

    assert.equal(afterDelete.sequences?.length, 1);
    assert.notEqual(afterDelete.activeSequenceId, teaserId);
  });

  test("deleteSequence throws when attempting to delete the last sequence", () => {
    const project = ensureSequencesInitialized(createMockProject());
    const seqId = project.sequences![0].id;
    assert.throws(() => deleteSequence(project, seqId), /Cannot delete the only sequence/);
  });

  test("setActiveSequence switches active sequence and syncs doc.timeline", () => {
    let project = ensureSequencesInitialized(createMockProject());
    const mainSeqId = project.sequences![0].id;
    project = addSequenceToProject(project, { name: "Reel" });
    const reelSeqId = project.activeSequenceId!;

    const switchedBack = setActiveSequence(project, mainSeqId);
    assert.equal(switchedBack.activeSequenceId, mainSeqId);
    assert.equal(switchedBack.timeline?.id, project.sequences![0].timeline.id);
  });
});
