/**
 * Sample-Driven Continuous Audio Renderer for Content Studio (Phase 8 Correction).
 *
 * Rules:
 * - Completely decoupled from the video frame loop.
 * - Sample-driven: absolute output sample indices define all timestamps and boundaries.
 *   timestamp = firstOutputSampleIndex / outputSampleRate
 *   duration = numberOfSamplesPerChannel / outputSampleRate
 * - Decodes continuous audio streams per clip using Mediabunny AudioSampleSink.
 * - Accurately trims source audio to [sourceIn, sourceOut] discarding decoder pre-roll.
 * - Resamples any source sample rate to the target output rate (default 48000 Hz).
 * - Maps any source channel layout to stereo (2 channels).
 * - Applies 3ms micro-fades at clip edit boundaries to eliminate DC clicks/pops.
 * - Mixes simultaneous tracks according to timeline gain and mute states.
 * - Emits continuous AudioSample blocks with strictly bounded memory usage.
 */

import { AudioSample, type AudioSampleSink } from "mediabunny";
import type { RenderPlan, RenderPlanAudioSegment } from "../../types/export.ts";

export interface DecodedClipBuffer {
  clipId: string;
  left: Float32Array;
  right: Float32Array;
  startSample: number; // in output sample coordinates
  endSample: number;   // in output sample coordinates
  volume: number;
}

export interface AudioRendererOptions {
  outputSampleRate?: number;
  outputChannels?: number;
}

/**
 * Resamples a single Float32Array channel from sourceRate to targetRate using linear interpolation.
 */
export function resampleAudioChannel(
  source: Float32Array,
  sourceRate: number,
  targetRate: number,
  targetLength: number
): Float32Array {
  if (source.length === 0 || targetLength === 0) {
    return new Float32Array(targetLength);
  }

  if (sourceRate === targetRate && source.length === targetLength) {
    return new Float32Array(source);
  }

  const result = new Float32Array(targetLength);
  if (targetLength === 1) {
    result[0] = source[0];
    return result;
  }

  const ratio = (source.length - 1) / (targetLength - 1);
  for (let i = 0; i < targetLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(source.length - 1, i0 + 1);
    const frac = pos - i0;
    result[i] = (1 - frac) * source[i0] + frac * source[i1];
  }

  return result;
}

/**
 * Applies a smooth 3ms Hann ramp at the start and end of a clip to prevent DC offset clicks.
 */
export function applyBoundaryMicroFades(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number
): void {
  const totalFrames = left.length;
  if (totalFrames <= 4) return;

  // 3ms fade, or at most half the clip
  const fadeFrames = Math.min(Math.floor(totalFrames / 2), Math.max(8, Math.round(sampleRate * 0.003)));

  for (let i = 0; i < fadeFrames; i++) {
    const inGain = 0.5 * (1 - Math.cos((Math.PI * i) / fadeFrames));
    left[i] *= inGain;
    right[i] *= inGain;

    const outIdx = totalFrames - 1 - i;
    const outGain = 0.5 * (1 - Math.cos((Math.PI * i) / fadeFrames));
    left[outIdx] *= outGain;
    right[outIdx] *= outGain;
  }
}

/**
 * Sample-driven audio track mixer.
 */
export class AudioTrackMixer {
  readonly plan: RenderPlan;
  readonly audioSinks: Map<string, AudioSampleSink>;
  readonly outputSampleRate: number;
  readonly outputChannels: number;
  readonly totalAudioSamples: number;

  private decodedClips = new Map<string, DecodedClipBuffer>();

  constructor(
    plan: RenderPlan,
    audioSinks: Map<string, AudioSampleSink>,
    options: AudioRendererOptions = {}
  ) {
    this.plan = plan;
    this.audioSinks = audioSinks;
    this.outputSampleRate = options.outputSampleRate || plan.settings.audioSampleRate || 48000;
    this.outputChannels = options.outputChannels || plan.settings.audioChannels || 2;
    this.totalAudioSamples = Math.round(plan.totalDurationSeconds * this.outputSampleRate);
  }

