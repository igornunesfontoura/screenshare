// Captura nativa de tela e áudio (DXGI/WASAPI no Windows, PipeWire no Linux).
// Implementação real virá na Fase 3; por ora expõe só a detecção de plataforma.

import { ipcMain } from "electron";
import { IPC, type CaptureBackend, type PlatformInfo } from "../../../shared/platform.ts";

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
  ipcMain.handle(
    IPC.platformInfo,
    (): PlatformInfo => ({
      os: process.platform === "win32" ? "windows" : process.platform,
      arch: process.arch,
      captureBackend: captureBackend(),
    }),
  );
}
