/**
 * Browser-local storage inventory and lifecycle management for Speech-to-Text (ASR) models.
 *
 * Rules:
 * - Scans browser-managed origin storage (OPFS) under `browser-whisper-transformers-cache`.
 * - Strictly separated from workspace disk cache (projects/<id>/cache/).
 * - Models are NEVER automatically deleted; deletions are strictly user-initiated via manual buttons.
 * - Inspects cached file sizes for Whisper models in OPFS.
 * - Delegates actual deletions to `BrowserWhisper.deleteModel()` and `BrowserWhisper.clearCache()`.
 */

import { formatBytes } from "../projectValidation.ts";

export interface SpeechModelStorageItem {
  id: "whisper-tiny_timestamped" | "whisper-base_timestamped" | "whisper-tiny" | "whisper-base";
  label: string;
  hfId: string;
  estimatedSizeFormatted: string;
  estimatedSizeBytes: number;
  actualSizeBytes: number;
  isDownloaded: boolean;
  description: string;
}

export interface SpeechModelStorageReport {
  isSupported: boolean;
  totalBytes: number;
  totalFormatted: string;
  models: SpeechModelStorageItem[];
}

export const SPEECH_MODEL_CATALOG: Array<{
  id: "whisper-tiny_timestamped" | "whisper-base_timestamped" | "whisper-tiny" | "whisper-base";
  label: string;
  hfId: string;
  estimatedSizeBytes: number;
  estimatedSizeFormatted: string;
  description: string;
}> = [
  {
    id: "whisper-tiny_timestamped",
    label: "Whisper Tiny (Word-Level Timestamps)",
    hfId: "onnx-community/whisper-tiny_timestamped",
    estimatedSizeBytes: 120 * 1024 * 1024,
    estimatedSizeFormatted: "~120 MB",
    description: "Lightweight, fastest model with precise word-level cut boundaries.",
  },
  {
    id: "whisper-base_timestamped",
    label: "Whisper Base (Word-Level Timestamps)",
    hfId: "onnx-community/whisper-base_timestamped",
    estimatedSizeBytes: 206 * 1024 * 1024,
    estimatedSizeFormatted: "~206 MB",
    description: "Higher accuracy with word-level timestamps for complex speech.",
  },
  {
    id: "whisper-tiny",
    label: "Whisper Tiny (Segment Timestamps)",
    hfId: "onnx-community/whisper-tiny",
    estimatedSizeBytes: 120 * 1024 * 1024,
    estimatedSizeFormatted: "~120 MB",
    description: "Fastest segment-level transcription for low-memory devices.",
  },
  {
    id: "whisper-base",
    label: "Whisper Base (Segment Timestamps)",
    hfId: "onnx-community/whisper-base",
    estimatedSizeBytes: 206 * 1024 * 1024,
    estimatedSizeFormatted: "~206 MB",
    description: "Balanced general-purpose transcription with sentence cues.",
  },
];

const OPFS_CACHE_DIR_NAME = "browser-whisper-transformers-cache";

/**
 * Scans OPFS to inventory downloaded Whisper models and calculate total disk consumption in browser storage.
 */
export async function scanSpeechModelStorage(): Promise<SpeechModelStorageReport> {
  const isBrowser = typeof window !== "undefined";
  const hasOpfs =
    isBrowser &&
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    typeof navigator.storage.getDirectory === "function";

  const items: SpeechModelStorageItem[] = SPEECH_MODEL_CATALOG.map((m) => ({
    id: m.id,
    label: m.label,
    hfId: m.hfId,
    estimatedSizeFormatted: m.estimatedSizeFormatted,
    estimatedSizeBytes: m.estimatedSizeBytes,
    actualSizeBytes: 0,
    isDownloaded: false,
    description: m.description,
  }));

  if (!hasOpfs) {
    return {
      isSupported: false,
      totalBytes: 0,
      totalFormatted: "0 B",
      models: items,
    };
  }

  let totalCacheBytes = 0;

  try {
    const rootDir = await navigator.storage.getDirectory();
    let cacheDir: FileSystemDirectoryHandle;
    try {
      cacheDir = await rootDir.getDirectoryHandle(OPFS_CACHE_DIR_NAME, { create: false });
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "NotFoundError") {
        return {
          isSupported: true,
          totalBytes: 0,
          totalFormatted: "0 B",
          models: items,
        };
      }
      throw e;
    }

    let metadataDir: FileSystemDirectoryHandle | null = null;
    let filesDir: FileSystemDirectoryHandle | null = null;

    try {
      metadataDir = await cacheDir.getDirectoryHandle("metadata", { create: false });
    } catch {}

    try {
      filesDir = await cacheDir.getDirectoryHandle("files", { create: false });
    } catch {}

    // Map fileName -> sizeBytes
    const fileSizeMap = new Map<string, number>();
    if (filesDir) {
      for await (const [name, handle] of (filesDir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
        if (handle.kind === "file") {
          try {
            const file = await (handle as FileSystemFileHandle).getFile();
            fileSizeMap.set(name, file.size);
            totalCacheBytes += file.size;
          } catch {}
        }
      }
    }

    // Inspect metadata json files to attribute bytes to each model
    if (metadataDir && filesDir) {
      for await (const [metaName, handle] of (metadataDir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
        if (handle.kind === "file" && metaName.endsWith(".json")) {
          try {
            const file = await (handle as FileSystemFileHandle).getFile();
            const text = await file.text();
            const record = JSON.parse(text) as { url?: string; fileName?: string };

            if (record?.url && record?.fileName) {
              const size = fileSizeMap.get(record.fileName) || 0;

              for (const model of items) {
                if (record.url.includes(model.hfId)) {
                  model.actualSizeBytes += size;
                  model.isDownloaded = true;
                }
              }
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    console.warn("[modelStorage] Error scanning browser OPFS model cache:", err);
  }

  return {
    isSupported: true,
    totalBytes: totalCacheBytes,
    totalFormatted: formatBytes(totalCacheBytes),
    models: items,
  };
}

/**
 * Manually deletes a single Whisper model from browser OPFS and legacy cache.
 */
export async function deleteSpeechModel(
  modelId: "whisper-tiny_timestamped" | "whisper-base_timestamped" | "whisper-tiny" | "whisper-base"
): Promise<void> {
  const { BrowserWhisper } = await import("browser-whisper");
  await BrowserWhisper.deleteModel(modelId as Parameters<typeof BrowserWhisper.deleteModel>[0]);
}

/**
 * Manually clears all Whisper speech models from browser OPFS and legacy cache.
 */
export async function clearAllSpeechModels(): Promise<void> {
  const { BrowserWhisper } = await import("browser-whisper");
  await BrowserWhisper.clearCache();
}
