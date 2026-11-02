// Captura nativa de tela e áudio (DXGI/WASAPI no Windows, PipeWire no Linux).

import { app, ipcMain } from "electron";
import {
  IPC,
  type CaptureBackend,
  type PlatformInfo,
} from "../../../shared/platform.ts";
import { listCaptureSources, prepareCapture, registerDisplayMediaHandler } from "./capture.ts";
import {
  startLinuxSystemAudio,
  stopLinuxSystemAudio,
  stopLinuxSystemAudioSync,
} from "./linux-audio.ts";

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
      os: process.platform === "win32" ? "windows" : process.platform,
      arch: process.arch,
      captureBackend: captureBackend(),
    }),
  );
  ipcMain.handle(IPC.listCaptureSources, () => listCaptureSources());
  ipcMain.handle(IPC.prepareCapture, (_event, request: unknown) => prepareCapture(request));

  // No Windows o áudio vem pelo loopback do getDisplayMedia; só o Linux precisa disto.
  ipcMain.handle(IPC.startSystemAudio, () =>
    process.platform === "linux" ? startLinuxSystemAudio() : null,
  );
  ipcMain.handle(IPC.stopSystemAudio, () => stopLinuxSystemAudio());

  app.on("will-quit", stopLinuxSystemAudioSync);
}
