import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  runRepurposePipeline,
  validateSelectedSources,
} from "../src/lib/repurpose/pipeline.ts";
import { applyEditPlanToTimeline } from "../src/lib/repurpose/editPlan.ts";
import { createProjectRevision, listProjectRevisions } from "../src/lib/projectRevisions.ts";
import type { ProjectDocument, LiveAssetItem } from "../src/types/project.ts";
import type { RepurposeConfig } from "../src/types/repurpose.ts";

function createMockWavFile(name = "test-audio.wav", durationSeconds = 5): File {
  const sampleRate = 48000;
  const channels = 2;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * channels * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  // Fill sine wave in data
  for (let i = 0; i < numSamples; i++) {
    const val = Math.floor(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16000);
    view.setInt16(44 + i * 4, val, true); // Left
    view.setInt16(44 + i * 4 + 2, val, true); // Right
  }

  return new File([buffer], name, { type: "audio/wav" });
}

function createMockWorkspace() {
  const files = new Map<string, { content: string; size: number }>();

  function createDirHandle(currentPath: string): FileSystemDirectoryHandle {
    return {
      kind: "directory",
      name: currentPath.split("/").pop() || "",
      getDirectoryHandle: async (name: string, opts?: { create?: boolean }) => {
        const subPath = `${currentPath}/${name}`;
        if (!opts?.create) {
          const prefix = `${subPath}/`;
          let hasChild = false;
          for (const k of files.keys()) {
            if (k.startsWith(prefix) || k === subPath) {
              hasChild = true;
              break;
            }
          }
          if (!hasChild) {
            const err = new Error(`Directory not found: ${subPath}`);
            err.name = "NotFoundError";
            throw err;
          }
        }
        return createDirHandle(subPath);
      },
      getFileHandle: async (name: string, opts?: { create?: boolean }) => {
        const filePath = `${currentPath}/${name}`;
        if (!files.has(filePath) && !opts?.create) {
          const err = new Error(`File not found: ${filePath}`);
          err.name = "NotFoundError";
          throw err;
        }
        return {
          kind: "file",
          name,
          getFile: async () => {
            const entry = files.get(filePath);
            return {
              name,
              size: entry ? entry.size : 0,
              lastModified: Date.now(),
              text: async () => entry?.content || "",
            } as unknown as File;
          },
          createWritable: async () => {
            let buffer = "";
            return {
              write: async (data: unknown) => {
                if (typeof data === "string") buffer += data;
                else if (data instanceof Uint8Array) buffer += new TextDecoder().decode(data);
              },
              close: async () => {
                files.set(filePath, { content: buffer, size: buffer.length });
              },
            } as unknown as FileSystemWritableFileStream;
          },
        } as unknown as FileSystemFileHandle;
      },
      removeEntry: async (name: string) => {
        const filePath = `${currentPath}/${name}`;
        files.delete(filePath);
      },
      async *[Symbol.asyncIterator]() {
        const prefix = `${currentPath}/`;
        const subItems = new Set<string>();
        for (const k of files.keys()) {
          if (k.startsWith(prefix)) {
            const rel = k.slice(prefix.length);
            const firstSeg = rel.split("/")[0];
            subItems.add(firstSeg);
          }
        }
        for (const item of subItems) {
          const isDir = Array.from(files.keys()).some((k) => k.startsWith(`${prefix}${item}/`));
          if (isDir) {
            yield [item, createDirHandle(`${prefix}${item}`)] as [string, FileSystemHandle];
          } else {
            const fileHandle = {
              kind: "file",
              name: item,
              getFile: async () => {
                const entry = files.get(`${prefix}${item}`);
                return {
                  name: item,
                  size: entry?.size || 0,
                  lastModified: Date.now(),
                  text: async () => entry?.content || "",
                };
              },
            };
            yield [item, fileHandle as unknown as FileSystemHandle] as [string, FileSystemHandle];
          }
        }
      },
    } as unknown as FileSystemDirectoryHandle;
  }

  return { rootHandle: createDirHandle(""), files };
}

