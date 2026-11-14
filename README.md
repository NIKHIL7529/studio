# Content Studio

A browser-based, local-first video editor and deterministic repurposing workspace.

> **Release-Readiness Phase**  
> Complete local-first, browser-native video editing and deterministic repurposing workspace. Hardened across application startup, browser capability preflight, durable workspace persistence, source relinking, multi-track timeline editing, audio/text overlays, progressive streaming export, project revisions, workspace trash, and conservative cache lifecycle management.

---

## 1. What is Content Studio?

Content Studio lets creators import their own videos, organize multi-track timelines, trim and split clips, configure aspect ratios, overlay styled captions, and export completed videos — entirely in desktop web browsers, without uploading files to external servers, creating accounts, or installing desktop companion software.

### Core Principles
- **Local-first architecture:** Original source videos, project documents, edit decisions, revisions, and exported files remain entirely on the user's computer. No source video is ever uploaded.
- **Browser-native media engine:** Video decoding, audio mixing, frame compositing, and container multiplexing use WebCodecs, Mediabunny, Web Workers, HTMLMediaElement, and the File System Access API. No FFmpeg, FFmpeg.wasm, or native binaries are required.
- **Privacy-first & offline-ready:** Works without user authentication, databases, cloud storage, or external APIs. Zero network requests occur during normal editing and export.
- **Deterministic editing & repurposing:** Automated moment discovery and candidate scoring are 100% deterministic, transparent local algorithms based on visual dynamics, audio energy, and natural boundaries. No AI, LLMs, or cloud transcription services are included in this release.

---

## 2. Implemented Capabilities Baseline

| Area | Status | Implementation Details |
|---|---|---|
| **Startup & Capability Preflight** | ✅ Implemented | Non-intrusive runtime checks for File System Access, WebCodecs, Web Workers, Web Audio, IndexedDB, OffscreenCanvas, and WebGPU. Clear separation between core requirements and optional performance enhancements. |
| **Workspace & Permissions** | ✅ Implemented | User-selected local folder via File System Access API. Handles stored in IndexedDB with re-authorization state machine (`not-selected`, `checking`, `granted`, `prompt-required`, `denied`, `unsupported`, `error`). |
| **Project Lifecycle** | ✅ Implemented | Safe creation, UUID-isolated storage (`projects/<id>/project.json`), renaming, listing with corruption resilience, deletion, and reversible trash recovery. |
| **Source Media References** | ✅ Implemented | Zero-copy referencing: handles stored in IndexedDB, referenced via opaque UUIDs. Original files are never duplicated into workspace, OPFS, or IndexedDB. |
| **Media Relinking & Fingerprints** | ✅ Implemented | Missing/offline source detection, bounded SHA-256 head/tail fingerprinting, metadata change warnings, and automated re-inspection upon relinking. |
| **Media Inspection & Preview** | ✅ Implemented | Mediabunny stream inspection (container, tracks, dimensions, duration, orientation, CFR/VFR detection) and HTMLMediaElement native preview playback with strict object URL revocation. |
| **Multi-track Timeline Editor** | ✅ Implemented | Multi-track video and audio tracks, clip trimming (`sourceIn`/`sourceOut`), split at playhead (`S`), clip drag-and-drop, magnet snapping, zoom (20–500 px/s), and bounded undo/redo (50 states). |
| **Text & Caption Overlays** | ✅ Implemented | Positionable, styled text overlays with proportional canvas rendering and preview parity. |
| **Local Rendering Pipeline** | ✅ Implemented | Pure integer microsecond render planning, frame-by-frame canvas compositing, 1-second bounded chunk audio mixing, backpressure-controlled WebCodecs encoding, and staged progressive writing. |
| **Export Formats & Validation** | ✅ Implemented | MP4 (H.264 + AAC) default, WebM (VP9 + Opus) supported fallback. Post-render Mediabunny container and track validation. Safe cancellation cleans temporary files. |
| **Revisions & Output History** | ✅ Implemented | Bounded project snapshots (50 revisions), pre-restore safety checkpoints, export history persistence, and disk status verification. |
| **Cache & Trash Management** | ✅ Implemented | Categorized cache inventory, active resource locking, safe dry-run cleanup, and reversible project trash. |
| **Deterministic Repurposing** | ✅ Implemented | Local visual dynamics and audio signal analysis, candidate moment scoring, objective weighting (`highlights`, `educational`, `podcast`), sequence selection, and automated edit plan generation. |

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
| **Overall Status** | **Supported** | **Unsupported** | **Unsupported** | **Unsupported** |

