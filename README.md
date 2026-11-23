# Content Studio

A browser-based, local-first video editor and deterministic repurposing workspace.

> **Current Architecture Status**  
> Complete local-first, browser-native video editing and deterministic repurposing workspace. Features multi-track timeline editing, dual-monitor review (Source & Program), keyframing & motion presets, video transitions, multi-sequence workflows, offline in-browser speech-to-text (Whisper WebGPU/WASM), subtitle parsing, context-integrity repurposing, progressive streaming export, project revisions, workspace trash, and conservative cache lifecycle management.

---

## 1. What is Content Studio?

Content Studio lets creators import their own videos, inspect and edit footage across multi-track timelines, trim and split clips, apply transitions and keyframe animations, configure aspect ratios, generate word-accurate subtitles, and export completed videos — entirely in desktop web browsers, without uploading files to external servers, creating accounts, or installing desktop companion software.

### Core Principles
- **Local-first architecture:** Original source videos, project documents, edit decisions, revisions, and exported files remain entirely on the user's computer. No source video is ever uploaded.
- **Browser-native media engine:** Video decoding, audio mixing, frame compositing, and container multiplexing use WebCodecs, Mediabunny, HTMLMediaElement, and the File System Access API. No FFmpeg, FFmpeg.wasm, or native binaries are required.
- **Privacy-first & offline-ready:** Works without user authentication, databases, cloud storage, or external APIs. Zero network requests occur during normal editing and export.
- **Client-Side Speech-to-Text & Repurposing:** In-browser offline transcription powered by Whisper (via `browser-whisper` and `@huggingface/transformers`) executing locally through WebGPU or CPU WebAssembly. Candidate discovery and sequence assembly rely on 100% deterministic local signal analysis (audio dynamics, visual transitions, context integrity). No cloud AI services or external LLM APIs are involved.

---

## 2. Implemented Capabilities Baseline

