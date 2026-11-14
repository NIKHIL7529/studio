/**
 * Preview source lifecycle and playback controller for local media (Phase 3).
 *
 * Rules:
 * - Backed by browser-native HTMLMediaElement (<video> / <audio>) and object URLs.
 * - Every created object URL is tracked and explicitly revoked upon source change or disposal.
 * - Does not require WebCodecs for basic preview playback.
 * - Handles browser autoplay restrictions gracefully.
 * - Prevents stale playback across source replacements and unmounts.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { PreviewSourceState } from "./types.ts";

/**
 * Manages tracking and safe revocation of object URLs.
 */
export class ObjectUrlManager {
  private activeUrls = new Set<string>();

  /**
   * Creates an object URL for a given Blob or File and tracks it for revocation.
   */
  create(blob: Blob | File): string {
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      throw new Error("URL.createObjectURL is not available in this environment.");
    }
    const url = URL.createObjectURL(blob);
    this.activeUrls.add(url);
    return url;
  }

  /**
   * Revokes a specific object URL and removes it from tracking.
   */
  revoke(url: string | null | undefined): void {
    if (!url || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
    if (this.activeUrls.has(url)) {
      URL.revokeObjectURL(url);
      this.activeUrls.delete(url);
    }
  }

  /**
   * Revokes all tracked object URLs.
   */
  revokeAll(): void {
    if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
    for (const url of this.activeUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch { /* ignored */ }
    }
    this.activeUrls.clear();
  }

  /**
   * Returns current count of active object URLs.
   */
  get size(): number {
    return this.activeUrls.size;
  }
}

