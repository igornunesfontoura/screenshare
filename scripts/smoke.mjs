// Smoke test do app empacotado: abre o executável, conecta pelo protocolo de
// depuração do Chromium e confere título, ponte do preload e versão.
//   node scripts/smoke.mjs release/0.1.0/linux-unpacked/screenshare
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PORT = 9333;
const TIMEOUT_MS = 30_000;

const executable = process.argv[2];
if (!executable) {
  console.error("Uso: node scripts/smoke.mjs <executável do app empacotado>");
  process.exit(2);
}
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
// Mesmo build que foi empacotado (npm run build antes do electron-builder).
const workletFile = readdirSync(new URL("../out/renderer/assets/", import.meta.url)).find((f) =>
  /^pcm-worklet-.*\.js$/.test(f),
);

// Worklet do áudio PCM (helper do Windows): carrega pelo mesmo caminho do app empacotado
// (file://), recebe amostras por um MessagePort e precisa produzir som.
const PCM_CHECK = `(async () => {
  const ctx = new AudioContext({ sampleRate: 48000 });
  await ctx.audioWorklet.addModule(new URL("assets/${workletFile}", location.href));
  const node = new AudioWorkletNode(ctx, "pcm-player", { numberOfInputs: 0, outputChannelCount: [2] });
  const analyser = ctx.createAnalyser();
  node.connect(analyser);
  const channel = new MessageChannel();
  node.port.postMessage({ port: channel.port2 }, [channel.port2]);
  await ctx.resume();
  for (let i = 0; i < 30; i++) channel.port1.postMessage(new Float32Array(960).fill(0.5));
  await new Promise((r) => setTimeout(r, 300));
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  await ctx.close();
  return Math.max(...data);
})().catch((e) => String(e))`;

const app = spawn(executable, [`--remote-debugging-port=${PORT}`], { stdio: "ignore" });
const deadline = Date.now() + TIMEOUT_MS;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Executável ausente ou app que fecha sozinho: falha na hora, sem esperar o prazo.
const appFailed = new Promise((_, reject) => {
  app.once("error", (err) => reject(new Error(`Não foi possível abrir o app: ${err.message}`)));
  app.once("exit", (code) => reject(new Error(`O app fechou antes do fim do teste (código ${code}).`)));
});
appFailed.catch(() => undefined);

function withDeadline(promise, what) {
  const remaining = Math.max(0, deadline - Date.now());
  const timeout = sleep(remaining).then(() => {
    throw new Error(`Tempo esgotado: ${what}`);
  });
  return Promise.race([promise, appFailed, timeout]);
}

async function findPage() {
  while (Date.now() < deadline) {
    if (app.exitCode !== null || app.killed) break;
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) return page;
    } catch {
      // App ainda subindo.
    }
    await sleep(250);
  }
  throw new Error("O app não abriu nenhuma janela a tempo.");
}

let nextId = 1;

// userGesture: simula um clique do usuário (tela cheia e clipboard exigem gesto).
function evaluate(ws, expression, { userGesture = false } = {}) {
  const call = new Promise((resolve, reject) => {
    const id = nextId++;
    ws.addEventListener("close", () => reject(new Error("Conexão de depuração fechada.")), { once: true });
    ws.addEventListener("message", function onMessage(event) {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(`CDP: ${message.error.message}`));
      else if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.text));
      } else resolve(message.result?.result?.value);
    });
    ws.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true, userGesture },
      }),
    );
  });
  return withDeadline(call, expression);
}

async function waitFor(ws, expression) {
  while (Date.now() < deadline) {
    const value = await evaluate(ws, expression).catch(() => undefined);
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`Tempo esgotado esperando: ${expression}`);
}

let exitCode = 0;
try {
  const page = await withDeadline(findPage(), "janela do app");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await withDeadline(
    new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("Falha ao conectar no CDP.")), { once: true });
    }),
    "conexão de depuração",
  );

  const title = await waitFor(ws, "document.readyState === 'complete' && document.title");
  const info = JSON.parse(await evaluate(ws, "window.screenshare.platformInfo().then(JSON.stringify)"));
  const rendered = await waitFor(ws, "document.body.innerText.includes('Criar sala')");
  // As duas dependem do handler de permissões do processo principal.
  const fullscreen = await evaluate(
    ws,
    "document.body.requestFullscreen().then(() => document.fullscreenElement === document.body)" +
      ".then(async (ok) => { await document.exitFullscreen(); return ok; }).catch((e) => String(e))",
    { userGesture: true },
  );
  const clipboard = await evaluate(
    ws,
    "navigator.clipboard.writeText('smoke').then(() => true).catch((e) => String(e))",
    { userGesture: true },
  );
  const pcmPeak = await evaluate(ws, PCM_CHECK, { userGesture: true });
  ws.close();

  const checks = [
    ["título da janela", title === "ScreenShare", title],
    ["ponte do preload", typeof info.os === "string" && typeof info.captureBackend === "string", info],
    ["versão do app", info.version === version, `${info.version} (esperado ${version})`],
    ["tela inicial renderizada", rendered === true, rendered],
    ["tela cheia permitida", fullscreen === true, fullscreen],
    ["copiar para a área de transferência", clipboard === true, clipboard],
    ["worklet do áudio PCM", typeof pcmPeak === "number" && pcmPeak > 0.4, pcmPeak],
  ];
  if (process.platform === "win32") checks.push(...(await checkWinAudioHelper()));
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? "✔" : "✖"} ${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    if (!ok) exitCode = 1;
  }
} catch (err) {
  console.error("✖", err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  app.kill();
}
process.exit(exitCode);

// Helper de áudio por app (Windows): lista sessões e entrega PCM pelo stdout.
async function checkWinAudioHelper() {
  const helper = join(dirname(executable), "resources", "screenshare-audio.exe");
  if (!existsSync(helper)) return [["helper de áudio empacotado", false, helper]];

  let listing;
  try {
    listing = JSON.parse(execFileSync(helper, ["sessions", "--own-pid", "0"], { timeout: 10_000 }).toString());
  } catch (err) {
    listing = String(err);
  }

  const child = spawn(helper, ["capture", "--own-pid", "0"]);
  child.stdin.write(`${JSON.stringify({ blocked: [] })}\n`);
  let bytes = 0;
  child.stdout.on("data", (chunk) => (bytes += chunk.length));
  await sleep(2000);
  const received = bytes;
  // Fechar o stdin (app fechado) precisa encerrar o helper.
  const exited = new Promise((resolve) => child.once("exit", () => resolve(true)));
  child.stdin.end();
  const closed = await Promise.race([exited, sleep(3000).then(() => false)]);
  if (!closed) child.kill();

  return [
    ["helper lista sessões de áudio", Array.isArray(listing?.apps), listing],
    // 10 ms = 3840 bytes; em 2 s espera-se bem mais de 100 blocos.
    ["helper entrega PCM contínuo", received >= 3840 * 100, `${received} bytes em 2 s`],
    ["helper encerra quando o app fecha", closed, closed],
  ];
}
