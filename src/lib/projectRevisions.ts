/**
 * Project revisions lifecycle and snapshot management (Phase 6).
 *
 * Rules:
 * - All revisions are stored inside the project folder: projects/<id>/revisions/
 * - Every revision is an immutable ProjectDocument snapshot: rev-<uuid>.json
 * - Fast manifest: revisions/manifest.json tracks ordered revision metadata.
 * - Duplicate suppression: avoids redundant snapshots when document content has not materially changed.
 * - Safety: Restoring an older revision always saves the active project state as a checkpoint first.
 * - Completed export files and references are never deleted or overwritten during restore.
 */

import type {
  ProjectDocument,
  ProjectRevisionMetadata,
  ProjectExport,
} from "../types/project.ts";
import {
  isValidUuid,
  validateProjectDocument,
  serializeProjectDocument,
} from "./projectValidation.ts";
import { getProjectsDirectory, writeProject } from "./workspace.ts";

export const REVISIONS_DIR_NAME = "revisions";
export const REVISIONS_MANIFEST_FILE = "manifest.json";
export const DEFAULT_MAX_REVISIONS = 30;

/**
 * Ensures or retrieves the revisions directory for a given project.
 */
export async function getRevisionsDirectory(
  workspaceHandle: FileSystemDirectoryHandle,
  projectId: string,
  create: boolean = false
): Promise<FileSystemDirectoryHandle> {
  const projectsDir = await getProjectsDirectory(workspaceHandle, create);
  const projectDir = await projectsDir.getDirectoryHandle(projectId, { create });
  return await projectDir.getDirectoryHandle(REVISIONS_DIR_NAME, { create });
}

/**
 * Reads the revisions manifest file, or returns an empty list if not present.
 */
export async function listProjectRevisions(
  workspaceHandle: FileSystemDirectoryHandle,
  projectId: string
): Promise<ProjectRevisionMetadata[]> {
  if (!isValidUuid(projectId)) {
    throw new Error(`Invalid project ID: "${projectId}". Must be a valid UUID.`);
  }

  let revisionsDir: FileSystemDirectoryHandle;
  try {
    revisionsDir = await getRevisionsDirectory(workspaceHandle, projectId, false);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "NotFoundError") {
      return [];
    }
    throw err;
  }

  // Attempt to read manifest.json
  try {
    const fileHandle = await revisionsDir.getFileHandle(REVISIONS_MANIFEST_FILE, { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (m): m is ProjectRevisionMetadata =>
          typeof m === "object" &&
          m !== null &&
          isValidUuid(m.id) &&
          typeof m.createdAt === "string" &&
          typeof m.reason === "string"
      );
    }
  } catch {
    // Manifest missing or corrupt — fall back to scanning rev-*.json files
  }

  // Fallback scanner for rev-<uuid>.json files
  const recovered: ProjectRevisionMetadata[] = [];
  try {
    for await (const [name, handle] of (revisionsDir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
      if (handle.kind === "file" && name.startsWith("rev-") && name.endsWith(".json")) {
        const revId = name.slice(4, -5);
        if (isValidUuid(revId)) {
          try {
            const f = await (handle as FileSystemFileHandle).getFile();
            const text = await f.text();
            const doc = JSON.parse(text) as ProjectDocument;
            recovered.push({
              id: revId,
              createdAt: doc.updatedAt || new Date(f.lastModified).toISOString(),
              reason: "Recovered Checkpoint",
              byteSize: f.size,
              assetCount: Array.isArray(doc.assets) ? doc.assets.length : 0,
            });
          } catch {
            // Ignore unreadable revision file
          }
        }
      }
    }
    recovered.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    // Non-fatal
  }

  return recovered;
}

/**
 * Normalizes document content for change detection (omitting volatile timestamps).
 */
function getDocumentContentSignature(doc: ProjectDocument): string {
  const normalized = {
    name: doc.name,
    assets: doc.assets.map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      handleRefId: a.handleRefId,
      sourceLocator: a.sourceLocator,
    })),
    settings: doc.settings,
    timeline: doc.timeline,
  };
  return JSON.stringify(normalized);
}

/**
 * Creates a new recoverable revision for a project.
 * Implements duplicate suppression unless `force: true`.
 */
