# Content Studio

A browser-based, local-first video editor and repurposing workspace.

> **Phase 5 — Local video rendering and export.**  
> This release implements the complete local export pipeline from the timeline to playable output files: deterministic render-plan generation, WebCodecs/Mediabunny composition and encoding, progressive disk streaming to the user's workspace, output validation, and project export history.

---

## What is Content Studio?

Content Studio lets you import your own videos, arrange clips on a timeline, add text overlays and export finished content — entirely in your browser, without uploading anything, creating an account or installing desktop software.

**Core principles:**

- **Local-first.** Your source videos, project data and exports stay on your computer. Nothing is uploaded.
- **Browser-native.** Processing uses WebCodecs, Web Workers, Mediabunny, Canvas and File System Access APIs. No FFmpeg or FFmpeg.wasm required.
- **No account.** Open the site and start working. No sign-up, subscription or cloud dependency.
- **Open source.** An independent project with minimal dependencies and no proprietary infrastructure.

---

## Current state (Phase 5)

| Area | Status |
|---|---|
| Application shell and navigation | ✅ Implemented (Phase 1) |
| Design system and UI components | ✅ Implemented (Phase 1) |
| Home / workspace entry screen | ✅ Implemented (Phase 1) |
| Browser capability detection | ✅ Implemented (Phase 1) |
| Workspace folder selection & persistence | ✅ Implemented (Phase 2) |
| Project creation, list, rename & deletion | ✅ Implemented (Phase 2) |
| Source file references & media library | ✅ Implemented (Phase 2) |
| Re-authorization & missing-file relinking | ✅ Implemented (Phase 2) |
| Autosave & write-failure recovery | ✅ Implemented (Phase 2) |
| Local media inspection via Mediabunny | ✅ Implemented (Phase 3) |
| Native video & audio preview and seek scrubbing | ✅ Implemented (Phase 3) |
| WebCodecs runtime capability checks & fallback | ✅ Implemented (Phase 3) |
| Resource cleanup & object URL lifecycle | ✅ Implemented (Phase 3) |
| Multi-track timeline, trimming, snapping & undo/redo | ✅ Implemented (Phase 4) |
| Text overlays and styled captions | ✅ Implemented (Phase 4) |
| Deterministic render-plan generation | ✅ Implemented (Phase 5) |
| Capability preflight & runtime encoder verification | ✅ Implemented (Phase 5) |
| Local rendering pipeline (Mediabunny + WebCodecs) | ✅ Implemented (Phase 5) |
| Progressive disk streaming to workspace | ✅ Implemented (Phase 5) |
| Local output validation & smoke testing | ✅ Implemented (Phase 5) |
| Export history persistence & cancellation safeguards | ✅ Implemented (Phase 5) |

---

## Phase 5 Local Rendering & Export Architecture

### 1. Deterministic Render Planning
- Pure function `buildRenderPlan()` creates an immutable execution snapshot from the timeline and project document.
- Uses integer microsecond arithmetic (`BigInt`) to prevent cumulative floating-point timing drift.
- Resolves top-to-bottom video track stacking, clip boundary trimming (`sourceIn`/`sourceOut`), timeline gaps (blank frames), audio volume/mute mixing, and text overlay styling/positioning.
- Pre-export validation checks that all referenced media sources exist, are accessible, and have valid handles before rendering begins.

### 2. Runtime Capability Preflight
- Uses `VideoEncoder.isConfigSupported()` and `AudioEncoder.isConfigSupported()` with exact codec parameters (`avc1.640028`, `mp4a.40.2`, `vp09.00.10.08`, `opus`).
- Does not guess or rely on user-agent sniffing.
- Default profile: **MP4 with H.264 video and AAC audio**. Supported fallback: **WebM with VP9 and Opus audio**.
- If a browser or hardware configuration cannot encode the requested settings, clear explanations are provided and the project remains intact.

### 3. Progressive Disk Writing
- `WorkspaceProgressiveWriter` writes chunks directly to `projects/<id>/exports/.tmp_<id>_<timestamp>_<name>` using `FileSystemWritableFileStream` and Mediabunny `StreamTarget`.
- Bounded memory usage: never buffers entire rendered videos in JavaScript memory.
- Safe staging: atomic promotion to the final destination upon successful completion and validation; immediate cleanup of incomplete files on abort or error.
- Non-destructive naming: automatically avoids overwriting existing exports by generating collision-free names (e.g., `video (1).mp4`).
- Memory fallback mode (capped at 500 MB) for environments where the File System Access API writable streams are unavailable.

