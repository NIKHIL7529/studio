# Content Studio — Product Definition and Technical Direction

## 1. Product Overview

**Product name:** Content Studio  
**Product category:** Browser-based, local-first video editor and repurposing workspace  
**Initial platform:** Desktop web browsers  
**Initial audience:** Individual video creators, content creators, educators, podcasters and people who regularly convert long-form videos into short-form content.

### Product Vision

Content Studio is an open-source, browser-based video editing and repurposing application that allows users to import their own videos, organize projects, edit timelines, create short-form videos and export finished content directly on their computers.

The application should provide a capable video-editing experience without requiring users to install FFmpeg, download separate desktop software, create accounts, upload their source videos or depend on cloud processing infrastructure.

Video processing should happen locally inside the browser using modern browser media technologies and suitable open-source libraries.

The user should be able to open the website, select a local workspace folder, create a project, import existing videos, edit them, save project versions and export completed videos to their computer.

The application should prioritize:

- Local-first processing and storage.
- User privacy and complete control over media files.
- Fast and accessible video editing.
- Low memory consumption and efficient resource utilization.
- Minimal dependencies and infrastructure.
- A clean and intuitive editor interface.
- Open-source development and extensibility.

Content Studio should combine the usability of a modern video editor with specialized workflows for repurposing existing content into multiple short-form videos.

It should not initially be an AI product, chat application, cloud SaaS or autonomous-agent system.

---

## 2. Product Principles

### 2.1 Local-first architecture

Original videos, project data, editing decisions, intermediate assets and generated outputs should remain on the user's computer.

No original video should be uploaded to an external server.

No cloud media storage or remote rendering infrastructure should be required.

The application should work without a backend, database, authentication provider or external API.

### 2.2 Browser-native experience

Content Studio should remain a website rather than requiring users to install a desktop application or media-processing executable.

The application should use browser-native capabilities wherever practical:

- WebCodecs for video and audio decoding/encoding.
- Web Workers for background processing.
- WebGPU where beneficial and supported.
- Canvas and OffscreenCanvas for frame rendering and visual operations.
- Web Audio API for audio analysis and processing.
- File System Access API for local folders and file operations.
- IndexedDB for browser-persistent metadata and filesystem handles.
- Origin Private File System (OPFS) only for bounded temporary storage when genuinely needed.

The application should not require users to install FFmpeg, Python, Node.js or any other development/runtime dependency.

### 2.3 User-controlled storage

The user should choose a local workspace folder.

Projects, editing configurations, project metadata, generation versions and important application-generated files should be stored inside this workspace.

Original media should be referenced from its existing location whenever possible instead of duplicated into application-managed storage.

Temporary files should be managed carefully and automatically cleaned when no longer required.

### 2.4 No unnecessary complexity

The product should remain focused on video editing and repurposing.

Avoid introducing infrastructure, external providers, services or libraries unless a concrete feature requires them.

Prefer reliable existing browser APIs and mature open-source libraries instead of developing custom replacements unnecessarily.

### 2.5 Genuine open source

Content Studio should be an independent open-source project.

Architectural ideas, publicly documented techniques, product patterns and technical learnings may be used as references from projects such as FreeCut, Remotion, OpenCut and other browser-based video editors.

Do not assume that using documented ideas requires copying their source code.

Do not copy third-party branding, proprietary assets or source code without complying with the applicable licences.

Maintain a clear inventory of third-party dependencies, assets, licences and attribution requirements.

---

## 3. Initial Product Scope

The initial product is a complete frontend-only application.

There should be no backend or server-side media processing.

### Included in the initial product

- Workspace creation and management.
- Project creation, opening, saving and deletion.
- Importing videos and audio files.
- Local media inspection and preview.
- Video timeline editing.
- Multiple media sources.
- Trimming and splitting.
- Clip arrangement and sequencing.
- Audio handling.
- Basic visual transformations.
- Aspect ratio and output resolution configuration.
- Text and caption overlays.
- Local video rendering and export.
- Project version history.
- Persistent project storage.
- Temporary cache management.
- Media relinking and missing-file recovery.
- Basic editing and repurposing workflows.

### Explicitly excluded initially

