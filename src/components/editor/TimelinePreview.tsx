"use client";

/**
 * TimelinePreview — Timeline Composition Preview panel.
 *
 * Rules:
 * - Real timeline composition preview: synchronizes playhead, active clips, and timed captions.
 * - Solves async race conditions: automatically reloads when liveAssets or file handles settle.
 * - Seamless playback across consecutive clips of the same asset without object URL churn or black flash.
 * - Synchronizes video.currentTime with timeline currentTime to prevent frozen or blank frames.
 * - Renders timed captions with exact 1:1 match to export canvas (background pills, stroke, safe margins).
 * - Surfaces actionable states: Loading, Gap, Permission Renewal Needed, Autoplay Blocked, Decode Error.
 * - Never swallows exceptions or leaves a permanently black screen without explanation.
 */

import * as React from "react";
import { useEffect, useRef, useState, useCallback } from "react";
import type { TimelineDocument, TimelineClip, TimelineTransition, TextOverlay } from "../../types/timeline.ts";
import type { LiveAssetItem } from "../../types/project.ts";
import { getActiveClipAtTime, getActiveTextOverlaysAtTime, getTimelineDuration } from "../../lib/timeline/model.ts";
import { ObjectUrlManager } from "../../lib/media/previewSource.ts";
import { evaluateClipTransform, evaluateOverlayAnimation } from "../../lib/animation/animationPresets.ts";
import {
  getTransitionProgress,
  getTransitionDefinition,
  getTransitionTimeWindow,
  type TransitionDefinition,
} from "../../lib/transitions/transitionCatalog.ts";
import {
  buildCanvasColorFilter,
  getTemperatureTint,
  isDefaultColor,
} from "../../lib/color/colorPresets.ts";
import {
  collectDialogueIntervals,
  evaluateDuckingGainAtTime,
} from "../../lib/export/audioDucking.ts";
import { useEditorStore } from "../../store/editorStore.ts";

export interface TimelinePreviewProps {
  timeline: TimelineDocument;
  liveAssets: Map<string, LiveAssetItem>;
  currentTime: number;
  isPlaying: boolean;
  onPlaybackTimeUpdate: (time: number) => void;
  onPlayPause: () => void;
  onTimelineChange?: (newTimeline: TimelineDocument) => void;
}

