/**
 * Sequence Audio Exposer for Local Transcription.
 *
 * Rules:
 * - Extracts only the active audible parts of the sequence (respects cuts, in/out points, track mutes).
 * - Mixes multi-track audio to 16 kHz 16-bit mono WAV in memory (native format for Whisper).
 * - Avoids full video re-encoding or uncompressed long-audio bloat.
 * - 100% client-side, zero network calls.
 */

import type { TimelineDocument } from "../../types/timeline.ts";
import type { LiveAssetItem } from "../../types/project.ts";
import { createMediaInput } from "../media/input.ts";
import { AudioSampleSink } from "mediabunny";
import { resampleAudioChannel, applyBoundaryMicroFades } from "../export/audioRenderer.ts";

/**
 * Creates a standard WAV file blob header for 16-bit PCM.
 */
function createWavHeader(numSamples: number, sampleRate = 16000, numChannels = 1): ArrayBuffer {
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const dataSize = numSamples * numChannels * 2;
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  // "RIFF"
  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + dataSize, true);
  // "WAVE"
  view.setUint32(8, 0x57415645, false);
  // "fmt "
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true);  // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16 bits per sample
  // "data"
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, dataSize, true);

  return buffer;
}

/**
 * Renders the audible audio of a timeline sequence into a 16kHz mono WAV File
 * for Whisper transcription.
 */
export async function renderTimelineAudioToWav(
  timeline: TimelineDocument,
  liveAssets: Map<string, LiveAssetItem>,
  options?: { signal?: AbortSignal; onProgress?: (percent: number) => void }
): Promise<File> {
  const targetSampleRate = 16000;

  // Calculate total sequence duration
  let maxEndTime = 0;
  const audioClipsToRender: Array<{
    clipId: string;
    assetId: string;
    startTime: number;
    sourceIn: number;
    sourceOut: number;
    volume: number;
  }> = [];

  const anyAudioTrackSolo = timeline.tracks.some((tr) => tr.type === "audio" && tr.solo);

  for (const track of timeline.tracks) {
    if (track.type !== "audio" && track.type !== "video") continue;
    const isMuted = track.muted || (track.type === "audio" && anyAudioTrackSolo && !track.solo);
    if (isMuted) continue;

    const trackGain = track.volume ?? 1.0;

    for (const clip of track.clips) {
      if (clip.muted || clip.freezeFrameSourceTime !== null || (track.type === "video" && clip.audioDetached)) continue;

      const dur = (clip.sourceOut - clip.sourceIn) / (clip.playbackRate || 1.0);
      if (dur <= 0) continue;

      const end = clip.startTime + dur;
      if (end > maxEndTime) maxEndTime = end;

      audioClipsToRender.push({
        clipId: clip.id,
        assetId: clip.assetId,
        startTime: clip.startTime,
        sourceIn: clip.sourceIn,
        sourceOut: clip.sourceOut,
        volume: clip.volume * trackGain,
      });
    }
  }

  const totalSamples = Math.max(1, Math.round(maxEndTime * targetSampleRate));
  const masterMonoBuffer = new Float32Array(totalSamples);

  // Decode audio for each clip
  const openedInputs: Array<ReturnType<typeof createMediaInput>> = [];

  try {
    for (let i = 0; i < audioClipsToRender.length; i++) {
      if (options?.signal?.aborted) {
        throw new DOMException("Audio extraction cancelled.", "AbortError");
      }

      const item = audioClipsToRender[i];
      const live = liveAssets.get(item.assetId);
      if (!live || !live.file) continue;

      const input = createMediaInput(live.file);
      openedInputs.push(input);

      const aTracks = await input.getAudioTracks();
      if (aTracks.length === 0) continue;

      const sink = new AudioSampleSink(aTracks[0]);
      const clipDuration = item.sourceOut - item.sourceIn;
      const targetFrames = Math.max(1, Math.round(clipDuration * targetSampleRate));

      const tempMono = new Float32Array(targetFrames);

      // Drain audio samples from source
      for await (const sample of sink.samples(item.sourceIn, item.sourceOut)) {
        if (options?.signal?.aborted) {
          sample.close();
          break;
        }

        const sampleTime = sample.timestamp;
        const sampleDur = sample.duration;
        const sampleEnd = sampleTime + sampleDur;

        // Check if sample overlaps [sourceIn, sourceOut]
        if (sampleEnd > item.sourceIn && sampleTime < item.sourceOut) {
          const sampleRate = sample.sampleRate;

          // Extract mono float
          const ch0 = new Float32Array(sample.numberOfFrames);
          try {
            sample.copyTo(ch0, { planeIndex: 0, format: "f32-planar" });
          } catch {
            // Fallback: zeros
          }

          // Resample to 16kHz
          const resampledLen = Math.round((sample.numberOfFrames * targetSampleRate) / sampleRate);
          const resampled = resampleAudioChannel(ch0, sampleRate, targetSampleRate, resampledLen);

          // Copy into tempMono at appropriate offset
          const sampleOffsetSec = Math.max(0, sampleTime - item.sourceIn);
          const destOffsetFrames = Math.round(sampleOffsetSec * targetSampleRate);

          for (let s = 0; s < resampled.length && (destOffsetFrames + s) < targetFrames; s++) {
            tempMono[destOffsetFrames + s] += resampled[s] * item.volume;
          }
        }

        sample.close();
      }

      // Apply boundary micro-fades to prevent clicks
      applyBoundaryMicroFades(tempMono, tempMono, targetSampleRate);

      // Mix into master mono buffer at clip.startTime
      const destStartSample = Math.round(item.startTime * targetSampleRate);
      for (let s = 0; s < targetFrames && (destStartSample + s) < totalSamples; s++) {
        masterMonoBuffer[destStartSample + s] += tempMono[s];
      }

      if (options?.onProgress) {
        options.onProgress(Math.round(((i + 1) / audioClipsToRender.length) * 50));
      }
    }
  } finally {
    for (const inp of openedInputs) {
      try { inp.dispose(); } catch {}
    }
  }

  // Convert Float32Array to 16-bit PCM WAV
  const pcm16 = new Int16Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const s = Math.max(-1, Math.min(1, masterMonoBuffer[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const header = createWavHeader(totalSamples, targetSampleRate, 1);
  const blob = new Blob([header, pcm16.buffer], { type: "audio/wav" });

  return new File([blob], `sequence-audio-${Date.now()}.wav`, { type: "audio/wav" });
}
