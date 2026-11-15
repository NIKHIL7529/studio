"use client";

/**
 * SourceMonitor — Source media inspection and three-point / four-point edit monitor.
 *
 * Rules:
 * - Mark In (I), Mark Out (O), and clear boundaries.
 * - Frame-accurate stepping forward and backward.
 * - SMPTE timecode display for playhead and marked duration.
 * - Insert edit (shifts downstream clips) and Overwrite edit (places directly on timeline).
 * - Object URL safety and resource cleanup.
 */

import * as React from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import type { ProjectAsset, LiveAssetItem } from "../../types/project.ts";
import type { TimelineDocument } from "../../types/timeline.ts";
import { formatTimecode, stepFrames } from "../../lib/timeline/timecode.ts";
import { ObjectUrlManager } from "../../lib/media/previewSource.ts";
import { Button, IconButton, Badge } from "@/components/ui";

export interface SourceMonitorProps {
  asset: ProjectAsset | null;
  liveItem?: LiveAssetItem;
  timeline: TimelineDocument;
  onInsertEdit: (assetId: string, sourceIn: number, sourceOut: number, targetTrackId: string) => void;
  onOverwriteEdit: (assetId: string, sourceIn: number, sourceOut: number, targetTrackId: string) => void;
  onClose?: () => void;
}

