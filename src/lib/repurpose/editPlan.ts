/**
 * Edit Decision List (EDL) and Timeline sequence construction.
 *
 * Rules:
 * - Generates typed, immutable EditPlan representation.
 * - Validates finite timestamps, positive durations, monotonic ordering, and source bounds.
 * - Converts an EditPlan directly into a TimelineDocument with sequenced video clips.
 * - When candidate transcripts are available, maps spoken cues to timed TextOverlay captions.
 * - Ensures captions from one source never bleed into other clips or timeline gaps.
 */

import type { TimelineDocument, TimelineClip, TimelineTrack, TextOverlay } from "../../types/timeline.ts";
import type { ProjectDocument } from "../../types/project.ts";
import type { RepurposeCandidate, EditPlan, EditPlanSegment, RepurposeObjective, DeliverableType } from "../../types/repurpose.ts";
import type { ExportAspectRatio } from "../../types/export.ts";
import type { SourceTranscript } from "../../types/transcription.ts";
import { isValidUuid } from "../projectValidation.ts";
import { createTimeline, createTrack, validateTimeline, resolveTextOverlayCollisions } from "../timeline/model.ts";
import { DEFAULT_COLOR_ADJUSTMENTS } from "../color/colorPresets.ts";

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
  targetAspectRatio: ExportAspectRatio = "9:16",
  deliverableType: DeliverableType = "compilation",
  sequenceRationale?: string
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
      captionText: cand.transcriptSnippet,
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
    deliverableType,
    sequenceRationale,
  };

  const validation = validateEditPlan(plan);
  plan.isValid = validation.ok;
  plan.validationErrors = validation.errors;

  return plan;
}

/**
 * Converts an EditPlan into a TimelineDocument, populating the primary video track
 * with sequenced clips, and mapping transcript cues into timed captions.
 */
