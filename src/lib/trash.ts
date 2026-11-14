/**
 * Workspace trash and safe project deletion management (Phase 6).
 *
 * Rules:
 * - Deleting an active project moves it to <workspace>/trash/<projectId>/ (recoverable).
 * - Original source media files are NEVER deleted or touched.
 * - Trashed projects can be inspected and restored back to projects/<projectId>/.
 * - Permanent deletion requires an explicit user action and is strictly bounded
 *   to trash/<projectId>/.
 * - Deleting one project never affects other projects or files outside its folder.
 */

import type { ProjectDocument, ProjectSummary } from "../types/project.ts";
import {
  isValidUuid,
  validateProjectDocument,
} from "./projectValidation.ts";
import {
  getProjectsDirectory,
  PROJECT_DOC_FILE_NAME,
} from "./workspace.ts";

export const TRASH_DIR_NAME = "trash";

/**
 * Ensures or retrieves the trash directory under the workspace root.
 */
export async function getTrashDirectory(
  workspaceHandle: FileSystemDirectoryHandle,
  create: boolean = false
): Promise<FileSystemDirectoryHandle> {
  return await workspaceHandle.getDirectoryHandle(TRASH_DIR_NAME, { create });
}

/**
 * Moves an active project directory from `projects/<projectId>/` to `trash/<projectId>/`.
 * Strictly bounded to application-managed project data. Original media is NEVER touched.
 */
export async function moveToTrash(
  workspaceHandle: FileSystemDirectoryHandle,
  projectId: string
): Promise<void> {
  if (!isValidUuid(projectId)) {
    throw new Error(`Cannot move project to trash: Invalid project ID "${projectId}".`);
  }

  const projectsDir = await getProjectsDirectory(workspaceHandle, false);
  const trashDir = await getTrashDirectory(workspaceHandle, true);

  const sourceProjectDir = await projectsDir.getDirectoryHandle(projectId, { create: false });

  // 1. Check if browser supports DirectoryHandle.move()
  if (typeof (sourceProjectDir as unknown as { move?: (dest: FileSystemDirectoryHandle, newName?: string) => Promise<void> }).move === "function") {
    try {
      await (sourceProjectDir as unknown as { move: (dest: FileSystemDirectoryHandle, newName?: string) => Promise<void> }).move(trashDir, projectId);
      return;
    } catch {
      // Fall through to staged recursive copy
    }
  }

  // 2. Staged recursive copy into trash/<projectId>/
  const targetTrashProjectDir = await trashDir.getDirectoryHandle(projectId, { create: true });
  await copyDirectoryRecursive(sourceProjectDir, targetTrashProjectDir);

  // 3. Remove original projects/<projectId>/
  try {
    await projectsDir.removeEntry(projectId, { recursive: true });
  } catch {
    // Fallback manual entry removal if recursive removeEntry is unsupported
    await removeDirectoryContentsRecursive(projectsDir, projectId);
  }
}

/**
 * Lists all recoverable projects currently in the workspace trash.
 */
export async function listTrashedProjects(
  workspaceHandle: FileSystemDirectoryHandle
): Promise<ProjectSummary[]> {
  const summaries: ProjectSummary[] = [];

  let trashDir: FileSystemDirectoryHandle;
  try {
    trashDir = await getTrashDirectory(workspaceHandle, false);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "NotFoundError") {
      return [];
    }
    throw err;
  }

  for await (const [name, handle] of (trashDir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    if (handle.kind !== "directory" || !isValidUuid(name)) {
      continue;
    }

    const projectDirHandle = handle as FileSystemDirectoryHandle;
    try {
      const fileHandle = await projectDirHandle.getFileHandle(PROJECT_DOC_FILE_NAME, { create: false });
      const file = await fileHandle.getFile();
      const text = await file.text();
      const rawJson = JSON.parse(text);

      const validation = validateProjectDocument(rawJson);
      if (validation.ok) {
        const doc = validation.data;
        summaries.push({
          id: doc.id,
          name: doc.name,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          assetCount: doc.assets.length,
          valid: true,
        });
      } else {
        summaries.push({
          id: name,
          name: "Invalid Trashed Project",
          createdAt: new Date(file.lastModified).toISOString(),
          updatedAt: new Date(file.lastModified).toISOString(),
          assetCount: 0,
          valid: false,
          error: validation.error,
        });
      }
    } catch (err: unknown) {
      summaries.push({
        id: name,
        name: "Unreadable Trashed Project",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        assetCount: 0,
        valid: false,
        error: err instanceof Error ? err.message : "Failed to read project.json",
      });
    }
  }

  summaries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return summaries;
}

/**
 * Restores a trashed project back to the active `projects/<projectId>/` directory.
 */
