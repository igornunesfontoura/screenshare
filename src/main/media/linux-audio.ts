// Áudio do sistema no Linux: o Chromium esconde os dispositivos "Monitor of …",
// então remapeamos o monitor da saída padrão numa fonte comum via PulseAudio/PipeWire.

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const SOURCE_NAME = "screenshare_system_audio";
// Vira o `label` do dispositivo no renderer. Sem espaços: o pactl corta no primeiro.
const DEVICE_LABEL = "ScreenShare-System-Audio";

let moduleId: string | null = null;
// Start em andamento: chamadas concorrentes reaproveitam a mesma promise.
let starting: Promise<string | null> | null = null;

async function pactl(...args: string[]): Promise<string> {
  const { stdout } = await run("pactl", args);
  return stdout.trim();
}

export function startLinuxSystemAudio(): Promise<string | null> {
  starting ??= loadModule().finally(() => {
    starting = null;
  });
  return starting;
}

async function loadModule(): Promise<string | null> {
  if (moduleId) return DEVICE_LABEL;
  try {
    await unloadStaleModules();
    const sink = await pactl("get-default-sink");
    moduleId = await pactl(
      "load-module",
      "module-remap-source",
      `master=${sink}.monitor`,
      `source_name=${SOURCE_NAME}`,
      `source_properties=device.description=${DEVICE_LABEL}`,
    );
    return DEVICE_LABEL;
  } catch (err) {
    console.warn("Áudio do sistema indisponível (pactl):", err);
    return null;
  }
}

export async function stopLinuxSystemAudio(): Promise<void> {
  // Um stop no meio do start não pode deixar o módulo carregado.
  if (starting) await starting;
  if (!moduleId) return;
  const id = moduleId;
  moduleId = null;
  await pactl("unload-module", id).catch(() => undefined);
}

// Versão síncrona para o encerramento do app, quando não dá para esperar promises.
export function stopLinuxSystemAudioSync(): void {
  if (!moduleId) return;
  try {
    execFileSync("pactl", ["unload-module", moduleId]);
  } catch {
    // pactl ausente ou módulo já removido.
  }
  moduleId = null;
}

// Remove módulos deixados por uma execução anterior que tenha caído.
async function unloadStaleModules(): Promise<void> {
  const modules = await pactl("list", "short", "modules");
  for (const line of modules.split("\n")) {
    if (line.includes(`source_name=${SOURCE_NAME}`)) {
      await pactl("unload-module", line.split("\t")[0]).catch(() => undefined);
    }
  }
}