| Area | Status | Implementation Details |
|---|---|---|
| **Startup & Capability Preflight** | ✅ Implemented | Non-intrusive runtime checks for File System Access, WebCodecs, Web Workers, Web Audio, IndexedDB, OffscreenCanvas, and WebGPU. Hard preflight blocks browsers lacking directory access. |
| **Workspace & Permissions** | ✅ Implemented | User-selected local folder via File System Access API. Handles stored in IndexedDB with re-authorization state machine (`not-selected`, `checking`, `granted`, `prompt-required`, `denied`, `unsupported`, `error`). |
| **Project Lifecycle** | ✅ Implemented | Safe creation, UUID-isolated storage (`projects/<id>/project.json`), renaming, listing with corruption resilience, soft deletion, and reversible trash recovery. |
| **Source Media References** | ✅ Implemented | Zero-copy referencing: handles stored in IndexedDB, referenced via opaque UUIDs. Original files are never duplicated into workspace, OPFS, or IndexedDB. |
| **Media Relinking & Fingerprints** | ✅ Implemented | Missing/offline source detection, bounded SHA-256 head/tail fingerprinting, metadata change warnings, and automated re-inspection upon relinking. |
| **Dual-Monitor Editing** | ✅ Implemented | Professional two-up monitor architecture: Source Monitor (`SourceMonitor.tsx`) for inspecting assets and setting In/Out markers, paired with Program Monitor (`TimelinePreview.tsx`) for timeline playback. |
| **Multi-track Timeline Editor** | ✅ Implemented | Multi-track video and audio tracks, clip trimming (`sourceIn`/`sourceOut`), split at playhead (`S`), clip drag-and-drop, magnet snapping, zoom (20–500 px/s), and bounded undo/redo (50 states). |
| **Keyframes & Motion Presets** | ✅ Implemented | Parameterized keyframe engine (`src/lib/animation/animationPresets.ts`) supporting position, scale, rotation, opacity, and volume across linear, ease-in, ease-out, ease-in-out, and hold curves. Pre-built motion presets (zoom, pan, shake, Ken Burns, typewriter reveal). |
| **Video Transitions** | ✅ Implemented | Built-in transitions catalog and canvas renderers (`src/lib/transitions/`) for cross dissolves, fade to/from black, fade to/from white, dip to black/white, directional wipes (left/right/up/down), and slides with duration and easing controls. |
| **Multi-Sequence Management** | ✅ Implemented | Manage multiple sequences per project (`SequenceSelector.tsx`, `sequenceManager.ts`), each with independent resolutions, aspect ratios, and frame rates. |
| **Composition Evaluator** | ✅ Implemented | Unified deterministic composition evaluator (`src/lib/composition/evaluator.ts`) reconciling tracks, keyframes, transitions, overlays, audio levels, and karaoke captions with identical preview and export results. |
| **Text & Caption Overlays** | ✅ Implemented | Positionable, styled text overlays and timed short-form captions with line-wrapping, bounding background pills, stroke outlines, and 1:1 preview/export parity. |
| **Local Speech-to-Text (ASR)** | ✅ Implemented | Offline client-side transcription via Whisper (`src/lib/transcription/engine.ts`) running on WebGPU / WebAssembly with word-level timestamp support and automatic CPU fallback. |
| **Content-Aware Repurposing** | ✅ Implemented | Local SRT/VTT parsing, 100% full-duration coverage, content-derived excerpt lengths, multi-moment selection from single sources, 5 context integrity dimensions (speech boundary, thought completeness, context sufficiency, standalone clarity, ending closure), and automated caption generation. |
| **Local Rendering Pipeline** | ✅ Implemented | Pure integer microsecond render planning, frame-by-frame canvas compositing, 1-second bounded chunk audio mixing, backpressure-controlled WebCodecs encoding, and staged progressive writing. |
| **Export Formats & Validation** | ✅ Implemented | MP4 (H.264 + AAC) default, WebM (VP9 + Opus) supported fallback. Post-render Mediabunny container and track validation. In-app export preview player for direct playback of completed files. |
| **Revisions & Output History** | ✅ Implemented | Bounded project snapshots (50 revisions), pre-restore safety checkpoints, export history persistence, and disk status verification. |
| **Cache & Trash Management** | ✅ Implemented | Categorized cache inventory, active resource locking, safe dry-run cleanup, and reversible project trash. |

---

## 3. Supported Browsers and System Requirements

### Recommended & Tested Baseline
- **Google Chrome** (version 120+ on desktop: Windows, macOS, Linux).
- **Microsoft Edge** (version 120+ on desktop: Windows, macOS, Linux).

### Browser Compatibility Matrix

| Capability | Chrome / Edge (Desktop) | Firefox (Desktop) | Safari (macOS) | Mobile Browsers |
|---|---|---|---|---|
| **File System Access API (showDirectoryPicker)** | ✅ Full Support | ❌ Not Supported | ❌ Not Supported | ❌ Not Supported |
| **WebCodecs (VideoEncoder / AudioEncoder)** | ✅ Full Support | ⚠️ Partial / Flag | ⚠️ Partial / Flag | ⚠️ Inconsistent |
| **Writable File Streams on Handles** | ✅ Full Support | ❌ Not Supported | ❌ Not Supported | ❌ Not Supported |
| **Web Workers & OffscreenCanvas** | ✅ Full Support | ⚠️ Partial | ⚠️ Partial | ⚠️ Memory Limited |
| **WebGPU (Hardware ASR Acceleration)** | ✅ Supported | ⚠️ Flag / Nightly | ⚠️ Safari Tech Preview | ❌ Unsupported |
| **Overall Operational Status** | **Supported** | **Hard Blocked** | **Hard Blocked** | **Hard Blocked** |

> [!IMPORTANT]
> **Browser Support & Startup Gating:**  
> Non-Chromium desktop browsers (Firefox and Safari) and mobile browsers lack the File System Access API directory picker (`showDirectoryPicker`) and direct file stream writing (`FileSystemWritableFileStream`). Because Content Studio uses the user's local disk folder as its persistent source of truth, browsers lacking `showDirectoryPicker` are hard-blocked at startup with a compatibility notice. There is no degraded session mode or temporary in-memory project session. The memory-buffered writer (`createMemoryFallbackWriter`) in `progressiveWriter.ts` serves solely as a low-level writer fallback if a handle lacks `.createWritable()` or during headless testing.

