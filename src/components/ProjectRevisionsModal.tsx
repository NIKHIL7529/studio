"use client";

/**
 * ProjectRevisionsModal — Project version history and recovery (Phase 6).
 *
 * Rules:
 * - Allows creators to view historical project snapshots stored in projects/<id>/revisions/.
 * - Explicitly explains that restoring an older revision preserves the active project state as a checkpoint first.
 * - Does not overwrite or delete completed exports when restoring.
 * - Allows creating an immediate manual checkpoint anytime.
 */

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import type { ProjectDocument, ProjectRevisionMetadata } from "../types/project.ts";
import {
  listProjectRevisions,
  createProjectRevision,
  restoreProjectRevision,
} from "../lib/projectRevisions.ts";
import { formatBytes } from "../lib/projectValidation.ts";
import { Button, Modal } from "@/components/ui";

export interface ProjectRevisionsModalProps {
  isOpen: boolean;
  project: ProjectDocument;
  workspaceHandle: FileSystemDirectoryHandle;
  onClose: () => void;
  onProjectRestored: (restoredDoc: ProjectDocument) => void;
}

export function ProjectRevisionsModal({
  isOpen,
  project,
  workspaceHandle,
  onClose,
  onProjectRestored,
}: ProjectRevisionsModalProps) {
  const [revisions, setRevisions] = useState<ProjectRevisionMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual checkpoint state
  const [checkpointReason, setCheckpointReason] = useState("");
  const [isCreatingCheckpoint, setIsCreatingCheckpoint] = useState(false);

  // Restore confirmation modal
  const [targetRevision, setTargetRevision] = useState<ProjectRevisionMetadata | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const loadRevisions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await listProjectRevisions(workspaceHandle, project.id);
      setRevisions(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load project revisions.");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceHandle, project.id]);

  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;

    void Promise.resolve().then(async () => {
      if (isCancelled) return;
      setIsLoading(true);
      setError(null);
      try {
        const list = await listProjectRevisions(workspaceHandle, project.id);
        if (!isCancelled) setRevisions(list);
      } catch (err: unknown) {
        if (!isCancelled) setError(err instanceof Error ? err.message : "Failed to load project revisions.");
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, workspaceHandle, project.id]);

  const handleCreateCheckpoint = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const reason = checkpointReason.trim() || "Manual Checkpoint";
    setIsCreatingCheckpoint(true);
    setError(null);
    try {
      const created = await createProjectRevision(workspaceHandle, project, reason, { force: true });
      if (created) {
        setCheckpointReason("");
        await loadRevisions();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create checkpoint.");
    } finally {
      setIsCreatingCheckpoint(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!targetRevision) return;
    setIsRestoring(true);
    setError(null);
    try {
      const { restoredDoc } = await restoreProjectRevision(
        workspaceHandle,
        project.id,
        targetRevision.id,
        project
      );
      setTargetRevision(null);
      onProjectRestored(restoredDoc);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to restore revision.");
      setIsRestoring(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <Modal
        open={isOpen}
        onClose={onClose}
        title="Project Revision History"
        description="View and restore historical versions of this project. Revisions are stored safely in your workspace."
      >
        <div className="space-y-4">
          {error && (
            <div className="p-3 rounded bg-cs-error/10 border border-cs-error/20 text-xs text-cs-error flex items-start gap-2">
              <span>⚠️</span>
              <p className="flex-1">{error}</p>
            </div>
          )}

          {/* Create manual checkpoint */}
          <form
            onSubmit={handleCreateCheckpoint}
            className="flex items-center gap-2 p-3 rounded-lg bg-cs-bg-surface border border-cs-border-subtle"
          >
            <input
              type="text"
              placeholder="Checkpoint description (e.g., Before trimming clips)"
              value={checkpointReason}
              onChange={(e) => setCheckpointReason(e.target.value)}
              className="flex-1 bg-cs-bg-base border border-cs-border-subtle rounded px-2.5 py-1.5 text-xs text-cs-text-primary focus:outline-none focus:border-cs-accent"
            />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={isCreatingCheckpoint}
            >
              {isCreatingCheckpoint ? "Saving…" : "Save Checkpoint"}
            </Button>
          </form>

          {/* Revisions list */}
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {isLoading ? (
              <div className="py-8 text-center text-xs text-cs-text-tertiary">
                Loading revisions…
              </div>
            ) : revisions.length === 0 ? (
              <div className="py-8 text-center text-xs text-cs-text-tertiary">
                No saved revisions yet. Use &ldquo;Save Checkpoint&rdquo; to create your first snapshot.
              </div>
            ) : (
              revisions.map((rev, index) => (
                <div
                  key={rev.id}
                  className="p-3 rounded-lg border border-cs-border-subtle bg-cs-bg-surface flex items-center justify-between text-xs hover:border-cs-border-default transition-colors"
                >
                  <div className="space-y-1 min-w-0 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-cs-text-primary truncate">
                        {rev.reason}
                      </span>
                      {index === 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cs-accent/15 text-cs-accent font-medium">
                          Latest
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-cs-text-secondary flex items-center gap-2">
                      <span>{new Date(rev.createdAt).toLocaleString()}</span>
                      <span>•</span>
                      <span>{rev.assetCount} asset(s)</span>
                      <span>•</span>
                      <span>{formatBytes(rev.byteSize)}</span>
                    </div>
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setTargetRevision(rev)}
                    disabled={isRestoring}
                  >
                    Restore
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="flex justify-end pt-2 border-t border-cs-border-subtle">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirmation Modal Before Restore */}
      <Modal
        open={targetRevision !== null}
        onClose={() => {
          if (!isRestoring) setTargetRevision(null);
        }}
        title="Confirm Revision Restore"
        description="Are you sure you want to restore this older project revision?"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setTargetRevision(null)}
              disabled={isRestoring}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleConfirmRestore}
              disabled={isRestoring}
            >
              {isRestoring ? "Restoring…" : "Restore Revision"}
            </Button>
          </>
        }
      >
        {targetRevision && (
          <div className="text-xs text-cs-text-secondary space-y-3 leading-relaxed">
            <div className="p-3 rounded bg-cs-bg-surface border border-cs-border-subtle space-y-1">
              <p className="font-semibold text-cs-text-primary">
                {targetRevision.reason}
              </p>
              <p className="text-[11px] text-cs-text-tertiary">
                Created: {new Date(targetRevision.createdAt).toLocaleString()} ({formatBytes(targetRevision.byteSize)})
              </p>
            </div>
            <div className="p-3 rounded bg-cs-info/10 border border-cs-info/20 text-cs-text-primary space-y-1">
              <p className="font-medium text-cs-info">Data Safety Guarantee</p>
              <p className="text-[11px] text-cs-text-secondary">
                A safety checkpoint of your <strong>current editing state</strong> will be automatically saved before restoring. Completed export files will <strong>not</strong> be removed or overwritten.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