- AI-based clip selection.
- LLM-based editing.
- AI transcription services.
- AI-generated captions.
- Cloud-based media processing.
- Backend APIs.
- User authentication and signup.
- Supabase or another database.
- Cloudflare R2 or other cloud media storage.
- Razorpay or payment integration.
- Subscriptions, billing or credit systems.
- Teams, organizations or collaboration.
- Cloud synchronization and backup.
- Desktop installers.
- FFmpeg or FFmpeg.wasm as a required processing engine.

AI and online integrations may be considered as a future optional extension, but they must not be implemented as part of the initial product.

---

## 4. Main User Workflow

### Step 1: Open Content Studio

The user visits the Content Studio website using a supported desktop browser.

The application should initialize the editor and check available browser capabilities.

Do not require signup, login, account creation or user onboarding involving external services.

### Step 2: Select a workspace

The user chooses an existing local folder or creates/selects a folder that Content Studio will use as its workspace.

The browser requests the necessary filesystem permissions.

The workspace becomes the durable location for project data and application-managed assets.

The application should remember the selected workspace where browser permissions allow it, and handle permission renewal when required.

### Step 3: Create or open a project

The user can create a new video project or open an existing project from the workspace.

Every project should have:

- A project identifier.
- Project name.
- Creation and last-modified timestamps.
- Media source manifest.
- Project configuration.
- Timeline and editing data.
- Project generation/version history.
- References to source files.
- Application-generated asset and cache references.

Project files should use a documented, stable format such as JSON where appropriate.

### Step 4: Import media

The user imports one or multiple video or audio files.

Original files should remain at their existing locations.

Where possible, store persistent file references using File System Access API handles rather than copying original media into the project.

The application should inspect files locally and collect supported metadata.

If a source file is moved, deleted or becomes inaccessible, provide an explicit relinking workflow.

### Step 5: Edit videos

The user can preview source media and create/edit timelines.

The editor should provide familiar video-editing interactions such as:

- Timeline tracks.
- Clip placement and reordering.
- Trimming.
- Splitting.
- Removing clips.
- Moving clips.
- Audio tracks.
- Text and captions.
- Aspect ratio controls.
- Preview playback.
- Timeline zoom and navigation.
- Undo and redo.
- Save and restore.

The editor should remain responsive during background processing.

### Step 6: Configure output

Allow users to configure supported export settings.

Potential settings:

- Output aspect ratio.
- Resolution.
- Frame rate.
- Container.
- Video codec.
- Audio codec.
- Output quality.
- Output filename.

All available controls must reflect capabilities supported by the actual browser and media engine.

Do not expose settings that cannot be generated reliably.

Do not silently force unsupported formats or codecs.

### Step 7: Export

The application should render videos locally.

Use streaming or progressive file output wherever possible to avoid storing entire rendered files in JavaScript memory.

Allow the user to save outputs to a chosen local folder.

Provide a normal browser download fallback where direct filesystem writing is unavailable.

### Step 8: Reopen projects and manage versions

Users should be able to close the website, return later and reopen saved projects.

Previous generation versions and completed outputs should remain available unless explicitly deleted by the user.

Editing an existing version should not silently overwrite earlier completed outputs.

---

## 5. Local Workspace and Storage Architecture

The user's selected workspace folder should be the durable source of truth.

Do not make OPFS the primary storage location for all original videos.

### Storage responsibilities

**Original source media**

- Remain at their original locations.
- Do not duplicate large source files unnecessarily.
- Store references and metadata in the project manifest.
- Detect missing or inaccessible sources.
- Allow the user to relink files.

**Project data**

Store in the selected workspace.

This includes:

- Project metadata.
- Source manifests.
- Timeline data.
- Editing configurations.
- Edit decision lists.
- Project versions.
- Generation records.
- Export metadata.

**Derived assets**

Where appropriate, store:

- Thumbnails.
- Waveforms.
- Low-resolution preview proxies.
- Scene-detection metadata.
- Temporary analysis output.
- Other regenerable assets.

**Temporary processing**

Use a bounded temporary storage strategy.

OPFS may be used for operations that require seekable temporary files or browser-managed scratch storage.

Do not copy every original video into OPFS.

Do not keep unnecessary duplicate copies of media or rendered outputs.

### Example workspace structure

