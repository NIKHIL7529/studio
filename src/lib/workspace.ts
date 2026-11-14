/**
 * Workspace filesystem operations for Content Studio (Phase 2).
 *
 * Layout:
 * <workspace>/
 * └── projects/
 *     ├── <project-uuid>/
 *     │   └── project.json
 *
 * Rules:
 * - Only operates inside the application-owned `projects/` directory.
 * - Project directory names must be valid UUIDs, never user-entered names.
 * - Corrupted project documents do not break the workspace listing.
 * - Deletion strictly targets `projects/<uuid>/` and never the workspace root.
 */

import type { ProjectDocument, ProjectSummary, WorkspacePermissionState } from "../types/project.ts";
import {
  isValidUuid,
  validateProjectDocument,
  serializeProjectDocument,
} from "./projectValidation.ts";

export const PROJECTS_DIR_NAME = "projects";
export const PROJECT_DOC_FILE_NAME = "project.json";

/**
 * Checks current permission state for a directory handle.
 */
export async function checkDirectoryPermission(
  handle: FileSystemDirectoryHandle
): Promise<WorkspacePermissionState> {
  if (typeof handle.queryPermission !== "function") {
    return "unsupported";
  }

  try {
    const status = await handle.queryPermission({ mode: "readwrite" });
    if (status === "granted") return "granted";
    if (status === "prompt") return "prompt-required";
    return "denied";
  } catch (err) {
    console.warn("Error querying directory permission:", err);
    return "error";
  }
}

/**
 * Requests read/write permission from an explicit user action.
 */
export async function requestDirectoryPermission(
  handle: FileSystemDirectoryHandle
): Promise<WorkspacePermissionState> {
  if (typeof handle.requestPermission !== "function") {
    return "unsupported";
  }

  try {
    const status = await handle.requestPermission({ mode: "readwrite" });
    if (status === "granted") return "granted";
    if (status === "prompt") return "prompt-required";
    return "denied";
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.name === "NotAllowedError") return "denied";
      if (err.name === "AbortError") return "prompt-required";
    }
    console.warn("Error requesting directory permission:", err);
    return "error";
  }
}

/**
 * Prompts user to pick a workspace directory via showDirectoryPicker.
 */
export async function pickWorkspaceDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof window === "undefined" || typeof window.showDirectoryPicker !== "function") {
    throw new Error("The File System Access API is not supported in this browser. Please use Chrome or Edge.");
  }

  try {
    const showDir = window.showDirectoryPicker;
    const handle = await showDir({
      mode: "readwrite",
      id: "content-studio-workspace",
      startIn: "documents",
    });
    return handle;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      // User cancelled picker — not a fatal error
      return null;
    }
    throw err;
  }
}

/**
 * Ensures the app-owned `projects/` subfolder exists under the workspace root.
 */
export async function getProjectsDirectory(
  workspaceHandle: FileSystemDirectoryHandle,
  create: boolean = false
): Promise<FileSystemDirectoryHandle> {
  return await workspaceHandle.getDirectoryHandle(PROJECTS_DIR_NAME, { create });
}

/**
 * Lists all projects in the workspace.
 * Traverses only the `projects/` directory.
 * Corrupted or invalid projects are surfaced with valid: false, allowing the
 * remaining projects to be listed cleanly.
 */
export async function listProjects(
  workspaceHandle: FileSystemDirectoryHandle
): Promise<ProjectSummary[]> {
  const summaries: ProjectSummary[] = [];

  let projectsDir: FileSystemDirectoryHandle;
  try {
    projectsDir = await getProjectsDirectory(workspaceHandle, false);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "NotFoundError") {
      // projects/ folder does not exist yet (clean workspace)
      return [];
    }
    throw err;
  }

  // Enumerate directory entries in projects/
  for await (const [name, handle] of (projectsDir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    if (handle.kind !== "directory") {
      // Ignore files directly inside projects/
      continue;
    }

    if (!isValidUuid(name)) {
      // Ignore directories that are not valid project UUIDs
      continue;
    }

    const projectDirHandle = handle as FileSystemDirectoryHandle;
    try {
      const fileHandle = await projectDirHandle.getFileHandle(PROJECT_DOC_FILE_NAME, { create: false });
      const file = await fileHandle.getFile();
      const text = await file.text();
      let rawJson: unknown;
      try {
        rawJson = JSON.parse(text);
      } catch {
        summaries.push({
          id: name,
          name: "Corrupted Project Document",
          createdAt: new Date(file.lastModified).toISOString(),
          updatedAt: new Date(file.lastModified).toISOString(),
          assetCount: 0,
          valid: false,
          error: "JSON syntax error in project.json",
        });
        continue;
      }

      const validation = validateProjectDocument(rawJson);
      if (!validation.ok) {
        summaries.push({
          id: name,
          name: (typeof rawJson === "object" && rawJson !== null && "name" in rawJson && typeof (rawJson as Record<string, unknown>).name === "string")
            ? (rawJson as Record<string, unknown>).name as string
            : "Invalid Project",
          createdAt: new Date(file.lastModified).toISOString(),
          updatedAt: new Date(file.lastModified).toISOString(),
          assetCount: 0,
          valid: false,
          error: validation.error,
        });
        continue;
      }

      const doc = validation.data;
      summaries.push({
        id: doc.id,
        name: doc.name,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        assetCount: doc.assets.length,
        valid: true,
      });
    } catch (err: unknown) {
      summaries.push({
        id: name,
        name: "Unreadable Project",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        assetCount: 0,
        valid: false,
        error: err instanceof Error ? err.message : "Failed to read project.json",
      });
    }
  }

  // Sort projects by updatedAt descending (most recent first)
  summaries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return summaries;
}

