/**
 * Progressive file writing and workspace destination management (Phase 5).
 *
 * Rules:
 * - Uses FileSystemFileHandle.createWritable() to stream output chunks directly to disk.
 * - Writes to a temporary file while rendering, promoting to final filename only upon success.
 * - On abort or error, closes the stream and deletes the temporary file.
 * - Never overwrites an existing export silently.
 * - Source media and prior exports are strictly preserved.
 */

import { StreamTarget, BufferTarget, Target } from "mediabunny";

export const EXPORTS_DIR_NAME = "exports";
export const MAX_FALLBACK_BUFFER_BYTES = 500 * 1024 * 1024; // 500 MB safe limit for fallback

export interface ExportWriter {
  target: Target;
  targetType: "filesystem-stream" | "memory-fallback";
  finalFilename: string;
  relativePath: string;
  finalize(): Promise<File>;
  abort(): Promise<void>;
}

export interface WorkspaceWriterOptions {
  workspaceHandle?: FileSystemDirectoryHandle;
  projectId: string;
  preferredFilename: string;
  allowOverwrite?: boolean;
}

/**
 * Sanitizes a filename, stripping path traversal and invalid characters.
 */
export function sanitizeExportFilename(name: string, fallbackExtension: string = ".mp4"): string {
  // Extract basename only to prevent directory traversal
  const segments = name.replace(/\\/g, "/").split("/").filter(Boolean);
  const basename = segments.pop() || "export";

  let cleaned = basename.trim().replace(/[/\\?%*:|"<>]/g, "_");
  cleaned = cleaned.replace(/^[._]+/, ""); // remove leading dots or underscores
  if (cleaned.length === 0) {
    cleaned = `export-${Date.now()}`;
  }
  if (!cleaned.toLowerCase().endsWith(".mp4") && !cleaned.toLowerCase().endsWith(".webm")) {
    cleaned += fallbackExtension;
  }
  return cleaned;
}

/**
 * Ensures the `projects/<projectId>/exports/` directory exists under workspace.
 */
export async function getExportsDirectory(
  workspaceHandle: FileSystemDirectoryHandle,
  projectId: string,
  create: boolean = true
): Promise<FileSystemDirectoryHandle> {
  const projectsDir = await workspaceHandle.getDirectoryHandle("projects", { create });
  const projectDir = await projectsDir.getDirectoryHandle(projectId, { create });
  return await projectDir.getDirectoryHandle(EXPORTS_DIR_NAME, { create });
}

/**
 * Finds an available filename if the preferred name already exists, avoiding silent overwrite.
 */
export async function findAvailableFilename(
  exportsDir: FileSystemDirectoryHandle,
  preferredName: string
): Promise<string> {
  const extIndex = preferredName.lastIndexOf(".");
  const base = extIndex !== -1 ? preferredName.slice(0, extIndex) : preferredName;
  const ext = extIndex !== -1 ? preferredName.slice(extIndex) : "";

  let candidate = preferredName;
  let counter = 1;

  while (true) {
    try {
      await exportsDir.getFileHandle(candidate, { create: false });
      // If found, increment counter and check again
      candidate = `${base} (${counter})${ext}`;
      counter++;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "NotFoundError") {
        // Name is available
        return candidate;
      }
      // Any other error (or unsupported directory handle), return candidate
      return candidate;
    }
  }
}

/**
 * Creates a staged progressive writer backed by the File System Access API.
 */
export async function createWorkspaceProgressiveWriter(
  options: WorkspaceWriterOptions
): Promise<ExportWriter> {
  const { workspaceHandle, projectId, preferredFilename, allowOverwrite } = options;

  if (!workspaceHandle) {
    return createMemoryFallbackWriter(preferredFilename);
  }

  const cleanFilename = sanitizeExportFilename(preferredFilename);
  const exportsDir = await getExportsDirectory(workspaceHandle, projectId, true);

  const finalFilename = allowOverwrite
    ? cleanFilename
    : await findAvailableFilename(exportsDir, cleanFilename);

  const tempFilename = `.tmp_${crypto.randomUUID().slice(0, 8)}_${finalFilename}`;
  const tempFileHandle = await exportsDir.getFileHandle(tempFilename, { create: true });

  if (typeof tempFileHandle.createWritable !== "function") {
    // If the browser does not support writable file streams on handles, fall back to memory writer
    return createMemoryFallbackWriter(preferredFilename);
  }

  const writable = await tempFileHandle.createWritable();
  const target = new StreamTarget(writable as unknown as WritableStream);

  const relativePath = `projects/${projectId}/${EXPORTS_DIR_NAME}/${finalFilename}`;

  let isClosed = false;

  return {
    target,
    targetType: "filesystem-stream",
    finalFilename,
    relativePath,

    async finalize(): Promise<File> {
      if (isClosed) {
        throw new Error("Writer has already been closed.");
      }
      isClosed = true;

      // Close underlying writable stream if not locked or already closed
      if (!writable.locked) {
        try {
          await writable.close();
        } catch {
          // Stream may have already closed during Output.finalize()
        }
      }

      const tempFile = await tempFileHandle.getFile();
      if (tempFile.size === 0) {
        try {
          await exportsDir.removeEntry(tempFilename);
        } catch {}
        throw new Error("Export produced an empty (0-byte) output file.");
      }

      // Atomically promote temporary file to final output name
      try {
        // Chromium FileSystemHandle.move() if supported
        if (typeof (tempFileHandle as unknown as { move?: (name: string) => Promise<void> }).move === "function") {
          await (tempFileHandle as unknown as { move: (name: string) => Promise<void> }).move(finalFilename);
          const finalHandle = await exportsDir.getFileHandle(finalFilename, { create: false });
          return await finalHandle.getFile();
        }
      } catch {
        // Fall back to stream-copy promotion if move is unsupported
      }

      // Staged stream-copy promotion
      const finalFileHandle = await exportsDir.getFileHandle(finalFilename, { create: true });
      const finalWritable = await finalFileHandle.createWritable();
      const readStream = tempFile.stream();

      if (
        typeof (finalWritable as unknown as { write?: (data: unknown) => Promise<void> }).write === "function" &&
        typeof (finalWritable as unknown as { getWriter?: unknown }).getWriter !== "function"
      ) {
        const reader = readStream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await (finalWritable as unknown as { write: (data: unknown) => Promise<void> }).write(value);
        }
        if (typeof (finalWritable as unknown as { close?: () => Promise<void> }).close === "function") {
          await (finalWritable as unknown as { close: () => Promise<void> }).close();
        }
      } else {
        await readStream.pipeTo(finalWritable as unknown as WritableStream);
      }

      // Clean up temp file
      try {
        await exportsDir.removeEntry(tempFilename);
      } catch {}

      return await finalFileHandle.getFile();
    },

    async abort(): Promise<void> {
      if (isClosed) return;
      isClosed = true;

      try {
        await writable.abort();
      } catch {}

      try {
        await exportsDir.removeEntry(tempFilename);
      } catch {}
    },
  };
}

