import { app, BrowserWindow, session, shell } from "electron";
import { join } from "node:path";
import { registerMediaIpc } from "./media/index.ts";

function createWindow(): void {
  const window = new BrowserWindow({
    title: "ScreenShare",
    width: 1280,
    height: 800,
    // Sem tamanho mínimo: em WMs tiling (Hyprland, i3) a janela pode ficar menor
    // que ele e o conteúdo seria cortado em vez de se adaptar.
    show: false,
    backgroundColor: "#090d16",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      // O vídeo do host precisa tocar com som sem exigir clique extra.
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  window.once("ready-to-show", () => window.show());

  // Links externos abrem no navegador do sistema, nunca dentro do app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (URL.parse(url)?.protocol === "https:") void shell.openExternal(url);
    return { action: "deny" };
  });

  // A janela nunca sai do app (ex.: arquivo ou link arrastado para dentro dela).
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) {
    // Em dev, joga o console do renderer no terminal do `npm run dev`.
    window.webContents.on("console-message", ({ level, message }) => {
      console.log(`[renderer:${level}] ${message}`);
    });
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

// Só câmera/microfone e captura de tela; qualquer outra permissão é negada.
const ALLOWED_PERMISSIONS = new Set(["media", "display-capture"]);

// Encode por hardware via VAAPI no Linux. Se o driver falhar, o Chromium
// cai sozinho para o encoder por software.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-features", "AcceleratedVideoEncoder,VaapiVideoEncoder");
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  // Necessário para o renderer ver os nomes dos dispositivos de áudio sem abrir o microfone.
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    ALLOWED_PERMISSIONS.has(permission),
  );
  registerMediaIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
