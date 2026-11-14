/**
 * Minimal typed IndexedDB wrapper for Content Studio.
 *
 * Rules:
 * - Stores ONLY FileSystemDirectoryHandle (workspace) and FileSystemFileHandle
 *   (source media) references using structured cloning.
 * - NEVER mirrors project documents, timelines, or media bytes into IndexedDB.
 * - Defensive against SSR environments, private browsing restrictions, and
 *   structured cloning failures.
 */

const DB_NAME = "content_studio_store";
const DB_VERSION = 1;

const STORE_WORKSPACE = "workspace_handles";
const STORE_FILES = "file_handles";

interface StoredWorkspace {
  key: "active";
  handle: FileSystemDirectoryHandle;
  name: string;
  savedAt: number;
}

interface StoredFileHandle {
  handleRefId: string;
  handle: FileSystemFileHandle;
  fileName: string;
  size: number;
  lastModified?: number;
  savedAt: number;
}

/**
 * Checks if IndexedDB is available in the current environment.
 */
export function isIdbSupported(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined" && indexedDB !== null;
}

/**
 * Opens or upgrades the IndexedDB database.
 */
function openDb(): Promise<IDBDatabase> {
  if (!isIdbSupported()) {
    return Promise.reject(new Error("IndexedDB is not supported in this environment."));
  }

  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_WORKSPACE)) {
          db.createObjectStore(STORE_WORKSPACE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_FILES)) {
          db.createObjectStore(STORE_FILES, { keyPath: "handleRefId" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
      request.onblocked = () => reject(new Error("IndexedDB opening was blocked by another tab."));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Stores the active workspace directory handle in IndexedDB.
 */
export async function saveWorkspaceHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_WORKSPACE, "readwrite");
      const store = tx.objectStore(STORE_WORKSPACE);
      const record: StoredWorkspace = {
        key: "active",
        handle,
        name: handle.name || "Workspace",
        savedAt: Date.now(),
      };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error("Failed to persist workspace handle."));
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted while saving workspace handle."));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Retrieves the stored workspace directory handle, or null if not set.
 */
export async function loadWorkspaceHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (!isIdbSupported()) return null;
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_WORKSPACE, "readonly");
      const store = tx.objectStore(STORE_WORKSPACE);
      const req = store.get("active");
      req.onsuccess = () => {
        const result = req.result as StoredWorkspace | undefined;
        resolve(result?.handle ?? null);
      };
      req.onerror = () => reject(req.error || new Error("Failed to load workspace handle."));
    });
  } catch (err) {
    console.warn("Failed to load stored workspace handle from IndexedDB:", err);
    return null;
  }
}

/**
 * Clears the stored workspace handle from IndexedDB.
 */
export async function clearWorkspaceHandle(): Promise<void> {
  if (!isIdbSupported()) return;
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_WORKSPACE, "readwrite");
      const store = tx.objectStore(STORE_WORKSPACE);
      const req = store.delete("active");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error("Failed to clear workspace handle."));
    });
  } catch (err) {
    console.warn("Failed to clear workspace handle from IndexedDB:", err);
  }
}

/**
 * Stores a source file handle in IndexedDB, associated with an opaque handleRefId.
 */
export async function saveFileHandle(
  handleRefId: string,
  handle: FileSystemFileHandle,
  meta?: { fileName?: string; size?: number; lastModified?: number }
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_FILES, "readwrite");
      const store = tx.objectStore(STORE_FILES);
      const record: StoredFileHandle = {
        handleRefId,
        handle,
        fileName: meta?.fileName || handle.name || "unnamed",
        size: meta?.size || 0,
        lastModified: meta?.lastModified,
        savedAt: Date.now(),
      };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error("Failed to save file handle."));
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted while saving file handle."));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Retrieves a source file handle by its opaque handleRefId.
 */
export async function loadFileHandle(handleRefId: string): Promise<FileSystemFileHandle | null> {
  if (!isIdbSupported()) return null;
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, "readonly");
      const store = tx.objectStore(STORE_FILES);
      const req = store.get(handleRefId);
      req.onsuccess = () => {
        const result = req.result as StoredFileHandle | undefined;
        resolve(result?.handle ?? null);
      };
      req.onerror = () => reject(req.error || new Error("Failed to load file handle."));
    });
  } catch (err) {
    console.warn(`Failed to load file handle for ${handleRefId}:`, err);
    return null;
  }
}

/**
 * Removes a file handle from IndexedDB.
 */
export async function removeFileHandle(handleRefId: string): Promise<void> {
  if (!isIdbSupported()) return;
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, "readwrite");
      const store = tx.objectStore(STORE_FILES);
      const req = store.delete(handleRefId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error("Failed to delete file handle."));
    });
  } catch (err) {
    console.warn(`Failed to delete file handle for ${handleRefId}:`, err);
  }
}

/**
 * Cleans up unreferenced file handles from IndexedDB.
 * Call this when a project is deleted or after asset removals.
 */
export async function cleanupUnreferencedFileHandles(referencedIds: Set<string>): Promise<number> {
  if (!isIdbSupported()) return 0;
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, "readwrite");
      const store = tx.objectStore(STORE_FILES);
      const req = store.openCursor();
      let removedCount = 0;

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const id = cursor.key as string;
          if (!referencedIds.has(id)) {
            cursor.delete();
            removedCount++;
          }
          cursor.continue();
        } else {
          resolve(removedCount);
        }
      };

      req.onerror = () => reject(req.error || new Error("Failed during handle cleanup."));
    });
  } catch (err) {
    console.warn("Failed to cleanup unreferenced file handles:", err);
    return 0;
  }
}