/**
 * Reads and validates a specific project document from the workspace.
 */
export async function readProject(
  workspaceHandle: FileSystemDirectoryHandle,
  projectId: string
): Promise<ProjectDocument> {
  if (!isValidUuid(projectId)) {
    throw new Error(`Invalid project ID: "${projectId}". Must be a valid UUID.`);
  }

  const projectsDir = await getProjectsDirectory(workspaceHandle, false);
  const projectDir = await projectsDir.getDirectoryHandle(projectId, { create: false });
  const fileHandle = await projectDir.getFileHandle(PROJECT_DOC_FILE_NAME, { create: false });
  const file = await fileHandle.getFile();
  const text = await file.text();

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Project ${projectId} contains malformed JSON.`);
  }

  const validation = validateProjectDocument(raw);
  if (!validation.ok) {
    throw new Error(`Project ${projectId} failed schema validation: ${validation.error}`);
  }

  return validation.data;
}

/**
 * Writes a project document to disk atomically.
 * Updates the updatedAt timestamp before persisting.
 */
export async function writeProject(
  workspaceHandle: FileSystemDirectoryHandle,
  doc: ProjectDocument
): Promise<ProjectDocument> {
  if (!isValidUuid(doc.id)) {
    throw new Error(`Cannot save project: Invalid project ID "${doc.id}".`);
  }

  const projectsDir = await getProjectsDirectory(workspaceHandle, true);
  const projectDir = await projectsDir.getDirectoryHandle(doc.id, { create: true });

  const updatedDoc: ProjectDocument = {
    ...doc,
    updatedAt: new Date().toISOString(),
  };

  const serialized = serializeProjectDocument(updatedDoc);

  // Staged safe write: write to temporary file first if atomic move is supported
  const tempFilename = `.tmp_save_${Math.random().toString(36).slice(2, 8)}.json`;
  let tempHandle: FileSystemFileHandle | null = null;
  let hasAtomicMove = false;

  try {
    const candidate = await projectDir.getFileHandle(tempFilename, { create: true });
    if (typeof (candidate as unknown as { move?: (name: string) => Promise<void> }).move === "function") {
      tempHandle = candidate;
      hasAtomicMove = true;
    } else if (typeof projectDir.removeEntry === "function") {
      try {
        await projectDir.removeEntry(tempFilename);
      } catch {}
    }
  } catch {
    hasAtomicMove = false;
  }

  if (hasAtomicMove && tempHandle) {
    let writable: FileSystemWritableFileStream | null = null;
    try {
      writable = await tempHandle.createWritable();
      await writable.write(serialized);
      await writable.close();
      writable = null;

      // Atomically promote temp file to project.json
      await (tempHandle as unknown as { move: (name: string) => Promise<void> }).move(PROJECT_DOC_FILE_NAME);
      return updatedDoc;
    } catch (err) {
      if (writable) {
        try {
          await writable.abort();
        } catch {}
      }
      try {
        if (typeof projectDir.removeEntry === "function") {
          await projectDir.removeEntry(tempFilename);
        }
      } catch {}
      throw new Error(`Failed to write project document: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Direct write fallback
  const fileHandle = await projectDir.getFileHandle(PROJECT_DOC_FILE_NAME, { create: true });
  let writable: FileSystemWritableFileStream | null = null;
  try {
    writable = await fileHandle.createWritable();
    await writable.write(serialized);
    await writable.close();
    writable = null;
    return updatedDoc;
  } catch (err) {
    if (writable) {
      try {
        await writable.abort();
      } catch {}
    }
    throw new Error(`Failed to write project document: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Safely deletes a project directory from the workspace.
 * Deletion is strictly bounded to `projects/<projectId>/`.
 */
export async function deleteProject(
  workspaceHandle: FileSystemDirectoryHandle,
  projectId: string
): Promise<void> {
  if (!isValidUuid(projectId)) {
    throw new Error(`Cannot delete project: Invalid project ID "${projectId}".`);
  }

  const projectsDir = await getProjectsDirectory(workspaceHandle, false);

  try {
    // Attempt standard recursive removal of the project's UUID folder
    await projectsDir.removeEntry(projectId, { recursive: true });
  } catch (err) {
    // If browser does not support recursive deletion on removeEntry, perform bounded cleanup
    try {
      const projectDir = await projectsDir.getDirectoryHandle(projectId, { create: false });
      for await (const [entryName, entryHandle] of (projectDir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
        if (entryHandle.kind === "file") {
          await projectDir.removeEntry(entryName);
        }
      }
      await projectsDir.removeEntry(projectId);
    } catch {
      throw new Error(`Failed to delete project directory: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
