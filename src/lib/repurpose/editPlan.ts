/**
 * Edit Decision List (EDL) and Timeline sequence construction (Phase 7).
 *
 * Rules:
 * - Generates typed, immutable EditPlan representation.
 * - Validates finite timestamps, positive durations, monotonic ordering, and source bounds.
 * - Converts an EditPlan directly into a TimelineDocument consumed by the existing Phase 4 editor
 *   and rendered by Phase 5 export.
 * - Does not create a duplicate renderer or parallel timeline model.
 */

import type { TimelineDocument, TimelineClip, TimelineTrack } from "../../types/timeline.ts";
import type { ProjectDocument } from "../../types/project.ts";
import type { RepurposeCandidate, EditPlan, EditPlanSegment, RepurposeObjective } from "../../types/repurpose.ts";
import type { ExportAspectRatio } from "../../types/export.ts";
import { isValidUuid } from "../projectValidation.ts";
import { createTimeline, validateTimeline } from "../timeline/model.ts";

/**
 * Validates an EditPlan for structural and temporal integrity.
 */
export function validateEditPlan(
  plan: EditPlan,
  projectAssets?: ProjectDocument["assets"]
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!isValidUuid(plan.projectId)) {
    errors.push(`Invalid projectId: "${plan.projectId}". Must be a valid UUID.`);
  }

  if (!Array.isArray(plan.segments) || plan.segments.length === 0) {
    errors.push("Edit plan must contain at least one segment.");
    return { ok: false, errors };
  }

  let expectedTimelineStart = 0;
  let computedTotalDuration = 0;

  for (let i = 0; i < plan.segments.length; i++) {
    const seg = plan.segments[i];
    const prefix = `Segment ${i + 1} (${seg.id})`;

    if (!seg.sourceAssetId) {
      errors.push(`${prefix}: sourceAssetId is required.`);
    }

    if (projectAssets && !projectAssets.some((a) => a.id === seg.sourceAssetId)) {
      errors.push(`${prefix}: references unknown project asset "${seg.sourceAssetId}".`);
    }

    if (!Number.isFinite(seg.sourceIn) || seg.sourceIn < 0) {
      errors.push(`${prefix}: sourceIn must be a non-negative finite number (got ${seg.sourceIn}).`);
    }

    if (!Number.isFinite(seg.sourceOut) || seg.sourceOut <= seg.sourceIn) {
      errors.push(`${prefix}: sourceOut must be greater than sourceIn (got ${seg.sourceOut} <= ${seg.sourceIn}).`);
    }

    const calculatedDur = Number((seg.sourceOut - seg.sourceIn).toFixed(4));
    if (Math.abs(seg.duration - calculatedDur) > 0.01) {
      errors.push(`${prefix}: duration (${seg.duration}) does not match sourceOut - sourceIn (${calculatedDur}).`);
    }

    if (Math.abs(seg.timelineStart - expectedTimelineStart) > 0.01) {
      errors.push(
        `${prefix}: timelineStart (${seg.timelineStart}) does not match expected sequential offset (${expectedTimelineStart}).`
      );
    }

    expectedTimelineStart += seg.duration;
    computedTotalDuration += seg.duration;
  }

  if (Math.abs(plan.totalDuration - computedTotalDuration) > 0.05) {
    errors.push(
      `Plan totalDuration (${plan.totalDuration}) does not match sum of segments (${computedTotalDuration.toFixed(2)}).`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

/**
 * Constructs an EditPlan from a list of selected candidates.
 * Orders candidates chronologically per source to preserve narrative flow.
 */
export function createEditPlanFromCandidates(
  projectId: string,
  selectedCandidates: RepurposeCandidate[],
  objective: RepurposeObjective,
  targetAspectRatio: ExportAspectRatio = "9:16"
): EditPlan {
  // Sort candidates: group by source asset, then by sourceIn timestamp
  const sorted = [...selectedCandidates].sort((a, b) => {
    if (a.sourceAssetId !== b.sourceAssetId) {
      return a.sourceAssetId.localeCompare(b.sourceAssetId);
    }
    return a.sourceIn - b.sourceIn;
  });

  let currentTimelineStart = 0;
  const segments: EditPlanSegment[] = [];

  for (const cand of sorted) {
    const dur = Number((cand.sourceOut - cand.sourceIn).toFixed(2));
    const segId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `seg-${cand.id}`;

    segments.push({
      id: segId,
      sourceAssetId: cand.sourceAssetId,
      sourceAssetName: cand.sourceAssetName,
      sourceIn: cand.sourceIn,
      sourceOut: cand.sourceOut,
      duration: dur,
      timelineStart: Number(currentTimelineStart.toFixed(2)),
      candidateId: cand.id,
      explanation: cand.explanation,
    });

    currentTimelineStart += dur;
  }

  const totalDuration = Number(currentTimelineStart.toFixed(2));
  const planId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });

  const plan: EditPlan = {
    id: planId,
    projectId,
    objective,
    createdAt: new Date().toISOString(),
    targetAspectRatio,
    segments,
    totalDuration,
    isValid: true,
    validationErrors: [],
  };

  const validation = validateEditPlan(plan);
  plan.isValid = validation.ok;
  plan.validationErrors = validation.errors;

  return plan;
}

/**
 * Converts an EditPlan into a TimelineDocument, populating the primary video track
 * with sequenced clips. Preserves existing audio/text track structures.
 */
export function applyEditPlanToTimeline(
  editPlan: EditPlan,
  baseTimeline?: TimelineDocument
): { timeline: TimelineDocument; errors: string[] } {
  const t = baseTimeline ? { ...baseTimeline } : createTimeline();

  // Find or create primary video track
  let videoTrack = t.tracks.find((tr) => tr.type === "video");
  if (!videoTrack) {
    const vId = crypto.randomUUID();
    videoTrack = {
      id: vId,
      type: "video",
      name: "Video 1",
      order: 0,
      muted: false,
      clips: [],
    };
    t.tracks = [videoTrack, ...t.tracks];
  }

  // Create clips sequentially from edit plan segments
  const newClips: TimelineClip[] = editPlan.segments.map((seg) => {
    const clipId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `clip-${seg.id}`;

    return {
      id: clipId,
      assetId: seg.sourceAssetId,
      trackId: videoTrack.id,
      startTime: seg.timelineStart,
      sourceIn: seg.sourceIn,
      sourceOut: seg.sourceOut,
      volume: 1,
      muted: false,
    };
  });

  // Assign clips to video track
  const updatedTracks: TimelineTrack[] = t.tracks.map((tr) => {
    if (tr.id === videoTrack.id) {
      return {
        ...tr,
        clips: newClips,
      };
    }
    // For other tracks, clear or keep
    return tr;
  });

  const updatedTimeline: TimelineDocument = {
    ...t,
    id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : t.id,
    tracks: updatedTracks,
    settings: {
      ...t.settings,
      targetAspectRatio: editPlan.targetAspectRatio,
    },
  };

  const errors = validateTimeline(updatedTimeline);

  return { timeline: updatedTimeline, errors };
}
