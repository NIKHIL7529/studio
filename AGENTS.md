# Content Studio — Technical Architecture & Product Specification

## 1. Product Overview

**Product name:** Content Studio  
**Product category:** Browser-based, local-first video editor and deterministic repurposing workspace  
**Platform:** Desktop web browsers (Google Chrome & Microsoft Edge 120+)  
**Target audience:** Video creators, educators, podcasters, and content teams converting long-form footage into short-form content.

### Product Vision & Current Status

Content Studio is an open-source, browser-based video editing and repurposing application that allows users to import source media, organize multi-track timelines, preview footage via dual-monitor controls, apply keyframes and transitions, generate word-accurate subtitles with on-device speech-to-text, and export finished content directly on their local computers.

The application requires:
- No FFmpeg installation, desktop binaries, or container dependencies.
- No user accounts, logins, telemetry, or cloud processing infrastructure.
- Zero upload of user media files — all video processing, audio extraction, and transcription happen locally inside the browser.

Content Studio combines the workflows of a modern Non-Linear Editor (NLE) with deterministic, content-aware short-form repurposing.

---

## 2. Product Principles

### 2.1 Local-First Architecture
- **Zero-Copy Media Referencing:** Original source files remain untouched at their local filesystem paths. Persistent references are maintained in IndexedDB via `FileSystemFileHandle` objects and opaque UUIDs. Source media bytes are never copied into the workspace, OPFS, or IndexedDB.
- **Local Workspace as Source of Truth:** A user-selected local directory stores all project documents (`projects/<uuid>/project.json`), historical revision checkpoints (`revisions/`), export files (`exports/`), and disposable project cache (`cache/`).
- **Completely Serverless:** The application operates without backend servers, databases, or cloud render farms. Static hosting serves client assets only.

### 2.2 Browser-Native Media Engine
- **WebCodecs:** Hardware-accelerated video/audio decoding and encoding.
- **Mediabunny:** Client-side container demuxing, metadata inspection, and streaming multiplexing (MP4 / WebM).
- **Canvas & OffscreenCanvas:** Frame compositing, transitions, text overlays, and keyframe transform rendering.
- **Web Audio API:** Audio analysis, multi-track gain mixing, and crossfading.
- **File System Access API:** Directory picking (`showDirectoryPicker`) and direct progressive stream writing (`FileSystemWritableFileStream`).
- **IndexedDB:** Browser-persistent storage of directory/file handles and application preferences.
- **Local ASR via WebGPU & WebAssembly:** Client-side Whisper speech-to-text powered by `browser-whisper` and `@huggingface/transformers`. Audio never leaves the user's computer.

### 2.3 Deterministic Repurposing & Speech-to-Text
- Repurposing candidate discovery and sequence construction are 100% deterministic, transparent local algorithms based on:
  - Acoustic dynamics (RMS energy, zero-crossing rate, speech envelope, transient detection).
  - Visual dynamics (downscaled 160x90 luminance differences and color histograms).
  - Transcript semantics and 5 context-integrity dimensions (speech boundary completeness, thought continuity, context sufficiency, standalone clarity, and ending closure).
- No external cloud AI APIs (OpenAI, Anthropic, Gemini) or remote LLM services are utilized.

---

## 3. Implemented Subsystems & Architecture

### 3.1 Dual-Monitor Editing Workflow
Content Studio implements a professional two-up monitor architecture:
- **Source Monitor (`SourceMonitor.tsx`):** Displays unedited library assets, permitting frame-accurate scrubbing and setting In (`I`) and Out (`O`) trim points prior to timeline insertion.
- **Program Monitor (`TimelinePreview.tsx`):** Renders the active sequence composition in real time, displaying active video tracks, keyframe motion, transitions, text titles, and timed subtitles.

