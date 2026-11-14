/**
 * Browser capability detection for Content Studio.
 *
 * Rules:
 * - Detection is entirely defensive. No permissions are requested.
 * - No filesystem access, OPFS writes, IndexedDB writes, or network requests.
 * - Browser globals are only accessed at call time (client-side), never at
 *   module initialisation, so this module is safe to import in Server
 *   Components and during SSR — results will simply reflect the absence of
 *   browser APIs.
 * - Codec support is NOT inferred from the presence of WebCodecs classes.
 *   Detailed codec capability checks belong to the media engine.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Result for a single detected capability.
 */
export interface CapabilityEntry {
  /** Whether the API surface is present in this browser environment. */
  available: boolean;
  /**
   * Optional short note about the detection result — e.g. a known limitation
   * or a partial-availability qualifier. Keep this technical-free; it may be
   * shown to users.
   */
  note?: string;
}

/**
 * Snapshot of browser capability detections relevant to Content Studio.
 * All fields reflect the state at the time detectCapabilities() was called.
 */
export interface CapabilitySnapshot {
  /**
   * File System Access API — showDirectoryPicker, FileSystemDirectoryHandle,
   * FileSystemFileHandle. Required for workspace folder selection.
   */
  fileSystemAccess: CapabilityEntry;

  /**
   * WebCodecs API — VideoDecoder, VideoEncoder, AudioDecoder, AudioEncoder.
   * Required for local media decoding and encoding. Codec-level support is
   * tested by the media engine.
   */
  webCodecs: CapabilityEntry;

  /**
   * OffscreenCanvas — used for off-thread frame rendering via Workers.
   */
  offscreenCanvas: CapabilityEntry;

  /**
   * WebGPU — navigator.gpu. Optional; used for GPU-accelerated compositing
   * where available. The application falls back to Canvas 2D without it.
   */
  webGpu: CapabilityEntry;

  /**
   * Web Workers — Worker constructor. Required for off-thread media processing.
   */
  webWorkers: CapabilityEntry;

  /**
   * Web Audio API — AudioContext. Required for audio analysis and processing.
   */
  webAudio: CapabilityEntry;

  /**
   * Origin Private File System — navigator.storage.getDirectory.
   * Used for bounded temporary/cache storage, not for primary project data.
   */
  opfs: CapabilityEntry;

  /**
   * IndexedDB — used for browser-persistent metadata and file handle storage.
   */
  indexedDb: CapabilityEntry;

  /**
   * Whether detection ran in a browser environment.
   * False when called during SSR/server rendering.
   */
  isBrowser: boolean;
}

// ─── Detection helpers ────────────────────────────────────────────────────────

function isBrowserEnv(): boolean {
  return typeof window !== "undefined";
}

function checkFileSystemAccess(): CapabilityEntry {
  if (!isBrowserEnv()) return { available: false, note: "Not a browser environment." };
  const hasShowDir = typeof (window as unknown as Record<string, unknown>)["showDirectoryPicker"] === "function";
  const hasHandles =
    typeof FileSystemDirectoryHandle !== "undefined" &&
    typeof FileSystemFileHandle !== "undefined";
  if (hasShowDir && hasHandles) {
    return { available: true };
  }
  if (!hasShowDir) {
    return {
      available: false,
      note: "Workspace folder selection is not supported in this browser. Use Chrome or Edge for the full experience.",
    };
  }
  return {
    available: false,
    note: "File System Access API is partially available. Some workspace features may be limited.",
  };
}

function checkWebCodecs(): CapabilityEntry {
  if (!isBrowserEnv()) return { available: false, note: "Not a browser environment." };
  const hasDecoder = typeof VideoDecoder !== "undefined";
  const hasEncoder = typeof VideoEncoder !== "undefined";
  const hasAudioDecoder = typeof AudioDecoder !== "undefined";
  const hasAudioEncoder = typeof AudioEncoder !== "undefined";
  if (hasDecoder && hasEncoder && hasAudioDecoder && hasAudioEncoder) {
    return {
      available: true,
      note: "WebCodecs classes are present. Specific codec support will be verified when needed.",
    };
  }
  return {
    available: false,
    note: "WebCodecs is not available. Local media encoding and decoding will not be supported in this browser.",
  };
}

function checkOffscreenCanvas(): CapabilityEntry {
  if (!isBrowserEnv()) return { available: false, note: "Not a browser environment." };
  return {
    available: typeof OffscreenCanvas !== "undefined",
    note:
      typeof OffscreenCanvas === "undefined"
        ? "OffscreenCanvas is not available. Off-thread rendering will fall back to main-thread Canvas."
        : undefined,
  };
}

