"use client";

/**
 * CandidatePreviewPlayer — In-place preview player for candidate moments (Phase 7).
 *
 * Rules:
 * - Plays the exact candidate interval [sourceIn, sourceOut].
 * - Automatically seeks to sourceIn and stops at sourceOut.
 * - Safely manages and revokes object URLs using ObjectUrlManager.
 */

import * as React from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import type { RepurposeCandidate } from "../../types/repurpose.ts";
import type { LiveAssetItem } from "../../types/project.ts";
import { ObjectUrlManager } from "../../lib/media/previewSource.ts";
import { formatDuration } from "../../lib/media/inspector.ts";
import { IconButton } from "@/components/ui";

export interface CandidatePreviewPlayerProps {
  candidate: RepurposeCandidate | null;
  liveAssets: Map<string, LiveAssetItem>;
  onClose?: () => void;
}

export function CandidatePreviewPlayer({
  candidate,
  liveAssets,
  onClose,
}: CandidatePreviewPlayerProps) {
  if (!candidate) {
    return null;
  }

  return (
    <CandidateActivePlayer
      key={candidate.id}
      candidate={candidate}
      liveAssets={liveAssets}
      onClose={onClose}
    />
  );
}

function CandidateActivePlayer({
  candidate,
  liveAssets,
  onClose,
}: {
  candidate: RepurposeCandidate;
  liveAssets: Map<string, LiveAssetItem>;
  onClose?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const urlManagerRef = useRef<ObjectUrlManager>(new ObjectUrlManager());
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(candidate.sourceIn);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load candidate video and clean up on unmount
  useEffect(() => {
    const manager = urlManagerRef.current;
    const liveItem = liveAssets.get(candidate.sourceAssetId);

    if (!liveItem || !liveItem.file) {
      return () => {
        manager.revokeAll();
      };
    }

    let url = "";
    try {
      url = manager.create(liveItem.file);
      const video = videoRef.current;
      if (video) {
        video.src = url;
        video.currentTime = candidate.sourceIn;
        video
          .play()
          .then(() => setIsPlaying(true))
          .catch(() => setIsPlaying(false));
      }
    } catch {
      // Ignore initial play error if autoplay was prevented
    }

    return () => {
      manager.revokeAll();
    };
  }, [candidate, liveAssets]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    setPlaybackTime(video.currentTime);

    // Stop when reaching candidate sourceOut
    if (video.currentTime >= candidate.sourceOut) {
      video.pause();
      video.currentTime = candidate.sourceIn;
      setIsPlaying(false);
    }
  }, [candidate]);

  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      if (video.currentTime >= candidate.sourceOut || video.currentTime < candidate.sourceIn) {
        video.currentTime = candidate.sourceIn;
      }
      video
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const offsetInCandidate = Math.max(0, playbackTime - candidate.sourceIn);
  const liveItem = liveAssets.get(candidate.sourceAssetId);
  const isAccessible = !!(liveItem && liveItem.file);

  return (
    <div className="flex flex-col bg-cs-bg-surface border border-cs-border-subtle rounded-lg overflow-hidden shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-cs-bg-base border-b border-cs-border-subtle">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-cs-primary animate-pulse" />
          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-cs-primary/10 text-cs-primary">
            Candidate Preview
          </span>
          <span className="font-medium text-xs text-cs-text-primary truncate">
            {candidate.sourceAssetName}
          </span>
          <span className="font-mono text-[11px] text-cs-text-secondary">
            {formatDuration(candidate.sourceIn)} – {formatDuration(candidate.sourceOut)}
          </span>
        </div>
        {onClose && (
          <IconButton label="Close preview" size="sm" onClick={onClose} title="Close preview">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </IconButton>
        )}
      </div>

      {/* Video Viewport */}
      <div className="relative aspect-video bg-black flex items-center justify-center">
        {!isAccessible || errorMessage ? (
          <div className="p-4 text-center text-xs text-cs-error">
            {errorMessage || `Media file for "${candidate.sourceAssetName}" is not accessible.`}
          </div>
        ) : (
          <video
            ref={videoRef}
            onTimeUpdate={handleTimeUpdate}
            onEnded={() => setIsPlaying(false)}
            onError={() => setErrorMessage("Failed to play media preview.")}
            className="w-full h-full object-contain cursor-pointer"
            onClick={togglePlayPause}
            playsInline
          />
        )}
      </div>

      {/* Controls */}
      <div className="p-3 flex items-center gap-3 bg-cs-bg-base border-t border-cs-border-subtle">
        <IconButton
          label={isPlaying ? "Pause" : "Play"}
          size="sm"
          onClick={togglePlayPause}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" stroke="currentColor">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" stroke="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </IconButton>

        {/* Progress scrub bar */}
        <div className="flex-1 flex items-center gap-2">
          <input
            type="range"
            min={candidate.sourceIn}
            max={candidate.sourceOut}
            step={0.05}
            value={playbackTime}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setPlaybackTime(val);
              if (videoRef.current) {
                videoRef.current.currentTime = val;
              }
            }}
            className="flex-1 h-1 bg-cs-border-default rounded-lg appearance-none cursor-pointer accent-cs-primary"
          />
          <span className="font-mono text-[10px] text-cs-text-secondary shrink-0">
            {formatDuration(offsetInCandidate)} / {formatDuration(candidate.duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