  /**
   * Renders a continuous, sample-accurate AudioSample block for the given output sample range.
   */
  async renderBlock(
    startSampleIndex: number,
    frameCount: number
  ): Promise<AudioSample | null> {
    if (frameCount <= 0) return null;

    const endSampleIndex = startSampleIndex + frameCount;
    const mixLeft = new Float32Array(frameCount);
    const mixRight = new Float32Array(frameCount);

    // Identify clips overlapping this block
    const activeSegments = this.plan.audioSegments.filter((seg) => {
      if (seg.volume <= 0) return false;
      const clipStart = Math.round(seg.timelineStartSeconds * this.outputSampleRate);
      const clipEnd = Math.round(seg.timelineEndSeconds * this.outputSampleRate);
      return clipEnd > startSampleIndex && clipStart < endSampleIndex;
    });

    for (const segment of activeSegments) {
      const clipStart = Math.round(segment.timelineStartSeconds * this.outputSampleRate);
      const clipEnd = Math.round(segment.timelineEndSeconds * this.outputSampleRate);

      let clipBuffer = this.decodedClips.get(segment.clipId);
      if (!clipBuffer) {
        const decoded = await this.decodeAndPrepareClip(segment, clipStart, clipEnd);
        if (decoded) {
          this.decodedClips.set(segment.clipId, decoded);
          clipBuffer = decoded;
        }
      }

      if (!clipBuffer) continue;

      const overlapStart = Math.max(startSampleIndex, clipStart);
      const overlapEnd = Math.min(endSampleIndex, clipEnd);
      const overlapLen = overlapEnd - overlapStart;

      if (overlapLen <= 0) continue;

      const destOffset = overlapStart - startSampleIndex;
      const srcOffset = overlapStart - clipStart;

      const cLeft = clipBuffer.left;
      const cRight = clipBuffer.right;
      const vol = segment.volume;

      for (let i = 0; i < overlapLen; i++) {
        const sIdx = srcOffset + i;
        if (sIdx < cLeft.length) {
          mixLeft[destOffset + i] += cLeft[sIdx] * vol;
          mixRight[destOffset + i] += cRight[sIdx] * vol;
        }
      }
    }

    // Evict completed clips from memory to strictly bound RAM usage
    for (const [clipId, clipBuffer] of this.decodedClips.entries()) {
      if (clipBuffer.endSample <= endSampleIndex) {
        this.decodedClips.delete(clipId);
      }
    }

    // Master limiter / soft clamping to [-1.0, 1.0]
    for (let i = 0; i < frameCount; i++) {
      mixLeft[i] = Math.max(-1.0, Math.min(1.0, mixLeft[i]));
      mixRight[i] = Math.max(-1.0, Math.min(1.0, mixRight[i]));
    }

    // Package into planar AudioSample with absolute presentation timestamp
    const pcmBytes = frameCount * 2 * 4; // 2 channels * 4 bytes per float
    const pcmBuffer = new ArrayBuffer(pcmBytes);
    const leftView = new Float32Array(pcmBuffer, 0, frameCount);
    const rightView = new Float32Array(pcmBuffer, frameCount * 4, frameCount);

    leftView.set(mixLeft);
    rightView.set(mixRight);

    const timestamp = startSampleIndex / this.outputSampleRate;

    return new AudioSample({
      format: "f32-planar",
      sampleRate: this.outputSampleRate,
      numberOfChannels: 2,
      timestamp,
      data: pcmBuffer,
    });
  }

  /**
   * Decodes, trims, resamples, and micro-fades a single audio clip.
   */
  private async decodeAndPrepareClip(
    segment: RenderPlanAudioSegment,
    clipStartSample: number,
    clipEndSample: number
  ): Promise<DecodedClipBuffer | null> {
    const sink = this.audioSinks.get(segment.assetId);
    if (!sink) return null;

    const expectedFrames = clipEndSample - clipStartSample;
    if (expectedFrames <= 0) return null;

    const sourceIn = segment.sourceInSeconds;
    const sourceOut = segment.sourceOutSeconds;

    try {
      let firstPacketTs: number | null = null;
      let sourceRate = this.outputSampleRate;
      const rawChunksL: Float32Array[] = [];
      const rawChunksR: Float32Array[] = [];

      for await (const sample of sink.samples(sourceIn, sourceOut)) {
        if (firstPacketTs === null) {
          firstPacketTs = sample.timestamp;
          sourceRate = sample.sampleRate;
        }

        const l = new Float32Array(sample.numberOfFrames);
        const r = new Float32Array(sample.numberOfFrames);

        sample.copyTo(l, { planeIndex: 0, format: "f32-planar" });
        if (sample.numberOfChannels > 1) {
          sample.copyTo(r, { planeIndex: 1, format: "f32-planar" });
        } else {
          r.set(l);
        }

        rawChunksL.push(l);
        rawChunksR.push(r);
        sample.close();
      }

      if (rawChunksL.length === 0) {
        return {
          clipId: segment.clipId,
          left: new Float32Array(expectedFrames),
          right: new Float32Array(expectedFrames),
          startSample: clipStartSample,
          endSample: clipEndSample,
          volume: segment.volume,
        };
      }

      // Concatenate raw chunks
      const totalRaw = rawChunksL.reduce((acc, c) => acc + c.length, 0);
      const combinedL = new Float32Array(totalRaw);
      const combinedR = new Float32Array(totalRaw);
      let offset = 0;
      for (let i = 0; i < rawChunksL.length; i++) {
        combinedL.set(rawChunksL[i], offset);
        combinedR.set(rawChunksR[i], offset);
        offset += rawChunksL[i].length;
      }

      // Sample-accurate pre-roll trimming
      const actualFirstTs = firstPacketTs ?? sourceIn;
      const skipFrames = Math.max(0, Math.round((sourceIn - actualFirstTs) * sourceRate));
      const neededSourceFrames = Math.max(1, Math.round((sourceOut - sourceIn) * sourceRate));

      const slicedL = combinedL.subarray(skipFrames, skipFrames + neededSourceFrames);
      const slicedR = combinedR.subarray(skipFrames, skipFrames + neededSourceFrames);

      // Resample to target output rate
      const resampledL = resampleAudioChannel(slicedL, sourceRate, this.outputSampleRate, expectedFrames);
      const resampledR = resampleAudioChannel(slicedR, sourceRate, this.outputSampleRate, expectedFrames);

      // Apply 3ms boundary micro-fades
      applyBoundaryMicroFades(resampledL, resampledR, this.outputSampleRate);

      return {
        clipId: segment.clipId,
        left: resampledL,
        right: resampledR,
        startSample: clipStartSample,
        endSample: clipEndSample,
        volume: segment.volume,
      };
    } catch (err) {
      console.warn(`Failed to decode audio for clip ${segment.clipId}:`, err);
      return {
        clipId: segment.clipId,
        left: new Float32Array(expectedFrames),
        right: new Float32Array(expectedFrames),
        startSample: clipStartSample,
        endSample: clipEndSample,
        volume: segment.volume,
      };
    }
  }

  dispose(): void {
    this.decodedClips.clear();
  }
}