function checkWebGpu(): CapabilityEntry {
  if (!isBrowserEnv()) return { available: false, note: "Not a browser environment." };
  const hasGpu = typeof navigator !== "undefined" && "gpu" in navigator && navigator.gpu != null;
  return {
    available: hasGpu,
    note: hasGpu
      ? "WebGPU is available. GPU-accelerated compositing can be used where supported."
      : "WebGPU is not available in this browser. Canvas 2D will be used for rendering instead.",
  };
}

function checkWebWorkers(): CapabilityEntry {
  if (!isBrowserEnv()) return { available: false, note: "Not a browser environment." };
  return {
    available: typeof Worker !== "undefined",
    note:
      typeof Worker === "undefined"
        ? "Web Workers are not available. Background media processing will not be possible."
        : undefined,
  };
}

function checkWebAudio(): CapabilityEntry {
  if (!isBrowserEnv()) return { available: false, note: "Not a browser environment." };
  const hasCtx =
    typeof AudioContext !== "undefined" ||
    typeof (window as unknown as Record<string, unknown>)["webkitAudioContext"] !== "undefined";
  return {
    available: hasCtx,
    note: hasCtx
      ? undefined
      : "Web Audio API is not available. Audio analysis and processing features will be disabled.",
  };
}

function checkOpfs(): CapabilityEntry {
  if (!isBrowserEnv()) return { available: false, note: "Not a browser environment." };
  const hasStorageApi = typeof navigator !== "undefined" && "storage" in navigator;
  const hasGetDir =
    hasStorageApi &&
    typeof (navigator.storage as unknown as Record<string, unknown>)["getDirectory"] === "function";
  return {
    available: hasGetDir,
    note: hasGetDir
      ? undefined
      : "Origin Private File System is not available. Temporary cache storage will be managed differently.",
  };
}

function checkIndexedDb(): CapabilityEntry {
  if (!isBrowserEnv()) return { available: false, note: "Not a browser environment." };
  const has = typeof indexedDB !== "undefined" && indexedDB != null;
  return {
    available: has,
    note: has
      ? undefined
      : "IndexedDB is not available. Persistent metadata storage will not work in this browser.",
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect browser capabilities relevant to Content Studio.
 *
 * Safe to call from Server Components — in that context isBrowser is false
 * and all entries report available: false. Intended to be called once on the
 * client and cached/memoised by the caller.
 *
 * Does NOT:
 * - Request filesystem permissions
 * - Open folder or file pickers
 * - Create, read or write any files
 * - Write to OPFS or IndexedDB
 * - Make network requests
 * - Transmit results anywhere
 */
export function detectCapabilities(): CapabilitySnapshot {
  return {
    isBrowser: isBrowserEnv(),
    fileSystemAccess: checkFileSystemAccess(),
    webCodecs: checkWebCodecs(),
    offscreenCanvas: checkOffscreenCanvas(),
    webGpu: checkWebGpu(),
    webWorkers: checkWebWorkers(),
    webAudio: checkWebAudio(),
    opfs: checkOpfs(),
    indexedDb: checkIndexedDb(),
  };
}

/**
 * Convenience: returns true only when all core capabilities required for the
 * primary editing workflow are available.
 *
 * "Core" for the initial release means: File System Access API, WebCodecs,
 * Web Workers and Web Audio. OffscreenCanvas, WebGPU and OPFS are optional
 * enhancements.
 */
export function hasCoreCapabilities(snapshot: CapabilitySnapshot): boolean {
  return (
    snapshot.fileSystemAccess.available &&
    snapshot.webCodecs.available &&
    snapshot.webWorkers.available &&
    snapshot.webAudio.available
  );
}

/**
 * Human-readable label for a capability key, used in the browser compatibility
 * panel.
 */
export const CAPABILITY_LABELS: Record<keyof Omit<CapabilitySnapshot, "isBrowser">, string> = {
  fileSystemAccess: "Workspace folder access",
  webCodecs: "Media encoding & decoding",
  offscreenCanvas: "Off-thread rendering",
  webGpu: "GPU compositing (optional)",
  webWorkers: "Background processing",
  webAudio: "Audio analysis",
  opfs: "Temporary cache storage (optional)",
  indexedDb: "Persistent metadata storage",
};

/**
 * Whether a given capability is optional (application can function without it).
 */
export const CAPABILITY_OPTIONAL: Record<keyof Omit<CapabilitySnapshot, "isBrowser">, boolean> = {
  fileSystemAccess: false,
  webCodecs: false,
  offscreenCanvas: true,
  webGpu: true,
  webWorkers: false,
  webAudio: false,
  opfs: true,
  indexedDb: false,
};

// Re-export granular WebCodecs capability detection
export {
  detectWebCodecsCapabilities,
  checkVideoDecoderSupport,
  checkAudioDecoderSupport,
  checkVideoEncoderSupport,
  checkAudioEncoderSupport,
  checkAssetDecoderSupport,
} from "./media/webcodecsCapabilities.ts";

