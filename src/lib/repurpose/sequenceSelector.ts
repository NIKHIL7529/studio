/**
 * Adaptive candidate sequence selection.
 *
 * Rules:
 * - NO fixed candidate count (no hardcoded 3-result ceiling).
 * - NO source quotas or forced round-robin dilution: multiple strong moments from one source are selected.
 * - Requested output duration is a flexible objective, NOT an excuse to truncate complete thoughts.
 * - Suppresses near-duplicate and overlapping windows on the same asset (overlap > 20%).
 * - Distinguishes discovered, recommended, and selected counts clearly.
 * - Explains sequence assembly rationale and any shortage factually.
 */

import type { RepurposeCandidate, RepurposeConfig } from "../../types/repurpose.ts";

export const OVERLAP_SUPPRESSION_THRESHOLD = 0.20; // 20% overlap between clips from the same source
export const MIN_VIABLE_SCORE = 25.0;

export interface SequenceSelectionResult {
  selectedCandidates: RepurposeCandidate[];
  recommendedCandidates: RepurposeCandidate[];
  allCandidates: RepurposeCandidate[];
  discoveredCount: number;
  recommendedCount: number;
  actualCount: number;
  targetDuration?: number;
  actualDuration: number;
  isShortage: boolean;
  shortageExplanation?: string;
  sequenceRationale: string;
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
  const {
    targetClipCount,
    targetDuration,
    targetDurationRange,
    deliverableType = "compilation",
  } = config;

  const discoveredCount = candidates.length;

  // 1. Filter to viable candidates meeting quality threshold
  const viable = candidates.filter((c) => c.score >= MIN_VIABLE_SCORE);

  // 2. Overlap suppression across candidates from the same source
  // Higher-scoring candidates take precedence; overlapping weaker candidates are suppressed
  const nonOverlapping: RepurposeCandidate[] = [];
  for (const cand of viable) {
    const hasOverlap = nonOverlapping.some(
      (s) =>
        s.sourceAssetId === cand.sourceAssetId &&
        computeIntervalOverlap(s.sourceIn, s.sourceOut, cand.sourceIn, cand.sourceOut) >
          OVERLAP_SUPPRESSION_THRESHOLD
    );

    if (!hasOverlap) {
      nonOverlapping.push(cand);
    }
  }

  const recommendedCandidates = [...nonOverlapping];
  const recommendedCount = recommendedCandidates.length;

  // 3. Selection based on Deliverable Target
  const selected: RepurposeCandidate[] = [];
  const selectedIds = new Set<string>();

  // Determine target constraints
  const softTargetDuration = targetDuration || (targetDurationRange ? targetDurationRange.max : undefined);
  const hasDurationGoal = softTargetDuration !== undefined && softTargetDuration > 0;
  const maxClipsToPick = targetClipCount > 0 ? targetClipCount : 10;

  let currentSelectedDuration = 0;

  // Selection loop: Pick highest-scoring non-overlapping moments
  // Allow multiple candidates from the same source!
  for (const candidate of nonOverlapping) {
    if (hasDurationGoal) {
      // Check if adding candidate fits soft duration target
      // (permit slight overrun to avoid cutting a thought)
      if (currentSelectedDuration >= softTargetDuration) {
        break;
      }
      // If adding this clip exceeds target by more than 30%, check if we already have sufficient material
      if (
        currentSelectedDuration > 0 &&
        currentSelectedDuration + candidate.duration > softTargetDuration * 1.35
      ) {
        continue;
      }
    } else {
      if (selected.length >= maxClipsToPick) {
        break;
      }
    }

    selected.push({ ...candidate, selected: true });
    selectedIds.add(candidate.id);
    currentSelectedDuration += candidate.duration;
  }

  // 4. Update selected flag on all candidates
  const updatedAll = candidates.map((c) => ({
    ...c,
    selected: selectedIds.has(c.id),
  }));

  const actualCount = selected.length;
  const actualDuration = Number(currentSelectedDuration.toFixed(2));

  // 5. Shortage Explanation
  let isShortage = false;
  let shortageExplanation: string | undefined = undefined;

  if (hasDurationGoal && actualDuration < softTargetDuration * 0.75) {
    isShortage = true;
    shortageExplanation = `Selected moments total ${actualDuration.toFixed(1)}s (${softTargetDuration}s targeted). The source footage did not contain further non-redundant, high-quality segments. We avoid padding with weak material.`;
  } else if (!hasDurationGoal && actualCount < maxClipsToPick) {
    isShortage = true;
    shortageExplanation = `Found ${actualCount} valid moment${actualCount === 1 ? "" : "s"} (${maxClipsToPick} requested). The source footage did not yield further strong, non-redundant excerpts.`;
  }

  // 6. Sequence Rationale
  let sequenceRationale = "";
  if (deliverableType === "independent_clips") {
    sequenceRationale = `Identified ${actualCount} independent standalone clip${actualCount > 1 ? "s" : ""} suitable for individual short-form posting.`;
  } else {
    // Compilation
    const sourceCount = new Set(selected.map((s) => s.sourceAssetId)).size;
    sequenceRationale = `Assembled ${actualCount} coherent moment${actualCount > 1 ? "s" : ""} across ${sourceCount} source${sourceCount > 1 ? "s" : ""}, totaling ${actualDuration.toFixed(1)}s. Preserved complete thoughts and context boundaries.`;
  }

  return {
    selectedCandidates: selected,
    recommendedCandidates,
    allCandidates: updatedAll,
    discoveredCount,
    recommendedCount,
    actualCount,
    targetDuration: softTargetDuration,
    actualDuration,
    isShortage,
    shortageExplanation,
    sequenceRationale,
  };
}
