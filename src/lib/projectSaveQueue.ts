/**
 * Serialized project save queue with debounce and state management.
 *
 * Rules:
 * - Writes are serialized so overlapping autosaves never complete out of order.
 * - Debounces rapid edits (e.g. 600ms).
 * - Tracks visible save state: "saved" | "saving" | "error".
 * - Allows immediate flush when navigating or closing a project.
 * - Provides retry functionality after write failures.
 */

import type { ProjectDocument, SaveState } from "../types/project.ts";
import { writeProject } from "./workspace.ts";

export type SaveListener = (state: SaveState, error?: string) => void;

export class ProjectSaveQueue {
  private workspaceHandle: FileSystemDirectoryHandle;
  private pendingDoc: ProjectDocument | null = null;
  private currentPromise: Promise<void> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;
  private listeners = new Set<SaveListener>();

  public state: SaveState = "saved";
  public lastError: string | undefined = undefined;

  constructor(
    workspaceHandle: FileSystemDirectoryHandle,
    debounceMs: number = 600
  ) {
    this.workspaceHandle = workspaceHandle;
    this.debounceMs = debounceMs;
  }

  public subscribe(listener: SaveListener): () => void {
    this.listeners.add(listener);
    listener(this.state, this.lastError);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(state: SaveState, error?: string): void {
    this.state = state;
    this.lastError = error;
    for (const listener of this.listeners) {
      listener(state, error);
    }
  }

  /**
   * Enqueues a project document to be saved after debounce.
   */
  public enqueue(doc: ProjectDocument): void {
    this.pendingDoc = doc;
    this.notify("saving");

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /**
   * Immediately flushes any pending save without waiting for debounce.
   * Returns a promise that resolves once the write is safely committed.
   */
  public async flush(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (!this.pendingDoc) {
      if (!this.currentPromise) {
        if (this.state === "saving") {
          this.notify("saved");
        }
      }
      return this.currentPromise || Promise.resolve();
    }

    const docToWrite = this.pendingDoc;
    this.pendingDoc = null;

    // Chain onto current write promise to serialize
    const previousPromise = this.currentPromise || Promise.resolve();
    this.currentPromise = (async () => {
      try {
        await previousPromise;
      } catch {
        // Ignore previous errors so subsequent attempts can proceed
      }

      this.notify("saving");
      try {
        await writeProject(this.workspaceHandle, docToWrite);
        this.notify("saved");
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : "Failed to save project.";
        this.pendingDoc = docToWrite; // retain pending doc for retry
        this.notify("error", errorMsg);
        throw err;
      } finally {
        if (this.pendingDoc === null) {
          this.currentPromise = null;
        }
      }
    })();

    return this.currentPromise;
  }

  /**
   * Retries saving the pending document after a failure.
   */
  public async retry(): Promise<void> {
    if (this.pendingDoc) {
      return this.flush();
    }
  }

  /**
   * Cancels pending debounced save.
   */
  public cancel(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingDoc = null;
    this.notify("saved");
  }
}
