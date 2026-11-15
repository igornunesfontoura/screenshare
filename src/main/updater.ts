// Atualização automática a partir das releases do GitHub (publish em electron-builder.yml).
// Instalador do Windows e AppImage baixam a versão nova sozinhos e instalam ao fechar
// o app (ou na hora, pelo botão da interface). O .exe portátil não consegue se
// substituir: só avisa que há versão nova e aponta para a página de downloads.

import { app, BrowserWindow, ipcMain } from "electron";
import updater from "electron-updater";
import { IPC, type UpdateStatus } from "../../shared/platform.ts";

const RELEASES_URL = "https://github.com/igornunesfontoura/screenshare/releases/latest";
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let status: UpdateStatus = { state: "idle" };

function setStatus(next: UpdateStatus): void {
  status = next;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.updateStatusChanged, status);
  }
}

// Só o instalador (NSIS) e o AppImage sabem se atualizar.
function canSelfUpdate(): boolean {
  if (process.platform === "win32") return !process.env.PORTABLE_EXECUTABLE_FILE;
  if (process.platform === "linux") return Boolean(process.env.APPIMAGE);
  return false;
}

export function startAutoUpdate(): void {
  ipcMain.handle(IPC.updateStatus, () => status);
  ipcMain.handle(IPC.installUpdate, () => {
    // Instalação silenciosa e reabre o app depois (o NSIS assistido não reabriria sozinho).
    if (status.state === "ready") updater.autoUpdater.quitAndInstall(true, true);
  });

  // Em dev (npm run dev) não há release para comparar.
  if (!app.isPackaged) return;

  const { autoUpdater } = updater;
  const selfUpdate = canSelfUpdate();
  autoUpdater.autoDownload = selfUpdate;
  autoUpdater.autoInstallOnAppQuit = selfUpdate;
  autoUpdater.logger = console;

  autoUpdater.on("update-available", (info) => {
    setStatus(
      selfUpdate
        ? { state: "downloading", version: info.version, percent: 0 }
        : { state: "available", version: info.version, url: RELEASES_URL },
    );
  });
  autoUpdater.on("download-progress", (progress) => {
    if (status.state === "downloading") {
      setStatus({ ...status, percent: Math.round(progress.percent) });
    }
  });
  autoUpdater.on("update-downloaded", (info) => setStatus({ state: "ready", version: info.version }));
  // Sem internet, release ainda sem arquivos etc.: tenta de novo na próxima rodada.
  autoUpdater.on("error", (error) => {
    console.warn(`Falha ao procurar atualização: ${error.message}`);
    if (status.state === "downloading") setStatus({ state: "idle" });
  });

  const check = (): void => {
    // Uma versão já baixada fica esperando o reinício; não baixa de novo.
    if (status.state === "ready") return;
    autoUpdater.checkForUpdates().catch(() => {});
  };
  check();
  setInterval(check, CHECK_INTERVAL_MS);
}
