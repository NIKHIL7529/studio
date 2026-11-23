"use client";

/**
 * CacheManagerModal — Storage & Cache Management.
 *
 * Visually separates two distinct storage domains:
 * 1. Workspace Disk Cache: Local files on disk (projects/<id>/cache/, exports/.tmp_*).
 * 2. Speech Models — Browser Storage: Local Whisper model weights (120–206 MB) stored
 *    in browser OPFS (Origin Private File System).
 *
 * Rules:
 * - Speech models are NEVER automatically deleted; deletions are strictly manual.
 * - Workspace cleanup strictly protects original media, project documents, revisions, and completed exports.
 * - Reports active resource locks.
 */

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import {
  scanWorkspaceCache,
  cleanWorkspaceCache,
  type CacheCategory,
  type CacheInventoryReport,
  type CacheCleanupResult,
} from "../lib/cache/cacheManager.ts";
import {
  scanSpeechModelStorage,
  deleteSpeechModel,
  clearAllSpeechModels,
  type SpeechModelStorageReport,
} from "../lib/transcription/modelStorage.ts";
import { formatBytes } from "../lib/projectValidation.ts";
import { Button, Modal, Badge, Divider } from "@/components/ui";

export interface CacheManagerModalProps {
  isOpen: boolean;
  workspaceHandle: FileSystemDirectoryHandle;
  projectId?: string;
  onClose: () => void;
}

