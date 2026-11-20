// Áudio do sistema no Linux.
//
// Com PipeWire: um sink virtual (screenshare_capture) recebe, por links do pw-link,
// a saída de todos os apps EXCETO o próprio ScreenShare — assim as vozes do chat
// que tocam no host não voltam para os espectadores. O sink é remapeado numa fonte
// comum porque o Chromium esconde dispositivos "Monitor of …".
//
// O usuário pode tirar apps específicos da transmissão: eles são tratados como o
// próprio app (sem link para o sink; links existentes são desfeitos).
//
// Sem as ferramentas do PipeWire (PulseAudio puro): remapeia o monitor da saída
// padrão, que inclui o áudio do próprio app e não permite filtrar por app.

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import type { AudioApp, AudioAppListing } from "../../../shared/platform.ts";

const run = promisify(execFile);

const CAPTURE_SINK = "screenshare_capture";
const SOURCE_NAME = "screenshare_system_audio";
// Vira o `label` do dispositivo no renderer. Sem espaços: o pactl corta no primeiro.
const DEVICE_LABEL = "ScreenShare-System-Audio";
const LINK_INTERVAL_MS = 1000;
// O WirePlumber pode eleger o sink novo como padrão de forma assíncrona.
const DEFAULT_SINK_CHECKS = 5;
// Par de portas que falha seguidamente (formato, permissão) deixa de ser tentado.
const MAX_LINK_FAILURES = 3;

// Apps cujo áudio o usuário tirou da transmissão (ids de `audioAppOf`).
let blocked = new Set<string>();
// Força uma sincronização fora do intervalo (ex.: o usuário bloqueou um app agora).
let syncNow: (() => void) | null = null;

// Como reconhecer o áudio do próprio app: PIDs do processo (inclui o AudioService do
// Chromium) e o nome do app, que cobre PIDs de outro namespace (Flatpak).
export interface OwnAudio {
  pids: Set<number>;
  appName: string;
}
type OwnAudioSource = () => OwnAudio;

// Módulos carregados, na ordem de carga (descarregados na ordem inversa).
let modules: string[] = [];
let linkTimer: ReturnType<typeof setInterval> | null = null;
// Start em andamento: chamadas concorrentes reaproveitam a mesma promise.
let starting: Promise<string | null> | null = null;

async function pactl(...args: string[]): Promise<string> {
  const { stdout } = await run("pactl", args);
  return stdout.trim();
}

export function setLinuxBlockedApps(ids: readonly string[]): void {
  blocked = new Set(ids);
  syncNow?.();
}

// Apps tocando áudio agora (exceto o próprio). `supported` é false sem as
// ferramentas do PipeWire: aí a captura é o monitor da saída inteira, sem filtro.
export async function listLinuxAudioApps(own: OwnAudioSource): Promise<AudioAppListing> {
  if (!(await hasPipeWireTools())) return { supported: false, apps: [] };
  const { stdout } = await run("pw-dump", [], { maxBuffer: 64 * 1024 * 1024 });
  return { supported: true, apps: audioApps(JSON.parse(stdout) as PwObject[], own()) };
}

export function startLinuxSystemAudio(own: OwnAudioSource): Promise<string | null> {
  starting ??= load(own).finally(() => {
    starting = null;
  });
  return starting;
}

async function load(own: OwnAudioSource): Promise<string | null> {
  if (modules.length) return DEVICE_LABEL;
  try {
    await unloadStaleModules();
    const defaultSink = await pactl("get-default-sink");

    if (await hasPipeWireTools()) {
      modules.push(
        await pactl(
          "load-module",
          "module-null-sink",
          `sink_name=${CAPTURE_SINK}`,
          "sink_properties=device.description=ScreenShare-Captura",
        ),
      );
      modules.push(await remapSource(`${CAPTURE_SINK}.monitor`));
      startLinking(own, defaultSink);
    } else {
      modules.push(await remapSource(`${defaultSink}.monitor`));
    }
    return DEVICE_LABEL;
  } catch (err) {
    console.warn("Áudio do sistema indisponível:", err);
    await unloadModules();
    return null;
  }
}