### 3.2 Keyframe & Motion Presets (`src/lib/animation/animationPresets.ts`)
- **Keyframe Engine:** Parameter-driven keyframing for `positionX`, `positionY`, `scaleX`, `scaleY`, `rotation`, `opacity`, and `volume`.
- **Interpolation Modes:** Supports `linear`, `ease-in`, `ease-out`, `ease-in-out`, and `hold` interpolation curves.
- **Preset Library:** Pre-configured motion animations including Zoom In/Out, Pan Left/Right, Ken Burns motion, Continuous Float, Deterministic Shake, and Typewriter Text Reveal.

### 3.3 Video Transitions (`src/lib/transitions/`)
- **Catalog & Types:** Cross Dissolve, Fade From Black, Fade To Black, Dip Through Black, Fade From White, Fade To White, Dip Through White, Directional Wipes (Left, Right, Up, Down), and Slide transitions.
- **Normalized Execution:** Transitions evaluate on edit points between outgoing (`fromClip`) and incoming (`toClip`) handles with configurable durations and easing functions.
- **Render Parity:** Executed via canvas renderers (`renderTransition`) shared identically by the live preview and export pipeline.

### 3.4 Multi-Sequence Management (`src/lib/timeline/sequenceManager.ts`)
- **Multi-Sequence Document Model:** Projects support multiple sequence documents (`SequenceDocument`), enabling multiple cuts, aspect ratio variations (16:9, 9:16, 1:1, 4:5), or scene breakdowns within a single project.
- **Active Synchronization:** Active sequence edits automatically synchronize with `doc.timeline` and `doc.activeSequenceId`, maintaining backwards compatibility with single-timeline consumers.

### 3.5 Unified Composition Evaluator (`src/lib/composition/evaluator.ts`)
- **Single Source of Truth:** Pure, deterministic evaluation function `evaluateCompositionAtTime(timeline, time, options)` used identically by `TimelinePreview` and `pipeline.ts`.
- **Evaluated Composition Output:** Returns active video clips in stacking order, computed transform matrices, active transitions with progress `[0, 1]`, active text overlays, karaoke word highlight indices, and mixed audio source volumes.

### 3.6 Local Speech-to-Text & Subtitles (`src/lib/transcription/`)
- **Offline Whisper Engine (`engine.ts`):** Client-side speech-to-text using `browser-whisper` with WebGPU hardware acceleration and automatic CPU WebAssembly fallback.
- **5-Tier Model Catalog:** Structured 5-tier catalog with hardware compatibility gating: `lite` (`whisper-tiny_timestamped`, ~120 MB, CPU/WebGPU), `fast-en` (`moonshine-base`, ~98 MB, fast on CPU), `balanced` (`whisper-base_timestamped`, ~206 MB, CPU/WebGPU recommended), `high` (`whisper-small_timestamped`, ~461 MB, WebGPU recommended), and `pro` (`whisper-large-v3-turbo_timestamped`, ~809 MB, requires dedicated WebGPU).
- **Subtitle Parsing (`subtitleParser.ts`):** Parses user-provided SRT and WebVTT files into structured timestamped cues.
- **Automated Caption Generation (`captionGenerator.ts`):** Converts speech cues into styled short-form text overlays with line-wrapping, bounding boxes, and karaoke word tracking.

### 3.7 Content-Aware Repurposing Pipeline (`src/lib/repurpose/`)
- **100% Source Coverage:** Evaluates full source durations without arbitrary segment clamps.
- **Multi-Moment Discovery:** Identifies multiple candidate segments per source media file.
- **Context Integrity Scoring:** Evaluates candidate windows against 5 objective metrics:
  1. *Speech Boundary Precision:* Cuts avoid bisecting spoken words.
  2. *Thought Completeness:* Sentence beginnings and grammatical clauses are preserved.
  3. *Context Sufficiency:* Introductory phrasing provides adequate context.
  4. *Standalone Clarity:* Content remains understandable without external context.
  5. *Ending Closure:* Conclusions terminate cleanly on natural pauses.
