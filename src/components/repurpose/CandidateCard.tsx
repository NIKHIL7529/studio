"use client";

/**
 * CandidateCard — Displays a discovered repurpose candidate moment.
 *
 * Shows:
 * - Source name, time range (start - end), variable duration.
 * - Spoken transcript snippet with expandable preceding/following context.
 * - Separate context integrity badges: Speech Boundary, Thought Completeness, Context Sufficiency, Standalone Clarity.
 * - Notice when context expansion was applied to include necessary prior setup.
 * - Objective score with transparent breakdown.
 * - Preview action button & selection checkbox.
 */

import * as React from "react";
import { useState } from "react";
import type { RepurposeCandidate } from "../../types/repurpose.ts";
import { formatDuration } from "../../lib/media/inspector.ts";
import { Badge } from "@/components/ui";

export interface CandidateCardProps {
  candidate: RepurposeCandidate;
  isSelected: boolean;
  onToggleSelect: (candidate: RepurposeCandidate) => void;
  onPreview: (candidate: RepurposeCandidate) => void;
  isCurrentlyPreviewing?: boolean;
}

export function CandidateCard({
  candidate,
  isSelected,
  onToggleSelect,
  onPreview,
  isCurrentlyPreviewing = false,
}: CandidateCardProps) {
  const [showContextDetails, setShowContextDetails] = useState(false);

  const {
    score,
    explanation,
    sourceIn,
    sourceOut,
    duration,
    hasTranscriptEvidence,
    transcriptSnippet,
    precedingContextText,
    followingContextText,
    speechBoundaryIntegrity,
    thoughtCompleteness,
    contextSufficiency,
    contextExpansionApplied,
  } = candidate;

  // Labeled score badge
  let scoreBadgeVariant: "success" | "warning" | "default" = "default";
  let scoreLabel = "Moderate Match";
  if (score >= 75) {
    scoreBadgeVariant = "success";
    scoreLabel = "Strong Match";
  } else if (score >= 50) {
    scoreBadgeVariant = "default";
    scoreLabel = "Good Match";
  } else {
    scoreBadgeVariant = "warning";
    scoreLabel = "Fair Match";
  }

  return (
    <div
      className={`p-3.5 rounded-lg border transition-all ${
        isSelected
          ? "bg-cs-bg-active/40 border-cs-primary/60 shadow-sm"
          : "bg-cs-bg-base/60 border-cs-border-subtle hover:border-cs-border-default"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: Checkbox + Title + Spoken Words */}
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(candidate)}
            className="mt-1 h-4 w-4 rounded border-cs-border-default bg-cs-bg-surface text-cs-primary focus:ring-1 focus:ring-cs-primary cursor-pointer shrink-0"
            id={`cand-check-${candidate.id}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <label
                htmlFor={`cand-check-${candidate.id}`}
                className="font-medium text-xs text-cs-text-primary cursor-pointer truncate max-w-[200px]"
                title={candidate.sourceAssetName}
              >
                {candidate.sourceAssetName}
              </label>
              <span className="font-mono text-[11px] text-cs-text-secondary">
                {formatDuration(sourceIn)} – {formatDuration(sourceOut)}
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-cs-bg-surface border border-cs-border-subtle text-cs-text-secondary font-mono">
                {duration.toFixed(1)}s
              </span>
            </div>

            {/* Transcript Snippet if present */}
            {transcriptSnippet ? (
              <div className="mt-1.5 p-2 rounded bg-cs-bg-surface/60 border border-cs-border-subtle/60 text-xs text-cs-text-primary italic leading-relaxed">
                &ldquo;{transcriptSnippet}&rdquo;
              </div>
            ) : (
              <p className="text-[11px] text-cs-text-secondary mt-1 leading-relaxed">{explanation}</p>
            )}

            {/* Notice if context expansion was applied */}
            {contextExpansionApplied && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-emerald-400">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <span>Expanded to include prior setup: &ldquo;{contextExpansionApplied.setupIncluded}&rdquo;</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Score + Preview Action */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <Badge variant={scoreBadgeVariant}>{scoreLabel} ({Math.round(score)})</Badge>

          <button
            type="button"
            onClick={() => onPreview(candidate)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
              isCurrentlyPreviewing
                ? "bg-cs-primary text-white"
                : "bg-cs-bg-surface border border-cs-border-subtle text-cs-text-secondary hover:text-cs-text-primary hover:bg-cs-bg-active"
            }`}
            title="Preview this exact candidate excerpt"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              {isCurrentlyPreviewing ? (
                <>
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </>
              ) : (
                <polygon points="5 3 19 12 5 21 5 3" />
              )}
            </svg>
            <span>{isCurrentlyPreviewing ? "Playing" : "Preview"}</span>
          </button>
        </div>
      </div>

      {/* Context Assessment Badges */}
      {hasTranscriptEvidence && (
        <div className="mt-2.5 pt-2 border-t border-cs-border-subtle flex items-center gap-1.5 flex-wrap text-[10px]">
          {thoughtCompleteness && (
            <span
              className={`px-1.5 py-0.5 rounded border ${
                thoughtCompleteness.isSatisfied
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                  : "bg-amber-500/10 border-amber-500/20 text-amber-300"
              }`}
              title={thoughtCompleteness.reason}
            >
              Thought: {thoughtCompleteness.isSatisfied ? "Complete" : "Partial"}
            </span>
          )}

          {contextSufficiency && (
            <span
              className={`px-1.5 py-0.5 rounded border ${
                contextSufficiency.isSatisfied
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                  : "bg-amber-500/10 border-amber-500/20 text-amber-300"
              }`}
              title={contextSufficiency.reason}
            >
              Context: {contextSufficiency.isSatisfied ? "Self-contained" : "Needs setup"}
            </span>
          )}

          {speechBoundaryIntegrity && (
            <span
              className={`px-1.5 py-0.5 rounded border ${
                speechBoundaryIntegrity.isSatisfied
                  ? "bg-cs-bg-surface border-cs-border-subtle text-cs-text-secondary"
                  : "bg-amber-500/10 border-amber-500/20 text-amber-300"
              }`}
              title={speechBoundaryIntegrity.reason}
            >
              Boundary: {speechBoundaryIntegrity.isSatisfied ? "Clean cuts" : "Mid-speech"}
            </span>
          )}

          {/* Toggle button for surrounding context */}
          {(precedingContextText || followingContextText) && (
            <button
              type="button"
              onClick={() => setShowContextDetails(!showContextDetails)}
              className="ml-auto text-[10px] text-cs-accent hover:underline flex items-center gap-1"
            >
              <span>{showContextDetails ? "Hide Context" : "View Context"}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points={showContextDetails ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Expandable Surrounding Context Tray */}
      {showContextDetails && (precedingContextText || followingContextText) && (
        <div className="mt-2.5 p-2.5 rounded bg-black/40 border border-cs-border-subtle/80 space-y-2 text-[11px]">
          {precedingContextText && (
            <div>
              <span className="text-[10px] font-semibold text-cs-text-tertiary uppercase tracking-wider block mb-0.5">
                Preceding Context (Before Cut):
              </span>
              <p className="text-cs-text-secondary italic">&ldquo;...{precedingContextText}&rdquo;</p>
            </div>
          )}

          {followingContextText && (
            <div className="border-t border-white/5 pt-1.5">
              <span className="text-[10px] font-semibold text-cs-text-tertiary uppercase tracking-wider block mb-0.5">
                Following Context (After Cut):
              </span>
              <p className="text-cs-text-secondary italic">&ldquo;{followingContextText}...&rdquo;</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
