/**
 * Render plan generation for Content Studio.
 *
 * Rules:
 * - Deterministic, immutable snapshot of project/timeline state.
 * - Integer frame arithmetic prevents cumulative floating-point drift.
 * - Validates all referenced source files for existence and accessibility.
 * - Tracks, clips, trims, gaps, mutes, volumes, and text overlays are accounted for.
 * - No mutation of the original project or timeline documents.
 */

import type { ProjectDocument, LiveAssetItem } from "../../types/project.ts";
import type { TimelineDocument } from "../../types/timeline.ts";
import type {
  ExportSettings,
  ExportPreset,
  ExportAspectRatio,
  RenderPlan,
  RenderPlanSource,
  RenderPlanVideoFrame,
  RenderPlanAudioSegment,
} from "../../types/export.ts";
import { getTimelineDuration, validateTimeline } from "../timeline/model.ts";

/**
 * Calculates standard dimensions for a given aspect ratio and preset.
 * All dimensions are guaranteed to be even numbers for H.264 encoder compatibility.
 */
export function calculateExportDimensions(
  aspectRatio: ExportAspectRatio,
  preset: ExportPreset
): { width: number; height: number } {
  let width = 1920;
  let height = 1080;

  switch (aspectRatio) {
    case "16:9":
      if (preset === "1080p") {
        width = 1920;
        height = 1080;
      } else if (preset === "720p") {
        width = 1280;
        height = 720;
      } else {
        width = 960;
        height = 540;
      }
      break;

    case "9:16":
      if (preset === "1080p") {
        width = 1080;
        height = 1920;
      } else if (preset === "720p") {
        width = 720;
        height = 1280;
      } else {
        width = 540;
        height = 960;
      }
      break;

    case "1:1":
      if (preset === "1080p") {
        width = 1080;
        height = 1080;
      } else if (preset === "720p") {
        width = 720;
        height = 720;
      } else {
        width = 540;
        height = 540;
      }
      break;

    case "4:5":
      if (preset === "1080p") {
        width = 1080;
        height = 1350;
      } else if (preset === "720p") {
        width = 720;
        height = 900;
      } else {
        width = 540;
        height = 676; // even number
      }
      break;
  }

  // Guarantee even dimensions
  width = Math.floor(width / 2) * 2;
  height = Math.floor(height / 2) * 2;

  return { width, height };
}

/**
 * Generates sensible default export settings for a project.
 */
export function getDefaultExportSettings(
  aspectRatio: ExportAspectRatio = "16:9",
  preset: ExportPreset = "1080p",
  projectName: string = "video"
): ExportSettings {
  const { width, height } = calculateExportDimensions(aspectRatio, preset);
  const cleanName = projectName.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "video";

  return {
    targetAspectRatio: aspectRatio,
    width,
    height,
    frameRate: 30,
    videoCodec: "avc",
    audioCodec: "aac",
    format: "mp4",
    quality: "high",
    audioSampleRate: 48000,
    audioChannels: 2,
    filename: `${cleanName}-${preset}.mp4`,
  };
}

/**
 * Builds an immutable, deterministic RenderPlan from the given project snapshot.
 */
