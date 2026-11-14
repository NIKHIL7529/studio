"use client";

/**
 * CandidateCard — Displays a discovered repurpose candidate moment (Phase 7).
 *
 * Shows:
 * - Source name, time range (start - end), duration.
 * - Objective-relative score with label.
 * - Concise, factual explanation of measurable signals used.
 * - Selection checkbox.
 * - Preview / seek action button.
 */

import * as React from "react";
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
  const { score, contributingEvidence, explanation, sourceIn, sourceOut, duration } = candidate;

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
        {/* Left: Checkbox + Title */}
        <div className="flex items-start gap-2.5 min-w-0">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(candidate)}
            className="mt-1 h-4 w-4 rounded border-cs-border-default bg-cs-bg-surface text-cs-primary focus:ring-1 focus:ring-cs-primary cursor-pointer"
            id={`cand-check-${candidate.id}`}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <label
                htmlFor={`cand-check-${candidate.id}`}
                className="font-medium text-xs text-cs-text-primary cursor-pointer truncate max-w-[220px]"
                title={candidate.sourceAssetName}
              >
                {candidate.sourceAssetName}
              </label>
              <span className="font-mono text-[11px] text-cs-text-secondary">
                {formatDuration(sourceIn)} – {formatDuration(sourceOut)}
              </span>
              <span className="text-[10px] text-cs-text-tertiary">({duration.toFixed(1)}s)</span>
            </div>

            {/* Factual signal explanation */}
            <p className="text-[11px] text-cs-text-secondary mt-1 leading-relaxed">{explanation}</p>
          </div>
        </div>

        {/* Right: Score + Preview Action */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <Badge variant={scoreBadgeVariant}>{scoreLabel} ({Math.round(score)})</Badge>
          </div>

          <button
            type="button"
            onClick={() => onPreview(candidate)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors ${
              isCurrentlyPreviewing
                ? "bg-cs-primary text-white"
                : "bg-cs-bg-surface border border-cs-border-subtle text-cs-text-secondary hover:text-cs-text-primary hover:bg-cs-bg-active"
            }`}
            title="Preview this candidate interval"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" stroke="currentColor">
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

      {/* Signal Tags & Evidence pill indicators */}
      <div className="mt-2.5 pt-2 border-t border-cs-border-subtle flex items-center gap-1.5 flex-wrap text-[10px] text-cs-text-tertiary">
        {contributingEvidence.hasAudio ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cs-bg-surface border border-cs-border-subtle">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            </svg>
            Speech: {Math.round(contributingEvidence.speechActivityRatio * 100)}%
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cs-bg-surface border border-cs-border-subtle text-cs-text-tertiary">
            No audio track
          </span>
        )}

        {contributingEvidence.sceneCutCount > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cs-bg-surface border border-cs-border-subtle">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            {contributingEvidence.sceneCutCount} cut{contributingEvidence.sceneCutCount > 1 ? "s" : ""}
          </span>
        )}

        {contributingEvidence.startsAtNaturalBoundary && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cs-bg-surface border border-cs-border-subtle text-emerald-400">
            Pause start
          </span>
        )}

        {contributingEvidence.endsAtNaturalBoundary && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cs-bg-surface border border-cs-border-subtle text-emerald-400">
            Pause end
          </span>
        )}

        {contributingEvidence.matchedKeywords && contributingEvidence.matchedKeywords.length > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cs-primary/10 border border-cs-primary/30 text-cs-primary">
            Keyword: {contributingEvidence.matchedKeywords.join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}
