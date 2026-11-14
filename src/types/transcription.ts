/**
 * Type definitions for Content Studio Local Transcription and Subtitles.
 *
 * Rules:
 * - 100% local-first and private: zero cloud APIs, zero external telemetry.
 * - Supports user-imported SRT/VTT files and local on-device ASR (Whisper via WebGPU/WASM).
 * - Exposes word-level and segment-level timestamps.
 * - JSON-serializable for derived caching in project workspace.
 */

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface TranscriptionCue {
  id: string;
  start: number;
  end: number;
  text: string;
  words?: WordTimestamp[];
  speaker?: string;
}

export type TranscriptionEngineType = "srt-vtt" | "browser-whisper" | "manual";

export interface SourceTranscript {
  sourceAssetId: string;
  sourceAssetName: string;
  fingerprint?: string;
  language?: string;
  modelIdentifier?: string;
  engine: TranscriptionEngineType;
  cues: TranscriptionCue[];
  fullText: string;
  duration: number;
  coverage: Array<{ start: number; end: number }>;
  createdAt: string;
  isWordLevel: boolean;
}

export interface TranscriptionProgress {
  stage: "idle" | "loading-model" | "extracting-audio" | "transcribing" | "completed" | "error";
  percent: number;
  statusText: string;
  currentChunk?: number;
  totalChunks?: number;
}

export interface ModelDownloadInfo {
  modelName: string;
  label: string;
  sizeBytes: number;
  sizeFormatted: string;
  isDownloaded: boolean;
  supportsWordTimestamps: boolean;
  description: string;
}

export interface TranscriptionCapabilityReport {
  webGpuSupported: boolean;
  wasmSupported: boolean;
  canRunAsr: boolean;
  availableModels: ModelDownloadInfo[];
  recommendedModel: string;
  message: string;
}

export interface TranscriptionEngine {
  readonly name: string;
  isAvailable(): Promise<TranscriptionCapabilityReport>;
  downloadModel(
    modelName: string,
    options?: {
      signal?: AbortSignal;
      onProgress?: (percent: number, statusText: string) => void;
    }
  ): Promise<void>;
  transcribe(
    file: File,
    options?: {
      signal?: AbortSignal;
      modelName?: string;
      language?: string;
      onProgress?: (progress: TranscriptionProgress) => void;
      onCue?: (cue: TranscriptionCue) => void;
    }
  ): Promise<SourceTranscript>;
  deleteModel(modelName: string): Promise<void>;
  dispose(): void;
}
