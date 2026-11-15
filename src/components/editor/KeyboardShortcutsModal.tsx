"use client";

/**
 * KeyboardShortcutsModal — Discoverable keyboard shortcuts reference.
 */

import * as React from "react";
import { useState } from "react";
import { Modal, Button } from "@/components/ui";
import { KEYBOARD_SHORTCUTS } from "../../lib/timeline/shortcuts.ts";

export interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  const [search, setSearch] = useState("");
  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  const filtered = KEYBOARD_SHORTCUTS.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.keys.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q)
    );
  });

  const categories = Array.from(new Set(filtered.map((s) => s.category)));

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Keyboard Shortcuts"
      description="Professional Non-Linear Video Editor (NLE) keybindings"
      maxWidth="lg"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-4 max-h-[60vh] overflow-hidden">
        {/* Search input */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search shortcuts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-xs rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary placeholder:text-cs-text-tertiary focus:outline-none focus:border-cs-accent"
          />
          <svg
            className="absolute left-2.5 top-2.5 text-cs-text-tertiary"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>

        {/* Shortcuts list grouped by category */}
        <div className="overflow-y-auto space-y-4 pr-1">
          {categories.map((category) => (
            <div key={category} className="flex flex-col gap-1.5">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-cs-text-tertiary px-1">
                {category}
              </h4>
              <div className="bg-cs-bg-base border border-cs-border-subtle rounded divide-y divide-cs-border-subtle">
                {filtered
                  .filter((s) => s.category === category)
                  .map((shortcut) => {
                    const displayKey = isMac && shortcut.macKeys ? shortcut.macKeys : shortcut.keys;
                    return (
                      <div
                        key={shortcut.id}
                        className="flex items-center justify-between px-3 py-2 text-xs hover:bg-cs-bg-hover transition-colors"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-cs-text-primary">{shortcut.name}</span>
                          <span className="text-[11px] text-cs-text-tertiary">
                            {shortcut.description}
                          </span>
                        </div>
                        <kbd className="px-2 py-0.5 rounded bg-cs-bg-elevated border border-cs-border-default font-mono text-[11px] text-cs-text-secondary shrink-0 shadow-sm">
                          {displayKey}
                        </kbd>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="py-8 text-center text-xs text-cs-text-tertiary">
              No shortcuts found matching &ldquo;{search}&rdquo;
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
