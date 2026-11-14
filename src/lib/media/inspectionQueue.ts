/**
 * Bounded asynchronous inspection queue with cancellation and stale result protection (Phase 3).
 *
 * Rules:
 * - Bounds concurrency (default 1) to prevent starving browser I/O or preview playback.
 * - Supports cancellation via AbortController when projects switch or assets are removed.
 * - Protects against stale asynchronous results using generational token matching.
 * - Releases File references promptly upon completion.
 */

import { inspectMediaFile } from "./inspector.ts";
import type { MediaInspectionResult } from "./types.ts";

interface QueueTask {
  assetId: string;
  file: File;
  token: number;
  abortController: AbortController;
  onComplete: (result: MediaInspectionResult) => void;
}

export class MediaInspectionQueue {
  private queue: QueueTask[] = [];
  private activeTask: QueueTask | null = null;
  private assetTokens = new Map<string, number>();
  private readonly maxConcurrency: number;

  constructor(maxConcurrency = 1) {
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }

  /**
   * Enqueues an asset file for inspection.
   * If an inspection for this asset was already queued or active, it is invalidated.
   * Returns a cancellation function.
   */
  enqueue(
    assetId: string,
    file: File,
    onComplete: (result: MediaInspectionResult) => void
  ): () => void {
    // Increment generation token for this asset so any in-flight task is ignored
    const nextToken = (this.assetTokens.get(assetId) || 0) + 1;
    this.assetTokens.set(assetId, nextToken);

    // If active task is for this asset, abort it
    if (this.activeTask?.assetId === assetId) {
      this.activeTask.abortController.abort();
    }

    // Remove any pending queued tasks for this asset
    this.queue = this.queue.filter((t) => t.assetId !== assetId);

    const task: QueueTask = {
      assetId,
      file,
      token: nextToken,
      abortController: new AbortController(),
      onComplete,
    };

    this.queue.push(task);
    this.pump();

    return () => {
      this.cancel(assetId);
    };
  }

  /**
   * Cancels any pending or active inspection for a specific asset.
   */
  cancel(assetId: string): void {
    // Invalidate token
    const token = (this.assetTokens.get(assetId) || 0) + 1;
    this.assetTokens.set(assetId, token);

    if (this.activeTask?.assetId === assetId) {
      this.activeTask.abortController.abort();
    }

    this.queue = this.queue.filter((t) => t.assetId !== assetId);
  }

  /**
   * Cancels all pending and in-flight inspections.
   */
  cancelAll(): void {
    this.assetTokens.clear();
    if (this.activeTask) {
      this.activeTask.abortController.abort();
      this.activeTask = null;
    }
    this.queue = [];
  }

  /**
   * Current count of queued (pending) tasks.
   */
  get pendingCount(): number {
    return this.queue.length;
  }

  /**
   * Whether an inspection is actively executing.
   */
  get isRunning(): boolean {
    return this.activeTask !== null;
  }

  private pump(): void {
    if (this.activeTask !== null || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift()!;
    this.activeTask = task;

    void (async () => {
      try {
        const result = await inspectMediaFile(task.file, {
          signal: task.abortController.signal,
        });

        // Stale check: verify token still matches
        const currentToken = this.assetTokens.get(task.assetId);
        if (currentToken === task.token && !task.abortController.signal.aborted) {
          task.onComplete(result);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Aborted cleanly; do not notify caller
          return;
        }
        const currentToken = this.assetTokens.get(task.assetId);
        if (currentToken === task.token && !task.abortController.signal.aborted) {
          task.onComplete({
            status: "error",
            error: err instanceof Error ? err.message : "Inspection failed.",
          });
        }
      } finally {
        if (this.activeTask === task) {
          this.activeTask = null;
        }
        this.pump();
      }
    })();
  }
}