export async function createProjectRevision(
  workspaceHandle: FileSystemDirectoryHandle,
  doc: ProjectDocument,
  reason: string = "Manual Checkpoint",
  options?: {
    force?: boolean;
    maxRevisions?: number;
  }
): Promise<ProjectRevisionMetadata | null> {
  if (!isValidUuid(doc.id)) {
    throw new Error(`Cannot create revision: Invalid project ID "${doc.id}".`);
  }

  const maxRevisions = options?.maxRevisions ?? DEFAULT_MAX_REVISIONS;
  const revisionsDir = await getRevisionsDirectory(workspaceHandle, doc.id, true);
  const existingList = await listProjectRevisions(workspaceHandle, doc.id);

  // Duplicate suppression: Compare against latest revision content
  if (!options?.force && existingList.length > 0) {
    const latestMeta = existingList[0];
    try {
      const latestDoc = await readProjectRevision(workspaceHandle, doc.id, latestMeta.id);
      if (getDocumentContentSignature(doc) === getDocumentContentSignature(latestDoc)) {
        // Document content is identical to the latest revision; suppress duplicate
        return null;
      }
    } catch {
      // If reading latest fails, proceed with creating new revision
    }
  }

  const revisionId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });

  const now = new Date().toISOString();
  const serialized = serializeProjectDocument(doc);
  const byteSize = new TextEncoder().encode(serialized).byteLength;

  const metadata: ProjectRevisionMetadata = {
    id: revisionId,
    createdAt: now,
    reason: reason.trim() || "Checkpoint",
    byteSize,
    assetCount: doc.assets.length,
  };

  // 1. Write the revision snapshot file rev-<id>.json
  const revFileName = `rev-${revisionId}.json`;
  const revFileHandle = await revisionsDir.getFileHandle(revFileName, { create: true });
  const revWritable = await revFileHandle.createWritable();
  await revWritable.write(serialized);
  await revWritable.close();

  // 2. Update manifest.json with bounded retention
  const updatedList = [metadata, ...existingList];
  const prunedList = updatedList.slice(0, maxRevisions);

  // Clean up any files that were pruned
  if (updatedList.length > maxRevisions) {
    const toRemove = updatedList.slice(maxRevisions);
    for (const oldRev of toRemove) {
      try {
        await revisionsDir.removeEntry(`rev-${oldRev.id}.json`);
      } catch {
        // Non-fatal if already removed
      }
    }
  }

  // Persist updated manifest
  const manifestHandle = await revisionsDir.getFileHandle(REVISIONS_MANIFEST_FILE, { create: true });
  const manifestWritable = await manifestHandle.createWritable();
  await manifestWritable.write(JSON.stringify(prunedList, null, 2));
  await manifestWritable.close();

  return metadata;
}

/**
 * Reads and validates a specific revision snapshot.
 */
export async function readProjectRevision(
  workspaceHandle: FileSystemDirectoryHandle,
  projectId: string,
  revisionId: string
): Promise<ProjectDocument> {
  if (!isValidUuid(projectId) || !isValidUuid(revisionId)) {
    throw new Error(`Invalid projectId (${projectId}) or revisionId (${revisionId}).`);
  }

  const revisionsDir = await getRevisionsDirectory(workspaceHandle, projectId, false);
  const revFileName = `rev-${revisionId}.json`;
  const fileHandle = await revisionsDir.getFileHandle(revFileName, { create: false });
  const file = await fileHandle.getFile();
  const text = await file.text();

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Revision ${revisionId} contains malformed JSON.`);
  }

  const validation = validateProjectDocument(raw);
  if (!validation.ok) {
    throw new Error(`Revision ${revisionId} failed schema validation: ${validation.error}`);
  }

  return validation.data;
}

/**
 * Restores a project document from a chosen revision snapshot.
 *
 * Guarantees:
 * 1. Creates a safety checkpoint of the active project document BEFORE restoring.
 * 2. Merges completed export history so no completed export outputs are lost.
 * 3. Safely commits restored state as project.json.
 */
export async function restoreProjectRevision(
  workspaceHandle: FileSystemDirectoryHandle,
  projectId: string,
  revisionId: string,
  currentDoc: ProjectDocument
): Promise<{ restoredDoc: ProjectDocument; checkpoint: ProjectRevisionMetadata }> {
  // 1. Read target revision document
  const targetDoc = await readProjectRevision(workspaceHandle, projectId, revisionId);

  // 2. Create safety checkpoint of the pre-restore active state
  const checkpointReason = `Before restoring revision from ${new Date(targetDoc.updatedAt || targetDoc.createdAt).toLocaleString()}`;
  const checkpoint = await createProjectRevision(workspaceHandle, currentDoc, checkpointReason, {
    force: true,
  });

  if (!checkpoint) {
    throw new Error("Failed to create pre-restore safety checkpoint.");
  }

  // 3. Preserve any completed exports in currentDoc that may not be in targetDoc
  const currentExports = currentDoc.exports || [];
  const targetExports = targetDoc.exports || [];
  const mergedExportsMap = new Map<string, ProjectExport>();

  for (const exp of targetExports) {
    mergedExportsMap.set(exp.id, exp);
  }
  for (const exp of currentExports) {
    mergedExportsMap.set(exp.id, exp); // current completed exports preserved
  }

  const preservedExports = Array.from(mergedExportsMap.values());

  // 4. Assemble the restored document
  const restoredDoc: ProjectDocument = {
    ...targetDoc,
    id: currentDoc.id, // preserve active project UUID
    updatedAt: new Date().toISOString(),
    exports: preservedExports.length > 0 ? preservedExports : undefined,
  };

  // 5. Persist as the active project.json
  const savedDoc = await writeProject(workspaceHandle, restoredDoc);

  return { restoredDoc: savedDoc, checkpoint };
}
