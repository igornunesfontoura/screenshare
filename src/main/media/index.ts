// Captura nativa de tela e áudio (DXGI/WASAPI no Windows, PipeWire no Linux).

import { app, ipcMain } from "electron";
import {
  IPC,
  type AudioAppListing,
  type CaptureBackend,
  type PlatformInfo,
  type SystemAudioSource,
} from "../../../shared/platform.ts";
import { listCaptureSources, prepareCapture, registerDisplayMediaHandler } from "./capture.ts";
import {
  type OwnAudio,
  listLinuxAudioApps,
  setLinuxBlockedApps,
  startLinuxSystemAudio,
  stopLinuxSystemAudio,
  stopLinuxSystemAudioSync,
} from "./linux-audio.ts";
import {
  listWinAudioApps,
  setWinBlockedApps,
  startWinSystemAudio,
  stopWinSystemAudio,
  winHelperAvailable,
} from "./win-audio.ts";

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

  ipcMain.handle(IPC.startSystemAudio, async (event): Promise<SystemAudioSource | null> => {
    if (process.platform === "linux") {
      const label = await startLinuxSystemAudio(ownAudio);
      return label ? { kind: "device", label } : null;
    }
    // Sem o helper o áudio do Windows vem pelo loopback do getDisplayMedia.
    if (winHelperAvailable()) return (await startWinSystemAudio(event.sender)) ? { kind: "pcm" } : null;
    return null;
  });
  ipcMain.handle(IPC.stopSystemAudio, () =>
    process.platform === "win32" ? stopWinSystemAudio() : stopLinuxSystemAudio(),
  );
  ipcMain.handle(IPC.listAudioApps, async (): Promise<AudioAppListing> => {
    try {
      if (process.platform === "linux") return await listLinuxAudioApps(ownAudio);
      if (process.platform === "win32") return await listWinAudioApps();
    } catch (err) {
      console.warn("Falha ao listar apps com áudio:", err);
    }
    return { supported: false, apps: [] };
  });
  ipcMain.handle(IPC.setBlockedAudioApps, (_event, ids: unknown) => {
    const list = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
    if (process.platform === "linux") setLinuxBlockedApps(list);
    else if (process.platform === "win32") setWinBlockedApps(list);
  });

  app.on("will-quit", () => {
    stopLinuxSystemAudioSync();
    stopWinSystemAudio();
  });
}
