// Smoke test do app empacotado: abre o executável, conecta pelo protocolo de
// depuração do Chromium e confere título, ponte do preload e versão.
//   node scripts/smoke.mjs release/0.1.0/linux-unpacked/screenshare
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const PORT = 9333;
const TIMEOUT_MS = 30_000;

const executable = process.argv[2];
if (!executable) {
  console.error("Uso: node scripts/smoke.mjs <executável do app empacotado>");
  process.exit(2);
}
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const app = spawn(executable, [`--remote-debugging-port=${PORT}`], { stdio: "ignore" });
const deadline = Date.now() + TIMEOUT_MS;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPage() {
  while (Date.now() < deadline) {
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

function evaluate(ws, expression) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    ws.addEventListener("message", function onMessage(event) {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener("message", onMessage);
      if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.text));
      else resolve(message.result?.result?.value);
    });
    ws.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
  });
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
  const page = await findPage();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  const title = await waitFor(ws, "document.readyState === 'complete' && document.title");
  const info = JSON.parse(await evaluate(ws, "window.screenshare.platformInfo().then(JSON.stringify)"));
  const rendered = await waitFor(ws, "document.body.innerText.includes('Criar sala')");
  ws.close();

  const checks = [
    ["título da janela", title === "ScreenShare", title],
    ["ponte do preload", typeof info.os === "string" && typeof info.captureBackend === "string", info],
    ["versão do app", info.version === version, `${info.version} (esperado ${version})`],
    ["tela inicial renderizada", rendered === true, rendered],
  ];
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
