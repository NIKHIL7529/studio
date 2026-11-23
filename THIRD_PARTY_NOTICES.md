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

### Browser-Whisper
- **Package:** `browser-whisper`
- **Version:** `^2.0.0` (resolved: `2.0.0`)
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