export async function restoreFromTrash(
  workspaceHandle: FileSystemDirectoryHandle,
  projectId: string
): Promise<ProjectDocument> {
  if (!isValidUuid(projectId)) {
    throw new Error(`Cannot restore project: Invalid project ID "${projectId}".`);
  }

  const trashDir = await getTrashDirectory(workspaceHandle, false);
  const projectsDir = await getProjectsDirectory(workspaceHandle, true);

  const trashedProjectDir = await trashDir.getDirectoryHandle(projectId, { create: false });

  // 1. Move if supported
  if (typeof (trashedProjectDir as unknown as { move?: (dest: FileSystemDirectoryHandle, newName?: string) => Promise<void> }).move === "function") {
    try {
      await (trashedProjectDir as unknown as { move: (dest: FileSystemDirectoryHandle, newName?: string) => Promise<void> }).move(projectsDir, projectId);
      const restoredFileHandle = await (await projectsDir.getDirectoryHandle(projectId, { create: false })).getFileHandle(PROJECT_DOC_FILE_NAME, { create: false });
      const f = await restoredFileHandle.getFile();
      const text = await f.text();
      return JSON.parse(text) as ProjectDocument;
    } catch {
      // Fall through to staged copy
    }
  }

  // 2. Staged copy back to projects/<projectId>/
  const restoredTargetDir = await projectsDir.getDirectoryHandle(projectId, { create: true });
  await copyDirectoryRecursive(trashedProjectDir, restoredTargetDir);

  // 3. Remove from trash
  try {
    await trashDir.removeEntry(projectId, { recursive: true });
  } catch {
    await removeDirectoryContentsRecursive(trashDir, projectId);
  }

  // Read and validate restored document
  const fileHandle = await restoredTargetDir.getFileHandle(PROJECT_DOC_FILE_NAME, { create: false });
  const file = await fileHandle.getFile();
  const text = await file.text();
  const raw = JSON.parse(text);
  const validation = validateProjectDocument(raw);
  if (!validation.ok) {
    throw new Error(`Restored project validation failed: ${validation.error}`);
  }

  return validation.data;
}

/**
 * Permanently deletes a trashed project folder.
 * STRICT SAFETY RULE: Deletion is strictly bounded to `trash/<projectId>/`.
 * Never touches original source files or active projects.
 */
export async function permanentlyDeleteProject(
  workspaceHandle: FileSystemDirectoryHandle,
  projectId: string
): Promise<void> {
  if (!isValidUuid(projectId)) {
    throw new Error(`Cannot permanently delete: Invalid project ID "${projectId}".`);
  }

  const trashDir = await getTrashDirectory(workspaceHandle, false);

  try {
    await trashDir.removeEntry(projectId, { recursive: true });
  } catch {
    await removeDirectoryContentsRecursive(trashDir, projectId);
  }
}

/**
 * Permanently deletes all trashed projects in the workspace.
 */
export async function emptyTrash(
  workspaceHandle: FileSystemDirectoryHandle
): Promise<number> {
  let trashDir: FileSystemDirectoryHandle;
  try {
    trashDir = await getTrashDirectory(workspaceHandle, false);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "NotFoundError") {
      return 0;
    }
    throw err;
  }

  let count = 0;
  for await (const [name, handle] of (trashDir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    if (handle.kind === "directory" && isValidUuid(name)) {
      try {
        await trashDir.removeEntry(name, { recursive: true });
        count++;
      } catch {
        try {
          await removeDirectoryContentsRecursive(trashDir, name);
          count++;
        } catch {}
      }
    }
  }

  return count;
}

/**
 * Recursively copies all entries from source directory into target directory.
 */
async function copyDirectoryRecursive(
  sourceDir: FileSystemDirectoryHandle,
  targetDir: FileSystemDirectoryHandle
): Promise<void> {
  for await (const [name, handle] of (sourceDir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    if (handle.kind === "directory") {
      const subSource = handle as FileSystemDirectoryHandle;
      const subTarget = await targetDir.getDirectoryHandle(name, { create: true });
      await copyDirectoryRecursive(subSource, subTarget);
    } else if (handle.kind === "file") {
      const sourceFileHandle = handle as FileSystemFileHandle;
      const file = await sourceFileHandle.getFile();
      const targetFileHandle = await targetDir.getFileHandle(name, { create: true });
      const writable = await targetFileHandle.createWritable();
      if (typeof file.stream === "function") {
        const stream = file.stream();
        if (
          typeof (writable as unknown as { write?: (data: unknown) => Promise<void> }).write === "function" &&
          typeof (writable as unknown as { getWriter?: unknown }).getWriter !== "function"
        ) {
          const reader = stream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await (writable as unknown as { write: (data: unknown) => Promise<void> }).write(value);
          }
          if (typeof (writable as unknown as { close?: () => Promise<void> }).close === "function") {
            await (writable as unknown as { close: () => Promise<void> }).close();
          }
        } else {
          await stream.pipeTo(writable as unknown as WritableStream);
        }
      } else {
        let data: unknown = "";
        if (typeof file.text === "function") {
          data = await file.text();
        } else if (typeof file.arrayBuffer === "function") {
          data = new Uint8Array(await file.arrayBuffer());
        }
        await (writable as unknown as { write: (data: unknown) => Promise<void> }).write(data);
        if (typeof (writable as unknown as { close?: () => Promise<void> }).close === "function") {
          await (writable as unknown as { close: () => Promise<void> }).close();
        }
      }
    }
  }
}

/**
 * Fallback bounded directory removal when recursive removeEntry is unsupported.
 */
async function removeDirectoryContentsRecursive(
  parentDir: FileSystemDirectoryHandle,
  dirName: string
): Promise<void> {
  const dir = await parentDir.getDirectoryHandle(dirName, { create: false });
  for await (const [entryName, entryHandle] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    if (entryHandle.kind === "file") {
      await dir.removeEntry(entryName);
    } else if (entryHandle.kind === "directory") {
      await removeDirectoryContentsRecursive(dir, entryName);
    }
  }
  await parentDir.removeEntry(dirName);
}