export function buildRenderPlan(
  project: ProjectDocument,
  timeline: TimelineDocument,
  settings: ExportSettings,
  liveAssets: Map<string, LiveAssetItem>
): RenderPlan {
  // Deep clone to ensure this snapshot remains completely unaffected by subsequent edits
  const timelineSnapshot: TimelineDocument = JSON.parse(JSON.stringify(timeline));
  const projectSnapshot: ProjectDocument = JSON.parse(JSON.stringify(project));

  const validationErrors: string[] = [];

  // Validate timeline model
  const timelineModelErrors = validateTimeline(timelineSnapshot);
  if (timelineModelErrors.length > 0) {
    validationErrors.push(...timelineModelErrors);
  }

  const totalDurationSeconds = getTimelineDuration(timelineSnapshot);
  if (totalDurationSeconds <= 0) {
    validationErrors.push("Timeline is empty. Add at least one clip or text overlay to export.");
  }

  // Collect source asset references
  const referencedAssetIds = new Set<string>();
  for (const track of timelineSnapshot.tracks) {
    for (const clip of track.clips) {
      if (clip.assetId) {
        referencedAssetIds.add(clip.assetId);
      }
    }
  }

  const sources = new Map<string, RenderPlanSource>();
  const missingSources: string[] = [];

  for (const assetId of referencedAssetIds) {
    const assetMeta = projectSnapshot.assets.find((a) => a.id === assetId);
    const liveItem = liveAssets.get(assetId);

    if (!assetMeta || !liveItem || liveItem.status !== "ready" || !liveItem.file) {
      const displayName = assetMeta?.name ?? liveItem?.asset.name ?? assetId;
      missingSources.push(assetId);
      validationErrors.push(
        `Source media "${displayName}" (${assetId}) is missing or inaccessible. Please relink the file before exporting.`
      );
      continue;
    }

    const inspected = liveItem.asset.metadata;
    const hasVideo = inspected
      ? inspected.videoTracks.length > 0
      : (assetMeta.mediaType === "video");
    const hasAudio = inspected
      ? inspected.audioTracks.length > 0
      : (assetMeta.mediaType === "audio" || assetMeta.mediaType === "video");

    sources.set(assetId, {
      assetId,
      name: assetMeta.name,
      handleRefId: assetMeta.handleRefId,
      file: liveItem.file,
      hasVideo,
      hasAudio,
      duration: inspected?.duration,
      width: inspected?.videoTracks[0]?.displayWidth ?? inspected?.videoTracks[0]?.codedWidth,
      height: inspected?.videoTracks[0]?.displayHeight ?? inspected?.videoTracks[0]?.codedHeight,
      frameRate: inspected?.videoTracks[0]?.frameRate,
      rotation: inspected?.videoTracks[0]?.rotation,
    });
  }

  // Integer frame arithmetic
  const frameRate = Math.max(1, Math.min(120, Math.floor(settings.frameRate || 30)));
  const totalFrames = Math.ceil(totalDurationSeconds * frameRate);

  // Sort tracks by UI order (lower order renders higher / top-most)
  const sortedTracks = [...timelineSnapshot.tracks].sort((a, b) => a.order - b.order);
  const videoTracks = sortedTracks.filter((t) => t.type === "video");

  // Generate deterministic frame sequence
  const videoFrames: RenderPlanVideoFrame[] = [];
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    // Exact microsecond timestamp using integer arithmetic
    const presentationTimeUs = BigInt(Math.round((frameIndex * 1_000_000) / frameRate));
    const presentationTimeSeconds = frameIndex / frameRate;
    const durationSeconds = 1 / frameRate;

    // Find active clip on first video track spanning this time
    let activeClip: RenderPlanVideoFrame["activeClip"] = null;
    for (const track of videoTracks) {
      for (const clip of track.clips) {
        const clipDuration = clip.sourceOut - clip.sourceIn;
        const endTime = clip.startTime + clipDuration;
        if (presentationTimeSeconds >= clip.startTime && presentationTimeSeconds < endTime) {
          const offset = presentationTimeSeconds - clip.startTime;
          const sourceTimeSeconds = Math.min(
            clip.sourceOut - 0.0001,
            Math.max(clip.sourceIn, clip.sourceIn + offset)
          );
          activeClip = {
            clipId: clip.id,
            assetId: clip.assetId,
            sourceTimeSeconds,
          };
          break;
        }
      }
      if (activeClip) break;
    }

    // Find active text overlays spanning this time (invariant: at most 1 at any moment)
    const matchingOverlays = timelineSnapshot.textOverlays.filter(
      (overlay) =>
        presentationTimeSeconds >= overlay.startTime && presentationTimeSeconds < overlay.endTime
    );
    const activeOverlays = matchingOverlays.slice(0, 1);

    videoFrames.push({
      frameIndex,
      presentationTimeUs,
      presentationTimeSeconds,
      durationSeconds,
      activeClip,
      activeOverlays,
    });
  }

  // Generate audio segments
  const audioSegments: RenderPlanAudioSegment[] = [];
  for (const track of sortedTracks) {
    for (const clip of track.clips) {
      const source = sources.get(clip.assetId);
      if (source && !source.hasAudio) {
        // Source does not contain audio
        continue;
      }

      const clipDuration = clip.sourceOut - clip.sourceIn;
      if (clipDuration <= 0) continue;

      const isMuted = track.muted || clip.muted;
      const volume = isMuted ? 0 : Math.max(0, Math.min(1, clip.volume ?? 1));

      audioSegments.push({
        clipId: clip.id,
        assetId: clip.assetId,
        timelineStartSeconds: clip.startTime,
        timelineEndSeconds: clip.startTime + clipDuration,
        sourceInSeconds: clip.sourceIn,
        sourceOutSeconds: clip.sourceOut,
        volume,
        trackId: track.id,
        trackOrder: track.order,
      });
    }
  }

  // Sort audio segments by timeline start
  audioSegments.sort((a, b) => a.timelineStartSeconds - b.timelineStartSeconds);

  const hasVideo = videoFrames.some((f) => f.activeClip !== null || f.activeOverlays.length > 0);
  const hasAudio = audioSegments.some((s) => s.volume > 0);

  const isValid = validationErrors.length === 0 && totalFrames > 0;

  return {
    projectId: projectSnapshot.id,
    projectName: projectSnapshot.name,
    timelineId: timelineSnapshot.id,
    createdAt: new Date().toISOString(),
    settings,
    frameRate,
    totalDurationSeconds,
    totalFrames,
    sources,
    missingSources,
    videoFrames,
    audioSegments,
    hasVideo,
    hasAudio,
    isValid,
    validationErrors,
  };
}
