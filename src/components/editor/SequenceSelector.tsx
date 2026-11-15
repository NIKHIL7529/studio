"use client";

/**
 * SequenceSelector — Tab bar and switcher for multi-sequence editing.
 */

import * as React from "react";
import { useState } from "react";
import type { SequenceDocument } from "../../types/timeline.ts";
import type { ExportAspectRatio } from "../../types/export.ts";
import { Button, Modal } from "@/components/ui";

export interface SequenceSelectorProps {
  sequences: SequenceDocument[];
  activeSequenceId: string;
  onSelectSequence: (id: string) => void;
  onCreateSequence: (name: string, aspectRatio: ExportAspectRatio, fps: number) => void;
  onDuplicateSequence: (id: string) => void;
  onRenameSequence: (id: string, newName: string) => void;
  onDeleteSequence: (id: string) => void;
}

export function SequenceSelector({
  sequences,
  activeSequenceId,
  onSelectSequence,
  onCreateSequence,
  onDuplicateSequence,
  onRenameSequence,
  onDeleteSequence,
}: SequenceSelectorProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRatio, setNewRatio] = useState<ExportAspectRatio>("16:9");
  const [newFps, setNewFps] = useState<number>(30);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");

  const handleStartRename = (seq: SequenceDocument) => {
    setRenamingId(seq.id);
    setRenamingValue(seq.name);
  };

  const handleCommitRename = (seqId: string) => {
    if (renamingValue.trim()) {
      onRenameSequence(seqId, renamingValue.trim());
    }
    setRenamingId(null);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateSequence(newName.trim() || `Sequence ${sequences.length + 1}`, newRatio, newFps);
    setIsCreateOpen(false);
    setNewName("");
  };

  return (
    <div className="flex items-center gap-1 h-8 px-2 bg-cs-bg-elevated border-b border-cs-border-subtle shrink-0 overflow-x-auto select-none">
      {/* Sequence Tabs */}
      {sequences.map((seq) => {
        const isActive = seq.id === activeSequenceId;

        return (
          <div
            key={seq.id}
            onClick={() => onSelectSequence(seq.id)}
            className={`group flex items-center gap-1.5 h-6 px-2.5 rounded text-xs cursor-pointer border transition-colors shrink-0 ${
              isActive
                ? "bg-cs-bg-active border-cs-border-focus text-cs-text-primary font-medium"
                : "bg-cs-bg-base/60 border-transparent text-cs-text-secondary hover:text-cs-text-primary hover:bg-cs-bg-base"
            }`}
          >
            {renamingId === seq.id ? (
              <input
                type="text"
                value={renamingValue}
                onChange={(e) => setRenamingValue(e.target.value)}
                onBlur={() => handleCommitRename(seq.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCommitRename(seq.id);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                className="h-5 px-1 text-xs rounded bg-cs-bg-base border border-cs-border-focus text-cs-text-primary outline-none"
              />
            ) : (
              <span onDoubleClick={() => handleStartRename(seq)} title="Double-click to rename">
                {seq.name}
              </span>
            )}

            <span className="text-[10px] text-cs-text-tertiary font-mono">
              {seq.aspectRatio}
            </span>

            {/* Quick Actions (Duplicate / Delete) */}
            <div className="hidden group-hover:flex items-center gap-0.5 ml-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicateSequence(seq.id);
                }}
                title="Duplicate sequence"
                className="p-0.5 text-cs-text-tertiary hover:text-cs-text-primary rounded"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
              {sequences.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSequence(seq.id);
                  }}
                  title="Delete sequence"
                  className="p-0.5 text-cs-text-tertiary hover:text-cs-error rounded"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* New Sequence Button */}
      <button
        onClick={() => setIsCreateOpen(true)}
        className="flex items-center gap-1 h-6 px-2 rounded text-xs text-cs-text-tertiary hover:text-cs-text-primary hover:bg-cs-bg-base transition-colors shrink-0"
        title="Create new sequence / composition"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>New Sequence</span>
      </button>

      {/* Create Sequence Modal */}
      <Modal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create New Sequence"
        description="Configure sequence dimensions and frame rate"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleCreateSubmit}>
              Create Sequence
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4 text-xs">
          <div className="flex flex-col gap-1">
            <label className="text-cs-text-tertiary font-medium">Sequence Name</label>
            <input
              type="text"
              placeholder={`Sequence ${sequences.length + 1}`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-8 px-2.5 rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary focus:outline-none focus:border-cs-accent"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-cs-text-tertiary font-medium">Aspect Ratio</label>
              <select
                value={newRatio}
                onChange={(e) => setNewRatio(e.target.value as ExportAspectRatio)}
                className="h-8 px-2 rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary focus:outline-none"
              >
                <option value="16:9">16:9 Landscape (1920×1080)</option>
                <option value="9:16">9:16 Vertical / Shorts (1080×1920)</option>
                <option value="1:1">1:1 Square (1080×1080)</option>
                <option value="4:5">4:5 Portrait (1080×1350)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-cs-text-tertiary font-medium">Frame Rate</label>
              <select
                value={newFps}
                onChange={(e) => setNewFps(parseInt(e.target.value, 10))}
                className="h-8 px-2 rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary focus:outline-none"
              >
                <option value={24}>24 fps (Film)</option>
                <option value={25}>25 fps (PAL / Europe)</option>
                <option value={30}>30 fps (Standard Web)</option>
                <option value={60}>60 fps (Smooth / High Frame Rate)</option>
              </select>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