The following is an illustrative structure, not a mandatory directory naming convention.

    Content Studio Workspace/
    |
    +-- projects/
    |   |
    |   +-- project-001/
    |   |   |
    |   |   +-- project.json
    |   |   +-- source-manifest.json
    |   |   |
    |   |   +-- timeline/
    |   |   |   +-- timeline.json
    |   |   |
    |   |   +-- generations/
    |   |   |   |
    |   |   |   +-- generation-001/
    |   |   |   |   +-- settings.json
    |   |   |   |   +-- edit-plan.json
    |   |   |   |   +-- outputs/
    |   |   |   |
    |   |   |   +-- generation-002/
    |   |   |
    |   |   +-- assets/
    |   |   |
    |   |   +-- cache/
    |   |
    |   +-- project-002/
    |
    +-- shared-assets/
    |
    +-- trash/

The exact structure should follow the actual workspace implementation and avoid unnecessary folder creation.

### Cache management

Cache files are disposable when their source data and configuration can reproduce them.

Implement:

- Identification of generated cache files.
- Cache size tracking.
- Cleanup of unused cache files.
- Orphaned asset detection.
- Cleanup after cancelled or failed rendering.
- Safe cleanup on project deletion.
- Recovery from interrupted writes where practical.

Never automatically delete:

- Original source media.
- User-authored project data.
- Saved edit plans.
- Completed outputs.
- User-created assets that have not been classified as disposable.

Cache cleanup must be conservative and safe.

---

## 6. Media Processing Architecture

### Primary media technology

The intended primary media technology stack is:

- Mediabunny.
- WebCodecs.
- Web Workers.
- OffscreenCanvas.
- Web Audio API.
- WebGPU when useful and supported.

The architecture should use established libraries for container parsing, demuxing, muxing, media inspection and writing.

Do not reproduce complex media-container or codec implementations unnecessarily.

### Mediabunny

Mediabunny should be evaluated for:

- Reading media files.
- Extracting track information.
- Inspecting duration and dimensions.
- Audio and video track handling.
- Media decoding integration.
- Media muxing.
- Format conversion where supported.
- Writing generated media.
- Progressive output writing.

### WebCodecs

Use WebCodecs for:

- Video decoding.
- Video encoding.
- Audio decoding.
- Audio encoding.
- Frame processing.
- Hardware acceleration where supported.

Use capability detection before selecting a codec or output profile.

### Workers

Use dedicated workers for CPU-intensive processing.

Potential responsibilities:

- Metadata inspection.
- Thumbnail generation.
- Waveform generation.
- Frame sampling.
- Scene-boundary analysis.
- Audio analysis.
- Media processing.
- Encoding and export.
- Cache operations.

Do not perform long-running media processing on the main UI thread.

### WebGPU

WebGPU may be used for suitable image processing, compositing and effects.

It should be optional and capability-detected.

The application must retain a usable fallback path for environments without WebGPU.

### Avoid unnecessary FFmpeg dependencies

Do not require users to install FFmpeg.

Do not install native FFmpeg as a prerequisite.

Do not assume FFmpeg is available on the user's machine.

Do not make FFmpeg.wasm the primary rendering engine without a concrete performance and capability justification.

Browser-native technologies and Mediabunny should be investigated first.

---

## 7. Video Editor Functionality

Content Studio should evolve into a capable browser-based video editor rather than only a single-purpose clip generator.

### Media library

- Import video and audio assets.
- Show imported media in a project library.
- Display thumbnails.
- Show duration and other useful media information.
- Preview media.
- Relink missing files.
- Remove assets from a project without deleting original source files.

### Timeline

- Multiple video and audio tracks where supported by the architecture.
- Timeline zoom.
- Clip trimming.
- Clip splitting.
- Clip deletion.
- Clip reordering.
- Clip movement between tracks.
- Timeline selection.
- Snapping and basic alignment.
- Audio waveform visualization.
- Playback position and scrubbing.
- Undo and redo.

### Preview

- Responsive playback preview.
- Playback controls.
- Play/pause.
- Timeline seeking.
- Aspect ratio preview.
- Text overlays.
- Caption preview.
- Crop and positioning preview.

### Text and captions

- Add text overlays.
- Configure text position.
- Configure font, size and colour.
- Configure background and outline.
- Control start and end timing.
- Add multiple text segments.
- Preview captions.
- Burn captions into exported videos.

Speech-to-text and AI caption generation are excluded from the initial release.

### Audio

