# Motion Studio

Motion Studio is a browser-based, AI-assisted **image-to-motion graphics editor**. Gemini proposes a validated, subject-first motion plan; the local application evaluates keyframes and procedural motion, renders the scene on Canvas, exposes it on an editable timeline, and exports a video.

The original checkout contained configuration and a React entry point, but no `App`, renderer, timeline, state store, AI adapter, or export implementation. The current implementation fills in those missing modules while keeping the existing React, Zustand, Zod, Vite, and Canvas direction.

## Quick start

```bash
npm install
npm run dev
```

The development server binds to `0.0.0.0:5173`. Build and verification:

```bash
npm run type-check
npm run lint
npm test
npm run build
```

## Workflow

1. Upload PNG, JPG/JPEG, WebP, or SVG; drag and drop or paste an image with Ctrl/Cmd+V also works. SVG input is sanitized before it is decoded.
2. Choose an optional subject hint and canvas aspect ratio / fit mode.
3. Select **Generate Motion**. With an active Gemini configuration, the image is sent to Gemini Vision and a strict JSON `MotionPlan` is validated with Zod. Without Gemini, Motion Studio makes a deterministic local draft using the filename/category hint and image dimensions; it does **not** claim to have performed vision analysis.
4. Review the concept, subject layer, approximate mask status, keyframes, camera and supporting effects. Adjust strengths or submit a prompt to modify the existing plan.
5. Preview/scrub the timeline and choose duration, speed, aspect ratio, and FPS.
6. Export WebM where MediaRecorder supports it, or MP4/H.264 where WebCodecs supports the selected size and rate. Unsupported formats are disabled or fail with an explanation; MOV is not offered.

## Architecture

```text
React UI
  └─ Zustand editor state (image, validated plan, settings, undo/redo)
      ├─ Gemini Vision adapter → JSON only → strict Zod schema
      ├─ deterministic local plan builder
      ├─ procedural animation evaluator (time, keyframes, easing, speed)
      ├─ Canvas renderer (background plate, subject layers, masks, camera, effects)
      ├─ editable timeline (scrubbing, visibility, lock, draggable keyframes)
      ├─ IndexedDB autosave + key-free project/preset files
      └─ frame-stepped export (WebCodecs + MP4 muxer, MediaRecorder WebM fallback)
```

Important modules live under `apps/web/src/engine`, `services`, `store`, `components`, and `types`. `renderScene(scene, currentTime)` is shared by preview and export; no AI-generated JavaScript is evaluated.

## Gemini configuration and privacy

Add one or more user-owned Gemini API configurations in **Gemini**. Keys are masked in the list and stored only in browser local storage. A selected key is sent directly to Google over HTTPS; Motion Studio has no key-upload server and does not log the key. Multiple configurations are not automatically rotated to evade provider quotas. API keys are excluded from project files and presets.

Gemini responses must be valid JSON matching the versioned motion-plan schema. Malformed or invalid data is rejected; the editor falls back to a clearly labelled local plan rather than executing response text.

## Motion and mask limitations

Gemini analyzes the pixels for the main and secondary subjects, a stable background, and normalized regions that may move or must stay still. The validated plan gives the main subject its own layer, meaningful keyframes, and subject-specific motion. Camera, parallax, lighting, and particles are supporting controls and are off by default; the background layer has no motion by default.

Only a trusted high-confidence user mask or actual pixel-level segmentation can be rendered as an independently moving cut-out. Gemini boxes/ellipses/polygons are **seed prompts only**, never segmentation evidence. On supported browsers, the registered shared renderer lazily invokes MediaPipe's stateful `InteractiveSegmenter` for the primary planned subject, calls `setImage` once, and prompts `segment` with a positive-brush `Stroke`. It validates the returned confidence mask around the seed and derives tight bounds from mask pixels. If the mask is absent, ambiguous, oversized, unsupported, or the download/inference fails, the original source remains intact and the plan uses its restrained local-material fallback. Secondary subjects remain addressable by subject ID through the same provider interface, but are not segmented automatically yet.

