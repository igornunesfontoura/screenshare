// Captura nativa de tela e áudio (DXGI/WASAPI no Windows, PipeWire no Linux).

import { app, ipcMain } from "electron";
import {
  IPC,
  type CaptureBackend,
  type PlatformInfo,
} from "../../../shared/platform.ts";
import { listCaptureSources, prepareCapture, registerDisplayMediaHandler } from "./capture.ts";
import {
  type OwnAudio,
  startLinuxSystemAudio,
  stopLinuxSystemAudio,
  stopLinuxSystemAudioSync,
} from "./linux-audio.ts";

// Identifica o áudio do próprio app (PIDs, incluindo o AudioService do Chromium, e
// o nome), para a captura do sistema não pegar o que o ScreenShare toca (vozes do chat).
function ownAudio(): OwnAudio {
  return { pids: new Set(app.getAppMetrics().map((metric) => metric.pid)), appName: app.getName() };
}

function captureBackend(): CaptureBackend {
  switch (process.platform) {
    case "win32":
      return "dxgi-wasapi";
    case "linux":
      return "pipewire";
    default:
      return "unsupported";
  }
}

export function registerMediaIpc(): void {
  registerDisplayMediaHandler();

  ipcMain.handle(
    IPC.platformInfo,
    (): PlatformInfo => ({
      version: app.getVersion(),
      os: process.platform === "win32" ? "windows" : process.platform,
      arch: process.arch,
      captureBackend: captureBackend(),
    }),
  );
  ipcMain.handle(IPC.listCaptureSources, () => listCaptureSources());
  ipcMain.handle(IPC.prepareCapture, (_event, request: unknown) => prepareCapture(request));

  // No Windows o áudio vem pelo loopback do getDisplayMedia; só o Linux precisa disto.
  ipcMain.handle(IPC.startSystemAudio, () =>
    process.platform === "linux" ? startLinuxSystemAudio(ownAudio) : null,
  );
  ipcMain.handle(IPC.stopSystemAudio, () => stopLinuxSystemAudio());

  app.on("will-quit", stopLinuxSystemAudioSync);
}
