# Content Studio

A browser-based, local-first video editor and repurposing workspace.

> **Phase 3 — Local media engine foundation.**  
> This release connects imported local media references to the application, inspects media files using Mediabunny, provides reliable native preview playback and seeking, and establishes safe resource handling and WebCodecs capability detection. Timeline editing and video export will arrive in later phases.

---

## What is Content Studio?

Content Studio lets you import your own videos, arrange clips on a timeline, add text overlays and export finished content — entirely in your browser, without uploading anything, creating an account or installing desktop software.

**Core principles:**

- **Local-first.** Your source videos, project data and exports stay on your computer. Nothing is uploaded.
- **Browser-native.** Processing uses WebCodecs, Web Workers, the File System Access API and related browser APIs. No FFmpeg installation required.
- **No account.** Open the site and start working. No sign-up, subscription or cloud dependency.
- **Open source.** An independent project with minimal dependencies and no proprietary infrastructure.

---

## Current state (Phase 3)

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
| Timeline editor | 🔜 Phase 4+ |
| Local rendering and export | 🔜 Phase 5+ |

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