> [!IMPORTANT]
> **Why Firefox and Safari are currently unsupported:**  
> Neither Mozilla Firefox nor Apple Safari supports the File System Access API directory picker (`showDirectoryPicker`) and direct file stream writing (`FileSystemWritableFileStream`). Without these, persistent local workspaces cannot be opened or written directly to disk. Content Studio requires desktop Chrome or Edge for the release baseline. If accessed in Firefox or Safari, the application displays a clear compatibility notice.

---

## 4. Getting Started Locally

### Prerequisites
- [Node.js](https://nodejs.org) (v20.x or v24.x LTS recommended).

### Installation & Scripts
```bash
# Clone the repository
git clone https://github.com/<owner>/studio.git
cd studio

# Install dependencies using the repository lockfile
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
│       │   ├── interview-1080p.mp4
│       │   └── .tmp_<id>_<name>.mp4  # Temporary in-flight render staging
│       └── cache/                    # Disposable project-specific cache
├── trash/                            # Soft-deleted projects (reversible)
│   └── <project-uuid>/
└── .cache/                           # Workspace-level transient cache
```

### Storage Principles
1. **Original source media:** Files remain untouched at their original paths on your computer. Content Studio persists browser filesystem references in IndexedDB; original media bytes are never copied into the workspace, OPFS, or IndexedDB.
2. **Project data:** `project.json` is the sole durable source of truth for your edits, tracks, clips, overlays, and export history.
3. **Reversible trash:** Moving a project to trash moves `projects/<id>` into `trash/<id>`. Trashed projects can be inspected and restored to active projects at any time.
4. **Conservative cache cleanup:** The built-in Cache Manager catalogs only application-generated derived files (`.tmp_*`, thumbnails, waveforms, candidate cache). Durable project documents, completed exports, and original media are strictly protected and can never be deleted by cache cleanup.
5. **In-use resource locking:** Active playback, preview rendering, and ongoing exports hold resource locks preventing background cache cleanup from pruning active files.

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
- **Output Streaming:** Uses `WorkspaceProgressiveWriter` for chunk-based streaming directly to the workspace folder. If handle writable streams are unavailable, falls back to a memory-buffered writer with direct browser file download.

---

## 7. Performance & Resource Boundaries

- **Streaming Input Access:** Media inspection and playback utilize browser `BlobSource` ranged reads. Complete multi-gigabyte video files are never loaded entirely into JavaScript RAM.
- **Frame & Encoder Resource Cleanup:** Every created `VideoFrame`, `AudioBuffer`, `CanvasSink`, `CanvasSource`, and `Input` instance is explicitly closed and disposed on completion, error, and cancellation.
- **Bounded Concurrency:** Worker concurrency and media inspection queues are bounded to prevent CPU thread starvation.
- **Autosave Queue:** Project saves are debounced and queued (`ProjectSaveQueue`), ensuring atomic writes and preventing race conditions during rapid timeline editing.

---

## 8. Security & Privacy Review

- **Zero Network Transmission:** Content Studio does not make any network requests during application use. No telemetry, analytics, remote error reporting, external fonts, or cloud media services are loaded.
- **No API Keys or Secrets:** The frontend bundle contains zero third-party API keys or remote service credentials.
- **Isolated Filesystem Permissions:** Directory and file permissions are scoped strictly to the workspace folder and media files explicitly chosen by the user through browser permission dialogs.
- **Sanitized Paths:** File paths, filenames, and project document IDs are strictly validated to prevent directory traversal (`..`) or invalid characters.

---

## 9. Third-Party Notices & Licenses

Content Studio is licensed as open-source software. All third-party libraries and their licenses are documented in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md):
- **Mediabunny** — MPL-2.0
- **Next.js** — MIT License
- **React & React DOM** — MIT License
- **Tailwind CSS** — MIT License
- **TypeScript** — Apache-2.0
- **ESLint** — MIT License

---

## 10. Product Guidance & Future Scope

The comprehensive product definition and engineering principles are maintained in [`AGENTS.md`](./AGENTS.md).

### Explicitly Excluded from This Release (Future Scope Only)
- External AI APIs and LLM-assisted editing.
- Cloud transcription and automatic speech-to-text.
- Remote cloud rendering, backend servers, and databases.
- User accounts, authentication, billing, or subscription systems.
- Native FFmpeg dependencies or desktop executables.