---

## 4. Getting Started Locally

### Prerequisites
- [Node.js](https://nodejs.org) (v20.x or v24.x LTS recommended).

### Installation & Scripts
```bash
# Clone the repository
git clone https://github.com/NIKHIL7529/studio.git
cd studio

# Install dependencies and apply local package patches
npm install

# Run the development server
npm run dev

# Run all unit, integration, and media matrix tests
npm test

# Run TypeScript typechecking without emitting files
npm run typecheck

# Run ESLint across source and test files
npm run lint

# Create an optimized production build
npm run build
```

### Testing Strategy & Node vs. Browser Test Coverage
- **Unit & Architectural Tests:** The repository includes 42 automated test suites in `test/*.test.ts` running via Node's native test runner (`node --experimental-strip-types --test test/*.test.ts`). These suites rigorously test pure mathematical and architectural invariants: timecode precision, keyframe interpolation, transition curves, candidate discovery, context integrity scoring, composition evaluation, cache management, and format verification.
- **Synthetic Fixtures:** File format and container inspection tests utilize synthetic in-memory fixtures (standard RIFF/WAV headers and ISOBMFF MP4 boxes) rather than bundled external video files.
- **Browser & Hardware E2E:** Browser-specific APIs (`WebCodecs` hardware acceleration, `FileSystemDirectoryHandle`, WebGPU Whisper inference, and IndexedDB handle persistence) are validated through manual end-to-end testing in desktop Chrome and Edge. No Playwright or Cypress browser runners are currently integrated.

---

## 5. Local Workspace & Storage Architecture

### Workspace Directory Layout
When you select a local workspace directory, Content Studio operates strictly within its designated application folders:

```
<Workspace Folder>/
├── projects/
│   └── <project-uuid>/
│       ├── project.json              # Canonical project document (Schema 1)
│       ├── revisions/                # Bounded snapshot checkpoints
│       │   └── revision-<timestamp>-<id>.json
│       ├── exports/                  # Completed and staged exports
│       │   ├── output-1080p.mp4
│       │   └── .tmp_<id>_<name>.mp4  # Temporary in-flight render staging
│       └── cache/                    # Disposable project-specific cache (waveforms, frames)
├── trash/                            # Soft-deleted projects (reversible)
│   └── <project-uuid>/
└── .cache/                           # Workspace-level transient cache
```

### Storage Principles & Whisper Model Cache
1. **Original source media:** Files remain untouched at their original paths on your computer. Content Studio persists browser filesystem references in IndexedDB; original media bytes are never copied into the workspace, OPFS, or IndexedDB.
2. **Project data:** `project.json` is the sole durable source of truth for your edits, tracks, clips, overlays, and export history.
3. **Reversible trash:** Moving a project to trash moves `projects/<id>` into `trash/<id>`. Trashed projects can be inspected and restored to active projects at any time.
4. **Conservative cache cleanup:** The built-in Cache Manager catalogs only application-generated derived files (`.tmp_*`, thumbnails, waveforms, candidate cache) within the workspace directory. Durable project documents, completed exports, and original media are strictly protected.
5. **Whisper Model Storage Boundary:** Offline Whisper models (~120 MB for Whisper Tiny, ~206 MB for Whisper Base) downloaded via `browser-whisper` and `@huggingface/transformers` are stored in browser-managed origin storage (OPFS / CacheStorage). Users can view and manage speech models directly inside the Cache Manager dialog (`CacheManagerModal.tsx`) under the dedicated **"Speech Models — Browser Storage"** section, which provides manual per-model deletion and a global cache clear. Models are never deleted automatically.

---

## 6. Supported Media Formats & Codec Profiles

### Supported Input Containers & Codecs
- **Containers:** MP4, MOV, WebM, MKV, WAV, MP3, AAC/ADTS, OGG, FLAC.
- **Video Decoders:** H.264 (AVC), VP8, VP9, AV1 (subject to local browser/GPU support).
- **Audio Decoders:** AAC, Opus, MP3, Vorbis, FLAC, PCM Linear Audio.
- **Inspection capabilities:** Dimensions, display aspect ratios, rotation metadata (90°, 180°, 270° phone footage), variable-frame-rate detection (VFR content is never forced to an invented fixed rate), and channel counts.

### Supported Output Export Profiles
- **Aspect Ratios:** 16:9 (Landscape), 9:16 (Vertical / Shorts / Reels), 1:1 (Square), 4:5 (Portrait).
- **Resolution Presets:** 1080p (Full HD), 720p (HD), 540p (SD).
- **Frame Rates:** 30 fps (Standard), 60 fps (Smooth).
- **Default Format:** MP4 container with H.264 (`avc1.640028` / `avc1.4d002a`) video and AAC-LC (`mp4a.40.2`) audio at 48 kHz stereo.
- **Alternative Format:** WebM container with VP9 (`vp09.00.10.08`) video and Opus audio at 48 kHz stereo.
- **Output Streaming:** Uses `WorkspaceProgressiveWriter` for chunk-based streaming directly to the workspace folder.

---

## 7. Performance & Resource Boundaries

- **Execution Model:** Export rendering, canvas compositing, frame sampling, and audio analysis execute asynchronously on the main browser thread via WebCodecs and Mediabunny yield loops. Heavy machine-learning inference for Whisper ASR is offloaded to library-managed worker threads and WebGPU pipelines.
- **Streaming Input Access:** Media inspection and playback utilize browser `BlobSource` ranged reads. Complete multi-gigabyte video files are never loaded entirely into JavaScript RAM.
- **Frame & Encoder Resource Cleanup:** Every created `VideoFrame`, `AudioBuffer`, `CanvasSink`, `CanvasSource`, and `Input` instance is explicitly closed and disposed on completion, error, and cancellation.
- **Autosave Queue:** Project saves are debounced and queued (`ProjectSaveQueue`), ensuring atomic writes and preventing race conditions during rapid timeline editing.

---

## 8. Security & Privacy Review

- **Zero Network Transmission:** Content Studio does not make any network requests during application use. No telemetry, analytics, remote error reporting, external fonts, or cloud media services are loaded. (Model weights for Whisper are fetched from Hugging Face CDNs only upon explicit user request and cached locally).
- **No API Keys or Secrets:** The frontend bundle contains zero third-party API keys or remote service credentials.
- **Isolated Filesystem Permissions:** Directory and file permissions are scoped strictly to the workspace folder and media files explicitly chosen by the user through browser permission dialogs.
- **Sanitized Paths:** File paths, filenames, and project document IDs are strictly validated to prevent directory traversal (`..`) or invalid characters.

---

## 9. Third-Party Notices & Licenses

Content Studio is licensed as open-source software. All third-party libraries and their licenses are documented in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md):
- **Mediabunny** (`^1.66.0`) — Mozilla Public License 2.0 (MPL-2.0)
- **Browser-Whisper** (`^2.0.0`) — MIT License
- **@huggingface/transformers** (`^4.3.1`) — Apache License 2.0 (Apache-2.0)
- **Next.js** (`16.4.6`) — MIT License
- **React & React DOM** (`19.3.0`) — MIT License
- **Tailwind CSS** (`4.3.3`) — MIT License
- **TypeScript** (`^5`) — Apache-2.0
- **ESLint** (`^9`) — MIT License

---

## 10. Product Guidance & Future Scope

The comprehensive product definition and engineering principles are maintained in [`AGENTS.md`](./AGENTS.md).

### Explicitly Excluded (Future Scope Only)
- External cloud AI APIs (OpenAI, Anthropic, Gemini) and LLM-assisted chat editing.
- Remote cloud rendering, backend servers, and databases.
- User accounts, authentication, billing, or subscription systems.
- Native FFmpeg dependencies or desktop executables.
