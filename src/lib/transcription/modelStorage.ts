/**
 * Browser-local storage inventory and lifecycle management for Speech-to-Text (ASR) models.
 *
 * Rules:
 * - Scans browser-managed origin storage (OPFS) under `browser-whisper-transformers-cache`.
 * - Strictly separated from workspace disk cache (projects/<id>/cache/).
 * - Models are NEVER automatically deleted; deletions are strictly user-initiated via manual buttons.
 * - Inspects cached file sizes for Whisper and Parakeet models in OPFS.
 * - Delegates actual deletions to `BrowserWhisper.deleteModel()` and `BrowserWhisper.clearCache()`.
 */

import { formatBytes } from "../projectValidation.ts";

export type SpeechModelTier = "lite" | "fast-en" | "balanced" | "high" | "pro";

export type SpeechModelId =
  | "whisper-tiny_timestamped"
  | "moonshine-base"
  | "whisper-base_timestamped"
  | "whisper-small_timestamped"
  | "parakeet-tdt-0.6b-v3";

export interface SpeechModelCatalogEntry {
  tier: SpeechModelTier;
  id: SpeechModelId;
  label: string;
  hfId: string;
  estimatedSizeBytes: number;
  estimatedSizeFormatted: string;
  languages: string;
  hardwareRequirement: string;
  requiresWebGpu: boolean;
  recommendedBadge?: string;
  supportsWordTimestamps: boolean;
  description: string;
}

export interface SpeechModelStorageItem {
  id: SpeechModelId;
  tier: SpeechModelTier;
  label: string;
  hfId: string;
  estimatedSizeFormatted: string;
  estimatedSizeBytes: number;
  actualSizeBytes: number;
  isDownloaded: boolean;
  languages: string;
  hardwareRequirement: string;
  requiresWebGpu: boolean;
  recommendedBadge?: string;
  supportsWordTimestamps: boolean;
  description: string;
}

export interface SpeechModelStorageReport {
  isSupported: boolean;
  totalBytes: number;
  totalFormatted: string;
  models: SpeechModelStorageItem[];
}

export const SPEECH_MODEL_CATALOG: SpeechModelCatalogEntry[] = [
  {
    tier: "lite",
    id: "whisper-tiny_timestamped",
    label: "Lite (Default / Low-End)",
    hfId: "onnx-community/whisper-tiny_timestamped",
    estimatedSizeBytes: 120 * 1024 * 1024,
    estimatedSizeFormatted: "~120 MB",
    languages: "Multilingual (99)",
    hardwareRequirement: "Any desktop Chrome/Edge (CPU WASM or WebGPU)",
    requiresWebGpu: false,
    supportsWordTimestamps: true,
    description: "Lightweight, fastest model with precise word-level cut boundaries.",
  },
  {
    tier: "fast-en",
    id: "moonshine-base",
    label: "Fast English",
    hfId: "onnx-community/moonshine-base-ONNX",
    estimatedSizeBytes: 98 * 1024 * 1024,
    estimatedSizeFormatted: "~98 MB",
    languages: "English only",
    hardwareRequirement: "Any desktop Chrome/Edge (fast on CPU)",
    requiresWebGpu: false,
    supportsWordTimestamps: false,
    description: "Optimized for fast English-only transcription on CPU or low-end devices.",
  },
  {
    tier: "balanced",
    id: "whisper-base_timestamped",
    label: "Balanced (Recommended)",
    hfId: "onnx-community/whisper-base_timestamped",
    estimatedSizeBytes: 206 * 1024 * 1024,
    estimatedSizeFormatted: "~206 MB",
    languages: "Multilingual (99)",
    hardwareRequirement: "Mid-range laptops+ (CPU WASM or WebGPU)",
    requiresWebGpu: false,
    supportsWordTimestamps: true,
    description: "Higher accuracy with word-level timestamps for complex speech.",
  },
  {
    tier: "high",
    id: "whisper-small_timestamped",
    label: "High Accuracy",
    hfId: "onnx-community/whisper-small_timestamped",
    estimatedSizeBytes: 586 * 1024 * 1024,
    estimatedSizeFormatted: "~586 MB",
    languages: "Multilingual (99)",
    hardwareRequirement: "WebGPU recommended / 8 GB+ RAM",
    requiresWebGpu: false,
    recommendedBadge: "Recommended: WebGPU / 8 GB+ RAM",
    supportsWordTimestamps: true,
    description: "High accuracy multilingual model for nuanced or technical speech.",
  },
  {
    tier: "pro",
    id: "parakeet-tdt-0.6b-v3",
    label: "Pro (WebGPU Only)",
    hfId: "ysdede/parakeet-tdt-0.6b-v3-onnx",
    estimatedSizeBytes: Math.round(1.26 * 1024 * 1024 * 1024),
    estimatedSizeFormatted: "~1.26 GB",
    languages: "25 languages",
    hardwareRequirement: "Requires WebGPU (auto-disabled if WebGPU unavailable)",
    requiresWebGpu: true,
    supportsWordTimestamps: true,
    description: "Ultra-fast state-of-the-art WebGPU speech model with word-level timestamps.",
  },
];

/**
 * Returns the default recommended model tier based on WebGPU availability.
 */
export function getDefaultModelTier(hasWebGpu: boolean): SpeechModelTier {
  return hasWebGpu ? "balanced" : "lite";
}

/**
 * Returns the default recommended model ID based on WebGPU availability.
 */
export function getDefaultModelId(hasWebGpu: boolean): SpeechModelId {
  return hasWebGpu ? "whisper-base_timestamped" : "whisper-tiny_timestamped";
}

/**
 * Checks whether a model tier is supported in the current environment.
 */
export function isModelTierSupported(
  tier: SpeechModelTier,
  capabilities: { hasWebGpu: boolean }
): boolean {
  if (tier === "pro" && !capabilities.hasWebGpu) {
    return false;
  }
  return true;
}

/**
 * Checks whether a model ID is supported in the current environment.
 */
export function isModelIdSupported(
  modelId: SpeechModelId,
  capabilities: { hasWebGpu: boolean }
): boolean {
  const model = SPEECH_MODEL_CATALOG.find((m) => m.id === modelId);
  if (!model) return false;
  if (model.requiresWebGpu && !capabilities.hasWebGpu) return false;
  return true;
}

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
    tier: m.tier,
    label: m.label,
    hfId: m.hfId,
    estimatedSizeFormatted: m.estimatedSizeFormatted,
    estimatedSizeBytes: m.estimatedSizeBytes,
    actualSizeBytes: 0,
    isDownloaded: false,
    languages: m.languages,
    hardwareRequirement: m.hardwareRequirement,
    requiresWebGpu: m.requiresWebGpu,
    recommendedBadge: m.recommendedBadge,
    supportsWordTimestamps: m.supportsWordTimestamps,
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
                if (record.url.includes(model.hfId) || record.url.includes(model.id)) {
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
export async function deleteSpeechModel(modelId: SpeechModelId): Promise<void> {
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