function remapSource(master: string): Promise<string> {
  return pactl(
    "load-module",
    "module-remap-source",
    `master=${master}`,
    `source_name=${SOURCE_NAME}`,
    `source_properties=device.description=${DEVICE_LABEL}`,
  );
}

export async function stopLinuxSystemAudio(): Promise<void> {
  // Um stop no meio do start não pode deixar módulos carregados.
  if (starting) await starting;
  await unloadModules();
}

async function unloadModules(): Promise<void> {
  stopLinking();
  const loaded = modules.reverse();
  modules = [];
  for (const id of loaded) await pactl("unload-module", id).catch(() => undefined);
}

// Versão síncrona para o encerramento do app, quando não dá para esperar promises.
export function stopLinuxSystemAudioSync(): void {
  stopLinking();
  for (const id of modules.reverse()) {
    try {
      execFileSync("pactl", ["unload-module", id]);
    } catch {
      // pactl ausente ou módulo já removido.
    }
  }
  modules = [];
}

// Remove módulos deixados por uma execução anterior que tenha caído.
async function unloadStaleModules(): Promise<void> {
  const list = await pactl("list", "short", "modules");
  for (const line of list.split("\n")) {
    if (line.includes(`source_name=${SOURCE_NAME}`) || line.includes(`sink_name=${CAPTURE_SINK}`)) {
      await pactl("unload-module", line.split("\t")[0]).catch(() => undefined);
    }
  }
}