- Import audio files.
- Add audio tracks.
- Trim audio.
- Adjust volume.
- Mute tracks.
- Basic fades where supported.
- Preserve audio/video synchronization.
- Support multiple audio sources where practical.

### Export

Initially target reliable MP4 output with H.264 video and AAC audio, subject to browser capability.

Other formats and codecs should be enabled only after compatibility and output validation.

Possible export configurations should include:

- 9:16.
- 16:9.
- 1:1.
- 4:5.

Resolution and frame-rate choices must reflect actual encoding support.

Do not promise that all aspect-ratio, resolution and codec combinations work on all computers.

---

## 8. AI Repurposing Features — Future Scope Only

AI must not be included in the initial application.

The future product direction is to combine the conventional editor with automated short-form repurposing.

Potential future features include:

- Automatic candidate discovery.
- Transcript-based clip discovery.
- Educational clip selection.
- Highlight detection.
- Podcast/interview clip extraction.
- Duplicate and near-duplicate suppression.
- Duration-aware clip selection.
- Sequence construction.
- Automatic caption generation.
- Natural-language editing instructions.

The existing product concept has three initial editorial objectives:

- Educational.
- Highlights.
- Podcast/interview.

These are potential future repurposing workflows, not initial AI implementations.

The future implementation may use deterministic local algorithms, external AI services or a hybrid approach depending on measured requirements.

Do not build APIs, provider abstractions, model clients, AI configuration screens or credit systems until this future requirement is explicitly approved.

### Future privacy principle

If online AI capabilities are eventually added:

- Send only data necessary for the specific operation.
- Prefer transcript text and compact metadata where sufficient.
- Send bounded audio excerpts where audio understanding is required.
- Send selected frames where visual understanding is required.
- Never upload complete source videos merely because an AI provider offers a video endpoint.
- Make external data transfers transparent and user-controlled.

---

## 9. Frontend and Application Architecture

### Initial technology stack

- Next.js.
- React.
- TypeScript.
- Tailwind CSS.
- App Router.
- ESLint.
- Mediabunny.
- WebCodecs.
- Web Workers.
- IndexedDB.
- File System Access API.
- Optional OPFS.
- Optional WebGPU.
- Web Audio API.

Only add libraries when their capabilities justify their dependency and maintenance costs.

### Application structure

The product should have clear separation between:

- Application layout and navigation.
- Workspace management.
- Project management.
- Media library.
- Timeline editor.
- Preview renderer.
- Media processing services.
- Export pipeline.
- Local persistence.
- Cache management.
- Shared UI components.

Avoid putting the entire application into a single large component.

Use TypeScript types for persisted project documents, timeline records, media references, render settings and processing state.

Keep media engine code separate from React presentation code.

### Local-only operation

The initial application should be capable of running without a server-side runtime.

Aim for static hosting compatibility.

Do not introduce Next.js server actions, API routes, server-side databases or cloud-dependent page rendering for local editor functionality.

The hosted website should primarily serve the application files. Actual editing and media processing should happen in the browser.

---

## 10. UI and UX Direction

The application should feel like a polished, modern desktop video-editing tool.

Take inspiration from:

- FreeCut for browser-native media editing, local workspaces and storage architecture.
- Remotion for programmatic video composition and rendering concepts.
- OpenCut for interface and editing interaction ideas.
- Other established video editors for timeline, preview, media organization and familiar editing patterns.

These projects are learning references, not source-code templates to copy.

### Main application areas

1. Workspace/project home.
2. Project creation and opening.
3. Media library.
4. Main editing workspace.
5. Timeline.
6. Preview panel.
7. Export configuration and progress.
8. Project and cache management.
9. Application settings and browser capability information.

### UX principles

- Desktop-first design.
- Clean interface without unnecessary decoration.
- Efficient use of available screen space.
- Familiar editing interactions.
- Keyboard shortcuts where useful.
- Clear processing and export progress.
- Useful empty states.
- Clear error and recovery messages.
- No unnecessary modal dialogs.
- Avoid overwhelming users with technical details.
- Hide implementation-specific information unless it helps troubleshoot a real problem.

Do not display raw codec internals, file handles, technical browser details or debugging information in the regular editing workflow.

---

## 11. Browser Compatibility

Initial development should prioritize modern desktop Chromium browsers, particularly current Chrome and Edge.

