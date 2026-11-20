// Áudio do sistema no Windows filtrado por app, via o helper `screenshare-audio.exe`
// (native/win-audio, process loopback do Windows 10 2004+). O helper mistura os apps
// permitidos e escreve PCM Float32 no stdout; repassamos ao renderer por um
// MessagePort, onde um AudioWorklet vira a trilha da transmissão.
//
// Sem o helper (build sem ele, Windows antigo) o app usa o loopback do Chromium,
// que captura o sistema inteiro.

import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { app, MessageChannelMain, type MessagePortMain, type WebContents } from "electron";
import { IPC, PCM_CHANNELS, type AudioApp, type AudioAppListing } from "../../../shared/platform.ts";

const run = promisify(execFile);

const HELPER = "screenshare-audio.exe";
// Process loopback surgiu no Windows 10 2004.
const MIN_BUILD = 19041;
// O helper escreve um bloco a cada 10 ms desde o início; sem nada nesse prazo, falhou.
const FIRST_DATA_TIMEOUT_MS = 3000;
const LIST_TIMEOUT_MS = 5000;
const FRAME_BYTES = PCM_CHANNELS * 4;

let blocked: string[] = [];
let helper: ChildProcessWithoutNullStreams | null = null;
let port: MessagePortMain | null = null;

function helperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, HELPER)
    : join(app.getAppPath(), "native/win-audio/target/release", HELPER);
}

export function winHelperAvailable(): boolean {
  if (process.platform !== "win32") return false;
  const build = Number(release().split(".")[2]);
  return build >= MIN_BUILD && existsSync(helperPath());
}

const ownPidArgs = (): string[] => ["--own-pid", String(process.pid)];

export async function listWinAudioApps(): Promise<AudioAppListing> {
  if (!winHelperAvailable()) return { supported: false, apps: [] };
  const { stdout } = await run(helperPath(), ["sessions", ...ownPidArgs()], {
    timeout: LIST_TIMEOUT_MS,
    windowsHide: true,
  });
  const parsed = JSON.parse(stdout) as { apps?: AudioApp[] };
  return { supported: true, apps: parsed.apps ?? [] };
}

export function setWinBlockedApps(ids: readonly string[]): void {
  blocked = [...ids];
  sendBlocked();
}

function sendBlocked(): void {
  if (helper?.stdin.writable) helper.stdin.write(`${JSON.stringify({ blocked })}\n`);
}

// Inicia o helper e entrega a ponta do MessagePort ao renderer. false: falhou.
export async function startWinSystemAudio(target: WebContents): Promise<boolean> {
  stopWinSystemAudio();
  let child: ChildProcessWithoutNullStreams;
  try {
    // Bloqueados iniciais por argumento: nenhum áudio bloqueado entra antes do stdin ser lido.
    child = spawn(helperPath(), ["capture", ...ownPidArgs(), "--blocked", JSON.stringify(blocked)], {
      windowsHide: true,
    });
  } catch (err) {
    console.warn("Helper de áudio não iniciou:", err);
    return false;
  }
  helper = child;
  // Escrever num helper que acabou de morrer dá EPIPE; sem listener derrubaria o main.
  child.stdin.on("error", (err) => console.warn("stdin do helper de áudio:", err.message));
  child.stderr.on("data", (chunk: Buffer) => console.warn(`[screenshare-audio] ${chunk.toString().trim()}`));

  // Handler persistente desde o início: nenhum byte é descartado, senão os Float32
  // seguintes ficariam desalinhados. Até a porta existir, os blocos são só ignorados.
  let pending: Buffer = Buffer.alloc(0);
  let gotData: () => void = () => undefined;
  child.stdout.on("data", (chunk: Buffer) => {
    gotData();
    const data = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    const usable = data.length - (data.length % FRAME_BYTES);
    pending = Buffer.from(data.subarray(usable));
    if (!usable || !port || helper !== child) return;
    // Cópia alinhada: o Buffer pode ser uma fatia de um pool sem alinhamento de 4 bytes.
    const samples = new Float32Array(usable / 4);
    new Uint8Array(samples.buffer).set(data.subarray(0, usable));
    port.postMessage(samples);
  });

  const started = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), FIRST_DATA_TIMEOUT_MS);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      gotData = () => undefined;
      resolve(ok);
    };
    gotData = () => done(true);
    child.once("error", (err) => {
      console.warn("Helper de áudio falhou:", err);
      done(false);
    });
    child.once("exit", () => done(false));
  });
  if (!started || helper !== child) {
    if (helper === child) stopWinSystemAudio();
    return false;
  }

  const channel = new MessageChannelMain();
  port = channel.port1;
  target.postMessage(IPC.pcmPort, null, [channel.port2]);

  child.once("exit", (code, signal) => {
    if (helper !== child) return;
    const reason = `helper de áudio encerrou (${signal ?? `código ${code}`})`;
    console.warn(reason);
    stopWinSystemAudio();
    if (!target.isDestroyed()) target.send(IPC.systemAudioStopped, reason);
  });
  return true;
}

export function stopWinSystemAudio(): void {
  port?.close();
  port = null;
  if (helper) {
    // Fechar o stdin já encerra o helper; o kill cobre um helper travado.
    helper.stdin.end();
    helper.kill();
  }
  helper = null;
}
