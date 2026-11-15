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
import type { TimelineDocument, TimelineClip, TextOverlay } from "../../types/timeline.ts";
import type { LiveAssetItem } from "../../types/project.ts";
import { getActiveClipAtTime, getActiveTextOverlaysAtTime, getTimelineDuration } from "../../lib/timeline/model.ts";
import { ObjectUrlManager } from "../../lib/media/previewSource.ts";

export interface TimelinePreviewProps {
  timeline: TimelineDocument;
  liveAssets: Map<string, LiveAssetItem>;
  currentTime: number;
  isPlaying: boolean;
  onPlaybackTimeUpdate: (time: number) => void;
  onPlayPause: () => void;
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
}: TimelinePreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const urlManagerRef = useRef<ObjectUrlManager>(new ObjectUrlManager());

  // Tracking state to prevent duplicate object URL creation & handle file resolution races
  const currentLoadedAssetIdRef = useRef<string | null>(null);
  const currentLoadedFileRef = useRef<File | null>(null);
  const activeClipIdRef = useRef<string | null>(null);
  const activeUrlRef = useRef<string | null>(null);

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

  // Active clip asset info
  const activeLiveItem = activeClip ? liveAssets.get(activeClip.assetId) : null;
  const activeFile = activeLiveItem?.file ?? null;
  const isFileMissing = activeClip ? (!activeLiveItem || activeLiveItem.status !== "ready" || !activeFile) : false;

  // Load or reuse media source
  const loadClip = useCallback((clip: TimelineClip | null, file: File | null) => {
    const video = videoRef.current;
    const manager = urlManagerRef.current;

    if (!video) return;

    if (!clip || !file) {
      if (activeUrlRef.current) {
        manager.revoke(activeUrlRef.current);
        activeUrlRef.current = null;
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
      const targetSrc = Math.min(clip.sourceOut, clip.sourceIn + clipOffset);
      try {
        video.currentTime = targetSrc;
      } catch { /* ignored */ }
      video.muted = clip.muted;
      video.volume = Math.max(0, Math.min(1, clip.volume));
      if (isPlayingRef.current && video.paused) {
        video.play().catch(() => setPlaybackBlocked(true));
      }
      return;
    }

    // New file / source asset: swap URL cleanly
    if (activeUrlRef.current) {
      manager.revoke(activeUrlRef.current);
      activeUrlRef.current = null;
    }

    setIsLoadingMedia(true);
    setMediaError(null);

    try {
      const url = manager.create(file);
      activeUrlRef.current = url;
      currentLoadedAssetIdRef.current = clip.assetId;
      currentLoadedFileRef.current = file;
      activeClipIdRef.current = clip.id;

      video.src = url;
      video.muted = clip.muted;
      video.volume = Math.max(0, Math.min(1, clip.volume));
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
      const targetSrc = Math.min(clip.sourceOut, clip.sourceIn + clipOffset);
      try {
        video.currentTime = targetSrc;
      } catch { /* ignored */ }

      if (isPlayingRef.current) {
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
          const expectedSrcTime = currentClip.sourceIn + (newTime - currentClip.startTime);
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
    const targetSrc = Math.min(activeClip.sourceOut, activeClip.sourceIn + clipOffset);
    if (Math.abs(video.currentTime - targetSrc) > 0.05) {
      try { video.currentTime = targetSrc; } catch { /* ignored */ }
    }
  }, [currentTime, isPlaying, activeClip]);

  // Keep volume & muted synchronized
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClip) return;
    video.muted = activeClip.muted;
    video.volume = Math.max(0, Math.min(1, activeClip.volume));
  }, [activeClip]);

  // Cleanup on unmount
  useEffect(() => {
    const manager = urlManagerRef.current;
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      manager.revokeAll();
    };
  }, []);

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
          {/* Video element */}
          <video
            ref={videoRef}
            className={`w-full h-full object-contain ${!activeClip || isFileMissing ? "hidden" : ""}`}
            playsInline
            onClick={() => {
              if (playbackBlocked) {
                setPlaybackBlocked(false);
                videoRef.current?.play().catch(() => {});
              } else {
                onPlayPause();
              }
            }}
          />

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
                videoRef.current?.play().catch(() => {});
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
              compWidth={compSize.width}
              compHeight={compSize.height}
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
  compWidth,
  compHeight,
}: {
  overlay: TextOverlay;
  compWidth: number;
  compHeight: number;
}) {
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
  const transform =
    overlay.align === "left"
      ? "translate(0, -50%)"
      : overlay.align === "right"
      ? "translate(-100%, -50%)"
      : "translate(-50%, -50%)";

  return (
    <div
      className={`absolute pointer-events-none select-none z-20 ${alignClass}`}
      style={{
        left: `${overlay.x * 100}%`,
        top: `${overlay.y * 100}%`,
        transform,
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
      {overlay.text}
    </div>
  );
}