export function SourceMonitor({
  asset,
  liveItem,
  timeline,
  onInsertEdit,
  onOverwriteEdit,
  onClose,
}: SourceMonitorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlManagerRef = useRef<ObjectUrlManager>(new ObjectUrlManager());

  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [inPoint, setInPoint] = useState<number | null>(null);
  const [outPoint, setOutPoint] = useState<number | null>(null);

  // Target track state
  const defaultTrack = timeline.tracks.find((t) => t.type === (asset?.mediaType === "audio" ? "audio" : "video")) || timeline.tracks[0];
  const [userSelectedTrackId, setUserSelectedTrackId] = useState<string | null>(null);
  const targetTrackId = (userSelectedTrackId && timeline.tracks.some((t) => t.id === userSelectedTrackId))
    ? userSelectedTrackId
    : (defaultTrack?.id || "");

  // Load media file handle into URL
  useEffect(() => {
    const manager = urlManagerRef.current;
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      if (!asset || !liveItem?.file) {
        setMediaUrl(null);
        setCurrentTime(0);
        setDuration(0);
        setInPoint(null);
        setOutPoint(null);
        return;
      }

      const url = manager.create(liveItem.file);
      setMediaUrl(url);
      setCurrentTime(0);
      setInPoint(0);
      const assetDuration = asset.metadata?.duration || 0;
      setDuration(assetDuration);
      setOutPoint(assetDuration > 0 ? assetDuration : null);
    });

    return () => {
      cancelled = true;
      manager.revokeAll();
    };
  }, [asset, liveItem?.file]);

  const fps = asset?.metadata?.videoTracks?.[0]?.frameRate || 30;

  // Frame stepping
  const handleStepFrames = useCallback((delta: number) => {
    const el = videoRef.current || audioRef.current;
    if (!el) return;
    const nextTime = Math.max(0, Math.min(duration || 10000, stepFrames(el.currentTime, delta, fps)));
    el.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, [duration, fps]);

  // Toggle play/pause
  const handlePlayPause = useCallback(() => {
    const el = videoRef.current || audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      el.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  }, [isPlaying]);

  // Mark In & Mark Out
  const handleMarkIn = useCallback(() => {
    const el = videoRef.current || audioRef.current;
    const time = el?.currentTime || currentTime;
    setInPoint(time);
    if (outPoint !== null && outPoint <= time) {
      setOutPoint(Math.min(duration || time + 5, time + 5));
    }
  }, [currentTime, outPoint, duration]);

  const handleMarkOut = useCallback(() => {
    const el = videoRef.current || audioRef.current;
    const time = el?.currentTime || currentTime;
    setOutPoint(time);
    if (inPoint !== null && inPoint >= time) {
      setInPoint(Math.max(0, time - 5));
    }
  }, [currentTime, inPoint]);

  const handleClearInOut = useCallback(() => {
    setInPoint(0);
    setOutPoint(duration > 0 ? duration : null);
  }, [duration]);

  // Insert & Overwrite triggers
  const handleDoInsert = useCallback(() => {
    if (!asset || !targetTrackId) return;
    const effIn = inPoint !== null ? inPoint : 0;
    const effOut = outPoint !== null && outPoint > effIn ? outPoint : (duration > effIn ? duration : effIn + 5);
    onInsertEdit(asset.id, effIn, effOut, targetTrackId);
  }, [asset, targetTrackId, inPoint, outPoint, duration, onInsertEdit]);

  const handleDoOverwrite = useCallback(() => {
    if (!asset || !targetTrackId) return;
    const effIn = inPoint !== null ? inPoint : 0;
    const effOut = outPoint !== null && outPoint > effIn ? outPoint : (duration > effIn ? duration : effIn + 5);
    onOverwriteEdit(asset.id, effIn, effOut, targetTrackId);
  }, [asset, targetTrackId, inPoint, outPoint, duration, onOverwriteEdit]);

  if (!asset) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-cs-bg-base text-cs-text-tertiary text-xs">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" stroke="currentColor" className="mb-2 opacity-50">
          <circle cx="12" cy="12" r="10" />
          <polygon points="10 8 16 12 10 16 10 8" />
        </svg>
        <span className="font-medium text-cs-text-secondary">Source Monitor</span>
        <span className="mt-1 text-[11px]">Select a video or audio file from the media bin to inspect</span>
      </div>
    );
  }

  const markedDuration = Math.max(
    0,
    (outPoint !== null ? outPoint : duration) - (inPoint !== null ? inPoint : 0)
  );

  return (
    <div className="flex-1 flex flex-col bg-black overflow-hidden relative select-none">
      {/* Top Source Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-cs-bg-surface/90 border-b border-cs-border-subtle shrink-0 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="info">Source</Badge>
          <span className="font-semibold text-cs-text-primary truncate" title={asset.name}>
            {asset.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Target Track Selector */}
          <div className="flex items-center gap-1.5 text-[11px] text-cs-text-tertiary">
            <span>Target:</span>
            <select
              value={targetTrackId}
              onChange={(e) => setUserSelectedTrackId(e.target.value)}
              className="h-6 px-1.5 text-xs rounded bg-cs-bg-base border border-cs-border-default text-cs-text-primary focus:outline-none"
            >
              {timeline.tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.type})
                </option>
              ))}
            </select>
          </div>
          {onClose && (
            <IconButton label="Close Source Monitor" size="sm" onClick={onClose}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </IconButton>
          )}
        </div>
      </div>

      {/* Media Playback Surface */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden bg-black min-h-0">
        {mediaUrl ? (
          asset.mediaType === "audio" ? (
            <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-cs-info/20 text-cs-info flex items-center justify-center text-2xl">
                🎵
              </div>
              <span className="text-xs font-mono text-cs-text-secondary">{formatTimecode(currentTime, fps)}</span>
              <audio
                ref={audioRef}
                src={mediaUrl}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => {
                  setDuration(e.currentTarget.duration);
                  if (outPoint === null) setOutPoint(e.currentTarget.duration);
                }}
                onEnded={() => setIsPlaying(false)}
              />
            </div>
          ) : (
            <video
              ref={videoRef}
              src={mediaUrl}
              className="max-w-full max-h-full object-contain"
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => {
                setDuration(e.currentTarget.duration);
                if (outPoint === null) setOutPoint(e.currentTarget.duration);
              }}
              onEnded={() => setIsPlaying(false)}
              onClick={handlePlayPause}
            />
          )
        ) : (
          <div className="text-xs text-cs-text-tertiary">Media file handle not ready</div>
        )}
      </div>

      {/* Scrub & Mark Bar */}
      <div className="px-3 pt-2 bg-cs-bg-surface border-t border-cs-border-subtle shrink-0">
        <div className="relative h-4 flex items-center">
          {/* Full progress track */}
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={1 / fps}
            value={currentTime}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setCurrentTime(val);
              const el = videoRef.current || audioRef.current;
              if (el) el.currentTime = val;
            }}
            className="w-full h-1 bg-cs-bg-elevated rounded appearance-none cursor-pointer accent-cs-accent"
          />

          {/* In / Out visual range highlight */}
          {duration > 0 && inPoint !== null && outPoint !== null && (
            <div
              className="absolute top-1 bottom-1 bg-cs-accent/30 pointer-events-none rounded"
              style={{
                left: `${(inPoint / duration) * 100}%`,
                width: `${Math.max(0, ((outPoint - inPoint) / duration) * 100)}%`,
              }}
            />
          )}
        </div>
      </div>

      {/* Transport & Edit Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-1.5 bg-cs-bg-surface border-t border-cs-border-subtle shrink-0">
        {/* Left: Timecode Readout */}
        <div className="flex items-center gap-2 text-xs font-mono shrink-0">
          <span className="text-cs-text-primary font-semibold">{formatTimecode(currentTime, fps)}</span>
          <span className="text-cs-text-tertiary">/</span>
          <span className="text-cs-text-secondary">{formatTimecode(duration, fps)}</span>
          {inPoint !== null && outPoint !== null && (
            <span className="text-[11px] text-cs-accent ml-1 font-sans">
              [{formatTimecode(markedDuration, fps)}]
            </span>
          )}
        </div>

        {/* Center: Play / Frame Stepping Controls */}
        <div className="flex items-center gap-0.5 shrink-0">
          <IconButton label="Step 1 Sec Back" size="sm" onClick={() => handleStepFrames(-Math.round(fps))}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 19 2 12 11 5 11 19" />
              <polygon points="22 19 13 12 22 5 22 19" />
            </svg>
          </IconButton>
          <IconButton label="Step 1 Frame Back" size="sm" onClick={() => handleStepFrames(-1)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="19 20 9 12 19 4 19 20" />
              <line x1="5" y1="19" x2="5" y2="5" />
            </svg>
          </IconButton>
          <Button variant="ghost" size="sm" onClick={handlePlayPause} className="px-2">
            {isPlaying ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </Button>
          <IconButton label="Step 1 Frame Forward" size="sm" onClick={() => handleStepFrames(1)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 4 15 12 5 20 5 4" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </IconButton>
          <IconButton label="Step 1 Sec Forward" size="sm" onClick={() => handleStepFrames(Math.round(fps))}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="13 19 22 12 13 5 13 19" />
              <polygon points="2 19 11 12 2 5 2 19" />
            </svg>
          </IconButton>
        </div>

        {/* Right: In/Out + Insert/Overwrite Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" onClick={handleMarkIn} title="Mark In (I)" className="px-1.5 text-[11px] font-mono h-6">
            [ In
          </Button>
          <Button variant="ghost" size="sm" onClick={handleMarkOut} title="Mark Out (O)" className="px-1.5 text-[11px] font-mono h-6">
            Out ]
          </Button>
          <Button variant="ghost" size="sm" onClick={handleClearInOut} title="Clear In/Out (Alt+X)" className="px-1 text-[10px] text-cs-text-tertiary h-6">
            ✕
          </Button>

          <div className="h-4 w-px bg-cs-border-subtle mx-0.5" />

          {/* Insert Edit Button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleDoInsert}
            title="Insert Edit (,) — Inserts at playhead, rippling downstream clips"
            className="flex items-center gap-1 text-[11px] h-6 px-2"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
            <span>Insert</span>
          </Button>

          {/* Overwrite Edit Button */}
          <Button
            variant="primary"
            size="sm"
            onClick={handleDoOverwrite}
            title="Overwrite Edit (.) — Places onto timeline from playhead without rippling"
            className="flex items-center gap-1 text-[11px] h-6 px-2"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
            </svg>
            <span>Overwrite</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
