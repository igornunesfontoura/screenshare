# CLAUDE.md - Project Specification & AI Architecture Guide

## 1. Project Overview & Vision
**StreamForge Desktop** is a high-performance, cross-platform (Windows & Linux) P2P screen sharing and movie watch-party application. It is designed to solve the common issues with mainstream apps like Discord (DRM black screens, low FPS/resolution limits, audio desync, and hardware acceleration locks).

### Primary Goals:
* **Native Desktop App:** Linux (AppImage/Debian/Flatpak) and Windows (MSI/Portable executable).
* **High Quality Video & Audio:** Up to 4K 60FPS support with direct WebRTC P2P stream, custom bitrate control, and HW acceleration (NVENC/VAAPI).
* **Bypass DRM Black-Screen Issues:** Built-in screen capture options (PipeWire on Linux, DXGI/WASAPI on Windows) to capture streaming services smoothly.
* **Synchronized Audio & Playback:** Native audio loopback capture (system sound + mic overlay) with low latency (<150ms).

---

## 2. Recommended Tech Stack

| Layer | Technology Choice | Rationale |
| :--- | :--- | :--- |
| **Framework** | **Tauri v2** (or **Electron**) | **Tauri v2** recommended for lightweight memory footprint (<50MB RAM), fast Rust performance, and native OS API bindings (PipeWire/WASAPI). |
| **Frontend UI** | **React** / **Svelte** + **Tailwind CSS** + **Lucide Icons** | Fast, modern, responsive Dark Mode techwear UI. |
| **P2P Protocol** | **WebRTC** (via `rust-webrtc` or WebRTC Native DataChannels) | Direct P2P connection to minimize latency and avoid central relay server bandwidth bottlenecks. |
| **Signaling Server** | **Node.js WebSocket / PeerJS Server** | Simple light signaling server hosted on Render/Railway/Fly.io or self-hosted. |
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

If using **Tauri + React + Vite**:

### Setup & Installation
```bash
npm install
# Install system dependencies on Linux (Ubuntu/Debian)
sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev pipewire-audio-client-libraries
```

### Local Development
```bash
npm run tauri dev
```

### Build & Package (Cross-Platform)
```bash
# Build for Linux (AppImage & deb)
npm run tauri build -- --target x86_64-unknown-linux-gnu

# Build for Windows (x64 Installer / Portable)
npm run tauri build -- --target x86_64-pc-windows-msvc
```

---

## 5. Coding Standards & Conventions

### Architecture Rules
* **Modularity:** Separate Native OS Capture bindings from UI/WebRTC logic.
* **Error Handling:** Gracefully fallback if HW Acceleration fails (e.g., fallback from NVENC to CPU H.264 encoding).
* **DRM Workarounds:** Prompt user to disable hardware acceleration on browser if using browser-capture fallback, or default to direct OS Window handle capture.

### Code Style Guidelines
* **TypeScript / React:** Use functional components, explicit typing for WebRTC PeerConnections and MediaStreams.
* **Rust Backend (if Tauri):** Keep system capture logic inside `src-tauri/src/media/` and communicate with UI via Tauri `invoke` commands and events.
* **CSS/UI:** Use Tailwind utility classes. Color scheme: Dark Cyberpunk / Slate (#090d16 background, Emerald/Cyan highlights).

---

## 6. Development Roadmap for Claude Code

When prompting Claude Code to build this project step-by-step, use the following sequence:

1. **Phase 1: Project Scaffolding**
   * Setup Tauri v2 + React + Tailwind CSS template configured for Windows & Linux.
2. **Phase 2: Signaling & WebRTC P2P Infrastructure**
   * Build room code system and WebRTC handshake logic (SDP offer/answer + ICE candidates).
3. **Phase 3: Screen & Audio Capture Implementation**
   * Implement system media capture (`getDisplayMedia` with audio loopback & OS fallback).
4. **Phase 4: Player UI & Control Panel**
   * Create stream viewer, fullscreen toggle, audio meters, chat sidebar, and stream quality settings.
5. **Phase 5: Packaging & Testing**
   * Configure Tauri bundler for Linux AppImage and Windows `.exe`.