/**
 * Creates an in-memory buffer writer as fallback when File System Access API is unavailable.
 */
export function createMemoryFallbackWriter(preferredFilename: string): ExportWriter {
  const finalFilename = sanitizeExportFilename(preferredFilename);
  const target = new BufferTarget();
  let isClosed = false;

  return {
    target,
    targetType: "memory-fallback",
    finalFilename,
    relativePath: `exports/${finalFilename}`,

    async finalize(): Promise<File> {
      if (isClosed) {
        throw new Error("Writer has already been closed.");
      }
      isClosed = true;

      const buffer = target.buffer;
      if (!buffer || buffer.byteLength === 0) {
        throw new Error("Export produced an empty (0-byte) output buffer.");
      }

      if (buffer.byteLength > MAX_FALLBACK_BUFFER_BYTES) {
        throw new Error(
          `Export exceeded safe in-memory limit (${Math.round(buffer.byteLength / 1024 / 1024)} MB). Please use Chrome or Edge with workspace folder permissions.`
        );
      }

      const mimeType = finalFilename.endsWith(".webm") ? "video/webm" : "video/mp4";
      return new File([buffer], finalFilename, { type: mimeType, lastModified: Date.now() });
    },

    async abort(): Promise<void> {
      isClosed = true;
      target.buffer = null;
    },
  };
}