export function CacheManagerModal({
  isOpen,
  workspaceHandle,
  projectId,
  onClose,
}: CacheManagerModalProps) {
  // ── Workspace Disk Cache State ──────────────────────────────────────────────
  const [report, setReport] = useState<CacheInventoryReport | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [isCleaningWorkspace, setIsCleaningWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  // Category selections
  const [cleanDerived, setCleanDerived] = useState(true);
  const [cleanTemporary, setCleanTemporary] = useState(true);
  const [cleanOrphans, setCleanOrphans] = useState(true);

  // Dry run preview vs actual result
  const [dryRunResult, setDryRunResult] = useState<CacheCleanupResult | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CacheCleanupResult | null>(null);

  // ── Speech Models (Browser Storage) State ───────────────────────────────────
  const [speechReport, setSpeechReport] = useState<SpeechModelStorageReport | null>(null);
  const [isLoadingSpeech, setIsLoadingSpeech] = useState(false);
  const [speechActionLoading, setSpeechActionLoading] = useState<string | null>(null);
  const [speechSuccessMessage, setSpeechSuccessMessage] = useState<string | null>(null);
  const [speechErrorMessage, setSpeechErrorMessage] = useState<string | null>(null);

  const loadWorkspaceInventory = useCallback(async () => {
    setIsLoadingWorkspace(true);
    setWorkspaceError(null);
    try {
      const rep = await scanWorkspaceCache(workspaceHandle, projectId ? [projectId] : undefined);
      setReport(rep);
    } catch (err: unknown) {
      setWorkspaceError(err instanceof Error ? err.message : "Failed to scan workspace cache.");
    } finally {
      setIsLoadingWorkspace(false);
    }
  }, [workspaceHandle, projectId]);

  const loadSpeechStorage = useCallback(async () => {
    setIsLoadingSpeech(true);
    try {
      const rep = await scanSpeechModelStorage();
      setSpeechReport(rep);
    } catch (err: unknown) {
      console.warn("Failed to scan browser speech model storage:", err);
    } finally {
      setIsLoadingSpeech(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;

    void Promise.resolve().then(async () => {
      if (isCancelled) return;
      setDryRunResult(null);
      setCleanupResult(null);
      setSpeechSuccessMessage(null);
      setSpeechErrorMessage(null);
      await Promise.all([loadWorkspaceInventory(), loadSpeechStorage()]);
    });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, loadWorkspaceInventory, loadSpeechStorage]);

  const getSelectedCategories = (): CacheCategory[] => {
    const cats: CacheCategory[] = [];
    if (cleanDerived) cats.push("derived");
    if (cleanTemporary) cats.push("temporary");
    return cats;
  };

  const handleDryRun = async () => {
    setIsCleaningWorkspace(true);
    setWorkspaceError(null);
    try {
      const res = await cleanWorkspaceCache(workspaceHandle, {
        categories: getSelectedCategories(),
        cleanOrphans,
        dryRun: true,
        projectIds: projectId ? [projectId] : undefined,
      });
      setDryRunResult(res);
      setCleanupResult(null);
    } catch (err: unknown) {
      setWorkspaceError(err instanceof Error ? err.message : "Dry run failed.");
    } finally {
      setIsCleaningWorkspace(false);
    }
  };

  const handleExecuteCleanup = async () => {
    setIsCleaningWorkspace(true);
    setWorkspaceError(null);
    try {
      const res = await cleanWorkspaceCache(workspaceHandle, {
        categories: getSelectedCategories(),
        cleanOrphans,
        dryRun: false,
        projectIds: projectId ? [projectId] : undefined,
      });
      setCleanupResult(res);
      setDryRunResult(null);
      await loadWorkspaceInventory();
    } catch (err: unknown) {
      setWorkspaceError(err instanceof Error ? err.message : "Cache cleanup failed.");
    } finally {
      setIsCleaningWorkspace(false);
    }
  };

  // ── Speech Model Manual Actions ─────────────────────────────────────────────
  const handleDeleteSpeechModel = async (
    modelId: "whisper-tiny_timestamped" | "whisper-base_timestamped" | "whisper-tiny" | "whisper-base",
    label: string
  ) => {
    setSpeechActionLoading(modelId);
    setSpeechSuccessMessage(null);
    setSpeechErrorMessage(null);
    try {
      await deleteSpeechModel(modelId);
      setSpeechSuccessMessage(`${label} successfully deleted from browser storage.`);
      await loadSpeechStorage();
    } catch (err: unknown) {
      setSpeechErrorMessage(
        err instanceof Error ? err.message : `Failed to delete speech model "${label}".`
      );
    } finally {
      setSpeechActionLoading(null);
    }
  };

  const handleClearAllSpeechModels = async () => {
    setSpeechActionLoading("all");
    setSpeechSuccessMessage(null);
    setSpeechErrorMessage(null);
    try {
      await clearAllSpeechModels();
      setSpeechSuccessMessage("All speech models successfully removed from browser storage.");
      await loadSpeechStorage();
    } catch (err: unknown) {
      setSpeechErrorMessage(
        err instanceof Error ? err.message : "Failed to clear browser speech model storage."
      );
    } finally {
      setSpeechActionLoading(null);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Storage & Cache Management"
      description="Inspect and manage workspace disk files and on-device browser storage. Original source videos, project documents, revisions, and completed exports are never removed."
      maxWidth="xl"
    >
      <div className="space-y-6 text-xs max-h-[75vh] overflow-y-auto pr-1">
        {/* ═════════════════════════════════════════════════════════════════════ */}
        {/* SECTION 1: Workspace Disk Cache                                     */}
        {/* ═════════════════════════════════════════════════════════════════════ */}
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-1 border-b border-cs-border-subtle">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-cs-text-primary">
                  Workspace Disk Cache
                </h3>
                <Badge variant="default">Local Drive</Badge>
              </div>
              <p className="text-[11px] text-cs-text-tertiary mt-0.5">
                Regenerable waveforms, thumbnails, and temporary export files (.tmp_*) in your workspace folder
              </p>
            </div>
          </div>

          {workspaceError && (
            <div className="p-3 rounded bg-cs-error/10 border border-cs-error/20 text-cs-error flex items-start gap-2">
              <span>⚠️</span>
              <p className="flex-1">{workspaceError}</p>
            </div>
          )}

          {isLoadingWorkspace ? (
            <div className="py-6 text-center text-cs-text-tertiary">
              Scanning workspace cache files…
            </div>
          ) : report ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-cs-bg-surface border border-cs-border-subtle">
                  <span className="text-cs-text-tertiary block text-[10px] uppercase font-semibold tracking-wider mb-1">
                    Workspace Cache
                  </span>
                  <p className="text-base font-bold text-cs-text-primary">
                    {formatBytes(report.totalBytes)}
                  </p>
                  <p className="text-[11px] text-cs-text-secondary mt-0.5">
                    {report.entries.length} disposable item(s)
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-cs-bg-surface border border-cs-border-subtle">
                  <span className="text-cs-text-tertiary block text-[10px] uppercase font-semibold tracking-wider mb-1">
                    Safely Reclaimable
                  </span>
                  <p className="text-base font-bold text-emerald-400">
                    {formatBytes(report.reclaimableBytes)}
                  </p>
                  <p className="text-[11px] text-cs-text-secondary mt-0.5">
                    {report.inUseCount > 0
                      ? `${report.inUseCount} file(s) in active use (protected)`
                      : "All items eligible"}
                  </p>
                </div>
              </div>

              {/* Categories */}
              <div className="p-3 rounded-lg bg-cs-bg-surface border border-cs-border-subtle space-y-2">
                <span className="font-semibold text-cs-text-primary block text-[11px]">
                  Categories to Clean
                </span>

                <label className="flex items-center justify-between p-1.5 rounded hover:bg-cs-bg-base/50 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={cleanDerived}
                      onChange={(e) => setCleanDerived(e.target.checked)}
                      className="rounded border-cs-border-default text-cs-accent focus:ring-0"
                    />
                    <div>
                      <p className="font-medium text-cs-text-primary">Derived Cache Files</p>
                      <p className="text-[10px] text-cs-text-tertiary">Thumbnails, waveforms, and preview proxies in projects/*/cache/</p>
                    </div>
                  </div>
                  <span className="font-mono text-cs-text-secondary">
                    {formatBytes(report.derivedBytes)} ({report.derivedCount})
                  </span>
                </label>

                <label className="flex items-center justify-between p-1.5 rounded hover:bg-cs-bg-base/50 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={cleanTemporary}
                      onChange={(e) => setCleanTemporary(e.target.checked)}
                      className="rounded border-cs-border-default text-cs-accent focus:ring-0"
                    />
                    <div>
                      <p className="font-medium text-cs-text-primary">Temporary Processing Files</p>
                      <p className="text-[10px] text-cs-text-tertiary">Incomplete export chunks and temporary save files (.tmp_*)</p>
                    </div>
                  </div>
                  <span className="font-mono text-cs-text-secondary">
                    {formatBytes(report.temporaryBytes)} ({report.temporaryCount})
                  </span>
                </label>

                <label className="flex items-center justify-between p-1.5 rounded hover:bg-cs-bg-base/50 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={cleanOrphans}
                      onChange={(e) => setCleanOrphans(e.target.checked)}
                      className="rounded border-cs-border-default text-cs-accent focus:ring-0"
                    />
                    <div>
                      <p className="font-medium text-cs-text-primary">Orphaned Cache Files</p>
                      <p className="text-[10px] text-cs-text-tertiary">Unreferenced cache files from deleted projects</p>
                    </div>
                  </div>
                  <span className="font-mono text-cs-text-secondary">
                    {formatBytes(report.orphanedBytes)} ({report.orphanedCount})
                  </span>
                </label>
              </div>

              {/* Dry Run Preview View */}
              {dryRunResult && (
                <div className="p-3 rounded-lg bg-cs-info/10 border border-cs-info/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-cs-info">
                      Dry Run Preview: {dryRunResult.deletedCount} file(s) eligible
                    </span>
                    <span className="font-mono text-cs-text-primary font-bold">
                      Reclaimable: {formatBytes(dryRunResult.reclaimedBytes)}
                    </span>
                  </div>
                  <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                    {dryRunResult.deletedFiles.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-[11px] font-mono text-cs-text-secondary py-0.5 border-b border-cs-border-subtle/50"
                      >
                        <span className="truncate max-w-[260px]">{f.path}</span>
                        <span>{formatBytes(f.bytes)}</span>
                      </div>
                    ))}
                    {dryRunResult.skippedFiles.map((s, i) => (
                      <div
                        key={`s-${i}`}
                        className="flex items-center justify-between text-[11px] text-amber-400 py-0.5"
                      >
                        <span className="truncate max-w-[260px]">Skipped: {s.path}</span>
                        <span className="text-[10px]">{s.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cleanup Success Banner */}
              {cleanupResult && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 space-y-1">
                  <p className="font-semibold">Workspace Cache Cleaned</p>
                  <p className="text-[11px]">
                    Safely removed {cleanupResult.deletedCount} file(s) and reclaimed {formatBytes(cleanupResult.reclaimedBytes)}.
                  </p>
                  {cleanupResult.skippedFiles.length > 0 && (
                    <p className="text-[10px] text-amber-400 mt-1">
                      {cleanupResult.skippedFiles.length} file(s) were protected because they are in active use.
                    </p>
                  )}
                </div>
              )}

              {/* Workspace Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleDryRun}
                  disabled={
                    isLoadingWorkspace ||
                    isCleaningWorkspace ||
                    (!cleanDerived && !cleanTemporary && !cleanOrphans)
                  }
                >
                  Preview (Dry Run)
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleExecuteCleanup}
                  disabled={
                    isLoadingWorkspace ||
                    isCleaningWorkspace ||
                    report?.reclaimableBytes === 0 ||
                    (!cleanDerived && !cleanTemporary && !cleanOrphans)
                  }
                >
                  {isCleaningWorkspace ? "Cleaning…" : "Clean Reclaimable Space"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <Divider />

        {/* ═════════════════════════════════════════════════════════════════════ */}
        {/* SECTION 2: Speech Models — Browser Storage (OPFS)                   */}
        {/* ═════════════════════════════════════════════════════════════════════ */}
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-1 border-b border-cs-border-subtle">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-cs-text-primary">
                  Speech Models — Browser Storage
                </h3>
                <Badge variant="info">Browser OPFS</Badge>
              </div>
              <p className="text-[11px] text-cs-text-tertiary mt-0.5">
                On-device Whisper model weights stored in Chrome/Edge private origin storage (OPFS)
              </p>
            </div>

            {speechReport && speechReport.totalBytes > 0 && (
              <Button
                variant="danger"
                size="sm"
                onClick={handleClearAllSpeechModels}
                disabled={!!speechActionLoading}
              >
                {speechActionLoading === "all" ? "Clearing…" : "Clear All Speech Models"}
              </Button>
            )}
          </div>

          <div className="p-3 rounded-lg bg-cs-bg-muted border border-cs-border-subtle text-[11px] text-cs-text-secondary leading-relaxed">
            <span className="font-semibold text-cs-text-primary">User-Controlled Retention: </span>
            Speech models (~120 MB to ~206 MB each) are stored in your browser&apos;s isolated origin storage so you do not need to re-download them each time you edit.
            <strong className="text-cs-text-primary"> Models are never deleted automatically.</strong> Use the manual delete buttons below if you wish to reclaim disk space.
          </div>

          {speechSuccessMessage && (
            <div className="p-2.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center justify-between">
              <span>✓ {speechSuccessMessage}</span>
              <button
                onClick={() => setSpeechSuccessMessage(null)}
                className="text-emerald-400 hover:text-emerald-300 font-bold ml-2"
              >
                ×
              </button>
            </div>
          )}

          {speechErrorMessage && (
            <div className="p-2.5 rounded bg-cs-error/10 border border-cs-error/20 text-cs-error text-xs flex items-center justify-between">
              <span>⚠️ {speechErrorMessage}</span>
              <button
                onClick={() => setSpeechErrorMessage(null)}
                className="text-cs-error hover:text-red-300 font-bold ml-2"
              >
                ×
              </button>
            </div>
          )}

          {isLoadingSpeech ? (
            <div className="py-6 text-center text-cs-text-tertiary">
              Inspecting browser speech model storage…
            </div>
          ) : speechReport ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1 text-[11px] text-cs-text-secondary">
                <span>Total Stored in Browser:</span>
                <span className="font-mono font-bold text-cs-text-primary">
                  {speechReport.totalFormatted}
                </span>
              </div>

              <div className="divide-y divide-cs-border-subtle rounded-lg bg-cs-bg-surface border border-cs-border-subtle overflow-hidden">
                {speechReport.models.map((m) => {
                  const isDeleting = speechActionLoading === m.id;

                  return (
                    <div
                      key={m.id}
                      className="p-3 flex items-center justify-between gap-3 hover:bg-cs-bg-base/30 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-cs-text-primary text-xs truncate">
                            {m.label}
                          </span>
                          {m.isDownloaded ? (
                            <Badge variant="success">
                              Downloaded ({formatBytes(m.actualSizeBytes)})
                            </Badge>
                          ) : (
                            <Badge variant="muted">
                              Not Downloaded ({m.estimatedSizeFormatted})
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-cs-text-tertiary mt-0.5 truncate">
                          {m.description}
                        </p>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        {m.isDownloaded ? (
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={isDeleting || !!speechActionLoading}
                            onClick={() => handleDeleteSpeechModel(m.id, m.label)}
                          >
                            {isDeleting ? "Deleting…" : "Delete Model"}
                          </Button>
                        ) : (
                          <span className="text-[10px] text-cs-text-tertiary px-2 py-1">
                            Not cached
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end pt-3 border-t border-cs-border-subtle">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
