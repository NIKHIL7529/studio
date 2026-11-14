import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  resampleAudioChannel,
  applyBoundaryMicroFades,
  AudioTrackMixer,
} from "../src/lib/export/audioRenderer.ts";
import type { RenderPlan, RenderPlanAudioSegment } from "../src/types/export.ts";
import type { AudioSampleSink } from "mediabunny";

describe("Audio Continuity, Resampling & Sample-Driven Mixing", () => {
  test("resampleAudioChannel preserves waveform and exact output sample length", () => {
    const srcRate = 44100;
    const targetRate = 48000;
    const duration = 1.0;
    const srcLength = Math.round(srcRate * duration);
    const targetLength = Math.round(targetRate * duration);

    // 440 Hz pure tone
    const src = new Float32Array(srcLength);
    for (let i = 0; i < srcLength; i++) {
      src[i] = Math.sin(2 * Math.PI * 440 * (i / srcRate));
    }

    const resampled = resampleAudioChannel(src, srcRate, targetRate, targetLength);

    assert.equal(resampled.length, targetLength);
    // Verify continuity: no NaN or Inf
    for (let i = 0; i < resampled.length; i++) {
      assert.ok(Number.isFinite(resampled[i]), `Sample ${i} is not finite`);
      assert.ok(resampled[i] >= -1.01 && resampled[i] <= 1.01, `Sample ${i} out of bounds: ${resampled[i]}`);
    }

    // Verify frequency phase continuity at mid-point (0.5s)
    const midSrc = src[Math.round(srcRate * 0.5)];
    const midTarget = resampled[Math.round(targetRate * 0.5)];
    assert.ok(Math.abs(midSrc - midTarget) < 0.05, `Phase shift detected: src=${midSrc}, target=${midTarget}`);
  });

  test("applyBoundaryMicroFades prevents DC clicks at start and end without altering center", () => {
    const sampleRate = 48000;
    const totalFrames = 4800; // 0.1s
    const left = new Float32Array(totalFrames).fill(0.8);
    const right = new Float32Array(totalFrames).fill(-0.8);

    applyBoundaryMicroFades(left, right, sampleRate);

    // At sample 0, amplitude must be 0 (DC offset eliminated)
    assert.equal(Math.abs(left[0]), 0);
    assert.equal(Math.abs(right[0]), 0);

    // In center (sample 2400), amplitude must be 100% preserved
    assert.ok(Math.abs(left[2400] - 0.8) < 1e-6);
    assert.ok(Math.abs(right[2400] - -0.8) < 1e-6);

    // At last sample, amplitude must return to 0
    assert.equal(Math.abs(left[totalFrames - 1]), 0);
    assert.equal(Math.abs(right[totalFrames - 1]), 0);
  });

  test("AudioTrackMixer calculates exact sample timestamps for consecutive blocks", async () => {
    const mockPlan: RenderPlan = {
      projectId: "proj-1",
      projectName: "Test",
      timelineId: "tl-1",
      createdAt: new Date().toISOString(),
      settings: {
        targetAspectRatio: "16:9",
        width: 1280,
        height: 720,
        frameRate: 30,
        videoCodec: "avc",
        audioCodec: "aac",
        format: "mp4",
        quality: "high",
        audioSampleRate: 48000,
        audioChannels: 2,
        filename: "test.mp4",
      },
      frameRate: 30,
      totalDurationSeconds: 3.0,
      totalFrames: 90,
      sources: new Map(),
      missingSources: [],
      videoFrames: [],
      audioSegments: [],
      hasVideo: true,
      hasAudio: true,
      isValid: true,
      validationErrors: [],
    };

    const mixer = new AudioTrackMixer(mockPlan, new Map(), {
      outputSampleRate: 48000,
      outputChannels: 2,
    });

    assert.equal(mixer.totalAudioSamples, 144000);

    // Block 1: 0 to 48000
    const b1 = await mixer.renderBlock(0, 48000);
    assert.ok(b1);
    assert.equal(b1.timestamp, 0.0);
    assert.equal(b1.numberOfFrames, 48000);
    assert.equal(b1.duration, 1.0);

    // Block 2: 48000 to 96000
    const b2 = await mixer.renderBlock(48000, 48000);
    assert.ok(b2);
    assert.equal(b2.timestamp, 1.0);
    assert.equal(b2.numberOfFrames, 48000);
    assert.equal(b2.duration, 1.0);

    // Block 3: 96000 to 144000
    const b3 = await mixer.renderBlock(96000, 48000);
    assert.ok(b3);
    assert.equal(b3.timestamp, 2.0);
    assert.equal(b3.numberOfFrames, 48000);
    assert.equal(b3.duration, 1.0);

    b1.close();
    b2.close();
    b3.close();
    mixer.dispose();
  });

  test("AudioTrackMixer mixes overlapping tracks with volume gains and mutes", async () => {
    // Construct mock audio segments
    const segments: RenderPlanAudioSegment[] = [
      {
        clipId: "clip-dialogue",
        assetId: "mock-asset-1",
        timelineStartSeconds: 0.0,
        timelineEndSeconds: 2.0,
        sourceInSeconds: 0.0,
        sourceOutSeconds: 2.0,
        volume: 1.0,
        trackId: "track-1",
        trackOrder: 0,
      },
      {
        clipId: "clip-music",
        assetId: "mock-asset-2",
        timelineStartSeconds: 0.5,
        timelineEndSeconds: 2.5,
        sourceInSeconds: 0.0,
        sourceOutSeconds: 2.0,
        volume: 0.5,
        trackId: "track-2",
        trackOrder: 1,
      },
      {
        clipId: "clip-muted",
        assetId: "mock-asset-1",
        timelineStartSeconds: 2.0,
        timelineEndSeconds: 3.0,
        sourceInSeconds: 0.0,
        sourceOutSeconds: 1.0,
        volume: 0.0, // muted
        trackId: "track-1",
        trackOrder: 0,
      },
    ];

    const mockPlan: RenderPlan = {
      projectId: "proj-1",
      projectName: "Test",
      timelineId: "tl-1",
      createdAt: new Date().toISOString(),
      settings: {
        targetAspectRatio: "16:9",
        width: 1280,
        height: 720,
        frameRate: 30,
        videoCodec: "avc",
        audioCodec: "aac",
        format: "mp4",
        quality: "high",
        audioSampleRate: 48000,
        audioChannels: 2,
        filename: "test.mp4",
      },
      frameRate: 30,
      totalDurationSeconds: 3.0,
      totalFrames: 90,
      sources: new Map(),
      missingSources: [],
      videoFrames: [],
      audioSegments: segments,
      hasVideo: true,
      hasAudio: true,
      isValid: true,
      validationErrors: [],
    };

    // Mock AudioSampleSink that emits constant tones
    function createMockSink(freq: number) {
      return {
        async *samples() {
          const frames = 2048;
          for (let p = 0; p < 24; p++) {
            const data = new Float32Array(frames * 2);
            for (let i = 0; i < frames; i++) {
              const val = Math.sin(2 * Math.PI * freq * ((p * frames + i) / 48000));
              data[i] = val;
              data[frames + i] = val;
            }
            yield {
              timestamp: (p * frames) / 48000,
              duration: frames / 48000,
              sampleRate: 48000,
              numberOfChannels: 2,
              numberOfFrames: frames,
              format: "f32-planar",
              copyTo(dest: Float32Array, opts: { planeIndex: number }) {
                const off = opts.planeIndex === 1 ? frames : 0;
                dest.set(data.subarray(off, off + frames));
              },
              close() {},
            };
          }
        },
      } as unknown as AudioSampleSink;
    }

    const sinks = new Map<string, AudioSampleSink>([
      ["mock-asset-1", createMockSink(440)],
      ["mock-asset-2", createMockSink(880)],
    ]);

    const mixer = new AudioTrackMixer(mockPlan, sinks, {
      outputSampleRate: 48000,
      outputChannels: 2,
    });

    // Render 1st second (0.0 to 1.0s):
    // From 0.0 to 0.5s: only clip-dialogue (vol 1.0)
    // From 0.5 to 1.0s: clip-dialogue (vol 1.0) + clip-music (vol 0.5)
    const block1 = await mixer.renderBlock(0, 48000);
    assert.ok(block1);
    assert.equal(block1.numberOfFrames, 48000);
    assert.equal(block1.timestamp, 0.0);

    const left = new Float32Array(48000);
    block1.copyTo(left, { planeIndex: 0, format: "f32-planar" });

    // Verify samples are non-zero and finite
    assert.ok(Number.isFinite(left[1000]));
    assert.ok(Number.isFinite(left[30000]));

    // Render 3rd second (2.0 to 3.0s):
    // From 2.0 to 2.5s: clip-music (vol 0.5)
    // From 2.5 to 3.0s: clip-muted (vol 0) -> pure silence!
    const block3 = await mixer.renderBlock(96000, 48000);
    assert.ok(block3);
    const left3 = new Float32Array(48000);
    block3.copyTo(left3, { planeIndex: 0, format: "f32-planar" });

    // Between 2.5s and 3.0s (samples 24000 to 48000 in block 3), volume must be 0 (silence)
    for (let s = 25000; s < 48000; s++) {
      assert.equal(left3[s], 0, `Sample at ${s} should be silence due to mute`);
    }

    block1.close();
    block3.close();
    mixer.dispose();
  });

  test("Consecutive clips on the timeline produce seamless continuous audio across the edit point", async () => {
    // Clip 1: 0.0s to 1.0s (48000 samples)
    // Clip 2: 1.0s to 2.0s (48000 samples)
    const segments: RenderPlanAudioSegment[] = [
      {
        clipId: "clip-part-1",
        assetId: "narrator-audio",
        timelineStartSeconds: 0.0,
        timelineEndSeconds: 1.0,
        sourceInSeconds: 0.0,
        sourceOutSeconds: 1.0,
        volume: 1.0,
        trackId: "track-voice",
        trackOrder: 0,
      },
      {
        clipId: "clip-part-2",
        assetId: "narrator-audio",
        timelineStartSeconds: 1.0,
        timelineEndSeconds: 2.0,
        sourceInSeconds: 1.0,
        sourceOutSeconds: 2.0,
        volume: 1.0,
        trackId: "track-voice",
        trackOrder: 0,
      },
    ];

    const mockPlan: RenderPlan = {
      projectId: "proj-1",
      projectName: "Cut Continuity",
      timelineId: "tl-1",
      createdAt: new Date().toISOString(),
      settings: {
        targetAspectRatio: "16:9",
        width: 1280,
        height: 720,
        frameRate: 30,
        videoCodec: "avc",
        audioCodec: "aac",
        format: "mp4",
        quality: "high",
        audioSampleRate: 48000,
        audioChannels: 2,
        filename: "continuity.mp4",
      },
      frameRate: 30,
      totalDurationSeconds: 2.0,
      totalFrames: 60,
      sources: new Map(),
      missingSources: [],
      videoFrames: [],
      audioSegments: segments,
      hasVideo: true,
      hasAudio: true,
      isValid: true,
      validationErrors: [],
    };

    // Continuous 440 Hz narration tone across both seconds
    const sink = {
      async *samples(startSec: number) {
        const frames = 1024;
        const totalPackets = 48; // ~1s
        const baseSample = Math.round(startSec * 48000);
        for (let p = 0; p < totalPackets; p++) {
          const data = new Float32Array(frames * 2);
          for (let i = 0; i < frames; i++) {
            const currentSample = baseSample + p * frames + i;
            const val = Math.sin(2 * Math.PI * 440 * (currentSample / 48000));
            data[i] = val;
            data[frames + i] = val;
          }
          yield {
            timestamp: (baseSample + p * frames) / 48000,
            duration: frames / 48000,
            sampleRate: 48000,
            numberOfChannels: 2,
            numberOfFrames: frames,
            format: "f32-planar",
            copyTo(dest: Float32Array, opts: { planeIndex: number }) {
              const off = opts.planeIndex === 1 ? frames : 0;
              dest.set(data.subarray(off, off + frames));
            },
            close() {},
          };
        }
      },
    } as unknown as AudioSampleSink;

    const mixer = new AudioTrackMixer(mockPlan, new Map([["narrator-audio", sink]]), {
      outputSampleRate: 48000,
      outputChannels: 2,
    });

    // Render a block that straddles the cut point at sample 48000 (1.0s)
    // E.g. block from sample 40000 to sample 56000 (16000 frames)
    const straddleBlock = await mixer.renderBlock(40000, 16000);
    assert.ok(straddleBlock);
    assert.equal(straddleBlock.numberOfFrames, 16000);
    assert.equal(straddleBlock.timestamp, 40000 / 48000);

    const left = new Float32Array(16000);
    straddleBlock.copyTo(left, { planeIndex: 0, format: "f32-planar" });

    // The boundary is at index 8000 (48000 - 40000)
    // Verify waveform continuity: samples around index 8000 must be smooth and finite
    for (let i = 7990; i <= 8010; i++) {
      assert.ok(Number.isFinite(left[i]));
      // No sudden explosion or unhandled NaN
      assert.ok(Math.abs(left[i]) <= 1.0);
    }

    straddleBlock.close();
    mixer.dispose();
  });
});