The modern Stroke API's officially documented MagicTouch v2 int8 task is pinned at 30,525,312 bytes and uses a 768px model input. The smaller ~6.2MB MagicTouch v1 TFLite is not used: it is documented with the deprecated one-shot/ROI flow, and we do not guess at its compatibility with the modern Stroke API. No smaller model paired with the current stateful API was identified, so this build uses the official v2 task and falls back safely if it cannot initialize. The model/API combination is wired and type-checked against MediaPipe 1.0.1, but asset initialization and real-image inference still need browser validation. The provider downsizes input images to a 512px maximum edge, performs one local CPU inference during runtime preparation—not per animation frame—and downloads the model only on first use. The pinned 1.0.1 MediaPipe WASM runtime is also loaded on demand. First use therefore needs a network connection (about 30.5MB model plus roughly 12MB raw WASM before HTTP compression); no image is uploaded to the segmentation service. At most four one-byte-per-pixel masks are retained, each capped at a 768px edge (up to about 2.25MiB total); each runtime gets a fresh disposable bitmap, and the task unloads after an idle period. Segmentation is skipped when browser APIs are missing, reported memory is below 2GB, a single CPU thread is reported, or the browser signals 2G/Data Saver.

A trusted mask only moves when its bounds are under the renderer's safety limit and both the cut-out and a background cover are prepared successfully. That cover is a bounded, low-resolution edge-color diffusion patch—not generative inpainting—so it can look imperfect on detailed backgrounds. Thin features, touching subjects, large occluders, and inaccurate plan prompts may yield a poor mask; those results fail conservative sanity checks where detectable, but the model is not human-reviewed. Hidden surfaces are never reconstructed. The live preview reports whether pixel segmentation was prepared or whether the stable-background fallback is active.

## Export and duration

Default composition: **1920×1080, 8 seconds, 30 FPS**. Common duration choices are 5–30 seconds; supported FPS values are 24, 25, 30, 50, and 60. The frame count is `round(duration × FPS)` (for example, 8×30 = 240, 10×30 = 300, and 15×30 = 450). Export evaluates frames from index 0 through `totalFrames - 1` and uses the same renderer and motion time as preview.

MP4 uses WebCodecs H.264 and `mp4-muxer` where supported. WebM uses browser MediaRecorder with a controlled frame-stepped render at the selected FPS and duration. WebM timing is bounded by browser capture/recording behavior; its output is not silently renamed to another format. The export dialog shows frame progress and offers a video preview of the completed file.

## Project storage

Autosave uses IndexedDB when available. `.motion` project files include the image, scene plan, editable settings, and SEO fields, but never API keys. Presets are stored locally without API configurations or image data. Standard Undo/Redo covers plan and settings edits; animation sliders capture a gesture as one history action.

## Known limitations

- Segmentation assets are not bundled: first use downloads the pinned MediaPipe WASM runtime and the 30.5MB MagicTouch v2 int8 model. Offline, low-memory, or data-saving browsers keep the stable-background/local-material fallback. The modern model/API is wired and type-checked, but model initialization and mask quality have not yet been exercised in a browser.
- The model may merge nearby objects or miss thin details. Estimated-mask motion remains a local clipped material highlight, not independent object translation. The conservative background cover is edge-color diffusion and cannot recreate hidden texture.
- The offline fallback cannot semantically understand arbitrary pixels. It uses explicit user hints, filenames, and dimensions and clearly reports this limitation.
- MP4 depends on browser WebCodecs/H.264 support. WebM depends on MediaRecorder and a supported VP8/VP9 codec. MOV is unsupported.
- Canvas render resolution is bounded for preview and source processing to reduce memory pressure; 4K export is frame-by-frame and may be slow or unsupported on low-end devices.
- Audio tracks, cloud sync, and server-side accounts are not part of this browser editor.