export function applyEditPlanToTimeline(
  editPlan: EditPlan,
  baseTimeline?: TimelineDocument,
  sourceTranscripts?: Map<string, SourceTranscript>,
  options?: { generateCaptions?: boolean }
): { timeline: TimelineDocument; errors: string[] } {
  const t = baseTimeline ? { ...baseTimeline } : createTimeline();

  // Find or create primary video track
  let videoTrack: TimelineTrack | undefined = t.tracks.find((tr) => tr.type === "video");
  if (!videoTrack) {
    videoTrack = createTrack("video", "Video 1", 0, "dialogue");
    t.tracks = [videoTrack, ...t.tracks];
  }

  // Find or create primary audio track
  let audioTrack: TimelineTrack | undefined = t.tracks.find((tr) => tr.type === "audio");
  if (!audioTrack) {
    audioTrack = createTrack("audio", "Audio 1", 1, "general");
    t.tracks = [...t.tracks, audioTrack];
  }

  const resolvedVideoTrack = videoTrack!;
  const resolvedAudioTrack = audioTrack!;

  // Create clips sequentially from edit plan segments for both video and audio
  const newVideoClips: TimelineClip[] = [];
  const newAudioClips: TimelineClip[] = [];

  for (const seg of editPlan.segments) {
    const clipId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `clip-${seg.id}`;
    const audioClipId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `audio-${seg.id}`;

    newVideoClips.push({
      id: clipId,
      assetId: seg.sourceAssetId,
      trackId: resolvedVideoTrack.id,
      startTime: seg.timelineStart,
      sourceIn: seg.sourceIn,
      sourceOut: seg.sourceOut,
      volume: 1,
      muted: false,
      fitMode: "fit",
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      flipH: false,
      flipV: false,
      fadeIn: 0,
      fadeOut: 0,
      audioDetached: false,
      playbackRate: 1.0,
      preservePitch: true,
      freezeFrameSourceTime: null,
      linkedClipId: audioClipId,
      color: { ...DEFAULT_COLOR_ADJUSTMENTS },
    });

    newAudioClips.push({
      id: audioClipId,
      assetId: seg.sourceAssetId,
      trackId: resolvedAudioTrack.id,
      startTime: seg.timelineStart,
      sourceIn: seg.sourceIn,
      sourceOut: seg.sourceOut,
      volume: 1,
      muted: false,
      fitMode: "fit",
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      flipH: false,
      flipV: false,
      fadeIn: 0,
      fadeOut: 0,
      audioDetached: false,
      playbackRate: 1.0,
      preservePitch: true,
      freezeFrameSourceTime: null,
      linkedClipId: clipId,
      color: { ...DEFAULT_COLOR_ADJUSTMENTS },
    });
  }

  // Assign clips to video and audio tracks
  const updatedTracks: TimelineTrack[] = t.tracks.map((tr) => {
    if (tr.id === resolvedVideoTrack.id) {
      return {
        ...tr,
        clips: newVideoClips,
      };
    }
    if (tr.id === resolvedAudioTrack.id) {
      return {
        ...tr,
        clips: newAudioClips,
      };
    }
    return tr;
  });

  // Generate timed captions from source transcripts only when opted in
  const shouldGenerateCaptions = options ? options.generateCaptions === true : (sourceTranscripts !== undefined && sourceTranscripts.size > 0);
  const newCaptions: TextOverlay[] = [];

  if (shouldGenerateCaptions && sourceTranscripts) {
    let lastCaptionEndUs = 0;

    for (const seg of editPlan.segments) {
      const transcript = sourceTranscripts.get(seg.sourceAssetId);
      if (!transcript || transcript.cues.length === 0) continue;

      const segStartUs = Math.round(seg.timelineStart * 1_000_000);
      const segDurationUs = Math.round(seg.duration * 1_000_000);
      const segEndUs = segStartUs + segDurationUs;
      const segSourceInUs = Math.round(seg.sourceIn * 1_000_000);
      const segSourceOutUs = Math.round(seg.sourceOut * 1_000_000);

      // Filter cues overlapping this segment
      for (const cue of transcript.cues) {
        const cueStartUs = Math.round(cue.start * 1_000_000);
        const cueEndUs = Math.round(cue.end * 1_000_000);

        if (cueEndUs > segSourceInUs && cueStartUs < segSourceOutUs) {
          // Map cue time relative to exact sourceIn in integer microseconds
          const clampedCueStartUs = Math.max(segSourceInUs, cueStartUs);
          const clampedCueEndUs = Math.min(segSourceOutUs, cueEndUs);
          if (clampedCueEndUs <= clampedCueStartUs) continue;

          const cueOffsetStartUs = clampedCueStartUs - segSourceInUs;
          const cueOffsetEndUs = clampedCueEndUs - segSourceInUs;

          const rawTimelineStartUs = segStartUs + cueOffsetStartUs;
          const rawTimelineEndUs = segStartUs + cueOffsetEndUs;

          // Strictly clamp to parent clip window [segStartUs, segEndUs]
          const clampedStartUs = Math.max(segStartUs, Math.min(segEndUs, rawTimelineStartUs));
          const clampedEndUs = Math.max(clampedStartUs, Math.min(segEndUs, rawTimelineEndUs));
          if (clampedEndUs <= clampedStartUs) continue;

          // Enforce monotonic non-overlapping intervals across adjacent cuts
          const finalStartUs = Math.max(lastCaptionEndUs, clampedStartUs);
          if (finalStartUs >= segEndUs) continue;

          const finalEndUs = Math.max(finalStartUs, Math.min(segEndUs, clampedEndUs));
          if (finalEndUs <= finalStartUs) continue;

          lastCaptionEndUs = finalEndUs;

          const timelineStart = Number((finalStartUs / 1_000_000).toFixed(4));
          const timelineEnd = Number((finalEndUs / 1_000_000).toFixed(4));

          const overlayId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `caption-${cue.id}`;

          // Map word timings if present with exact microsecond mapping
          const wordTimings = cue.words
            ?.filter((w) => {
              const wStartUs = Math.round(w.start * 1_000_000);
              const wEndUs = Math.round(w.end * 1_000_000);
              return wEndUs > segSourceInUs && wStartUs < segSourceOutUs;
            })
            .map((w) => {
              const wStartUs = Math.round(w.start * 1_000_000);
              const wEndUs = Math.round(w.end * 1_000_000);
              const cWStart = Math.max(segSourceInUs, wStartUs);
              const cWEnd = Math.min(segSourceOutUs, wEndUs);
              const tStartUs = segStartUs + (cWStart - segSourceInUs);
              const tEndUs = segStartUs + (cWEnd - segSourceInUs);
              return {
                word: w.word,
                start: Number((tStartUs / 1_000_000).toFixed(4)),
                end: Number((tEndUs / 1_000_000).toFixed(4)),
              };
            });

          newCaptions.push({
            id: overlayId,
            text: cue.text,
            startTime: timelineStart,
            endTime: timelineEnd,
            x: 0.5,
            y: editPlan.targetAspectRatio === "9:16" ? 0.78 : 0.82,
            fontSize: editPlan.targetAspectRatio === "9:16" ? 28 : 24,
            color: "#ffffff",
            align: "center",
            presetId: "bold-karaoke",
            activeWordColor: "#facc15",
            overlayType: "caption",
            preset: "clean",
            backgroundColor: "rgba(0, 0, 0, 0.72)",
            strokeColor: "#000000",
            strokeWidth: 2,
            fontWeight: 700,
            boxWidthRatio: 0.85,
            sourceAssetId: seg.sourceAssetId,
            sourceCueId: cue.id,
            ...(wordTimings && wordTimings.length > 0 ? { wordTimings } : {}),
          });
        }
      }
    }
  }

  // Preserve any non-caption title overlays from base timeline, then append new captions
  const nonCaptionOverlays = t.textOverlays.filter((o) => o.overlayType !== "caption");
  const allOverlays = resolveTextOverlayCollisions([...nonCaptionOverlays, ...newCaptions]);

  const updatedTimeline: TimelineDocument = {
    ...t,
    id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : t.id,
    tracks: updatedTracks,
    textOverlays: allOverlays,
    settings: {
      ...t.settings,
      targetAspectRatio: editPlan.targetAspectRatio,
    },
  };

  const errors = validateTimeline(updatedTimeline);

  return { timeline: updatedTimeline, errors };
}