### 4. Output Validation & Verification
- After writing is finalized, the resulting file is inspected locally using Mediabunny:
  - Container readability and non-zero file size.
  - Presence of expected video and audio tracks.
  - Codec verification (e.g. `avc` for MP4, `vp9` for WebM).
  - Dimension matching (within ±4px macroblock tolerance).
  - Duration verification (within ±0.5s tolerance).
  - Browser `<video>` element metadata smoke test.

### 5. Export History & Persistence
- Validated exports are registered in `project.json` under `exports: ProjectExport[]`, keeping `schemaVersion: 1` backwards compatibility.
- Users can view and download previous exports directly from the Export modal.

---

## Phase 3 Media Architecture

### Role of Mediabunny
[Mediabunny](https://mediabunny.dev/) (v1.66) is integrated as a local-first media parsing engine:
- Reads directly from local `File` / `Blob` sources via `BlobSource` with bounded internal buffering (8 MiB default).
- Never reads whole files into memory or converts them into `ArrayBuffer` / base64 strings.
- Inspects container formats, MIME types, duration, video tracks (coded & display dimensions, orientation, codecs, frame rate metrics), and audio tracks (channels, sample rate, codecs).
- Fully disposes parser instances (`input.dispose()`) immediately after inspection.

### Native Preview & Playback
- Local playback uses the browser's native `HTMLMediaElement` (`<video>` / `<audio>`) with object URLs created by `URL.createObjectURL()`.
- Supports play/pause, accurate seek scrubbing, duration, and volume/mute controls.
- Handles browser autoplay policy gracefully without throwing unhandled rejections.
- Object URLs are tracked by `ObjectUrlManager` and revoked immediately upon media replacement, project switching, or component unmount.

### WebCodecs Integration Boundary
- WebCodecs is treated as an optional capability. Basic native preview and container inspection function seamlessly even when WebCodecs is unavailable.
- `detectWebCodecsCapabilities()` inspects `VideoDecoder`, `VideoEncoder`, `AudioDecoder`, and `AudioEncoder` independently.
- `checkAssetDecoderSupport()` calls `isConfigSupported()` with concrete codec parameters to check hardware/software decoder support for inspected media.

### Storage & Security
- Original media files stay untouched at their original paths on disk.
- Only stable, serializable metadata is stored in `projects/<id>/project.json`.
- Missing or moved files are flagged with an explicit relinking workflow; relinking clears old metadata and triggers automatic re-inspection.

### Media Formats & Tested Capabilities
- **Verified via automated tests:** WAVE (.wav with PCM audio), 0-byte/empty files, corrupt/unsupported non-media data, and WebCodecs capability detection.
- **Inspected via Mediabunny:** MP4, MOV, WebM, MKV, WAVE, MP3, AAC/ADTS, OGG, FLAC.
- **Known unverified formats on all devices:** High-profile HEVC/H.265 (hardware decoder dependent), AV1 on older machines, ProRes, and multi-track Dolby Vision HDR profiles.

---

## Getting started

Requires [Node.js](https://nodejs.org) (v20 or later recommended).

```bash
# Start the development server
npm run dev

# Run unit tests
npm test

# Production build
npm run build

# Type checking
npx tsc --noEmit

# Lint
npm run lint
```

---

## Targeted browser capabilities

Content Studio currently targets **Chrome and Edge on desktop** (current stable versions).

The following APIs are used or detected at runtime:

| API | Purpose | Required |
|---|---|---|
| File System Access API | Workspace folder selection | Yes |
| WebCodecs | Video / audio decoding and encoding | Yes |
| Web Workers | Background media processing | Yes |
| Web Audio API | Audio analysis | Yes |
| IndexedDB | Persistent metadata storage | Yes |
| OffscreenCanvas | Off-thread frame rendering | Optional |
| Origin Private File System | Temporary cache storage | Optional |
| WebGPU | GPU-accelerated compositing | Optional |

The application includes a browser compatibility panel that checks and explains these capabilities at runtime. It does not assume any codec is available based solely on API presence — detailed codec support is verified in the media engine phase.

---

## Product and engineering guidance

The full product specification and engineering guidelines are in [`AGENTS.md`](./AGENTS.md). That document is the authoritative source; this README describes the current implementation state only.

---

## Licence

Licence to be confirmed before public release. MIT or Apache 2.0 are the likely choices for original code. Third-party dependency licences are listed in `node_modules` per package.
