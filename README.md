# Content Studio

A browser-based, local-first video editor and repurposing workspace.

> **Phase 2 — Workspace and local persistence.**  
> This release provides local workspace folder selection, durable project document lifecycle (`project.json`), media source file references, IndexedDB handle persistence, relinking, and autosave. Video playback, timeline editing, and media rendering will arrive in later phases.

---

## What is Content Studio?

Content Studio lets you import your own videos, arrange clips on a timeline, add text overlays and export finished content — entirely in your browser, without uploading anything, creating an account or installing desktop software.

**Core principles:**

- **Local-first.** Your source videos, project data and exports stay on your computer. Nothing is uploaded.
- **Browser-native.** Processing uses WebCodecs, Web Workers, the File System Access API and related browser APIs. No FFmpeg installation required.
- **No account.** Open the site and start working. No sign-up, subscription or cloud dependency.
- **Open source.** An independent project with minimal dependencies and no proprietary infrastructure.

---

## Current state (Phase 2)

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
| Media engine & local decoding | 🔜 Phase 3 |
| Timeline editor | 🔜 Phase 4+ |
| Preview and playback | 🔜 Phase 4+ |
| Local rendering and export | 🔜 Phase 5+ |

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
