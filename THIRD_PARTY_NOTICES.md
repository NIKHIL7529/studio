# Third-Party Notices & Dependency Licenses

Content Studio relies on open-source dependencies. Below is an inventory of packages utilized by the application, their licenses, and relevant notices.

---

## Runtime Dependencies

### Mediabunny
- **Package:** `mediabunny`
- **Version:** `^1.66.0` (resolved: `1.66.0`)
- **License:** Mozilla Public License 2.0 (MPL-2.0)
- **Repository:** https://github.com/Vanilagy/mediabunny
- **Website:** https://mediabunny.dev
- **Author:** Vanilagy
- **Usage:** Local-first container demuxing, metadata inspection, and streaming output writing. Content Studio uses Mediabunny as an unmodified external dependency. Under MPL-2.0 Section 3.3 ("Larger Works"), incorporating an unmodified MPL-2.0 library into a larger project does not require the surrounding project to be licensed under MPL-2.0.

### Next.js
- **Package:** `next`
- **Version:** `16.4.6`
- **License:** MIT License
- **Copyright:** (c) 2026 Vercel, Inc.
- **Repository:** https://github.com/vercel/next.js
- **Usage:** React frontend application framework and static page bundling.

### React & React DOM
- **Packages:** `react`, `react-dom`
- **Version:** `19.3.0`
- **License:** MIT License
- **Copyright:** (c) Meta Platforms, Inc. and affiliates.
- **Repository:** https://github.com/facebook/react
- **Usage:** User interface component library and DOM reconciliation.

### Zustand
- **Package:** `zustand`
- **Version:** `^5.1.0` (resolved: `5.1.0`)
- **License:** MIT License
- **Copyright:** (c) 2019 Paul Henschel
- **Repository:** https://github.com/pmndrs/zustand
- **Usage:** High-performance client-side state management isolating 60 fps timeline interaction state from durable document storage.

### React Resizable Panels
- **Package:** `react-resizable-panels`
- **Version:** `^4.24.1` (resolved: `4.24.1`)
- **License:** MIT License
- **Copyright:** (c) 2022 Brian Vaughn
- **Repository:** https://github.com/bvaughn/react-resizable-panels
- **Usage:** Resizable panel layouts for dual-monitor, timeline, and asset browser docking.

### Lucide React
- **Package:** `lucide-react`
- **Version:** `^1.77.0` (resolved: `1.77.0`)
- **License:** ISC License
- **Copyright:** (c) 2020-2026 Lucide Contributors
- **Repository:** https://github.com/lucide-icons/lucide
- **Usage:** Iconography across timeline controls, playback transport, track headers, and toolbars.

### Radix UI Primitives
- **Packages:**
  - `@radix-ui/react-slider` (resolved: `1.6.1`)
  - `@radix-ui/react-popover` (resolved: `1.3.1`)
  - `@radix-ui/react-dropdown-menu` (resolved: `2.2.1`)
  - `@radix-ui/react-tooltip` (resolved: `1.4.1`)
  - `@radix-ui/react-tabs` (resolved: `1.2.1`)
  - `@radix-ui/react-context-menu` (resolved: `2.4.1`)
  - `@radix-ui/react-switch` (resolved: `1.4.1`)
- **License:** MIT License
- **Copyright:** (c) 2022 WorkOS
- **Repository:** https://github.com/radix-ui/primitives
- **Usage:** Accessible unstyled UI components for context menus, timeline zoom sliders, tooltips, and tab panels.

### Browser-Whisper
- **Package:** `browser-whisper`
- **Version:** `2.0.0` (resolved: `2.0.0`)
- **License:** MIT License
- **Repository:** https://github.com/tanpreetjolly/browser-whisper
- **Website:** https://whisper.tanpreet.xyz
- **Author:** Tanpreet Singh Jolly
- **Usage:** In-browser offline speech-to-text transcription engine. Audio never leaves the user's computer.

### Transformers.js
- **Package:** `@huggingface/transformers` (transitive dependency of `browser-whisper`)
- **Version:** `^4.3.1` (resolved: `4.3.2`)
- **License:** Apache License 2.0 (Apache-2.0)
- **Copyright:** (c) 2026 Hugging Face, Inc.
- **Repository:** https://github.com/huggingface/transformers.js
- **Usage:** Browser-local machine learning inference running Whisper WebGPU and WebAssembly pipelines. Model weights are stored locally in browser OPFS/CacheStorage after explicit user authorization.

---

## Development Dependencies

### Tailwind CSS & Turbopack Plugin
- **Packages:** `tailwindcss`, `@tailwindcss/turbopack`
- **Version:** `4.3.3`
- **License:** MIT License
- **Copyright:** (c) Tailwind Labs, Inc.
- **Repository:** https://github.com/tailwindlabs/tailwindcss
- **Usage:** Utility-first CSS styling and build plugin.

### TypeScript
- **Package:** `typescript`
- **Version:** `^5` (resolved: `5.8.2`)
- **License:** Apache License 2.0 (Apache-2.0)
- **Copyright:** (c) Microsoft Corporation.
- **Repository:** https://github.com/microsoft/TypeScript
- **Usage:** Type definitions and compile-time type validation.

### ESLint & Next.js ESLint Configuration
- **Packages:** `eslint`, `eslint-config-next`
- **Version:** `^9` / `16.4.6`
- **License:** MIT License
- **Repository:** https://github.com/eslint/eslint
- **Usage:** Code style enforcement and static analysis.

### TypeScript Type Definitions
- **Packages:** `@types/node`, `@types/react`, `@types/react-dom`, `@types/dom-webcodecs`, `@types/dom-mediacapture-transform`
- **License:** MIT License
- **Repository:** https://github.com/DefinitelyTyped/DefinitelyTyped
- **Usage:** Ambient typing for standard Web, Node.js, and React APIs.

---

## Intellectual Property & Architectural References

As described in `AGENTS.md`, Content Studio is an independent open-source project. Ideas and patterns from established browser-based video editors serve as learning references for browser media pipelines and UX paradigms. No proprietary code, trademarks, or copyrighted assets have been copied.
