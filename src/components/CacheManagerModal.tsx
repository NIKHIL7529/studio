"use client";

/**
 * CacheManagerModal — Local cache inventory and safe cleanup.
 *
 * Rules:
 * - Shows cache usage categorized into derived assets, temporary processing files, and orphaned files.
 * - Displays the exact amount of space that can safely be reclaimed.
 * - Supports dry-run preview before performing any deletions.
 * - Never deletes original media, project documents, revisions, or completed exports.
 * - Reports any files skipped due to active locks.
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
import { formatBytes } from "../lib/projectValidation.ts";
import { Button, Modal } from "@/components/ui";

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
  const [report, setReport] = useState<CacheInventoryReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Category selections
  const [cleanDerived, setCleanDerived] = useState(true);
  const [cleanTemporary, setCleanTemporary] = useState(true);
  const [cleanOrphans, setCleanOrphans] = useState(true);

  // Dry run preview vs actual result
  const [dryRunResult, setDryRunResult] = useState<CacheCleanupResult | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CacheCleanupResult | null>(null);

  const loadInventory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const rep = await scanWorkspaceCache(workspaceHandle, projectId ? [projectId] : undefined);
      setReport(rep);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to scan workspace cache.");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceHandle, projectId]);

  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;

    void Promise.resolve().then(async () => {
      if (isCancelled) return;
      setIsLoading(true);
      setError(null);
      setDryRunResult(null);
      setCleanupResult(null);
      try {
        const rep = await scanWorkspaceCache(workspaceHandle, projectId ? [projectId] : undefined);
        if (!isCancelled) setReport(rep);
      } catch (err: unknown) {
        if (!isCancelled) setError(err instanceof Error ? err.message : "Failed to scan workspace cache.");
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, workspaceHandle, projectId]);

  const getSelectedCategories = (): CacheCategory[] => {
    const cats: CacheCategory[] = [];
    if (cleanDerived) cats.push("derived");
    if (cleanTemporary) cats.push("temporary");
    return cats;
  };

  const handleDryRun = async () => {
    setIsCleaning(true);
    setError(null);
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
      setError(err instanceof Error ? err.message : "Dry run failed.");
    } finally {
      setIsCleaning(false);
    }
  };

  const handleExecuteCleanup = async () => {
    setIsCleaning(true);
    setError(null);
    try {
      const res = await cleanWorkspaceCache(workspaceHandle, {
        categories: getSelectedCategories(),
        cleanOrphans,
        dryRun: false,
        projectIds: projectId ? [projectId] : undefined,
      });
      setCleanupResult(res);
      setDryRunResult(null);
      await loadInventory();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Cache cleanup failed.");
    } finally {
      setIsCleaning(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Storage & Cache Management"
      description="Inspect and clean application-generated derived assets and temporary scratch files. Original videos, projects, revisions, and completed exports are never removed."
    >
      <div className="space-y-4 text-xs">
        {error && (
          <div className="p-3 rounded bg-cs-error/10 border border-cs-error/20 text-cs-error flex items-start gap-2">
            <span>⚠️</span>
            <p className="flex-1">{error}</p>
          </div>
        )}

        {/* Inventory Summary */}
        {isLoading ? (
          <div className="py-8 text-center text-cs-text-tertiary">
            Scanning workspace cache files…
          </div>
        ) : report ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-cs-bg-surface border border-cs-border-subtle">
                <span className="text-cs-text-tertiary block text-[10px] uppercase font-semibold tracking-wider mb-1">
                  Total Cache Size
                </span>
                <p className="text-lg font-bold text-cs-text-primary">
                  {formatBytes(report.totalBytes)}
                </p>
                <p className="text-[11px] text-cs-text-secondary mt-0.5">
                  {report.entries.length} tracked disposable item(s)
                </p>
              </div>

              <div className="p-3 rounded-lg bg-cs-bg-surface border border-cs-border-subtle">
                <span className="text-cs-text-tertiary block text-[10px] uppercase font-semibold tracking-wider mb-1">
                  Safely Reclaimable
                </span>
                <p className="text-lg font-bold text-emerald-400">
                  {formatBytes(report.reclaimableBytes)}
                </p>
                <p className="text-[11px] text-cs-text-secondary mt-0.5">
                  {report.inUseCount > 0 ? `${report.inUseCount} file(s) in active use (protected)` : "All items eligible"}
                </p>
              </div>
            </div>

            {/* Breakdown Categories */}
            <div className="p-3 rounded-lg bg-cs-bg-surface border border-cs-border-subtle space-y-2.5">
              <span className="font-semibold text-cs-text-primary block">
                Categories to Clean
              </span>

              <label className="flex items-center justify-between p-2 rounded hover:bg-cs-bg-base/50 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={cleanDerived}
                    onChange={(e) => setCleanDerived(e.target.checked)}
                    className="rounded border-cs-border-default text-cs-accent focus:ring-0"
                  />
                  <div>
                    <p className="font-medium text-cs-text-primary">Derived Cache Files</p>
                    <p className="text-[11px] text-cs-text-tertiary">Thumbnails, waveforms, and preview proxies in projects/*/cache/</p>
                  </div>
                </div>
                <span className="font-mono text-cs-text-secondary">
                  {formatBytes(report.derivedBytes)} ({report.derivedCount})
                </span>
              </label>

              <label className="flex items-center justify-between p-2 rounded hover:bg-cs-bg-base/50 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={cleanTemporary}
                    onChange={(e) => setCleanTemporary(e.target.checked)}
                    className="rounded border-cs-border-default text-cs-accent focus:ring-0"
                  />
                  <div>
                    <p className="font-medium text-cs-text-primary">Temporary Processing Files</p>
                    <p className="text-[11px] text-cs-text-tertiary">Incomplete export chunks and temporary save files (.tmp_*)</p>
                  </div>
                </div>
                <span className="font-mono text-cs-text-secondary">
                  {formatBytes(report.temporaryBytes)} ({report.temporaryCount})
                </span>
              </label>

              <label className="flex items-center justify-between p-2 rounded hover:bg-cs-bg-base/50 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={cleanOrphans}
                    onChange={(e) => setCleanOrphans(e.target.checked)}
                    className="rounded border-cs-border-default text-cs-accent focus:ring-0"
                  />
                  <div>
                    <p className="font-medium text-cs-text-primary">Orphaned Cache Files</p>
                    <p className="text-[11px] text-cs-text-tertiary">Unreferenced cache files from deleted projects</p>
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
                <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
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
                <p className="font-semibold">Cleanup Complete!</p>
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
          </div>
        ) : null}

        {/* Modal Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-cs-border-subtle">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDryRun}
              disabled={isLoading || isCleaning || (!cleanDerived && !cleanTemporary && !cleanOrphans)}
            >
              Preview (Dry Run)
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleExecuteCleanup}
              disabled={isLoading || isCleaning || (report?.reclaimableBytes === 0) || (!cleanDerived && !cleanTemporary && !cleanOrphans)}
            >
              {isCleaning ? "Cleaning…" : "Clean Reclaimable Space"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