export interface UseMediaPreviewResult {
  mediaRef: React.RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  state: PreviewSourceState;
  play: () => Promise<void>;
  pause: () => void;
  togglePlay: () => Promise<void>;
  seek: (timeInSeconds: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
}

const DEFAULT_STATE: PreviewSourceState = {
  state: "idle",
  currentTime: 0,
  duration: 0,
  buffered: 0,
  isPlaying: false,
  isMuted: false,
  volume: 1,
  error: undefined,
  isAutoplayBlocked: false,
};

/**
 * React hook to manage native media element playback, object URL lifecycle,
 * and preview state for a given local File.
 */
export function useMediaPreview(file?: File | null): UseMediaPreviewResult {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [state, setState] = useState<PreviewSourceState>(DEFAULT_STATE);
  const urlManagerRef = useRef<ObjectUrlManager | null>(null);

  if (!urlManagerRef.current) {
    urlManagerRef.current = new ObjectUrlManager();
  }

  // Active source URL ref to ensure timely cleanup in effects
  const activeUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const manager = urlManagerRef.current!;

    // Clean up any previously attached URL and reset media element
    if (activeUrlRef.current) {
      manager.revoke(activeUrlRef.current);
      activeUrlRef.current = null;
    }

    const element = mediaRef.current;
    if (element) {
      try {
        element.pause();
        element.removeAttribute("src");
        element.load();
      } catch { /* ignored */ }
    }

    if (!file) {
      setState(DEFAULT_STATE);
      return;
    }

    setState({
      ...DEFAULT_STATE,
      state: "loading",
    });

    let objectUrl: string;
    try {
      objectUrl = manager.create(file);
      activeUrlRef.current = objectUrl;
    } catch (err) {
      setState({
        ...DEFAULT_STATE,
        state: "error",
        error: err instanceof Error ? err.message : "Failed to create preview source URL.",
      });
      return;
    }

    if (element) {
      element.src = objectUrl;
      element.load();
    }

    return () => {
      if (activeUrlRef.current) {
        manager.revoke(activeUrlRef.current);
        activeUrlRef.current = null;
      }
      if (element) {
        try {
          element.pause();
          element.removeAttribute("src");
          element.load();
        } catch { /* ignored */ }
      }
    };
  }, [file]);

  // Event listeners on HTMLMediaElement
  useEffect(() => {
    const element = mediaRef.current;
    if (!element) return;

    const handleLoadedMetadata = () => {
      setState((prev) => ({
        ...prev,
        duration: element.duration || 0,
        currentTime: element.currentTime || 0,
        state: prev.isPlaying ? "playing" : "ready",
      }));
    };

    const handleTimeUpdate = () => {
      setState((prev) => ({
        ...prev,
        currentTime: element.currentTime || 0,
      }));
    };

    const handleProgress = () => {
      if (element.buffered.length > 0) {
        const bufferedEnd = element.buffered.end(element.buffered.length - 1);
        setState((prev) => ({
          ...prev,
          buffered: bufferedEnd,
        }));
      }
    };

    const handlePlay = () => {
      setState((prev) => ({
        ...prev,
        isPlaying: true,
        state: "playing",
        isAutoplayBlocked: false,
      }));
    };

    const handlePause = () => {
      setState((prev) => ({
        ...prev,
        isPlaying: false,
        state: prev.currentTime >= prev.duration && prev.duration > 0 ? "ended" : "paused",
      }));
    };

    const handleEnded = () => {
      setState((prev) => ({
        ...prev,
        isPlaying: false,
        state: "ended",
      }));
    };

    const handleError = () => {
      const mediaError = element.error;
      let errorMsg = "Media playback error.";
      if (mediaError) {
        switch (mediaError.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            errorMsg = "Playback was aborted.";
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            errorMsg = "Network or file read error.";
            break;
          case MediaError.MEDIA_ERR_DECODE:
            errorMsg = "Media decode error: codec or format unsupported by browser media engine.";
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            errorMsg = "Format or MIME type is not supported by this browser.";
            break;
        }
      }
      setState((prev) => ({
        ...prev,
        state: "error",
        error: errorMsg,
        isPlaying: false,
      }));
    };

    element.addEventListener("loadedmetadata", handleLoadedMetadata);
    element.addEventListener("timeupdate", handleTimeUpdate);
    element.addEventListener("progress", handleProgress);
    element.addEventListener("play", handlePlay);
    element.addEventListener("pause", handlePause);
    element.addEventListener("ended", handleEnded);
    element.addEventListener("error", handleError);

    return () => {
      element.removeEventListener("loadedmetadata", handleLoadedMetadata);
      element.removeEventListener("timeupdate", handleTimeUpdate);
      element.removeEventListener("progress", handleProgress);
      element.removeEventListener("play", handlePlay);
      element.removeEventListener("pause", handlePause);
      element.removeEventListener("ended", handleEnded);
      element.removeEventListener("error", handleError);
    };
  }, [file]);

  const play = useCallback(async () => {
    const element = mediaRef.current;
    if (!element) return;

    try {
      await element.play();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setState((prev) => ({
          ...prev,
          isAutoplayBlocked: true,
          isPlaying: false,
          state: "paused",
        }));
      } else {
        setState((prev) => ({
          ...prev,
          state: "error",
          error: err instanceof Error ? err.message : "Playback request failed.",
        }));
      }
    }
  }, []);

  const pause = useCallback(() => {
    const element = mediaRef.current;
    if (!element) return;
    try {
      element.pause();
    } catch { /* ignored */ }
  }, []);

  const togglePlay = useCallback(async () => {
    const element = mediaRef.current;
    if (!element) return;
    if (element.paused) {
      await play();
    } else {
      pause();
    }
  }, [play, pause]);

  const seek = useCallback((timeInSeconds: number) => {
    const element = mediaRef.current;
    if (!element) return;

    const target = Math.max(0, Math.min(timeInSeconds, element.duration || timeInSeconds));
    try {
      element.currentTime = target;
      setState((prev) => ({
        ...prev,
        currentTime: target,
      }));
    } catch { /* ignored */ }
  }, []);

  const setVolume = useCallback((vol: number) => {
    const element = mediaRef.current;
    if (!element) return;
    const clamped = Math.max(0, Math.min(1, vol));
    element.volume = clamped;
    setState((prev) => ({
      ...prev,
      volume: clamped,
      isMuted: clamped === 0,
    }));
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    const element = mediaRef.current;
    if (!element) return;
    element.muted = muted;
    setState((prev) => ({
      ...prev,
      isMuted: muted,
    }));
  }, []);

  return {
    mediaRef,
    state,
    play,
    pause,
    togglePlay,
    seek,
    setVolume,
    setMuted,
  };
}

