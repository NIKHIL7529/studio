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
   * `cursor` points to the entry that would be returned by the next undo().
   */
  private history: TimelineDocument[] = [];
  /**
   * Index into `history` of the "current" entry — i.e. the state that was
   * current when push() was called most recently (or after the last
   * undo/redo navigation).
   *
   * -1 means the stack is empty.
   */
  private cursor: number = -1;

  constructor(maxSize: number = 50) {
    if (maxSize < 1) {
      throw new RangeError("TimelineUndoStack: maxSize must be >= 1");
    }
    this.maxSize = maxSize;
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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deep-clones a TimelineDocument via JSON round-trip.
 * Safe because TimelineDocument is fully JSON-serializable.
 */
function deepClone(doc: TimelineDocument): TimelineDocument {
  return JSON.parse(JSON.stringify(doc)) as TimelineDocument;
}