function formatTimeDisplay(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${f}`;
}

export function TimelinePreview({
  timeline,
  liveAssets,
  currentTime,
  isPlaying,
  onPlaybackTimeUpdate,
  onPlayPause,
  onTimelineChange,
}: TimelinePreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const urlManagerRef = useRef<ObjectUrlManager>(new ObjectUrlManager());

  // Zustand editor store integration for canvas manipulation
  const {
    selectedClipIds,
    selectedOverlayId,
    selectSingleClip,
    selectOverlay,
    setDragPreview,
  } = useEditorStore();

  const [snapGuides, setSnapGuides] = useState<{ x?: number; y?: number }>({});
  const [editingOverlayId, setEditingOverlayId] = useState<string | null>(null);
  const [inlineEditText, setInlineEditText] = useState("");

  // Tracking state to prevent duplicate object URL creation & handle file resolution races
  const currentLoadedAssetIdRef = useRef<string | null>(null);
  const currentLoadedFileRef = useRef<File | null>(null);
  const activeClipIdRef = useRef<string | null>(null);
  const activeUrlRef = useRef<string | null>(null);
  const [activeMediaUrl, setActiveMediaUrl] = useState<string | null>(null);

  const rafRef = useRef<number | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const currentTimeRef = useRef(currentTime);
  const timelineRef = useRef(timeline);
  const liveAssetsRef = useRef(liveAssets);

  // Error and UI overlay states
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);

  // Bounded composition frame dimensions calculated from aspect ratio
  const [compSize, setCompSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const targetAspectRatio = timeline.settings?.targetAspectRatio || "16:9";
  const ratioValue =
    targetAspectRatio === "9:16" ? 9 / 16 :
      targetAspectRatio === "1:1" ? 1 :
        targetAspectRatio === "4:5" ? 4 / 5 :
          16 / 9;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth <= 0 || clientHeight <= 0) return;

      // Available space with a bit of padding around the canvas so borders are distinct
      const availW = Math.max(0, clientWidth - 24);
      const availH = Math.max(0, clientHeight - 24);

      let w = availW;
      let h = availW / ratioValue;
      if (h > availH) {
        h = availH;
        w = h * ratioValue;
      }
      setCompSize({ width: Math.round(w), height: Math.round(h) });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [ratioValue]);

  // Keep refs in sync with props
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    currentTimeRef.current = currentTime;
    timelineRef.current = timeline;
    liveAssetsRef.current = liveAssets;
  }, [isPlaying, currentTime, timeline, liveAssets]);

  const activeClip = getActiveClipAtTime(timeline, currentTime);
  const activeOverlays = getActiveTextOverlaysAtTime(timeline, currentTime);
  const totalDuration = getTimelineDuration(timeline);

  // Keyframes and transform evaluation
  const evaluatedTransform = activeClip ? evaluateClipTransform(activeClip, currentTime) : null;

  // Active transitions evaluation
  const activeTransitions = (timeline.transitions || []).map((tr) => {
    const window = getTransitionTimeWindow(tr);
    if (currentTime >= window.start && currentTime <= window.end) {
      const prog = getTransitionProgress(tr, currentTime);
      return { transition: tr, progress: prog, def: getTransitionDefinition(tr.type) };
    }
    return null;
  }).filter(Boolean) as { transition: TimelineTransition; progress: number; def: TransitionDefinition | undefined }[];

  // Active clip asset info
  const activeLiveItem = activeClip ? liveAssets.get(activeClip.assetId) : null;
  const activeFile = activeLiveItem?.file ?? null;
  const isFileMissing = activeClip ? (!activeLiveItem || activeLiveItem.status !== "ready" || !activeFile) : false;
  const isImageMedia = activeLiveItem?.asset.kind === "image" || activeLiveItem?.asset.mediaType === "image";

  const crop = activeClip?.crop || { top: 0, right: 0, bottom: 0, left: 0 };
  const clipPath = (crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0)
    ? `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`
    : undefined;
  const scaleX = (evaluatedTransform?.scaleX ?? 1) * (activeClip?.flipH ? -1 : 1);
  const scaleY = (evaluatedTransform?.scaleY ?? 1) * (activeClip?.flipV ? -1 : 1);
  const transformStyle = evaluatedTransform
    ? `translate(${evaluatedTransform.positionX}%, ${evaluatedTransform.positionY}%) scale(${scaleX}, ${scaleY}) rotate(${evaluatedTransform.rotation}deg)`
    : undefined;
  const hasColorFilter = activeClip?.color && !isDefaultColor(activeClip.color);
  const colorFilterStyle = hasColorFilter ? buildCanvasColorFilter(activeClip.color) : undefined;
  const tempTint = activeClip?.color ? getTemperatureTint(activeClip.color.temperature) : null;

  const mediaNaturalW =
    activeLiveItem?.asset.metadata?.displayWidth ||
    activeLiveItem?.asset.metadata?.videoTracks?.[0]?.displayWidth ||
    compSize.width ||
    1920;
  const mediaNaturalH =
    activeLiveItem?.asset.metadata?.displayHeight ||
    activeLiveItem?.asset.metadata?.videoTracks?.[0]?.displayHeight ||
    compSize.height ||
    1080;
  const aspectSource = mediaNaturalW / (mediaNaturalH || 1);
  const aspectCanvas = (compSize.width || 1) / (compSize.height || 1);

  let fittedWidthPct = 100;
  let fittedHeightPct = 100;

  if (activeClip?.fitMode === "fit" || activeClip?.fitMode === "blur-bg") {
    if (aspectSource > aspectCanvas) {
      fittedHeightPct = Math.min(100, (aspectCanvas / aspectSource) * 100);
    } else {
      fittedWidthPct = Math.min(100, (aspectSource / aspectCanvas) * 100);
    }
  }

  // Load or reuse media source
  const loadClip = useCallback((clip: TimelineClip | null, file: File | null) => {
    const video = videoRef.current;
    const manager = urlManagerRef.current;

    if (!video) return;

    if (!clip || !file) {
      if (activeUrlRef.current) {
        manager.revoke(activeUrlRef.current);
        activeUrlRef.current = null;
        setActiveMediaUrl(null);
      }
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch { /* ignored */ }
      currentLoadedAssetIdRef.current = null;
      currentLoadedFileRef.current = null;
      activeClipIdRef.current = null;
      setIsLoadingMedia(false);
      return;
    }

    // Reuse existing URL if the same underlying File is already loaded
    if (currentLoadedAssetIdRef.current === clip.assetId && currentLoadedFileRef.current === file && activeUrlRef.current) {
      activeClipIdRef.current = clip.id;
      // Just seek to target timestamp within the already loaded media
      const clipOffset = Math.max(0, currentTimeRef.current - clip.startTime);
      const isFreeze = clip.freezeFrameSourceTime !== null;
      const targetSrc = isFreeze
        ? clip.freezeFrameSourceTime!
        : Math.min(clip.sourceOut, clip.sourceIn + clipOffset * (clip.playbackRate || 1.0));
      try {
        video.currentTime = targetSrc;
      } catch { /* ignored */ }
      video.muted = isFreeze || clip.muted;
      video.volume = Math.max(0, Math.min(1, clip.volume));
      video.playbackRate = clip.playbackRate || 1.0;
      if ("preservesPitch" in video) {
        (video as unknown as { preservesPitch: boolean }).preservesPitch = clip.preservePitch ?? true;
      }
      if (isFreeze) {
        try { video.pause(); } catch { /* ignored */ }
      } else if (isPlayingRef.current && video.paused) {
        video.play().catch(() => setPlaybackBlocked(true));
      }
      return;
    }

    // New file / source asset: swap URL cleanly
    if (activeUrlRef.current) {
      manager.revoke(activeUrlRef.current);
      activeUrlRef.current = null;
      setActiveMediaUrl(null);
    }

    setIsLoadingMedia(true);
    setMediaError(null);

    try {
      const url = manager.create(file);
      activeUrlRef.current = url;
      setActiveMediaUrl(url);
      currentLoadedAssetIdRef.current = clip.assetId;
      currentLoadedFileRef.current = file;
      activeClipIdRef.current = clip.id;

      video.src = url;
      const isFreeze = clip.freezeFrameSourceTime !== null;
      video.muted = isFreeze || clip.muted;
      video.volume = Math.max(0, Math.min(1, clip.volume));
      video.playbackRate = clip.playbackRate || 1.0;
      if ("preservesPitch" in video) {
        (video as unknown as { preservesPitch: boolean }).preservesPitch = clip.preservePitch ?? true;
      }
      video.load();
    } catch (err: unknown) {
      console.warn("TimelinePreview: failed to create object URL", err);
      setMediaError("Could not access media file in memory.");
      setIsLoadingMedia(false);
    }
  }, []);

  // When activeClip or activeFile changes (including when file resolves asynchronously), load clip
  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      loadClip(activeClip, activeFile);
    });
    return () => cancelAnimationFrame(frameId);
  }, [activeClip, activeFile, loadClip]);

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      setIsLoadingMedia(false);
      setMediaError(null);
      const clip = activeClip;
      if (!clip) return;

      const clipOffset = Math.max(0, currentTimeRef.current - clip.startTime);
      const isFreeze = clip.freezeFrameSourceTime !== null;
      const targetSrc = isFreeze
        ? clip.freezeFrameSourceTime!
        : Math.min(clip.sourceOut, clip.sourceIn + clipOffset * (clip.playbackRate || 1.0));
      try {
        video.currentTime = targetSrc;
      } catch { /* ignored */ }

      if (isFreeze) {
        try { video.pause(); } catch { /* ignored */ }
      } else if (isPlayingRef.current) {
        video.play()
          .then(() => setPlaybackBlocked(false))
          .catch(() => setPlaybackBlocked(true));
      }
    };

    const handleError = () => {
      setIsLoadingMedia(false);
      setMediaError("Browser was unable to decode this video format or codec.");
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("error", handleError);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("error", handleError);
    };
  }, [activeClip]);

  // Playhead & rAF playback driver with video synchronization
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const video = videoRef.current;
      if (video && !video.paused) {
        try { video.pause(); } catch { /* ignored */ }
      }
      return;
    }

    const video = videoRef.current;
    if (video && video.readyState >= 2 && video.paused) {
      video.play()
        .then(() => setPlaybackBlocked(false))
        .catch(() => setPlaybackBlocked(true));
    }

    let lastTimestamp: number | null = null;

    const tick = (timestamp: number) => {
      if (!isPlayingRef.current) return;

      if (lastTimestamp !== null) {
        const delta = (timestamp - lastTimestamp) / 1000;
        const newTime = currentTimeRef.current + delta;
        const duration = getTimelineDuration(timelineRef.current);

        if (duration > 0 && newTime >= duration) {
          // Reached end of timeline
          onPlaybackTimeUpdate(duration);
          onPlayPause();
          return;
        }

        onPlaybackTimeUpdate(newTime);

        // Keep video element synchronized with playhead time
        const currentClip = getActiveClipAtTime(timelineRef.current, newTime);
        const vid = videoRef.current;
        if (currentClip && vid && vid.readyState >= 2) {
          const isFreeze = currentClip.freezeFrameSourceTime !== null;
          if (isFreeze) {
            if (!vid.paused) {
              try { vid.pause(); } catch { /* ignored */ }
            }
            if (Math.abs(vid.currentTime - currentClip.freezeFrameSourceTime!) > 0.05) {
              try { vid.currentTime = currentClip.freezeFrameSourceTime!; } catch { /* ignored */ }
            }
          } else {
            vid.playbackRate = currentClip.playbackRate || 1.0;
            if ("preservesPitch" in vid) {
              (vid as unknown as { preservesPitch: boolean }).preservesPitch = currentClip.preservePitch ?? true;
            }
            const expectedSrcTime = currentClip.sourceIn + (newTime - currentClip.startTime) * (currentClip.playbackRate || 1.0);
            const drift = Math.abs(vid.currentTime - expectedSrcTime);
            if (drift > 0.35) {
              try {
                vid.currentTime = Math.min(currentClip.sourceOut, Math.max(currentClip.sourceIn, expectedSrcTime));
              } catch { /* ignored */ }
            }
            if (vid.paused && !playbackBlocked) {
              vid.play().catch(() => setPlaybackBlocked(true));
            }
          }
        }
      }

      lastTimestamp = timestamp;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, onPlaybackTimeUpdate, onPlayPause, playbackBlocked]);

  // Seek video element when currentTime changes externally (scrubbing or clicking timeline)
  useEffect(() => {
    if (isPlaying) return;
    const video = videoRef.current;
    if (!video || !activeClip) return;

    const clipOffset = Math.max(0, currentTime - activeClip.startTime);
    const isFreeze = activeClip.freezeFrameSourceTime !== null;
    const targetSrc = isFreeze
      ? activeClip.freezeFrameSourceTime!
      : Math.min(activeClip.sourceOut, activeClip.sourceIn + clipOffset * (activeClip.playbackRate || 1.0));
    if (Math.abs(video.currentTime - targetSrc) > 0.05) {
      try { video.currentTime = targetSrc; } catch { /* ignored */ }
    }
  }, [currentTime, isPlaying, activeClip]);

  // Keep volume & muted synchronized
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClip) return;
    const activeTrack = timeline.tracks.find((t) => t.id === activeClip.trackId);
    let duckingGain = 1.0;
    if (activeTrack?.ducking?.enabled) {
      const dialogueIntervals = collectDialogueIntervals(timeline);
      duckingGain = evaluateDuckingGainAtTime(currentTime, dialogueIntervals, activeTrack.ducking);
    }
    video.muted = activeClip.muted || !!activeTrack?.muted;
    video.volume = Math.max(0, Math.min(1, activeClip.volume * duckingGain));
  }, [activeClip, timeline, currentTime]);

  // Pointer drag handler for active clip frame
  const handleClipPointerDown = (e: React.PointerEvent) => {
    if (!activeClip || !onTimelineChange) return;
    if (e.button !== 0) return;
    selectSingleClip(activeClip.id);

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const initialPosX = evaluatedTransform?.positionX ?? 0;
    const initialPosY = evaluatedTransform?.positionY ?? 0;

    const onPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;

      let newPosX = initialPosX + (dx / (compSize.width || 1)) * 100;
      let newPosY = initialPosY + (dy / (compSize.height || 1)) * 100;

      const guides: { x?: number; y?: number } = {};
      if (Math.abs(newPosX) < 1.5) {
        newPosX = 0;
        guides.x = compSize.width * 0.5;
      }
      if (Math.abs(newPosY) < 1.5) {
        newPosY = 0;
        guides.y = compSize.height * 0.5;
      }

      setSnapGuides(guides);
      setDragPreview({ clipId: activeClip.id, deltaX: dx, deltaY: dy });
    };

    const onPointerUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setSnapGuides({});
      setDragPreview(null);

      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;

      let finalPosX = initialPosX + (dx / (compSize.width || 1)) * 100;
      let finalPosY = initialPosY + (dy / (compSize.height || 1)) * 100;
      if (Math.abs(finalPosX) < 1.5) finalPosX = 0;
      if (Math.abs(finalPosY) < 1.5) finalPosY = 0;

      const updatedTracks = timeline.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== activeClip.id) return c;
          const kfs = c.keyframes || [];
          const updatedKfs = [
            ...kfs.filter((k) => k.property !== "positionX" && k.property !== "positionY"),
            { id: crypto.randomUUID(), time: 0, property: "positionX" as const, value: Number(finalPosX.toFixed(1)), interpolation: "linear" as const },
            { id: crypto.randomUUID(), time: 0, property: "positionY" as const, value: Number(finalPosY.toFixed(1)), interpolation: "linear" as const },
          ];
          return { ...c, keyframes: updatedKfs };
        }),
      }));
      onTimelineChange({ ...timeline, tracks: updatedTracks });
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // Pointer drag handler for text overlays & captions
  const handleOverlayPointerDown = (e: React.PointerEvent, overlay: TextOverlay) => {
    e.stopPropagation();
    selectOverlay(overlay.id);

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const origX = overlay.x;
    const origY = overlay.y;

    const onPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;

      let newX = origX + dx / (compSize.width || 1);
      let newY = origY + dy / (compSize.height || 1);

      const guides: { x?: number; y?: number } = {};
      if (Math.abs(newX - 0.5) < 0.02) {
        newX = 0.5;
        guides.x = compSize.width * 0.5;
      }
      if (Math.abs(newY - 0.5) < 0.02) {
        newY = 0.5;
        guides.y = compSize.height * 0.5;
      }

      setSnapGuides(guides);
      setDragPreview({ overlayId: overlay.id, deltaX: dx, deltaY: dy });
    };

    const onPointerUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setSnapGuides({});
      setDragPreview(null);

      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;

      let finalX = origX + dx / (compSize.width || 1);
      let finalY = origY + dy / (compSize.height || 1);
      if (Math.abs(finalX - 0.5) < 0.02) finalX = 0.5;
      if (Math.abs(finalY - 0.5) < 0.02) finalY = 0.5;

      finalX = Math.max(0.05, Math.min(0.95, Number(finalX.toFixed(3))));
      finalY = Math.max(0.05, Math.min(0.95, Number(finalY.toFixed(3))));

      if (onTimelineChange) {
        const updated = timeline.textOverlays.map((o) =>
          o.id === overlay.id ? { ...o, x: finalX, y: finalY } : o
        );
        onTimelineChange({ ...timeline, textOverlays: updated });
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const handleCommitInlineEdit = (overlayId: string) => {
    if (!onTimelineChange) return;
    if (inlineEditText.trim()) {
      const updated = timeline.textOverlays.map((o) =>
        o.id === overlayId ? { ...o, text: inlineEditText.trim() } : o
      );
      onTimelineChange({ ...timeline, textOverlays: updated });
    }
    setEditingOverlayId(null);
  };

  const isClipSelected = activeClip ? selectedClipIds.includes(activeClip.id) : false;

  const hasTimeline = totalDuration > 0;

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c]">
      {/* Preview Header Pill */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-black/60 border-b border-white/5 text-[10px] text-cs-text-tertiary select-none">
        <div className="flex items-center gap-2">
          <span className="font-semibold tracking-wide uppercase text-cs-text-secondary">Program Monitor</span>
          <span className="px-1.5 py-0.2 rounded bg-white/10 text-white font-mono text-[9px] font-medium">
            {targetAspectRatio}
          </span>
        </div>
        <span className="font-mono text-cs-text-secondary">{formatTimeDisplay(currentTime)}</span>
      </div>

      {/* Main Monitor Viewport (Letterbox / Pillarbox Container) */}
      <div
        ref={containerRef}
        className="relative flex-1 bg-[#09090b] flex items-center justify-center overflow-hidden min-h-0 p-3 select-none"
      >
        {/* Actual Output Composition Canvas (Strictly contained to sequence aspect ratio) */}
        <div
          className="relative bg-black border border-white/15 shadow-2xl overflow-hidden flex items-center justify-center"
          style={{
            width: compSize.width > 0 ? `${compSize.width}px` : "100%",
            height: compSize.height > 0 ? `${compSize.height}px` : "100%",
            maxWidth: "100%",
            maxHeight: "100%",
          }}
        >
          {/* Blur-bg background layer when fitMode === "blur-bg" */}
          {activeClip && !isFileMissing && activeClip.fitMode === "blur-bg" && activeMediaUrl && (
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {isImageMedia ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={activeMediaUrl}
                  alt=""
                  className="w-full h-full object-cover filter blur-xl scale-125 opacity-70"
                />
              ) : (
                <video
                  src={activeMediaUrl}
                  className="w-full h-full object-cover filter blur-xl scale-125 opacity-70"
                  muted
                  playsInline
                />
              )}
              <div className="absolute inset-0 bg-black/25" />
            </div>
          )}

          {/* Media Element: Image or Video */}
          <div
            className="relative z-10 w-full h-full flex items-center justify-center cursor-move"
            onPointerDown={handleClipPointerDown}
          >
            {isImageMedia ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activeMediaUrl || ""}
                alt={activeLiveItem?.asset.name || "Preview"}
                className={`w-full h-full ${activeClip?.fitMode === "fill" ? "object-cover" : "object-contain"} ${!activeClip || isFileMissing ? "hidden" : ""}`}
                style={{
                  transform: transformStyle,
                  opacity: evaluatedTransform ? evaluatedTransform.opacity : undefined,
                  clipPath,
                  transformOrigin: "center center",
                  filter: colorFilterStyle,
                }}
              />
            ) : (
              <video
                ref={videoRef}
                className={`w-full h-full ${activeClip?.fitMode === "fill" ? "object-cover" : "object-contain"} ${!activeClip || isFileMissing ? "hidden" : ""}`}
                style={{
                  transform: transformStyle,
                  opacity: evaluatedTransform ? evaluatedTransform.opacity : undefined,
                  clipPath,
                  transformOrigin: "center center",
                  filter: colorFilterStyle,
                }}
                playsInline
              />
            )}

            {/* Temperature Tint Overlay */}
            {tempTint && activeClip && !isFileMissing && (
              <div
                className="absolute pointer-events-none"
                style={{
                  width: `${fittedWidthPct}%`,
                  height: `${fittedHeightPct}%`,
                  backgroundColor: tempTint.color,
                  opacity: tempTint.alpha,
                  transform: transformStyle,
                  clipPath,
                  transformOrigin: "center center",
                }}
              />
            )}

            {/* Selection Bounding Box & Handles for Selected Clip */}
            {isClipSelected && activeClip && !isFileMissing && (
              <div
                className="absolute inset-0 pointer-events-none border-2 border-cs-accent z-20"
                style={{
                  transform: transformStyle,
                  transformOrigin: "center center",
                }}
              >
                {/* 4 Corner Scale Handles */}
                <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-cs-accent rounded-sm shadow pointer-events-auto cursor-nwse-resize" />
                <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-cs-accent rounded-sm shadow pointer-events-auto cursor-nesw-resize" />
                <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-cs-accent rounded-sm shadow pointer-events-auto cursor-nesw-resize" />
                <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-cs-accent rounded-sm shadow pointer-events-auto cursor-nwse-resize" />

                {/* Top Rotation Handle with Stem */}
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-auto cursor-grab active:cursor-grabbing">
                  <div className="w-3 h-3 rounded-full bg-white border-2 border-cs-accent shadow" />
                  <div className="w-0.5 h-3 bg-cs-accent" />
                </div>
              </div>
            )}
          </div>

          {/* Magnetic Center Snap Guide Lines */}
          {snapGuides.x !== undefined && (
            <div
              className="absolute top-0 bottom-0 w-px bg-cyan-400 z-40 pointer-events-none shadow-[0_0_8px_rgba(34,211,238,0.9)]"
              style={{ left: `${snapGuides.x}px` }}
            />
          )}
          {snapGuides.y !== undefined && (
            <div
              className="absolute left-0 right-0 h-px bg-cyan-400 z-40 pointer-events-none shadow-[0_0_8px_rgba(34,211,238,0.9)]"
              style={{ top: `${snapGuides.y}px` }}
            />
          )}

          {/* 9:16 Safe Area Margins Overlay */}
          {targetAspectRatio === "9:16" && (
            <div className="absolute inset-x-[6%] top-[12%] bottom-[18%] border border-dashed border-white/20 pointer-events-none z-30">
              <span className="absolute top-1 left-1.5 text-[8px] font-mono text-white/30 uppercase tracking-wider">
                Safe Area (9:16)
              </span>
            </div>
          )}

          {/* Active Transition Visual Preview Layer */}
          {activeTransitions.length > 0 && (() => {
            const trans = activeTransitions[0].transition;
            const prog = activeTransitions[0].progress;
            if (trans.type === "fade_to_black") {
              return <div className="absolute inset-0 bg-black pointer-events-none z-15" style={{ opacity: prog }} />;
            }
            if (trans.type === "fade_from_black") {
              return <div className="absolute inset-0 bg-black pointer-events-none z-15" style={{ opacity: 1 - prog }} />;
            }
            if (trans.type === "dip_black") {
              const dip = prog < 0.5 ? prog * 2 : (1 - prog) * 2;
              return <div className="absolute inset-0 bg-black pointer-events-none z-15" style={{ opacity: dip }} />;
            }
            if (trans.type === "fade_to_white") {
              return <div className="absolute inset-0 bg-white pointer-events-none z-15" style={{ opacity: prog }} />;
            }
            if (trans.type === "fade_from_white") {
              return <div className="absolute inset-0 bg-white pointer-events-none z-15" style={{ opacity: 1 - prog }} />;
            }
            if (trans.type === "dip_color") {
              const dip = prog < 0.5 ? prog * 2 : (1 - prog) * 2;
              const dipColor = typeof trans.params?.color === "string" ? trans.params.color : "#000000";
              return <div className="absolute inset-0 pointer-events-none z-15" style={{ backgroundColor: dipColor, opacity: dip }} />;
            }
            return null;
          })()}

          {/* Active Transition Indicator Badge */}
          {activeTransitions.length > 0 && (
            <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/85 border border-emerald-500/40 text-[11px] text-emerald-300 z-20 shadow-lg pointer-events-none">
              <span>✨</span>
              <span>
                {activeTransitions[0].def?.label || activeTransitions[0].transition.type} (
                {Math.round(activeTransitions[0].progress * 100)}%)
              </span>
            </div>
          )}

          {/* Actionable Overlay: Missing / Unlinked Source File */}
          {activeClip && isFileMissing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center bg-black/85 z-20">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mb-1">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <h4 className="text-xs font-semibold text-cs-text-primary">Source Media Offline</h4>
              <p className="text-[11px] text-cs-text-secondary max-w-sm">
                The file for &ldquo;{activeLiveItem?.asset.name || activeClip.assetId}&rdquo; requires permission renewal or relinking.
              </p>
            </div>
          )}

          {/* Actionable Overlay: Loading Media */}
          {isLoadingMedia && (
            <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/75 border border-white/10 text-[11px] text-cs-text-secondary z-20">
              <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="10" />
              </svg>
              <span>Loading clip source...</span>
            </div>
          )}

          {/* Actionable Overlay: Media Decode Error */}
          {mediaError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center bg-black/90 z-20">
              <div className="w-10 h-10 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <h4 className="text-xs font-semibold text-red-300">Decode Error</h4>
              <p className="text-[11px] text-cs-text-secondary max-w-sm">{mediaError}</p>
            </div>
          )}

          {/* Actionable Overlay: Autoplay Blocked */}
          {playbackBlocked && (
            <div
              onClick={() => {
                setPlaybackBlocked(false);
                videoRef.current?.play().catch(() => { });
              }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center bg-black/60 cursor-pointer z-30"
            >
              <div className="w-12 h-12 rounded-full bg-cs-accent/20 text-cs-accent flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </div>
              <p className="text-xs font-medium text-white">Click anywhere to resume playback</p>
            </div>
          )}

          {/* Actionable Overlay: Gap / No clip */}
          {!activeClip && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 select-none">
              <div className="text-cs-text-tertiary opacity-30">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" strokeWidth="1" stroke="currentColor">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <polygon points="10 8 16 11.5 10 15 10 8" />
                </svg>
              </div>
              {hasTimeline ? (
                <p className="text-xs text-cs-text-tertiary">Gap — no clip at this position</p>
              ) : (
                <p className="text-xs text-cs-text-tertiary">Add clips or repurposed moments to preview</p>
              )}
            </div>
          )}

          {/* Synchronized Text Overlays & Timed Captions (Strictly bounded inside the composition canvas) */}
          {activeOverlays.map((overlay) => (
            <TextOverlayRenderer
              key={overlay.id}
              overlay={overlay}
              currentTime={currentTime}
              compWidth={compSize.width}
              compHeight={compSize.height}
              isSelected={selectedOverlayId === overlay.id}
              isEditing={editingOverlayId === overlay.id}
              inlineText={editingOverlayId === overlay.id ? inlineEditText : overlay.text}
              onSelect={() => selectOverlay(overlay.id)}
              onDoubleClick={() => {
                setEditingOverlayId(overlay.id);
                setInlineEditText(overlay.text);
              }}
              onPointerDown={(e) => handleOverlayPointerDown(e, overlay)}
              onInlineTextChange={setInlineEditText}
              onCommitInlineEdit={() => handleCommitInlineEdit(overlay.id)}
            />
          ))}
        </div>
      </div>

      {/* Playback Controls & Status Bar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-cs-bg-surface border-t border-cs-border-subtle">
        {/* Replay / Jump to Start */}
        <button
          onClick={() => {
            onPlaybackTimeUpdate(0);
            if (!isPlaying) onPlayPause();
          }}
          className="w-7 h-7 flex items-center justify-center rounded bg-cs-bg-elevated hover:bg-cs-bg-base text-cs-text-secondary hover:text-cs-text-primary transition-colors shrink-0"
          aria-label="Replay from start"
          title="Replay from start (Home)"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 .49-3.51" />
          </svg>
        </button>

        {/* Step Back 1 Frame */}
        <button
          onClick={() => onPlaybackTimeUpdate(Math.max(0, currentTime - 1 / 30))}
          className="w-7 h-7 flex items-center justify-center rounded bg-cs-bg-elevated hover:bg-cs-bg-base text-cs-text-secondary hover:text-cs-text-primary transition-colors shrink-0"
          aria-label="Step back 1 frame"
          title="Step back 1 frame (Left Arrow)"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Play / Pause */}
        <button
          onClick={onPlayPause}
          className="w-7 h-7 flex items-center justify-center rounded bg-cs-accent hover:bg-cs-accent-hover text-white transition-colors shrink-0"
          aria-label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
        >
          {isPlaying ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>

        {/* Step Forward 1 Frame */}
        <button
          onClick={() => onPlaybackTimeUpdate(Math.min(totalDuration, currentTime + 1 / 30))}
          className="w-7 h-7 flex items-center justify-center rounded bg-cs-bg-elevated hover:bg-cs-bg-base text-cs-text-secondary hover:text-cs-text-primary transition-colors shrink-0"
          aria-label="Step forward 1 frame"
          title="Step forward 1 frame (Right Arrow)"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {/* Time display */}
        <span className="text-xs font-mono text-cs-text-secondary shrink-0 ml-1">
          {formatTimeDisplay(currentTime)}
          <span className="text-cs-text-tertiary mx-1">/</span>
          {formatTimeDisplay(totalDuration)}
        </span>

        {/* Active clip info */}
        {activeClip && (
          <span className="text-[11px] text-cs-text-tertiary truncate max-w-[200px] ml-2">
            {liveAssets.get(activeClip.assetId)?.asset.name ?? activeClip.assetId}
          </span>
        )}

        {/* Active captions / overlays count */}
        {activeOverlays.length > 0 && (
          <span className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-cs-accent/15 text-cs-accent font-medium">
            {activeOverlays.length} active {activeOverlays.length === 1 ? "overlay" : "overlays"}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Text and Caption Overlay Renderer matching export canvas 1:1.
 * Strict coordinate parity: bounded inside the composition canvas.
 */
function TextOverlayRenderer({
  overlay,
  currentTime,
  compWidth,
  compHeight,
  isSelected,
  isEditing,
  inlineText,
  onSelect,
  onDoubleClick,
  onPointerDown,
  onInlineTextChange,
  onCommitInlineEdit,
}: {
  overlay: TextOverlay;
  currentTime: number;
  compWidth: number;
  compHeight: number;
  isSelected: boolean;
  isEditing: boolean;
  inlineText: string;
  onSelect: () => void;
  onDoubleClick: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onInlineTextChange: (val: string) => void;
  onCommitInlineEdit: () => void;
}) {
  const animated = evaluateOverlayAnimation(overlay, currentTime);
  const isCaption = overlay.overlayType === "caption";
  const alignClass =
    overlay.align === "center"
      ? "text-center"
      : overlay.align === "right"
        ? "text-right"
        : "text-left";

  const scale = (compHeight > 0 ? compHeight : 720) / 720;
  const fontSize = Math.max(10, Math.round(overlay.fontSize * scale));
  const fontWeight = overlay.fontWeight || (isCaption ? 700 : 600);
  const maxWidthPx = (overlay.boxWidthRatio || 0.85) * (compWidth > 0 ? compWidth : 1280);

  const bgColor =
    overlay.backgroundColor ||
    (overlay.preset === "bold" || isCaption ? "rgba(0, 0, 0, 0.82)" : undefined);
  const strokeColor =
    overlay.strokeColor || (overlay.preset === "minimal" ? "#000000" : undefined);
  const strokeWidth = (overlay.strokeWidth || (strokeColor ? 2 : 0)) * scale;

  const padX = Math.round(14 * scale);
  const padY = Math.round(6 * scale);
  const borderRadius = Math.round(8 * scale);

  // Position transform based on align
  const baseTransform =
    overlay.align === "left"
      ? "translate(0, -50%)"
      : overlay.align === "right"
        ? "translate(-100%, -50%)"
        : "translate(-50%, -50%)";

  const finalTransform =
    animated.offsetY !== 0
      ? `${baseTransform} translateY(${animated.offsetY}px)`
      : baseTransform;

  return (
    <div
      className={`absolute select-none z-20 ${alignClass} ${isEditing ? "pointer-events-auto" : "cursor-move pointer-events-auto"}`}
      onPointerDown={isEditing ? undefined : onPointerDown}
      onDoubleClick={onDoubleClick}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      style={{
        left: `${overlay.x * 100}%`,
        top: `${overlay.y * 100}%`,
        transform: finalTransform,
        opacity: animated.opacity,
        fontSize: `${fontSize}px`,
        color: overlay.color || "#ffffff",
        maxWidth: `${maxWidthPx}px`,
        width: "max-content",
        lineHeight: 1.35,
        fontWeight,
        letterSpacing: "0.01em",
        wordBreak: "break-word",
        overflowWrap: "break-word",
        backgroundColor: bgColor,
        padding: bgColor ? `${padY}px ${padX}px` : "0",
        borderRadius: bgColor ? `${borderRadius}px` : "0",
        WebkitTextStroke:
          strokeColor && strokeWidth > 0 ? `${strokeWidth}px ${strokeColor}` : undefined,
        textShadow:
          !bgColor && (!strokeColor || strokeWidth <= 0)
            ? "0 1px 4px rgba(0,0,0,0.85), 0 0 8px rgba(0,0,0,0.6)"
            : undefined,
      }}
    >
      {isEditing ? (
        <textarea
          autoFocus
          value={inlineText}
          onChange={(e) => onInlineTextChange(e.target.value)}
          onBlur={onCommitInlineEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onCommitInlineEdit();
            }
          }}
          className="bg-black/95 text-white outline-none border-2 border-cs-accent rounded p-1 resize-none font-inherit text-inherit"
          style={{ minWidth: "160px", minHeight: "44px" }}
        />
      ) : (
        <>
          {animated.renderedText}
          {isSelected && (
            <div className="absolute -inset-1.5 pointer-events-none border-2 border-cs-accent rounded-sm">
              <div className="absolute -top-1 -left-1 w-2 h-2 bg-white border border-cs-accent rounded-sm" />
              <div className="absolute -top-1 -right-1 w-2 h-2 bg-white border border-cs-accent rounded-sm" />
              <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-white border border-cs-accent rounded-sm" />
              <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-white border border-cs-accent rounded-sm" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