Important capabilities must be checked at runtime:

- File System Access API.
- WebCodecs.
- Supported decoders.
- Supported encoders.
- Audio codec availability.
- WebGPU.
- OffscreenCanvas.
- OPFS.
- Available storage.
- Relevant file permissions.

The application must not assume every browser or device supports every codec.

Build clear capability checks and explain missing functionality to users.

Provide a standard file-input and browser-download fallback where feasible, while clearly indicating that some project-folder capabilities may be limited.

Do not require users to change complicated browser security flags or manually configure development headers.

---

## 12. Performance and Resource Management

Performance is a core product requirement.

The application should be designed for ordinary creator laptops, not exclusively high-end editing workstations.

Consider:

- Limited RAM.
- Integrated GPUs.
- Hardware encoder availability.
- Long source videos.
- Large output files.
- Variable frame rate.
- Multiple imported assets.
- Browser memory limits.
- Disk space limitations.
- Background-tab throttling.
- Browser crashes and interrupted processing.

### Resource rules

- Avoid reading entire source videos into JavaScript memory.
- Prefer streamed media access and processing.
- Use workers for long-running operations.
- Avoid retaining decoded frames unnecessarily.
- Reuse thumbnails and waveform data when safe.
- Use bounded concurrency.
- Clean up decoder, encoder, frame and audio resources.
- Close unused streams and writable file handles.
- Release memory when switching projects.
- Avoid simultaneously processing every imported video.
- Check storage availability where possible.
- Provide cancellation for long-running operations.
- Do not delete user data during recovery or cleanup.

### Long-running operations

Browser processing depends on the browser session and the device remaining active.

The application must account for:

- Refreshes.
- Closing the tab.
- Browser crashes.
- Sleep and shutdown.
- Revoked directory permission.
- Interrupted exports.

Use persisted project state and recoverable processing steps where practical.

Do not claim that rendering will continue after the user closes the browser.

---

## 13. Reliability and Data Safety

Project data must not become corrupted if a browser session or render operation fails.

Use safe save operations and temporary files for important project updates.

Where practical:

- Write new project documents to temporary paths before replacing the active document.
- Retain previous valid project metadata until an update is safely saved.
- Maintain project versions.
- Detect incomplete exports.
- Never expose partially rendered outputs as completed.
- Recover or clean failed temporary exports.
- Keep original source media untouched.
- Avoid deleting source files when removing project references.

Use clear confirmation before permanent deletion.

The user must remain in control of project deletion and original-file deletion.

---

## 14. Privacy and Security

The application should have a privacy-first default.

- No source-video uploads.
- No account creation.
- No tracking that collects media content.
- No transmission of local media metadata to external services without a specific need and user consent.
- No remote rendering.
- No cloud backups.
- No third-party media analytics.
- No API keys or server secrets in frontend code.
- No unnecessary access to local folders.
- Request only the filesystem permissions needed for the selected operation.

Any future online capability must introduce its own explicit privacy and security review.

---

## 15. Open-Source Project Direction

Content Studio is intended to be a separate, independent open-source project.

The project should have:

- Its own Git repository.
- Its own README.
- Its own product specification.
- Its own development guidelines.
- Its own licence.
- Third-party notices.
- Clear contribution guidelines.
- Documented browser and media compatibility.
- Reproducible dependency installation.
- No secret configuration.

The final open-source licence should be selected before public release. MIT or Apache 2.0 are possible choices for original code, subject to third-party licence compatibility.

---

## 16. Development and Validation Principles

Development should proceed incrementally.

Do not attempt to implement the entire editor, media pipeline and project storage system simultaneously.

Prioritize working functionality over an elaborate architecture.

Before adding a dependency, understand:

- What problem it solves.
- Whether browser-native functionality already exists.
- Its licence.
- Bundle size.
- Runtime and memory requirements.
- Browser support.
- Maintenance activity.
- Whether it is appropriate for commercial use.

Use actual sample videos during development.

Validate generated media by inspecting metadata and playing the results.

Test supported inputs, unsupported codecs, large files, multiple source files, variable frame rates, interrupted exports and missing source media.

Run locally available tests, lint, typechecking and production builds. Do not rely on undocumented claims of media compatibility or benchmark performance.

Record unverified behaviour and known limitations.

---

## 17. Implementation Roadmap

