/**
 * Local deterministic audio signal analysis (Phase 7).
 *
 * Rules:
 * - 100% deterministic, local-first in-browser signal processing.
 * - Samples audio in bounded chunks to keep memory usage minimal.
 * - Extracts measurable acoustic metrics: short-time RMS loudness, silence intervals, transients,
 *   and speech-activity-like envelope dynamics.
 * - STRICT LIMITATION: Does NOT perform speech recognition, speaker identification, transcription,
 *   sentiment analysis, or topic detection.
 * - Gracefully handles sources with no audio track.
 */

import { AudioBufferSink } from "mediabunny";
import { createMediaInput, disposeMediaInput } from "../media/input.ts";
import type { AudioSampleSignal } from "../../types/repurpose.ts";

export const AUDIO_WINDOW_SECONDS = 0.5; // 500ms analysis window
export const SILENCE_RMS_THRESHOLD = 0.015; // Below this is acoustic silence
export const TRANSIENT_DELTA_THRESHOLD = 0.08; // Sudden jump in RMS energy
export const ALGORITHM_VERSION_AUDIO = "v1-rms-zcr-speechlike";

export interface AudioAnalysisOptions {
  signal?: AbortSignal;
  onProgress?: (percent: number, statusText: string) => void;
  windowSeconds?: number;
}

export interface AudioInterval {
  start: number;
  end: number;
}

/**
 * Computes root-mean-square (RMS) energy and zero-crossing rate (ZCR)
 * from a slice of audio samples.
 */
export function computeAudioMetrics(samples: Float32Array): {
  rms: number;
  zcr: number;
  isSilence: boolean;
  isSpeechLike: boolean;
} {
  const len = samples.length;
  if (len === 0) {
    return { rms: 0, zcr: 0, isSilence: true, isSpeechLike: false };
  }

  let sumSquares = 0;
  let zeroCrossings = 0;
  let prevSign = samples[0] >= 0;

  for (let i = 0; i < len; i++) {
    const s = samples[i];
    sumSquares += s * s;

    const currentSign = s >= 0;
    if (currentSign !== prevSign) {
      zeroCrossings++;
      prevSign = currentSign;
    }
  }

  const rms = Math.sqrt(sumSquares / len);
  const zcr = zeroCrossings / len;

  const isSilence = rms < SILENCE_RMS_THRESHOLD;

  // Speech-like heuristic:
  // Human speech typically has moderate RMS (not silent, not pure constant clipping),
  // and moderate zero-crossing rate (typical fundamental & formants vs sub-bass hum or pure high hiss).
  const isSpeechLike =
    !isSilence &&
    rms >= 0.02 &&
    rms <= 0.65 &&
    zcr >= 0.003 &&
    zcr <= 0.35;

  return { rms, zcr, isSilence, isSpeechLike };
}

/**
 * Merges adjacent boolean flags into continuous intervals [start, end].
 */
export function buildIntervalsFromSignals(
  signals: AudioSampleSignal[],
  windowDuration: number,
  predicate: (sig: AudioSampleSignal) => boolean,
  minIntervalDuration = 0.4
): AudioInterval[] {
  const intervals: AudioInterval[] = [];
  let currentStart: number | null = null;
  let currentEnd = 0;

  for (const sig of signals) {
    if (predicate(sig)) {
      if (currentStart === null) {
        currentStart = sig.timestamp;
      }
      currentEnd = sig.timestamp + windowDuration;
    } else {
      if (currentStart !== null) {
        if (currentEnd - currentStart >= minIntervalDuration) {
          intervals.push({ start: currentStart, end: currentEnd });
        }
        currentStart = null;
      }
    }
  }

  if (currentStart !== null && currentEnd - currentStart >= minIntervalDuration) {
    intervals.push({ start: currentStart, end: currentEnd });
  }

  return intervals;
}

/**
 * Analyzes audio signals of a source media file using Mediabunny AudioBufferSink.
 * Safely handles missing audio, stream bounds, and resource disposal.
 */
export async function analyzeAudioSignals(
  file: File | Blob,
  duration: number,
  options: AudioAnalysisOptions = {}
): Promise<{
  audioSignals: AudioSampleSignal[];
  silenceIntervals: AudioInterval[];
  speechActivityIntervals: AudioInterval[];
}> {
  const { signal, onProgress, windowSeconds = AUDIO_WINDOW_SECONDS } = options;

  if (duration <= 0 || !Number.isFinite(duration)) {
    return { audioSignals: [], silenceIntervals: [], speechActivityIntervals: [] };
  }

  const input = createMediaInput(file);
  const audioSignals: AudioSampleSignal[] = [];

  try {
    const audioTracks = await input.getAudioTracks();
    if (audioTracks.length === 0) {
      // Source has no audio track; return empty results gracefully
      return { audioSignals: [], silenceIntervals: [], speechActivityIntervals: [] };
    }

    const audioSink = new AudioBufferSink(audioTracks[0]);

    const totalWindows = Math.ceil(duration / windowSeconds);
    let prevRms = 0;

    for (let w = 0; w < totalWindows; w++) {
      if (signal?.aborted) {
        throw new DOMException("Audio analysis aborted by user", "AbortError");
      }

      const timestamp = w * windowSeconds;

      let bufferWrapped: { buffer: AudioBuffer } | null = null;
      try {
        bufferWrapped = await audioSink.getBuffer(timestamp);
      } catch (err) {
        console.warn(`Audio sample buffer read warning at ${timestamp.toFixed(2)}s:`, err);
      }

      if (bufferWrapped?.buffer) {
        const audioBuf = bufferWrapped.buffer;
        const channel0 = audioBuf.getChannelData(0);

        const metrics = computeAudioMetrics(channel0);
        const deltaRms = Math.abs(metrics.rms - prevRms);
        const isTransient = deltaRms > TRANSIENT_DELTA_THRESHOLD;

        audioSignals.push({
          timestamp,
          rms: metrics.rms,
          isSilence: metrics.isSilence,
          isSpeechLikeActivity: metrics.isSpeechLike,
          isTransient,
        });

        prevRms = metrics.rms;
      } else {
        // Fallback for empty or gap window
        audioSignals.push({
          timestamp,
          rms: 0,
          isSilence: true,
          isSpeechLikeActivity: false,
          isTransient: false,
        });
        prevRms = 0;
      }

      if (onProgress && w % 10 === 0) {
        const percent = Math.round(((w + 1) / totalWindows) * 100);
        onProgress(percent, `Analyzing audio signals: ${w + 1}/${totalWindows}`);
      }
    }
  } finally {
    disposeMediaInput(input);
  }

  // Derive silence and speech activity intervals
  const silenceIntervals = buildIntervalsFromSignals(
    audioSignals,
    windowSeconds,
    (sig) => sig.isSilence,
    0.3 // min silence length 300ms
  );

  const speechActivityIntervals = buildIntervalsFromSignals(
    audioSignals,
    windowSeconds,
    (sig) => sig.isSpeechLikeActivity,
    0.6 // min speech activity length 600ms
  );

  return { audioSignals, silenceIntervals, speechActivityIntervals };
}
