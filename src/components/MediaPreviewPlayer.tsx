"use client";

/**
 * MediaPreviewPlayer — Video and audio preview player with seek controls and media inspection summary (Phase 3).
 *
 * Responsibilities:
 * - Native browser playback for supported local video and audio files using object URLs.
 * - Accurate play/pause, seek scrubbing, and playback time updates.
 * - Responsive preview surface that preserves media aspect ratio.
 * - Handles autoplay restrictions, missing files, permission states, and unsupported media.
 * - Displays inspected technical summary (container, duration, resolution, rotation, frame rate, audio).
 * - Tiers preview cleanly: native player for playback, WebCodecs capability query for future phases.
 */

import * as React from "react";
import { useEffect, useState } from "react";
import type { ProjectAsset, LiveAssetItem } from "../types/project.ts";
import { useMediaPreview } from "../lib/media/previewSource.ts";
import { formatDuration, formatResolution } from "../lib/media/inspector.ts";
import { checkAssetDecoderSupport } from "../lib/media/webcodecsCapabilities.ts";
import { formatBytes } from "../lib/projectValidation.ts";
import { Button, Badge, Panel, PanelHeader } from "@/components/ui";

interface MediaPreviewPlayerProps {
  asset: ProjectAsset;
  liveItem?: LiveAssetItem;
  onAuthorize: () => void;
  onRelink: () => void;
}

