/**
 * Export history and output lifecycle management (Phase 6).
 *
 * Rules:
 * - Completed outputs are stored in projects/<projectId>/exports/
 * - Every export record is tracked in ProjectDocument.exports
 * - Users can open/download, rename, and delete completed outputs.
 * - Deletion targets only application-managed exports in exports/<filename>.
 * - Source media and timeline documents are NEVER touched by export deletion.
 * - Missing outputs are surfaced as recoverable states rather than silently discarded.
 */

import type { ProjectExport } from "../../types/project.ts";
import { isValidUuid } from "../projectValidation.ts";
import { getExportsDirectory, sanitizeExportFilename } from "./progressiveWriter.ts";

export interface ExportFileStatus {
  exists: boolean;
  file?: File;
  fileHandle?: FileSystemFileHandle;
  error?: string;
}

/**
 * Checks whether an exported output file still exists in the workspace.
 */
export async function checkExportFileStatus(
  workspaceHandle: FileSystemDirectoryHandle,
  projectId: string,
  filename: string
): Promise<ExportFileStatus> {
  if (!isValidUuid(projectId)) {
    return { exists: false, error: "Invalid project ID" };
  }

  try {
    const exportsDir = await getExportsDirectory(workspaceHandle, projectId, false);
    const fileHandle = await exportsDir.getFileHandle(filename, { create: false });
    const file = await fileHandle.getFile();
    if (file.size === 0) {
      return { exists: false, error: "Output file is empty (0 bytes)." };
    }
    return { exists: true, file, fileHandle };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "NotFoundError") {
      return { exists: false, error: "Output file not found at original location." };
    }
    return {
      exists: false,
      error: err instanceof Error ? err.message : "Failed to access output file.",
    };
  }
}

/**
 * Renames an application-managed export file and updates its metadata in the exports list.
 */
export async function renameExport(
  workspaceHandle: FileSystemDirectoryHandle,
  projectId: string,
  exportId: string,
  currentExports: ProjectExport[],
  desiredName: string
): Promise<{ updatedExports: ProjectExport[]; renamedExport: ProjectExport }> {
  if (!isValidUuid(projectId)) {
    throw new Error(`Invalid project ID: "${projectId}".`);
  }

  const exportRecord = currentExports.find((e) => e.id === exportId);
  if (!exportRecord) {
    throw new Error(`Export record not found for ID "${exportId}".`);
  }

  const exportsDir = await getExportsDirectory(workspaceHandle, projectId, false);
  const oldFilename = exportRecord.name;
  const extension = oldFilename.slice(oldFilename.lastIndexOf(".")) || ".mp4";
  const newFilename = sanitizeExportFilename(desiredName, extension);

  if (oldFilename === newFilename) {
    return { updatedExports: currentExports, renamedExport: exportRecord };
  }

  // Ensure new filename does not conflict with an existing file
  try {
    await exportsDir.getFileHandle(newFilename, { create: false });
    throw new Error(`A file named "${newFilename}" already exists in the exports directory.`);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("already exists")) {
      throw err;
    }
    // NotFoundError is expected when name is available
  }

  // Rename on disk
  const oldHandle = await exportsDir.getFileHandle(oldFilename, { create: false });

  if (typeof (oldHandle as unknown as { move?: (name: string) => Promise<void> }).move === "function") {
    await (oldHandle as unknown as { move: (name: string) => Promise<void> }).move(newFilename);
  } else {
    // Stream-copy promotion fallback
    const oldFile = await oldHandle.getFile();
    const newHandle = await exportsDir.getFileHandle(newFilename, { create: true });
    const writable = await newHandle.createWritable();
    const stream = oldFile.stream();

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

    // Remove old file
    try {
      await exportsDir.removeEntry(oldFilename);
    } catch {}
  }

  const updatedRecord: ProjectExport = {
    ...exportRecord,
    name: newFilename,
    relativePath: `projects/${projectId}/exports/${newFilename}`,
  };

  const updatedExports = currentExports.map((e) => (e.id === exportId ? updatedRecord : e));
  return { updatedExports, renamedExport: updatedRecord };
}

/**
 * Safely deletes an export output and removes its record from the project exports.
 * NEVER deletes or touches original source media.
 */
export async function deleteExport(
  workspaceHandle: FileSystemDirectoryHandle,
  projectId: string,
  exportId: string,
  currentExports: ProjectExport[],
  deleteFileOnDisk: boolean = true
): Promise<ProjectExport[]> {
  if (!isValidUuid(projectId)) {
    throw new Error(`Invalid project ID: "${projectId}".`);
  }

  const exportRecord = currentExports.find((e) => e.id === exportId);
  if (!exportRecord) {
    return currentExports;
  }

  if (deleteFileOnDisk) {
    try {
      const exportsDir = await getExportsDirectory(workspaceHandle, projectId, false);
      await exportsDir.removeEntry(exportRecord.name);
    } catch (err: unknown) {
      // If file was already deleted externally, proceed with removing the history record
      if (!(err instanceof Error && err.name === "NotFoundError")) {
        console.warn(`Failed to delete export file "${exportRecord.name}":`, err);
      }
    }
  }

  return currentExports.filter((e) => e.id !== exportId);
}
