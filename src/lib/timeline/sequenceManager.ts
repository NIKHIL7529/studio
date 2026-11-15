/**
 * Sequence / Composition Manager for multi-sequence projects.
 *
 * Rules:
 * - Pure functions returning updated ProjectDocument instances.
 * - Backwards-compatible: projects with single timeline automatically get wrapped into a default sequence.
 * - Syncs the active sequence's timeline with project.timeline so single-timeline consumers (renderPlan, export, repurpose) remain fully functional.
 */

import type { ProjectDocument } from "../../types/project.ts";
import type { SequenceDocument, TimelineDocument } from "../../types/timeline.ts";
import type { ExportAspectRatio } from "../../types/export.ts";
import { createTimeline } from "./model.ts";
import { DEFAULT_FPS } from "./timecode.ts";

export interface CreateSequenceOptions {
  name?: string;
  fps?: number;
  width?: number;
  height?: number;
  aspectRatio?: ExportAspectRatio;
  initialTimeline?: TimelineDocument;
}

/**
 * Creates a new SequenceDocument with sensible defaults.
 */
export function createSequence(options: CreateSequenceOptions = {}): SequenceDocument {
  const aspectRatio: ExportAspectRatio = options.aspectRatio || "16:9";
  const fps = options.fps || DEFAULT_FPS;
  let width = options.width || 1920;
  let height = options.height || 1080;

  if (aspectRatio === "9:16") {
    width = 1080;
    height = 1920;
  } else if (aspectRatio === "1:1") {
    width = 1080;
    height = 1080;
  } else if (aspectRatio === "4:5") {
    width = 1080;
    height = 1350;
  }

  const timeline = options.initialTimeline || createTimeline();
  timeline.settings = { ...timeline.settings, targetAspectRatio: aspectRatio };
  timeline.timebase = { fps };

  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    name: options.name?.trim() || "Sequence 1",
    fps,
    width,
    height,
    aspectRatio,
    timeline,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Ensures a project document has the sequences array and activeSequenceId initialized.
 * If doc.sequences is missing or empty, synthesizes a primary sequence from doc.timeline.
 */
export function ensureSequencesInitialized(doc: ProjectDocument): ProjectDocument {
  if (doc.sequences && doc.sequences.length > 0 && doc.activeSequenceId) {
    const activeExists = doc.sequences.some((s) => s.id === doc.activeSequenceId);
    if (activeExists) return doc;
  }

  const primaryTimeline = doc.timeline || createTimeline();
  const aspectRatio: ExportAspectRatio =
    doc.settings?.targetAspectRatio || primaryTimeline.settings?.targetAspectRatio || "16:9";

  const defaultSeq = createSequence({
    name: "Main Sequence",
    aspectRatio,
    fps: primaryTimeline.timebase?.fps || DEFAULT_FPS,
    initialTimeline: primaryTimeline,
  });

  const sequences = doc.sequences && doc.sequences.length > 0 ? doc.sequences : [defaultSeq];
  const activeSequenceId = sequences[0].id;

  return {
    ...doc,
    sequences,
    activeSequenceId,
    timeline: sequences[0].timeline,
  };
}

/**
 * Retrieves the currently active sequence from a project document.
 */
export function getActiveSequence(doc: ProjectDocument): SequenceDocument {
  const initialized = ensureSequencesInitialized(doc);
  const found = initialized.sequences?.find((s) => s.id === initialized.activeSequenceId);
  return found || initialized.sequences![0];
}

/**
 * Sets the active sequence by ID and updates doc.timeline to match.
 */
export function setActiveSequence(doc: ProjectDocument, sequenceId: string): ProjectDocument {
  const initialized = ensureSequencesInitialized(doc);
  const target = initialized.sequences?.find((s) => s.id === sequenceId);
  if (!target) return doc;

  return {
    ...initialized,
    activeSequenceId: sequenceId,
    timeline: target.timeline,
  };
}

/**
 * Updates the active sequence's timeline and synchronizes with doc.timeline.
 */
export function updateActiveSequenceTimeline(
  doc: ProjectDocument,
  updatedTimeline: TimelineDocument
): ProjectDocument {
  const initialized = ensureSequencesInitialized(doc);
  const activeId = initialized.activeSequenceId!;
  const now = new Date().toISOString();

  const updatedSequences = initialized.sequences!.map((s) =>
    s.id === activeId ? { ...s, timeline: updatedTimeline, updatedAt: now } : s
  );

  return {
    ...initialized,
    sequences: updatedSequences,
    timeline: updatedTimeline,
    updatedAt: now,
  };
}

/**
 * Adds a new sequence to the project and activates it.
 */
export function addSequenceToProject(
  doc: ProjectDocument,
  options: CreateSequenceOptions = {}
): ProjectDocument {
  const initialized = ensureSequencesInitialized(doc);
  const count = (initialized.sequences?.length || 0) + 1;
  const seq = createSequence({
    name: options.name || `Sequence ${count}`,
    ...options,
  });

  const sequences = [...(initialized.sequences || []), seq];
  return {
    ...initialized,
    sequences,
    activeSequenceId: seq.id,
    timeline: seq.timeline,
  };
}

/**
 * Duplicates an existing sequence.
 */
export function duplicateSequence(doc: ProjectDocument, sequenceId: string): ProjectDocument {
  const initialized = ensureSequencesInitialized(doc);
  const target = initialized.sequences?.find((s) => s.id === sequenceId);
  if (!target) return doc;

  const now = new Date().toISOString();
  const clonedTimeline: TimelineDocument = JSON.parse(JSON.stringify(target.timeline));
  clonedTimeline.id = crypto.randomUUID();

  const dupSeq: SequenceDocument = {
    ...target,
    id: crypto.randomUUID(),
    name: `${target.name} (Copy)`,
    timeline: clonedTimeline,
    createdAt: now,
    updatedAt: now,
  };

  const sequences = [...initialized.sequences!, dupSeq];
  return {
    ...initialized,
    sequences,
    activeSequenceId: dupSeq.id,
    timeline: dupSeq.timeline,
  };
}

/**
 * Renames a sequence.
 */
export function renameSequence(
  doc: ProjectDocument,
  sequenceId: string,
  newName: string
): ProjectDocument {
  const clean = newName.trim();
  if (!clean) return doc;

  const initialized = ensureSequencesInitialized(doc);
  const sequences = initialized.sequences!.map((s) =>
    s.id === sequenceId ? { ...s, name: clean, updatedAt: new Date().toISOString() } : s
  );

  return {
    ...initialized,
    sequences,
  };
}

/**
 * Safely deletes a sequence, preventing deletion if it is the only remaining sequence.
 */
export function deleteSequence(doc: ProjectDocument, sequenceId: string): ProjectDocument {
  const initialized = ensureSequencesInitialized(doc);
  if (initialized.sequences!.length <= 1) {
    throw new Error("Cannot delete the only sequence in a project");
  }

  const remaining = initialized.sequences!.filter((s) => s.id !== sequenceId);
  const nextActive = initialized.activeSequenceId === sequenceId ? remaining[0].id : initialized.activeSequenceId;
  const activeSeq = remaining.find((s) => s.id === nextActive) || remaining[0];

  return {
    ...initialized,
    sequences: remaining,
    activeSequenceId: activeSeq.id,
    timeline: activeSeq.timeline,
  };
}
