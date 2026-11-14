import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAsset,
  validateProjectDocument,
  validateInspectedMetadata,
  createDefaultProject,
} from "../src/lib/projectValidation.ts";
import { relinkAssetHandle } from "../src/lib/mediaImport.ts";
import type { ProjectAsset } from "../src/types/project.ts";
import type { InspectedMediaMetadata } from "../src/lib/media/types.ts";

test("validateInspectedMetadata sanitizes and retains valid fields", () => {
  const raw = {
    containerFormat: "MP4",
    mimeType: "video/mp4",
    duration: 120.5,
    displayWidth: 1920,
    displayHeight: 1080,
    codedWidth: 1920,
    codedHeight: 1080,
    rotation: 0,
    frameRate: 30,
    isConstantFrameRate: true,
    sampleRate: 48000,
    numberOfChannels: 2,
    videoTracks: [
      {
        trackNumber: 1,
        codec: "avc1.640028",
        codedWidth: 1920,
        codedHeight: 1080,
      },
    ],
    audioTracks: [
      {
        trackNumber: 2,
        codec: "mp4a.40.2",
        sampleRate: 48000,
        numberOfChannels: 2,
      },
    ],
    // Dangerous non-serializable properties that should be ignored
    unwantedFunc: () => {},
    unwantedObj: { some: "nested" },
  };

  const validated = validateInspectedMetadata(raw);
  assert.ok(validated);
  assert.equal(validated.containerFormat, "MP4");
  assert.equal(validated.duration, 120.5);
  assert.equal(validated.displayWidth, 1920);
  assert.equal(validated.videoTracks.length, 1);
  assert.equal(validated.audioTracks.length, 1);
  assert.equal((validated as unknown as Record<string, unknown>).unwantedFunc, undefined);
  assert.equal((validated as unknown as Record<string, unknown>).unwantedObj, undefined);
});

test("validateAsset preserves valid metadata", () => {
  const metadata: InspectedMediaMetadata = {
    containerFormat: "WAVE",
    duration: 15.2,
    videoTracks: [],
    audioTracks: [
      {
        trackNumber: 1,
        codec: "pcm-s16",
        numberOfChannels: 2,
        sampleRate: 44100,
      },
    ],
    numberOfChannels: 2,
    sampleRate: 44100,
    inspectedAt: new Date().toISOString(),
  };

  const asset: ProjectAsset = {
    id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    name: "audio.wav",
    mediaType: "audio",
    mimeType: "audio/wav",
    size: 1024,
    handleRefId: "ref-1",
    metadata,
  };

  const res = validateAsset(asset);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.ok(res.data.metadata);
    assert.equal(res.data.metadata.containerFormat, "WAVE");
    assert.equal(res.data.metadata.numberOfChannels, 2);
  }
});

test("validateProjectDocument persists asset metadata through document validation", () => {
  const doc = createDefaultProject("Test Project");
  doc.assets.push({
    id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    name: "clip.mp4",
    mediaType: "video",
    mimeType: "video/mp4",
    size: 2048,
    handleRefId: "ref-2",
    metadata: {
      containerFormat: "MP4",
      duration: 60,
      displayWidth: 1280,
      displayHeight: 720,
      videoTracks: [],
      audioTracks: [],
      inspectedAt: new Date().toISOString(),
    },
  });

  const res = validateProjectDocument(doc);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.assets.length, 1);
    assert.ok(res.data.assets[0].metadata);
    assert.equal(res.data.assets[0].metadata.containerFormat, "MP4");
    assert.equal(res.data.assets[0].metadata.displayWidth, 1280);
  }
});

test("relinkAssetHandle resets metadata so newly relinked file is re-inspected", async () => {
  const asset: ProjectAsset = {
    id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    name: "old-clip.mp4",
    mediaType: "video",
    mimeType: "video/mp4",
    size: 1000,
    handleRefId: "ref-1",
    metadata: {
      containerFormat: "MP4",
      duration: 30,
      videoTracks: [],
      audioTracks: [],
      inspectedAt: new Date().toISOString(),
    },
  };

  const mockHandle = {} as FileSystemFileHandle;
  const newFile = {
    name: "new-clip.mp4",
    size: 5000,
    lastModified: 1700000000000,
    type: "video/mp4",
  } as File;

  const prevWindow = (globalThis as unknown as Record<string, unknown>).window;
  const prevIndexedDB = (globalThis as unknown as Record<string, unknown>).indexedDB;

  (globalThis as unknown as Record<string, unknown>).window = globalThis;
  (globalThis as unknown as Record<string, unknown>).indexedDB = {
    open: () => {
      const req: Record<string, unknown> = {
        result: {
          transaction: () => ({
            objectStore: () => ({
              put: () => {
                const putReq: { onsuccess?: (ev: unknown) => void } = {};
                setTimeout(() => putReq.onsuccess?.({}), 0);
                return putReq;
              },
            }),
          }),
        },
      };
      setTimeout(() => (req.onsuccess as (ev: unknown) => void)?.({ target: req }), 0);
      return req;
    },
  };

  try {
    const relinked = await relinkAssetHandle(asset, mockHandle, newFile);
    assert.equal(relinked.name, "new-clip.mp4");
    assert.equal(relinked.size, 5000);
    // Metadata MUST be cleared
    assert.equal(relinked.metadata, undefined);
  } finally {
    (globalThis as unknown as Record<string, unknown>).window = prevWindow;
    (globalThis as unknown as Record<string, unknown>).indexedDB = prevIndexedDB;
  }
});