- **EditPlan Generation:** Converts scored candidates directly into a new sequence timeline.

### 3.8 Progressive Export Pipeline (`src/lib/export/`)
- **Render Planning:** Integer microsecond-accurate render plans reconciling all video frames and audio sample intervals.
- **Progressive Streaming Writer (`progressiveWriter.ts`):** Writes output chunks directly to disk using `FileSystemWritableFileStream` to stage `.tmp_<id>_<name>.mp4`, atomically renaming to final filename upon completion.
- **Validation:** Performs post-render Mediabunny container and track inspection (`validation.ts`).

---

## 4. Workspace & Storage Architecture

### 4.1 Directory Structure
```
<Workspace Folder>/
├── projects/
│   └── <project-uuid>/
│       ├── project.json              # Canonical project document (Schema 1)
│       ├── revisions/                # Bounded snapshot checkpoints (up to 50)
│       │   └── revision-<timestamp>-<id>.json
│       ├── exports/                  # Completed and staged exports
│       │   ├── output-1080p.mp4
│       │   └── .tmp_<id>_<name>.mp4  # Temporary in-flight render staging
│       └── cache/                    # Disposable project-specific cache (waveforms, frames)
├── trash/                            # Soft-deleted projects (reversible)
│   └── <project-uuid>/
└── .cache/                           # Workspace-level transient cache
```

### 4.2 Storage Boundaries & Whisper Model Cache
- **Workspace-Managed Storage:** `projects/<id>/cache/`, `.tmp_*` files, and `trash/` are managed by `cacheManager.ts` and `trash.ts`. Active resource locks prevent cleanup during ongoing exports or playback.
- **Browser-Managed Origin Storage:** Model weights downloaded for local Whisper speech recognition are stored in browser OPFS / CacheStorage by `browser-whisper` and `@huggingface/transformers`. They reside in origin storage outside the workspace folder and are managed via the dedicated "Speech Models — Browser Storage" section in `CacheManagerModal.tsx` through manual deletion controls (`BrowserWhisper.deleteModel()` and `BrowserWhisper.clearCache()`). Models are never deleted automatically.

---

## 5. Threading & Execution Model

### Current Reality:
- **Main Thread Execution:** Export rendering, canvas compositing, video frame sampling, audio signal analysis, and media inspection run asynchronously on the main browser thread via WebCodecs and Mediabunny yield loops.
- **Worker Thread Execution:** Heavy machine-learning inference for Whisper ASR is dispatched by `browser-whisper` inside internal Web Worker threads and WebGPU pipelines.
- **Future Worker Migration:** Dedicated `*.worker.ts` files for export compositing, frame sampling, and audio analysis represent a future optimization to ensure UI frame rates remain at 60 fps during intensive 4K rendering.

---

## 6. Browser Compatibility & Cross-Origin Isolation

### 6.1 Browser Gating
- **Supported:** Desktop Google Chrome and Microsoft Edge (version 120+ on Windows, macOS, Linux).
- **Unsupported & Hard-Blocked:** Mozilla Firefox and Apple Safari lack the File System Access API directory picker (`showDirectoryPicker`) and writable file streams. When opened in unsupported browsers, `WorkspaceHome.tsx` immediately renders a blocking "Browser Compatibility Notice".
- **Writer Fallback:** The memory-buffered fallback (`createMemoryFallbackWriter`) exists solely at the low-level writer interface (for environments without `.createWritable()`); there is no degraded session mode without directory permissions.

### 6.2 Cross-Origin Isolation (COOP / COEP)
- Content Studio currently runs without requiring `Cross-Origin-Opener-Policy: same-origin` or `Cross-Origin-Embedder-Policy: require-corp` headers.
- Single-threaded WebAssembly and WebGPU in `@huggingface/transformers` function without `SharedArrayBuffer`.
- If multi-threaded WebAssembly (`wasm-threads`) is introduced in the future, static hosting headers or a client-side service worker (`coi-serviceworker`) will be required.