### Phase 1 — Application foundation

- Establish Next.js project structure.
- Create the main layout.
- Build workspace home.
- Build the project creation and opening experience.
- Establish UI components and design system.
- Implement browser capability detection.

### Phase 2 — Workspace and local persistence

- Implement directory selection.
- Create and open project directories.
- Persist project manifests.
- Maintain references to source files.
- Implement project autosave.
- Implement relinking.
- Implement safe project deletion.

### Phase 3 — Media engine foundation

- Integrate Mediabunny.
- Integrate WebCodecs.
- Implement media inspection.
- Implement local playback.
- Implement timeline seeking.
- Test audio/video synchronization.
- Implement bounded background processing.

### Phase 4 — Editor functionality

- Build media library.
- Build timeline.
- Implement clip trimming and splitting.
- Implement clip movement and reordering.
- Implement audio tracks.
- Implement preview.
- Implement basic text overlays.
- Implement undo and redo.

### Phase 5 — Local rendering and export

- Implement render configuration.
- Implement cropping and resizing.
- Implement multi-clip rendering.
- Implement audio handling.
- Implement caption overlays.
- Write outputs progressively to disk.
- Implement output validation.
- Implement cancellation and recovery.

### Phase 6 — Project versions and cache management

- Implement generation snapshots.
- Maintain separate output versions.
- Implement cache tracking.
- Implement unused asset detection.
- Implement safe cache cleanup.
- Test project reopening and recovery.

### Phase 7 — Repurposing workflow without AI

- Introduce structured repurposing configuration.
- Implement deterministic frame-based scene detection.
- Implement local audio signal analysis.
- Implement manual or rule-based candidate selection.
- Implement edit-plan generation.
- Integrate generated sequences into the timeline.
- Allow manual refinement and export.

### Phase 8 — Performance and release readiness

- Test real source videos.
- Test large files.
- Test different codecs.
- Test different browsers.
- Measure memory and processing time.
- Improve resource management.
- Verify workspace persistence.
- Review licensing and third-party notices.
- Publish the initial open-source release.

### Future phase — Optional AI capabilities

Only after the local editor and rendering pipeline are stable, evaluate:

- Transcript generation.
- Semantic clip discovery.
- Objective-aware ranking.
- Automatic short-form selection.
- AI captions.
- Natural-language instructions.

Any future AI system must remain optional and must not make ordinary editing dependent on external APIs.

---

## 18. Definition of a Successful Initial Product

The initial Content Studio release should satisfy the following:

1. A user can visit the website without creating an account.
2. A user can choose a local workspace folder.
3. A user can create and reopen projects.
4. Original videos stay in their original locations.
5. Source files are not uploaded to cloud storage.
6. The application does not require a native FFmpeg installation.
7. A user can import and preview supported video files.
8. A user can edit multiple clips on a timeline.
9. A user can trim, split, arrange and combine clips.
10. A user can add text overlays and basic captions.
11. A user can configure supported output settings.
12. A user can render and export a valid video locally.
13. Export does not require the entire output to be retained in browser memory.
14. A user can reopen saved projects.
15. Earlier project generations and completed exports remain available.
16. Temporary assets are managed safely.
17. Project deletion does not delete the original source media.
18. The editor remains usable on ordinary desktop hardware.
19. The application runs without a backend or database.
20. The project can be hosted as a static website.

The product should be considered ready for its first public release only after these capabilities have been implemented and validated against real sample media on the supported browser/device matrix.

---

## 19. Final Product Direction

Content Studio should become a capable local-first video editor with an integrated video-repurposing workflow.

Its primary differentiator is the ability to create short-form video outputs from one or multiple local source videos while preserving user control over the editing process and keeping source media private.

The initial product is a fully client-side, no-account, no-backend, open-source application.

The media engine should be based primarily on Mediabunny and WebCodecs, with browser-native APIs used wherever practical.

The selected workspace folder should contain durable project data and completed exports. Original media should be referenced in place whenever possible. Browser-managed storage should be used selectively for temporary work and recoverable cache.

The application should begin with conventional editing and deterministic local processing. AI, online services, accounts and cloud features are future optional directions, not initial dependencies.

**The goal is to deliver a reliable, useful video editor that creators can open in their browser, use with their own media and export without installing software or uploading their videos anywhere.**
