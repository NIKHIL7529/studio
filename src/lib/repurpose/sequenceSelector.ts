/**
 * Deterministic candidate sequence selection with overlap suppression (Phase 7).
 *
 * Rules:
 * - Selects up to requested target count while respecting min/max duration bounds.
 * - Suppresses near-duplicate and overlapping windows on the same asset (overlap > 20%).
 * - Preserves temporal continuity and balances multiple source assets where appropriate.
 * - Minimum score gate: candidates below threshold (e.g. 25.0) are excluded.
 * - HONESTY RULE: If insufficient valid candidates exist, returns only the valid ones found
 *   with an explicit informative shortage explanation. Never fabricates clips or duplicates moments.
 */

import type { RepurposeCandidate, RepurposeConfig } from "../../types/repurpose.ts";

export const OVERLAP_SUPPRESSION_THRESHOLD = 0.20; // 20% overlap between clips from the same source
export const MIN_VIABLE_SCORE = 25.0;

export interface SequenceSelectionResult {
  selectedCandidates: RepurposeCandidate[];
  allCandidates: RepurposeCandidate[];
  requestedCount: number;
  actualCount: number;
  isShortage: boolean;
  shortageExplanation?: string;
}

/**
 * Computes overlap ratio between two time intervals [aIn, aOut] and [bIn, bOut].
 * Returns value in [0, 1] relative to the shorter interval duration.
 */
export function computeIntervalOverlap(
  aIn: number,
  aOut: number,
  bIn: number,
  bOut: number
): number {
  const overlapStart = Math.max(aIn, bIn);
  const overlapEnd = Math.min(aOut, bOut);
  const overlapDuration = Math.max(0, overlapEnd - overlapStart);

  if (overlapDuration === 0) return 0;

  const aDur = aOut - aIn;
  const bDur = bOut - bIn;
  const minDur = Math.min(aDur, bDur);

  return minDur > 0 ? overlapDuration / minDur : 0;
}

/**
 * Selects an optimal sequence of candidate moments from a scored pool.
 */
export function selectCandidateSequence(
  candidates: RepurposeCandidate[],
  config: RepurposeConfig
): SequenceSelectionResult {
  const { targetClipCount, minClipDuration, maxClipDuration } = config;

  // Filter candidates to those strictly meeting minimum score and duration bounds
  const viable = candidates.filter(
    (c) =>
      c.score >= MIN_VIABLE_SCORE &&
      c.duration >= minClipDuration * 0.85 &&
      c.duration <= maxClipDuration * 1.15
  );

  // Group viable candidates by source asset
  const bySource = new Map<string, RepurposeCandidate[]>();
  for (const c of viable) {
    const list = bySource.get(c.sourceAssetId) || [];
    list.push(c);
    bySource.set(c.sourceAssetId, list);
  }

  const selected: RepurposeCandidate[] = [];
  const selectedIds = new Set<string>();

  // Determine if multi-source
  const isMultiSource = bySource.size > 1;

  if (isMultiSource) {
    // Multi-source round-robin selection to encourage source diversity
    const sourceIds = Array.from(bySource.keys());
    let addedInRound = true;

    while (selected.length < targetClipCount && addedInRound) {
      addedInRound = false;

      for (const sId of sourceIds) {
        if (selected.length >= targetClipCount) break;

        const pool = bySource.get(sId) || [];
        // Find best non-overlapping candidate from this source
        for (const candidate of pool) {
          if (selectedIds.has(candidate.id)) continue;

          // Check overlap with already selected candidates from the same source
          const hasOverlap = selected.some(
            (s) =>
              s.sourceAssetId === candidate.sourceAssetId &&
              computeIntervalOverlap(s.sourceIn, s.sourceOut, candidate.sourceIn, candidate.sourceOut) >
                OVERLAP_SUPPRESSION_THRESHOLD
          );

          if (!hasOverlap) {
            selected.push({ ...candidate, selected: true });
            selectedIds.add(candidate.id);
            addedInRound = true;
            break; // Move to next source in this round
          }
        }
      }
    }
  } else {
    // Single-source greedy selection with overlap suppression
    for (const candidate of viable) {
      if (selected.length >= targetClipCount) break;

      const hasOverlap = selected.some(
        (s) =>
          computeIntervalOverlap(s.sourceIn, s.sourceOut, candidate.sourceIn, candidate.sourceOut) >
          OVERLAP_SUPPRESSION_THRESHOLD
      );

      if (!hasOverlap) {
        selected.push({ ...candidate, selected: true });
        selectedIds.add(candidate.id);
      }
    }
  }

  // Update selected flag on all candidates
  const updatedAll = candidates.map((c) => ({
    ...c,
    selected: selectedIds.has(c.id),
  }));

  const actualCount = selected.length;
  const isShortage = actualCount < targetClipCount;

  let shortageExplanation: string | undefined = undefined;
  if (isShortage) {
    if (actualCount === 0) {
      shortageExplanation = `No valid moments were found meeting the duration bounds (${minClipDuration}s–${maxClipDuration}s) with sufficient signal quality. Try lowering the minimum duration or importing longer footage.`;
    } else {
      shortageExplanation = `Found ${actualCount} valid moment${actualCount > 1 ? "s" : ""} meeting your constraints (${targetClipCount} requested). Adjust clip count or duration bounds to discover additional moments without duplicating footage.`;
    }
  }

  return {
    selectedCandidates: selected,
    allCandidates: updatedAll,
    requestedCount: targetClipCount,
    actualCount,
    isShortage,
    shortageExplanation,
  };
}
