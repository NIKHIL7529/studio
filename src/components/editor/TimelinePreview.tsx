"use client";

/**
 * TimelinePreview — Preview panel showing the timeline at the current playhead.
 *
 * Uses native <video>/<audio> element backed by object URLs.
 * Drives playhead forward with requestAnimationFrame when isPlaying.
 * Renders text overlays absolutely positioned over the video.
 * Handles sourceIn offset, clip.muted, clip.volume and end-of-timeline.
 * Cleans up all object URLs and event listeners on unmount or source change.
 */

import * as React from "react";
import { useEffect, useRef, useCallback } from "react";
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const urlManagerRef = useRef<ObjectUrlManager>(new ObjectUrlManager());
  const activeClipIdRef = useRef<string | null>(null);
  const activeUrlRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const currentTimeRef = useRef(currentTime);
  const timelineRef = useRef(timeline);
  const liveAssetsRef = useRef(liveAssets);

  // Keep refs in sync
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    currentTimeRef.current = currentTime;
    timelineRef.current = timeline;
    liveAssetsRef.current = liveAssets;
  }, [isPlaying, currentTime, timeline, liveAssets]);

  const activeClip = getActiveClipAtTime(timeline, currentTime);
  const activeOverlays = getActiveTextOverlaysAtTime(timeline, currentTime);
  const totalDuration = getTimelineDuration(timeline);

  // Load clip into video element
  const loadClip = useCallback((clip: TimelineClip | null) => {
    const video = videoRef.current;
    const manager = urlManagerRef.current;

    // Revoke previous URL
    if (activeUrlRef.current) {
      manager.revoke(activeUrlRef.current);
      activeUrlRef.current = null;
    }

    if (video) {
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch { /* ignored */ }
    }

    if (!clip || !video) {
      activeClipIdRef.current = null;
      return;
    }

    const liveItem = liveAssetsRef.current.get(clip.assetId);
    const file = liveItem?.file;
    if (!file) {
      activeClipIdRef.current = clip.id;
      return;
    }

    try {
      const url = manager.create(file);
      activeUrlRef.current = url;
      activeClipIdRef.current = clip.id;

      video.src = url;
      video.muted = clip.muted;
      video.volume = Math.max(0, Math.min(1, clip.volume));
      video.load();
    } catch (err) {
      console.warn("TimelinePreview: failed to create object URL", err);
    }
  }, []);

  // When active clip changes, reload video element
  useEffect(() => {
    const newClipId = activeClip?.id ?? null;
    if (newClipId !== activeClipIdRef.current) {
      loadClip(activeClip);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClip?.id, loadClip]);

  // After loadedmetadata, seek to sourceIn offset
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      const clip = activeClip;
      if (!clip) return;
      // Seek to sourceIn plus the offset within the clip
      const clipOffset = currentTimeRef.current - clip.startTime;
      const targetSrc = clip.sourceIn + Math.max(0, clipOffset);
      try {
        video.currentTime = Math.min(targetSrc, clip.sourceOut);
      } catch { /* ignored */ }

      if (isPlayingRef.current) {
        video.play().catch(() => { /* autoplay block */ });
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    return () => video.removeEventListener("loadedmetadata", handleLoadedMetadata);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClip?.id]);

  // rAF-based playback driver
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // Pause video if playing
      const video = videoRef.current;
      if (video && !video.paused) {
        try { video.pause(); } catch { /* ignored */ }
      }
      return;
    }

    // Start playing video element
    const video = videoRef.current;
    if (video && video.readyState >= 2) {
      video.play().catch(() => { /* autoplay block */ });
    }

    let lastTimestamp: number | null = null;

    const tick = (timestamp: number) => {
      if (!isPlayingRef.current) return;

      if (lastTimestamp !== null) {
        const delta = (timestamp - lastTimestamp) / 1000;
        const newTime = currentTimeRef.current + delta;
        const duration = getTimelineDuration(timelineRef.current);

        if (duration > 0 && newTime >= duration) {
          // End of timeline
          onPlaybackTimeUpdate(duration);
          onPlayPause(); // stop
          return;
        }

        onPlaybackTimeUpdate(newTime);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // Seek video element when currentTime changes externally (not from rAF)
  useEffect(() => {
    if (isPlaying) return; // rAF drives it
    const video = videoRef.current;
    if (!video || !activeClip) return;

    const clipOffset = currentTime - activeClip.startTime;
    const targetSrc = activeClip.sourceIn + Math.max(0, clipOffset);
    const clamped = Math.min(targetSrc, activeClip.sourceOut);
    if (Math.abs(video.currentTime - clamped) > 0.1) {
      try { video.currentTime = clamped; } catch { /* ignored */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, isPlaying, activeClip?.id]);

  // Keep video muted/volume in sync with clip props
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
    <div className="flex flex-col h-full bg-black">
      {/* Preview area */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden min-h-0">
        {/* Video element (always present, hidden when in gap) */}
        <video
          ref={videoRef}
          className={`w-full h-full object-contain ${!activeClip ? "hidden" : ""}`}
          playsInline
          onClick={onPlayPause}
        />

        {/* Gap / no clip state */}
        {!activeClip && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="text-cs-text-tertiary opacity-30">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" strokeWidth="1" stroke="currentColor">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <polygon points="10 8 16 11.5 10 15 10 8" />
              </svg>
            </div>
            {hasTimeline ? (
              <p className="text-xs text-cs-text-tertiary">Gap — no clip at this position</p>
            ) : (
              <p className="text-xs text-cs-text-tertiary">Add clips to the timeline to preview</p>
            )}
          </div>
        )}

        {/* Text overlays */}
        {activeOverlays.map((overlay) => (
          <TextOverlayRenderer key={overlay.id} overlay={overlay} />
        ))}
      </div>

      {/* Controls bar */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-2 bg-cs-bg-surface border-t border-cs-border-subtle">
        {/* Play/pause */}
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

        {/* Time display */}
        <span className="text-xs font-mono text-cs-text-secondary shrink-0">
          {formatTimeDisplay(currentTime)}
          <span className="text-cs-text-tertiary mx-1">/</span>
          {formatTimeDisplay(totalDuration)}
        </span>

        {/* Active clip label */}
        {activeClip && (
          <span className="text-[11px] text-cs-text-tertiary truncate">
            {liveAssets.get(activeClip.assetId)?.asset.name ?? activeClip.assetId}
          </span>
        )}

        {/* Overlay count badge */}
        {activeOverlays.length > 0 && (
          <span className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-cs-accent/15 text-cs-accent">
            {activeOverlays.length} overlay{activeOverlays.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

function TextOverlayRenderer({ overlay }: { overlay: TextOverlay }) {
  const alignClass =
    overlay.align === "center"
      ? "text-center"
      : overlay.align === "right"
      ? "text-right"
      : "text-left";

  return (
    <div
      className={`absolute pointer-events-none select-none ${alignClass}`}
      style={{
        left: `${overlay.x * 100}%`,
        top: `${overlay.y * 100}%`,
        transform: "translate(-50%, -50%)",
        fontSize: `${overlay.fontSize}px`,
        color: overlay.color,
        textShadow: "0 1px 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6)",
        maxWidth: "80%",
        lineHeight: 1.3,
        fontWeight: 600,
        letterSpacing: "0.01em",
      }}
    >
      {overlay.text}
    </div>
  );
}