export function MediaPreviewPlayer({
  asset,
  liveItem,
  onAuthorize,
  onRelink,
}: MediaPreviewPlayerProps) {
  const file = liveItem?.file;
  const isVideo = asset.mediaType === "video";
  const {
    mediaRef,
    state: playbackState,
    togglePlay,
    seek,
    setMuted,
  } = useMediaPreview(file);

  const [decoderSupport, setDecoderSupport] = useState<{
    videoSupported?: boolean;
    audioSupported?: boolean;
  }>({});

  // Check WebCodecs decoder support for the inspected metadata in background
  useEffect(() => {
    let isCancelled = false;
    if (asset.metadata) {
      checkAssetDecoderSupport(asset.metadata).then((res) => {
        if (!isCancelled) {
          setDecoderSupport(res);
        }
      });
    }
    return () => {
      isCancelled = true;
    };
  }, [asset.metadata]);

  const accessStatus = liveItem?.status || "ready";
  const isInspecting = liveItem?.isInspecting;
  const inspectionResult = liveItem?.inspection;
  const metadata = asset.metadata || inspectionResult?.metadata;

  // Aspect ratio styling for video
  const aspectStyle =
    isVideo && metadata?.displayWidth && metadata?.displayHeight
      ? { aspectRatio: `${metadata.displayWidth} / ${metadata.displayHeight}` }
      : { aspectRatio: "16 / 9" };

  return (
    <div className="flex flex-col gap-4">
      {/* Playback Surface Panel */}
      <Panel>
        <PanelHeader
          title={asset.name}
          description={`${asset.mediaType.toUpperCase()} · ${formatBytes(asset.size)}`}
          actions={
            <div className="flex items-center gap-2">
              <Badge variant={isVideo ? "default" : "info"}>
                {isVideo ? "Video Preview" : "Audio Preview"}
              </Badge>
              {decoderSupport.videoSupported !== undefined && (
                <Badge
                  variant={decoderSupport.videoSupported ? "success" : "muted"}
                  title={
                    decoderSupport.videoSupported
                      ? "WebCodecs VideoDecoder supports this codec profile."
                      : "WebCodecs VideoDecoder does not support this codec profile. Native browser playback is used."
                  }
                >
                  {decoderSupport.videoSupported ? "WebCodecs Ready" : "Native Player"}
                </Badge>
              )}
            </div>
          }
        />

        <div className="p-4 flex flex-col items-center justify-center bg-cs-bg-base/60 min-h-[320px]">
          {/* Missing / Moved State */}
          {accessStatus === "missing" && (
            <div className="flex flex-col items-center text-center max-w-sm gap-3 py-10">
              <div className="w-10 h-10 rounded-full bg-cs-error/15 text-cs-error flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h4 className="text-sm font-semibold text-cs-text-primary">Source file missing or moved</h4>
              <p className="text-xs text-cs-text-secondary leading-relaxed">
                The original file was moved, renamed, or deleted from its original location on disk. Relink the reference to resume preview.
              </p>
              <Button variant="primary" size="sm" onClick={onRelink}>
                Relink file
              </Button>
            </div>
          )}

          {/* Prompt Required State */}
          {accessStatus === "prompt-required" && (
            <div className="flex flex-col items-center text-center max-w-sm gap-3 py-10">
              <div className="w-10 h-10 rounded-full bg-cs-warning/15 text-cs-warning flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <h4 className="text-sm font-semibold text-cs-text-primary">Permission Renewal Required</h4>
              <p className="text-xs text-cs-text-secondary leading-relaxed">
                The browser requires user authorization to re-open this file from your computer for this editing session.
              </p>
              <Button variant="primary" size="sm" onClick={onAuthorize}>
                Authorize file access
              </Button>
            </div>
          )}

          {/* Inspecting State */}
          {isInspecting && (
            <div className="flex flex-col items-center text-center gap-3 py-12">
              <div className="w-8 h-8 border-2 border-cs-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-cs-text-secondary font-medium">
                Inspecting media tracks and container…
              </p>
            </div>
          )}

          {/* Inspection Error / Unsupported State */}
          {!isInspecting && inspectionResult && inspectionResult.status !== "ready" && accessStatus === "ready" && (
            <div className="flex flex-col items-center text-center max-w-sm gap-3 py-10">
              <div className="w-10 h-10 rounded-full bg-cs-warning/15 text-cs-warning flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <h4 className="text-sm font-semibold text-cs-text-primary">
                {inspectionResult.status === "unsupported"
                  ? "Unsupported Media Format"
                  : inspectionResult.status === "no-usable-tracks"
                  ? "No Usable Media Tracks"
                  : "Corrupted Media File"}
              </h4>
              <p className="text-xs text-cs-text-secondary leading-relaxed">
                {inspectionResult.error || "The file could not be parsed by the media engine."}
              </p>
              <Button variant="secondary" size="sm" onClick={onRelink}>
                Relink to another file
              </Button>
            </div>
          )}

          {/* Active Player Surface */}
          {!isInspecting && accessStatus === "ready" && (!inspectionResult || inspectionResult.status === "ready") && (
            <div className="w-full flex flex-col items-center">
              {isVideo ? (
                <div
                  className="w-full max-h-[380px] bg-black rounded overflow-hidden flex items-center justify-center relative shadow-inner"
                  style={aspectStyle}
                >
                  <video
                    ref={mediaRef as React.RefObject<HTMLVideoElement>}
                    className="w-full h-full object-contain"
                    playsInline
                    onClick={togglePlay}
                  />
                </div>
              ) : (
                <div className="w-full py-12 flex flex-col items-center justify-center bg-cs-bg-elevated/40 rounded border border-cs-border-subtle">
                  <div className="w-16 h-16 rounded-full bg-cs-info/10 text-cs-info flex items-center justify-center mb-3">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                  </div>
                  <span className="text-xs font-medium text-cs-text-primary mb-1">{asset.name}</span>
                  <span className="text-[11px] text-cs-text-tertiary">
                    {metadata?.duration ? formatDuration(metadata.duration) : "Audio source"}
                  </span>
                  <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} />
                </div>
              )}

              {/* Playback Controls Bar */}
              <div className="w-full mt-3 p-3 bg-cs-bg-surface border border-cs-border-subtle rounded flex flex-col gap-2">
                {/* Seek Bar */}
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-cs-text-secondary shrink-0">
                    {formatDuration(playbackState.currentTime)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={playbackState.duration > 0 ? playbackState.duration : metadata?.duration || 100}
                    step={0.05}
                    value={playbackState.currentTime}
                    onChange={(e) => seek(parseFloat(e.target.value))}
                    disabled={playbackState.state === "loading" || playbackState.state === "error"}
                    className="flex-1 h-1.5 bg-cs-bg-base rounded-lg appearance-none cursor-pointer accent-cs-accent disabled:opacity-50"
                    aria-label="Seek playback timeline"
                  />
                  <span className="text-[11px] font-mono text-cs-text-tertiary shrink-0">
                    {formatDuration(playbackState.duration || metadata?.duration)}
                  </span>
                </div>

                {/* Button Controls */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={togglePlay}
                      title={playbackState.isPlaying ? "Pause (Space)" : "Play (Space)"}
                      disabled={playbackState.state === "loading" || playbackState.state === "error"}
                    >
                      {playbackState.isPlaying ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="4" width="4" height="16" />
                          <rect x="14" y="4" width="4" height="16" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      )}
                      <span>{playbackState.isPlaying ? "Pause" : "Play"}</span>
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setMuted(!playbackState.isMuted)}
                      title={playbackState.isMuted ? "Unmute" : "Mute"}
                    >
                      {playbackState.isMuted ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                          <line x1="1" y1="1" x2="23" y2="23" />
                          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                          <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0a7 7 0 0 1-.11 1.23" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      )}
                    </Button>
                  </div>

                  {playbackState.isAutoplayBlocked && (
                    <span className="text-[11px] text-cs-warning">
                      Playback paused by browser. Click Play to start.
                    </span>
                  )}

                  {playbackState.error && (
                    <span className="text-[11px] text-cs-error" title={playbackState.error}>
                      Playback error. Codec may not be supported by native browser element.
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </Panel>

      {/* Inspected Technical Metadata Summary */}
      {metadata && (
        <Panel>
          <PanelHeader title="Inspected Media Metadata" description="Extracted locally via Mediabunny" />
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-cs-text-tertiary block mb-0.5">Container Format</span>
              <span className="font-semibold text-cs-text-primary">
                {metadata.containerFormat || "Unknown"}
              </span>
            </div>

            <div>
              <span className="text-cs-text-tertiary block mb-0.5">Duration</span>
              <span className="font-semibold text-cs-text-primary font-mono">
                {formatDuration(metadata.duration)}
              </span>
            </div>

            {isVideo && (
              <>
                <div>
                  <span className="text-cs-text-tertiary block mb-0.5">Display Dimensions</span>
                  <span className="font-semibold text-cs-text-primary">
                    {formatResolution(metadata.displayWidth, metadata.displayHeight)}
                    {metadata.rotation ? ` (${metadata.rotation}°)` : ""}
                  </span>
                </div>

                <div>
                  <span className="text-cs-text-tertiary block mb-0.5">Coded Dimensions</span>
                  <span className="text-cs-text-secondary">
                    {formatResolution(metadata.codedWidth, metadata.codedHeight)}
                  </span>
                </div>

                <div>
                  <span className="text-cs-text-tertiary block mb-0.5">Frame Rate</span>
                  <span className="font-semibold text-cs-text-primary">
                    {metadata.isConstantFrameRate && metadata.frameRate
                      ? `${metadata.frameRate} fps (CFR)`
                      : metadata.isConstantFrameRate === false
                      ? "Variable (VFR)"
                      : "Unspecified"}
                  </span>
                </div>

                <div>
                  <span className="text-cs-text-tertiary block mb-0.5">Video Tracks</span>
                  <span className="text-cs-text-secondary">
                    {metadata.videoTracks.length} track{metadata.videoTracks.length === 1 ? "" : "s"}
                  </span>
                </div>
              </>
            )}

            <div>
              <span className="text-cs-text-tertiary block mb-0.5">Audio Channels</span>
              <span className="font-semibold text-cs-text-primary">
                {metadata.numberOfChannels
                  ? metadata.numberOfChannels === 1
                    ? "Mono (1 ch)"
                    : metadata.numberOfChannels === 2
                    ? "Stereo (2 ch)"
                    : `${metadata.numberOfChannels} channels`
                  : "No audio"}
              </span>
            </div>

            <div>
              <span className="text-cs-text-tertiary block mb-0.5">Audio Sample Rate</span>
              <span className="text-cs-text-secondary">
                {metadata.sampleRate ? `${metadata.sampleRate.toLocaleString()} Hz` : "--"}
              </span>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}