---

## 7. Dependency Patches & Third-Party Code

### 7.1 `scripts/patch-browser-whisper.js`
- **Purpose:** Patches `node_modules/browser-whisper/dist/index.js` during `npm postinstall`.
- **Target Bug:** Adds null/undefined guards before `.destroy()` and `.unmap()` calls in onnxruntime's Emscripten WebGPU binding (`wgpuBufferRelease`, `wgpuDeviceRelease`), preventing unhandled `TypeError` exceptions during handle release.
- **Cross-Platform:** Uses standard Node.js `fs` and `path` modules.

---

## 8. Testing Strategy

- **Architectural & Unit Test Suites:** 45 test files (77 test suites / 356 tests) in `test/*.test.ts` run via Node's native runner:
  ```bash
  npm test
  # Invokes: node --experimental-strip-types --test test/*.test.ts
  ```
- **Synthetic Test Fixtures:** Media inspection and container format tests generate synthetic RIFF/WAV audio blobs and ISOBMFF MP4 boxes in memory to avoid proprietary external video dependencies.
- **Manual Chromium Validation:** Real-world WebCodecs hardware encoding, File System Access API picker interactions, and WebGPU Whisper execution are smoke-tested in desktop Chrome/Edge.

---

## 9. Implementation Status & Future Roadmap

| Milestone | Status | Details |
|---|---|---|
| **Phase 1: Foundation & Preflight** | ✅ Completed | Project setup, runtime capability detection, strict path validation. |
| **Phase 2: Local Workspace & Persistence** | ✅ Completed | FSA directory picker, IDB handle storage, schema-1 `project.json`, revisions, reversible trash. |
| **Phase 3: Media Inspection & Preview** | ✅ Completed | Mediabunny stream inspection, dual-monitor setup (Source & Program), object URL revocation. |
| **Phase 4: Multi-Track Timeline & Editing** | ✅ Completed | Video/audio tracks, trimming, splitting, magnet snapping, bounded undo/redo (50 states). |
| **Phase 5: Keyframes & Transitions** | ✅ Completed | Parameterized keyframes, motion presets, transition catalog, unified composition evaluator. |
| **Phase 6: Local Speech-to-Text & Subtitles** | ✅ Completed | Offline Whisper WebGPU/WASM, SRT/VTT parser, word-level caption generator. |
| **Phase 7: Content-Aware Repurposing** | ✅ Completed | 100% source duration coverage, acoustic/visual dynamics, 5 context-integrity metrics, EditPlan. |
| **Phase 8: Progressive Export & Validation** | ✅ Completed | Staged progressive disk writing, WebCodecs MP4/WebM encoding, post-render container validation. |
| **Phase 9: Professional NLE Workspace & Direct Canvas** | ✅ Completed | Resizable layout (`react-resizable-panels`), direct Program canvas manipulation (bounding box, corner scale & rotation handles, center snap guides, 9:16 safe margins, inline text editing), 5-tier local ASR catalog (`lite`, `fast-en`, `balanced`, `high`, `pro`) with WebGPU hardware gating, audio fade ramps & handles, caption trimming, and Radix context menu & inspector controls. |
| **Phase 10: Color Adjustments & Deterministic Audio Ducking** | ✅ Completed | 6 color presets (`none`, `vivid`, `warm`, `cool`, `bw`, `cinematic`), Canvas 2D filter generation, temperature tint overlay, track audio roles (`dialogue`, `music`, `sfx`, `general`), deterministic dialogue interval harvesting, sample-accurate attack/release audio ducking ramps (-30 to -3 dB), with exact 1:1 preview and export parity. |
| **Phase 11: Future Architectural Enhancements** | 📋 Planned | Offload export compositing to dedicated Web Workers, configure COOP/COEP headers for multi-threaded WASM, add Playwright browser test harness. |