describe("Repurpose Pipeline End-to-End Orchestration", () => {
  const projectId = "d0000000-0000-4000-8000-000000000001";
  const asset1Id = "a1111111-0000-4000-8000-000000000001";
  const asset2Id = "a2222222-0000-4000-8000-000000000002";

  const file1 = createMockWavFile("interview-audio1.wav", 15);
  const file2 = createMockWavFile("interview-audio2.wav", 20);

  const mockProject: ProjectDocument = {
    schemaVersion: 1,
    id: projectId,
    name: "Repurpose Test Project",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    assets: [
      {
        id: asset1Id,
        name: file1.name,
        kind: "audio",
        mediaType: "audio",
        mimeType: "audio/wav",
        size: file1.size,
        handleRefId: "h1",
        fingerprint: "fp11111111",
        metadata: {
          containerFormat: "WAVE",
          duration: 15.0,
          videoTracks: [],
          audioTracks: [{ trackNumber: 0, codec: "pcm_s16le", numberOfChannels: 2, sampleRate: 48000 }],
          inspectedAt: new Date().toISOString(),
        },
      },
      {
        id: asset2Id,
        name: file2.name,
        kind: "audio",
        mediaType: "audio",
        mimeType: "audio/wav",
        size: file2.size,
        handleRefId: "h2",
        fingerprint: "fp22222222",
        metadata: {
          containerFormat: "WAVE",
          duration: 20.0,
          videoTracks: [],
          audioTracks: [{ trackNumber: 0, codec: "pcm_s16le", numberOfChannels: 2, sampleRate: 48000 }],
          inspectedAt: new Date().toISOString(),
        },
      },
    ],
  };

  const liveAssets = new Map<string, LiveAssetItem>();
  liveAssets.set(asset1Id, {
    asset: mockProject.assets[0],
    status: "ready",
    file: file1,
  });
  liveAssets.set(asset2Id, {
    asset: mockProject.assets[1],
    status: "ready",
    file: file2,
  });

  test("validateSelectedSources catches missing or empty files and accepts ready files", () => {
    // Valid selection
    const res1 = validateSelectedSources(mockProject, liveAssets, [asset1Id]);
    assert.equal(res1.errors.length, 0);
    assert.equal(res1.validAssets.length, 1);

    // Missing asset selection
    const res2 = validateSelectedSources(mockProject, liveAssets, ["non-existent-id"]);
    assert.ok(res2.errors.length > 0);
    assert.ok(res2.errors[0].includes("not found"));

    // Inaccessible / missing file
    const brokenLive = new Map<string, LiveAssetItem>();
    brokenLive.set(asset1Id, {
      asset: mockProject.assets[0],
      status: "missing",
    });
    const res3 = validateSelectedSources(mockProject, brokenLive, [asset1Id]);
    assert.ok(res3.errors.length > 0);
    assert.ok(res3.errors[0].includes("not accessible"));
  });

  test("pipeline analyzes single media file, scores candidates, and creates valid EditPlan", async () => {
    const { rootHandle } = createMockWorkspace();

    const config: RepurposeConfig = {
      objective: "podcast",
      targetClipCount: 2,
      minClipDuration: 5,
      maxClipDuration: 10,
      targetAspectRatio: "9:16",
      keywords: ["interview"],
      selectedAssetIds: [asset1Id],
    };

    let progressCalls = 0;
    const result = await runRepurposePipeline(mockProject, liveAssets, config, {
      workspaceHandle: rootHandle,
      onProgress: (p) => {
        progressCalls++;
        assert.ok(p.percent >= 0 && p.percent <= 100);
      },
    });

    assert.ok(progressCalls > 0, "Progress callbacks invoked");
    assert.ok(result.allCandidates.length > 0, "Discovered candidates");
    assert.ok(result.selectedCandidates.length > 0, "Selected candidates");
    assert.equal(result.editPlan.isValid, true);
    assert.equal(result.editPlan.targetAspectRatio, "9:16");

    // All selected candidates should have duration within bounds
    for (const c of result.selectedCandidates) {
      assert.ok(c.duration >= 4.0 && c.duration <= 11.5);
    }
  });

  test("pipeline handles multi-source analysis and sequences multiple sources", async () => {
    const { rootHandle } = createMockWorkspace();

    const config: RepurposeConfig = {
      objective: "highlights",
      targetClipCount: 2,
      minClipDuration: 5,
      maxClipDuration: 10,
      targetAspectRatio: "16:9",
      keywords: [],
      selectedAssetIds: [asset1Id, asset2Id],
    };

    const result = await runRepurposePipeline(mockProject, liveAssets, config, {
      workspaceHandle: rootHandle,
    });

    assert.equal(result.analyzedSourcesCount, 2);
    assert.ok(result.selectedCandidates.length >= 1);
    assert.equal(result.editPlan.isValid, true);
  });

  test("pipeline cancellation: abort signal halts execution cleanly", async () => {
    const { rootHandle } = createMockWorkspace();
    const controller = new AbortController();
    controller.abort(); // Pre-abort

    const config: RepurposeConfig = {
      objective: "highlights",
      targetClipCount: 2,
      minClipDuration: 5,
      maxClipDuration: 10,
      targetAspectRatio: "9:16",
      keywords: [],
      selectedAssetIds: [asset1Id],
    };

    await assert.rejects(async () => {
      await runRepurposePipeline(mockProject, liveAssets, config, {
        signal: controller.signal,
        workspaceHandle: rootHandle,
      });
    }, /cancelled/);
  });

  test("applies repurposed edit plan to timeline and persists project revision safely", async () => {
    const { rootHandle, files } = createMockWorkspace();

    // Seed project.json in workspace
    files.set(`projects/${projectId}/project.json`, {
      content: JSON.stringify(mockProject),
      size: 500,
    });

    const config: RepurposeConfig = {
      objective: "educational",
      targetClipCount: 2,
      minClipDuration: 5,
      maxClipDuration: 10,
      targetAspectRatio: "1:1",
      keywords: [],
      selectedAssetIds: [asset1Id],
    };

    const pipelineResult = await runRepurposePipeline(mockProject, liveAssets, config, {
      workspaceHandle: rootHandle,
    });

    const { timeline, errors } = applyEditPlanToTimeline(pipelineResult.editPlan);
    assert.equal(errors.length, 0);

    // Save as new project revision with reason
    const reason = `Repurpose: Educational (${pipelineResult.selectedCandidates.length} clips)`;
    const updatedDoc: ProjectDocument = {
      ...mockProject,
      timeline,
      settings: { targetAspectRatio: "1:1" },
    };

    const revMeta = await createProjectRevision(rootHandle, updatedDoc, reason, { force: true });
    assert.ok(revMeta !== null);
    assert.equal(revMeta.reason, reason);

    // Verify revision is stored and listed
    const revisions = await listProjectRevisions(rootHandle, projectId);
    assert.ok(revisions.length > 0);
    assert.equal(revisions[0].reason, reason);
  });
});