async function hasPipeWireTools(): Promise<boolean> {
  try {
    await run("pw-link", ["--version"]);
    await run("pw-dump", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

function startLinking(own: OwnAudioSource, defaultSink: string): void {
  let busy = false;
  // Pedido feito durante uma sincronização: roda de novo ao fim dela.
  let again = false;
  let sinkChecks = DEFAULT_SINK_CHECKS;
  const failures = new Map<string, number>();
  const tick = async (): Promise<void> => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      // O sink de captura não pode virar a saída padrão do usuário.
      if (sinkChecks-- > 0 && (await pactl("get-default-sink")) !== defaultSink) {
        await pactl("set-default-sink", defaultSink);
      }
      await syncLinks(own, failures);
    } catch (err) {
      console.warn("Falha ao ligar streams de áudio:", err);
    } finally {
      busy = false;
    }
    if (again && linkTimer === timer) {
      again = false;
      await tick();
    }
  };
  const timer = setInterval(tick, LINK_INTERVAL_MS);
  linkTimer = timer;
  void tick();
  syncNow = () => void tick();
}

function stopLinking(): void {
  if (linkTimer) clearInterval(linkTimer);
  linkTimer = null;
  syncNow = null;
}

interface PwObject {
  id: number;
  type: string;
  info?: {
    props?: Record<string, unknown>;
    direction?: string;
    "output-port-id"?: number;
    "input-port-id"?: number;
  };
}

// Canal de origem → canais do sink estéreo. Traseiros/laterais vão para o lado
// correspondente; central, LFE, mono e desconhecidos para os dois (o diálogo de
// filmes 5.1 fica no canal central).
function targetChannels(channel: unknown): string[] {
  switch (channel) {
    case "FL":
    case "RL":
    case "SL":
    case "FLC":
    case "RLC":
      return ["FL"];
    case "FR":
    case "RR":
    case "SR":
    case "FRC":
    case "RRC":
      return ["FR"];
    default:
      return ["FL", "FR"];
  }
}

type Props = Record<string, unknown>;

function isOwnStream(props: Props, own: OwnAudio): boolean {
  return (
    own.pids.has(Number(props["application.process.id"])) ||
    String(props["application.name"] ?? "").toLowerCase() === own.appName.toLowerCase()
  );
}

// Identidade estável de um app entre streams e execuções: o binário (ex.: "chromium"),
// senão o nome. O rótulo é o nome que o próprio app publica.
export function audioAppOf(props: Props): AudioApp | null {
  const name = String(props["application.name"] ?? props["node.name"] ?? "").trim();
  const id = String(props["application.process.binary"] ?? name).trim().toLowerCase();
  return id ? { id, name: name || id } : null;
}

function isPlayback(o: PwObject): boolean {
  return o.type === "PipeWire:Interface:Node" && o.info?.props?.["media.class"] === "Stream/Output/Audio";
}

export function audioApps(objects: PwObject[], own: OwnAudio): AudioApp[] {
  const apps = new Map<string, AudioApp>();
  for (const o of objects) {
    const props = o.info?.props ?? {};
    if (!isPlayback(o) || isOwnStream(props, own)) continue;
    const app = audioAppOf(props);
    if (app && !apps.has(app.id)) apps.set(app.id, app);
  }
  return [...apps.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface LinkPlan {
  add: [number, number][];
  // Links do próprio app ou de apps bloqueados para o sink (ex.: criados antes de um
  // PID novo ser conhecido, ou antes de o usuário bloquear o app).
  remove: [number, number][];
}

// Liga a saída de cada stream de reprodução de outros apps ao sink de captura e
// desfaz qualquer link que leve o áudio do próprio app ou de um app bloqueado para lá.
export function planLinks(
  objects: PwObject[],
  own: OwnAudio,
  blockedApps: ReadonlySet<string> = new Set(),
): LinkPlan {
  const props = (o: PwObject) => o.info?.props ?? {};
  const plan: LinkPlan = { add: [], remove: [] };
  const sink = objects.find(
    (o) => o.type === "PipeWire:Interface:Node" && props(o)["node.name"] === CAPTURE_SINK,
  );
  if (!sink) return plan;

  const excluded = (o: PwObject) =>
    isOwnStream(props(o), own) || blockedApps.has(audioAppOf(props(o))?.id ?? "");
  const playback = objects.filter(isPlayback);
  const foreign = new Set(playback.filter((o) => !excluded(o)).map((o) => o.id));
  const mine = new Set(playback.filter(excluded).map((o) => o.id));

  const ports = objects.filter((o) => o.type === "PipeWire:Interface:Port");
  const nodeOf = new Map(ports.map((p) => [p.id, Number(props(p)["node.id"])]));
  const sinkInputs = ports.filter((p) => nodeOf.get(p.id) === sink.id && p.info?.direction === "input");
  const links = objects
    .filter((o) => o.type === "PipeWire:Interface:Link")
    .map((l) => [l.info?.["output-port-id"] ?? -1, l.info?.["input-port-id"] ?? -1] as [number, number]);
  const linked = new Set(links.map(([o, i]) => `${o}>${i}`));
  const sinkInputIds = new Set(sinkInputs.map((p) => p.id));

  for (const port of ports) {
    if (port.info?.direction !== "output" || !foreign.has(nodeOf.get(port.id) ?? -1)) continue;
    const channels = targetChannels(props(port)["audio.channel"]);
    for (const target of sinkInputs.filter((s) => channels.includes(String(props(s)["audio.channel"])))) {
      if (!linked.has(`${port.id}>${target.id}`)) plan.add.push([port.id, target.id]);
    }
  }
  for (const [output, input] of links) {
    if (sinkInputIds.has(input) && mine.has(nodeOf.get(output) ?? -1)) plan.remove.push([output, input]);
  }
  return plan;
}

async function syncLinks(own: OwnAudioSource, failures: Map<string, number>): Promise<void> {
  const { stdout } = await run("pw-dump", [], { maxBuffer: 64 * 1024 * 1024 });
  // PIDs lidos depois do dump: um stream novo do próprio app já aparece nos dois.
  const plan = planLinks(JSON.parse(stdout) as PwObject[], own(), blocked);
  for (const [output, input] of plan.remove) {
    await run("pw-link", ["-d", String(output), String(input)]).catch(() => undefined);
  }
  for (const [output, input] of plan.add) {
    const key = `${output}>${input}`;
    if ((failures.get(key) ?? 0) >= MAX_LINK_FAILURES) continue;
    // Falha pontual (stream que acabou de sumir) é normal; conta e tenta de novo depois.
    await run("pw-link", [String(output), String(input)]).catch(() => {
      failures.set(key, (failures.get(key) ?? 0) + 1);
    });
  }
}
