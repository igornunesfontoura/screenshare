# CLAUDE.md - Project Specification & AI Architecture Guide

## 1. Project Overview & Vision
**ScreenShare** is a high-performance, cross-platform (Windows & Linux) P2P screen sharing and movie watch-party application. It is designed to solve the common issues with mainstream apps like Discord (DRM black screens, low FPS/resolution limits, audio desync, and hardware acceleration locks).

### Primary Goals:
* **Native Desktop App:** Linux (AppImage/Debian/Flatpak) and Windows (MSI/Portable executable).
* **High Quality Video & Audio:** Up to 4K 60FPS support with direct WebRTC P2P stream, custom bitrate control, and HW acceleration (NVENC/VAAPI).
* **Bypass DRM Black-Screen Issues:** Built-in screen capture options (PipeWire on Linux, DXGI/WASAPI on Windows) to capture streaming services smoothly.
* **Synchronized Audio & Playback:** Native audio loopback capture (system sound + mic overlay) with low latency (<150ms).

---

## 2. Recommended Tech Stack

| Layer | Technology Choice | Rationale |
| :--- | :--- | :--- |
| **Framework** | **Electron** (via `electron-vite`) | Chromium ships full WebRTC, `getDisplayMedia` over PipeWire on Wayland, Windows system-audio loopback and NVENC/VAAPI encoding. Tauri v2 was tried first and dropped: WebKitGTK on Linux (e.g. Arch's `webkit2gtk-4.1`) is built without WebRTC — `RTCPeerConnection` is undefined even with `enable-webrtc` set. |
| **Frontend UI** | **React** / **Svelte** + **Tailwind CSS** + **Lucide Icons** | Fast, modern, responsive Dark Mode techwear UI. |
| **P2P Protocol** | **WebRTC** (Chromium's built-in stack in the renderer) | Direct P2P connection to minimize latency and avoid central relay server bandwidth bottlenecks. |
| **Signaling Server** | **Node.js WebSocket** (`ws`, in `server/`) | Simple light signaling server hosted on Render/Railway/Fly.io or self-hosted. |
| **Audio Capture** | **WASAPI (Windows)** / **PulseAudio/PipeWire (Linux)** | Low-level system audio loopback capture. |

---

## 3. Core Features Architecture

```
[ Host PC Screen & Audio ] 
        │
        ├──> (Windows DXGI / Linux PipeWire Screen Capture)
        ├──> (WASAPI / PipeWire Audio Loopback)
        │
 [ Hardware Video Encoder (NVENC / VAAPI / AV1 / H.264) ]
        │
        ├──> [ WebRTC P2P Direct Tunnel ] ───> [ Guest PC Renderer ]
```

### Key Modules:
1. **Screen & Audio Capturer:**
   - **Windows:** DXGI Desktop Duplication API + WASAPI System Loopback.
   - **Linux:** XDG Desktop Portal + PipeWire + PulseAudio Loopback.
2. **P2P Connection Manager:**
   - Signaling via WebSocket (Room creation using 6-digit codes or direct link).
   - STUN/TURN integration for NAT traversal (using free Google STUN or custom TURN server).
3. **Player & Remote UI:**
   - Picture-in-Picture mode.
   - Text chat and voice chat overlay with push-to-talk.
   - Video settings (Bitrate slider: 2 Mbps to 50 Mbps, FPS selector: 30/60 FPS, Resolution: 720p/1080p/4K).
4. **Synchronized Local File Streamer (Optional Watch Party mode):**
   - Stream local `.mp4` / `.mkv` files directly using WebRTC without re-encoding to preserve 100% video quality.

---

## 4. Development Commands & Workflow

Stack: **Electron + electron-vite + React + Vite**. Node 24.2+ is required (the signaling server runs `.ts` directly with Node's type stripping).

### Setup & Installation
```bash
npm install
npm --prefix server install
```

### Local Development
```bash
npm run signal   # signaling server on ws://localhost:8787
npm run dev      # Electron app with HMR (renderer console is mirrored to this terminal)
```

### Checks
```bash
npm run typecheck     # main/preload + renderer
npm run test:server   # signaling server tests (node:test)
```

### Build & Package (Cross-Platform)
```bash
npm run dist:linux   # AppImage + deb  → release/<version>/
npm run dist:win     # NSIS installer + portable .exe
```

### Capture notes (Phase 3, verified on Hyprland/PipeWire)
* **Video picker:** on Wayland `desktopCapturer.getSources` opens the xdg-desktop-portal picker and returns only the chosen source, so the app skips its own picker there (`src/main/media/capture.ts`). Windows/X11 use the in-app `SourcePicker`.
* **Linux system audio:** Chromium hides PulseAudio "Monitor of …" devices, so `src/main/media/linux-audio.ts` remaps the default sink monitor into a normal source with `pactl load-module module-remap-source` and unloads it on stop/quit (stale modules from crashes are cleaned on next start). Requires `pactl` (pipewire-pulse/libpulse). Windows uses `audio: "loopback"` from the display-media handler.
* **HW encoding:** H.264 is preferred via `setCodecPreferences`. On Linux, VAAPI encode only kicks in with `--enable-features=AcceleratedVideoEncoder,VaapiVideoEncoder` (set in `src/main/index.ts`); Chromium falls back to software on its own if VAAPI fails.
* **Testing without consent prompts:** the screen picker is a consent dialog — never automate it. To exercise the WebRTC media path, inject a fake `window.screenshare` + canvas-based `getDisplayMedia` into a browser tab (host) and join from the app.

### Packaging & testing (Phase 5)
* Linux ships as AppImage only; the `.deb` target is off until the project has a homepage (required package metadata).
* Windows installers (NSIS/portable) need wine when built on Linux — build them on Windows (CI does) instead of installing wine.
* `scripts/smoke.mjs` launches a packaged build with `--remote-debugging-port` and checks title, preload bridge, version and first render. CI runs it on Linux (xvfb, AppArmor userns relaxed for the Chromium sandbox) and Windows.
* The signaling server URL is fixed per build (`VITE_SIGNALING_URL`; no server picker in the UI by design); the server ships as a Docker image (`server/Dockerfile`, build context = repo root) and handles SIGTERM as PID 1.

### Releases & auto-update
* `npm run release` (clean tree on `main`) bumps the patch version, tags `v<version>` and pushes; CI then publishes a GitHub release (repo is public) with the NSIS installer, portable `.exe`, AppImage, `latest*.yml` and blockmaps. Download page for friends: `https://github.com/igornunesfontoura/screenshare/releases/latest`.
* `src/main/updater.ts` (`electron-updater`, `publish` in `electron-builder.yml`): the NSIS install and the AppImage download updates in the background and install on quit or via the header button (disabled while in a room). The portable `.exe` can't replace itself — it only shows a link to the release page. Checks at startup and every 4 h; packaged builds only.
* Artifact names have no spaces (GitHub rewrites them and `latest.yml` would stop matching). The tag must equal `package.json` version (CI checks).

### Hosted signaling & invites
* Release builds point to the Cloudflare Workers deployment (`server/worker.ts`, `server/wrangler.jsonc`, URL in `.env.production`). One Durable Object (`idFromName("global")`) holds every room in memory — no hibernation API, so state lives while sockets are open and the object is evicted (no quota used) when idle. Free plan requires `new_sqlite_classes`.
* Message handling is transport-agnostic in `server/handler.ts`, shared by the Node server and the worker; `rooms.ts` uses Web Crypto (not `node:crypto`) so it runs on both. `npm --prefix server run test:worker` runs the same tests against `wrangler dev`.
* Workers can't send protocol pings, so the client sends `{type:"ping"}` every `KEEPALIVE_MS`; the worker closes sockets silent for 2.5× that.
* Invite link = `https://<server>/j/<code>` (`shared/invite.ts`); the Home code field accepts it (only the code is used), the worker and the Node server serve a small page at that path.

### Room flow (Phase 4)
* Joining puts the viewer in a server-side waiting room (`waiting` → host gets `join-request` → `admit`/`reject`); pending viewers count toward `MAX_VIEWERS` and cannot signal. Hosts can `kick`.
* Chat rides the `control` DataChannel: viewers send `chat-send`, the host stamps author/time (from server-provided names, so viewers can't spoof) and fans out `chat` to everyone; late joiners receive the history when their channel opens.

### Layout
* `src/main/` — Electron main process; native capture lives in `src/main/media/`.
* `src/preload/` — `contextBridge` exposing `window.screenshare` (must build to CJS, sandbox is on).
* `src/renderer/` — React UI, WebRTC (`lib/peer.ts`) and signaling client (`lib/signaling.ts`).
* `shared/` — types shared across processes and the server (`protocol.ts`, `platform.ts`).
* `server/` — standalone signaling server (own `package.json`, deployable on its own).

---

## 5. Coding Standards & Conventions

### Architecture Rules
* **Modularity:** Separate Native OS Capture bindings from UI/WebRTC logic.
* **Error Handling:** Gracefully fallback if HW Acceleration fails (e.g., fallback from NVENC to CPU H.264 encoding).
* **DRM Workarounds:** Prompt user to disable hardware acceleration on browser if using browser-capture fallback, or default to direct OS Window handle capture.

### Code Style Guidelines
* **TypeScript / React:** Use functional components, explicit typing for WebRTC PeerConnections and MediaStreams.
* **Main process:** Keep system capture logic inside `src/main/media/` and talk to the UI only through IPC channels declared in `shared/platform.ts` and exposed by the preload bridge. Keep `contextIsolation` and `sandbox` on.
* **Server:** Only erasable TypeScript syntax (no enums, no constructor parameter properties) — it runs on Node type stripping, enforced by `erasableSyntaxOnly`.
* **CSS/UI:** Use Tailwind utility classes. Color scheme: Dark Cyberpunk / Slate (#090d16 background, Emerald/Cyan highlights).

---

## 6. Development Roadmap for Claude Code

When prompting Claude Code to build this project step-by-step, use the following sequence:

1. **Phase 1: Project Scaffolding**
   * Setup Electron + React + Tailwind CSS template configured for Windows & Linux.
2. **Phase 2: Signaling & WebRTC P2P Infrastructure**
   * Build room code system and WebRTC handshake logic (SDP offer/answer + ICE candidates).
3. **Phase 3: Screen & Audio Capture Implementation**
   * Implement system media capture (`getDisplayMedia` with audio loopback & OS fallback).
4. **Phase 4: Player UI & Control Panel**
   * Create stream viewer, fullscreen toggle, audio meters, chat sidebar, and stream quality settings.
   * Done alongside: display names, host approval/kick of viewers (server-side waiting room).
5. **Phase 5: Packaging & Testing**
   * Configure electron-builder for Linux AppImage/deb and Windows `.exe`.
6. **Phase 6: Voice Chat (push-to-talk)**
   * Modes: off / push-to-talk (hold V, window must be focused — Electron's globalShortcut has no key-up) / open mic.

### Voice notes (Phase 6)
* **Star topology:** each `PeerLink` has a voice transceiver created by the host first (m-line 0, `sendrecv`); viewers adopt `getTransceivers()[0]` on the first offer and set it `sendrecv` before answering, so they can talk via `replaceTrack` without ever offering. `ontrack` on transceiver 0 is voice; everything else is screen media.
* **Mixing:** `VoiceMixer` (`lib/voice.ts`) plays received voices through `<audio>` elements (also required for remote WebRTC audio to reach WebAudio in Chromium) and, on the host, builds one `MediaStreamDestination` per viewer = host mic + all other viewers, never the viewer's own voice.
* **No echo of voices through system audio (Linux):** system audio is captured from a null sink `screenshare_capture` that `linux-audio.ts` feeds with `pw-link` links from every `Stream/Output/Audio` node except the app's own (`application.process.id` ∈ `app.getAppMetrics()` pids), re-planned every second via `pw-dump`. Without `pw-link`/`pw-dump` it falls back to the default sink monitor (echo returns). Windows requests `restrictOwnAudio` on the loopback capture — unverified.
* **Testing voice without real mics:** override `getUserMedia` with an oscillator per participant (distinct frequencies) and check FFT peaks on `getTransceivers()[0].receiver.track`.

### Per-app audio filter
* Default is "everything except blocked apps": the host unticks apps in `AudioAppsPicker`; apps that start playing later are included automatically. The blocked list (`{id,name}[]`) persists in `localStorage` and is pushed to main via `setBlockedAudioApps`, applied live (no WebRTC renegotiation).
* **Linux:** app id = `application.process.binary` (fallback `application.name`); `planLinks` treats blocked apps like the app's own audio (no link, existing links removed). Without `pw-link`/`pw-dump` the listing reports `supported: false` (whole-sink monitor, no filter).
* **Windows:** Chromium's loopback can't filter, so `native/win-audio` (Rust, `screenshare-audio.exe`, shipped via `extraResources`) uses process loopback (Win10 2004+/build 19041): `sessions` lists audio sessions (id = lowercased exe name); `capture` opens one INCLUDE-tree capture per allowed process, mixes them on a 10 ms clock and writes Float32 stereo 48 kHz to stdout; `--blocked <json>` sets the initial list (no leak before stdin is read), stdin lines `{"blocked":[...]}` update it, stdin EOF exits. Since only whole process trees can be captured, an ancestor of a blocked process (or of ScreenShare) is skipped and its allowed descendants are captured instead (`plan.rs`).
* Main forwards the PCM over a `MessageChannelMain` port (preload re-posts it with `window.postMessage`, `PCM_PORT_MESSAGE`) to `pcm-worklet.ts` (AudioWorklet, imported with `?worker&url`) whose output becomes the stream's audio track. Without the helper (old Windows, dev build without `npm run build:win-audio`) the app falls back to Chromium's whole-system loopback.
* `npm run test:win-audio` runs the helper's pure logic tests on any OS; `cargo check --target x86_64-pc-windows-msvc` type-checks the Win32 code from Linux. The Windows smoke test runs the packaged helper (`sessions`, `capture`, exit on stdin EOF); both smoke tests check the PCM worklet end to end.

* CI never has an app playing audio, so the helper's capture path (activation, packets) is only exercised on a real Windows host. To diagnose there without a dev setup: `scripts/diagnose-win-audio.ps1` (one-liner `irm …/scripts/diagnose-win-audio.ps1 | iex`, documented in README) runs `sessions` + 5 s of `capture` the way the app reads it and reports bytes, peak and the exit code (0xC0000005/0xC0000374 = crash). Gotcha already hit: `windows::…::PROPVARIANT` has a `Drop` (`PropVariantClear`), so a VT_BLOB pointing at stack memory must be `ManuallyDrop`.
* If the helper exits mid-stream, main sends `systemAudioStopped` and the host sees a warning (video keeps going).

### Webcam
* Source is `screen` or `camera` (`CaptureSettings.source`, fixed while live). Camera-only: the webcam (`getUserMedia`, resolution/FPS from the quality settings) is the main video track; system audio still works where it doesn't depend on `getDisplayMedia` (Linux, Windows helper).
* Overlay (`cameraOverlay`, screen mode only, toggled live): the webcam goes as a separate light track (720p30, 1.5 Mbps, `priority: low`, default codec so it doesn't take a HW encoder session), never composited on the host, so the screen keeps full quality. `PeerLink.setCamera` creates its transceiver only after the main video one, so the viewer tells them apart by order: 2nd video transceiver = webcam. Layout (corner + size) and visibility ride the `control` channel (`{t:"camera"}`); viewers draw `CameraOverlay` and can hide it (C). Stats pick the main video by `mid`.
* Testing without a real camera/screen: headless Chromium with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, a fake `window.screenshare` + canvas `getDisplayMedia` injected per tab, renderer built with `electron-vite build --mode development` (localhost signaling) served over http.

