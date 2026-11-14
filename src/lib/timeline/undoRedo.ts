/**
 * Bounded undo/redo stack for timeline state.
 *
 * Rules:
 * - Stores only serializable TimelineDocument snapshots
 * - Maximum history entries configurable (default 50)
 * - No File, Blob, HTMLElement, or any browser object stored
 * - Current position pointer allows undo and redo within the stored history
 */

import type { TimelineDocument } from "../../types/timeline.ts";

/**
 * Undo/redo stack for TimelineDocument snapshots.
 *
 * Usage pattern:
 *   stack.push(currentTimeline);   // snapshot before the edit
 *   const newTimeline = applyEdit(currentTimeline);
 *   setTimeline(newTimeline);
 *
 *   // Later:
 *   const prev = stack.undo();
 *   if (prev) setTimeline(prev);
 */
export class TimelineUndoStack {
  private readonly maxSize: number;
  /**
   * Stored snapshots. Index 0 is the oldest.
   * `cursor` points to the active snapshot in history.
   */
  private history: TimelineDocument[] = [];
  /**
   * Index into `history` of the active state.
   * -1 means the stack is empty.
   */
  private cursor: number = -1;

  constructor(initialStateOrMaxSize?: TimelineDocument | number, maxSize: number = 50) {
    let effectiveMaxSize = maxSize;
    let initialDoc: TimelineDocument | undefined;

    if (typeof initialStateOrMaxSize === "number") {
      effectiveMaxSize = initialStateOrMaxSize;
    } else if (initialStateOrMaxSize && typeof initialStateOrMaxSize === "object") {
      initialDoc = initialStateOrMaxSize;
    }

    if (effectiveMaxSize < 1) {
      throw new RangeError("TimelineUndoStack: maxSize must be >= 1");
    }
    this.maxSize = effectiveMaxSize;

    if (initialDoc) {
      this.init(initialDoc);
    }
  }

  /**
   * Resets the undo stack and seeds it with an initial timeline state.
   */
  init(state: TimelineDocument): void {
    this.history = [deepClone(state)];
    this.cursor = 0;
  }

  /**
   * Pushes a snapshot of the current state before an edit is applied.
   * Any redo history ahead of the cursor is discarded (new branch).
   */
  push(state: TimelineDocument): void {
    // Discard any redo entries that are now invalidated
    if (this.cursor < this.history.length - 1) {
      this.history = this.history.slice(0, this.cursor + 1);
    }

    this.history.push(deepClone(state));

    // Evict oldest entry when over capacity
    if (this.history.length > this.maxSize) {
      this.history.shift();
    }

    this.cursor = this.history.length - 1;
  }

  /**
   * Returns the previous state (before the last push) and moves the cursor
   * back. Returns null if already at the oldest entry.
   */
  undo(): TimelineDocument | null {
    if (this.cursor <= 0) return null;
    this.cursor -= 1;
    return deepClone(this.history[this.cursor]);
  }

  /**
   * Returns the next state (re-applies the most recently undone edit) and
   * moves the cursor forward. Returns null if there is nothing to redo.
   */
  redo(): TimelineDocument | null {
    if (this.cursor >= this.history.length - 1) return null;
    this.cursor += 1;
    return deepClone(this.history[this.cursor]);
  }

  /** True when undo() would return a state. */
  canUndo(): boolean {
    return this.cursor > 0;
  }

  /** True when redo() would return a state. */
  canRedo(): boolean {
    return this.cursor < this.history.length - 1;
  }

  /** Clears all history and resets the cursor. */
  clear(): void {
    this.history = [];
    this.cursor = -1;
  }

  /** Number of snapshots currently stored. */
  get size(): number {
    return this.history.length;
  }

  /** Returns the active snapshot without moving the cursor. */
  current(): TimelineDocument | null {
    if (this.cursor < 0 || this.cursor >= this.history.length) return null;
    return deepClone(this.history[this.cursor]);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deep-clones a TimelineDocument via JSON round-trip.
 * Safe because TimelineDocument is fully JSON-serializable.
 */
function deepClone(doc: TimelineDocument): TimelineDocument {
  return JSON.parse(JSON.stringify(doc)) as TimelineDocument;
}
