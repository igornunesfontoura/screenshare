import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocket, type WebSocketServer } from "ws";
import {
  MAX_PENDING,
  sanitizeName,
  type ClientMessage,
  type ServerMessage,
} from "../shared/protocol.ts";
import { startSignalingServer } from "./index.ts";

// SIGNALING_TEST_TARGET=worker roda os mesmos testes contra o worker.ts no
// wrangler dev (npm run test:worker), em vez do servidor Node.
const target = process.env.SIGNALING_TEST_TARGET === "worker" ? "worker" : "node";

let wss: WebSocketServer | undefined;
let worker: ChildProcess | undefined;
let url: string;

before(async () => {
  if (target === "worker") {
    url = await startWorker();
    return;
  }
  wss = startSignalingServer(0, { joinsPerMinute: 1000, pendingTimeoutMs: 1000 });
  await new Promise((resolve) => wss!.once("listening", resolve));
  url = `ws://localhost:${(wss.address() as AddressInfo).port}`;
});

after(() => {
  // Mata o grupo todo (wrangler + workerd); só o pai deixaria filhos segurando o runner.
  if (worker?.pid) process.kill(-worker.pid, "SIGTERM");
  if (!wss) return;
  for (const ws of wss.clients) ws.terminate();
  wss.close();
});

async function startWorker(): Promise<string> {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  worker = spawn(
    "npx",
    [
      "wrangler", "dev", "--port", String(port), "--ip", "127.0.0.1",
      "--var", "PENDING_TIMEOUT_MS:1000", "--var", "JOINS_PER_MINUTE:1000",
    ],
    {
      cwd: import.meta.dirname,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      detached: true,
    },
  );
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("Ready on")) resolve();
    };
    worker!.stdout!.on("data", onData);
    worker!.stderr!.on("data", onData);
    worker!.once("exit", () => reject(new Error(`wrangler dev saiu:\n${output}`)));
  });
  return `ws://127.0.0.1:${port}`;
}

class TestClient {
  private queue: ServerMessage[] = [];
  private waiters: ((m: ServerMessage) => void)[] = [];

  readonly ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.queue.push(message);
    });
  }

  static async connect(): Promise<TestClient> {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    return new TestClient(ws);
  }

  send(message: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(message));
  }

  next(): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    this.ws.close();
  }
}


function expectType<T extends ServerMessage["type"]>(
  message: ServerMessage,
  type: T,
): Extract<ServerMessage, { type: T }> {
  assert.equal(message.type, type, JSON.stringify(message));
  return message as Extract<ServerMessage, { type: T }>;
}

async function createRoom(name = "Host") {
  const host = await TestClient.connect();
  host.send({ type: "create", name });
  const created = expectType(await host.next(), "created");
  return { host, code: created.code, hostId: created.peerId };
}

// Pede para entrar e consome o "waiting" do viewer e o "join-request" do host.
async function requestJoin(host: TestClient, code: string, name = "Viewer") {
  const viewer = await TestClient.connect();
  viewer.send({ type: "join", code, name });
  expectType(await viewer.next(), "waiting");
  const request = expectType(await host.next(), "join-request");
  return { viewer, viewerId: request.peerId, name: request.name };
}

async function joinApproved(host: TestClient, code: string, name = "Viewer") {
  const { viewer, viewerId } = await requestJoin(host, code, name);
  host.send({ type: "admit", peerId: viewerId });
  const joined = expectType(await viewer.next(), "joined");
  expectType(await host.next(), "peer-joined");
  return { viewer, viewerId, joined };
}

function closeAll(...clients: TestClient[]) {
  for (const client of clients) client.close();
}

describe("signaling server", () => {
  it("cria sala com código de 6 dígitos", async () => {
    const { host, code } = await createRoom();
    assert.match(code, /^\d{6}$/);
    host.close();
  });

  it("viewer só entra depois que o host aprova", async () => {
    const { host, code, hostId } = await createRoom("Ana");
    const { viewer, viewerId, name } = await requestJoin(host, code, "Bia");
    assert.equal(name, "Bia");

    host.send({ type: "admit", peerId: viewerId });
    assert.deepEqual(await viewer.next(), {
      type: "joined",
      code,
      peerId: viewerId,
      hostId,
      hostName: "Ana",
      name: "Bia",
    });
    assert.deepEqual(await host.next(), { type: "peer-joined", peerId: viewerId, name: "Bia" });
    closeAll(host, viewer);
  });

  it("host recusa um pedido de entrada", async () => {
    const { host, code } = await createRoom();
    const { viewer, viewerId } = await requestJoin(host, code);

    host.send({ type: "reject", peerId: viewerId });
    assert.deepEqual(await viewer.next(), { type: "removed", reason: "rejected" });

    // Recusado pode tentar de novo (não ficou preso à sala).
    viewer.send({ type: "join", code, name: "De novo" });
    expectType(await viewer.next(), "waiting");
    closeAll(host, viewer);
  });

  it("host expulsa um viewer aprovado", async () => {
    const { host, code, hostId } = await createRoom();
    const { viewer, viewerId } = await joinApproved(host, code);

    host.send({ type: "kick", peerId: viewerId });
    assert.deepEqual(await viewer.next(), { type: "removed", reason: "kicked" });
    assert.deepEqual(await host.next(), { type: "peer-left", peerId: viewerId });

    viewer.send({ type: "signal", to: hostId, payload: { kind: "answer", sdp: "x" } });
    expectType(await viewer.next(), "error");
    closeAll(host, viewer);
  });

  it("viewer não pode aprovar, recusar nem expulsar", async () => {
    const { host, code } = await createRoom();
    const a = await joinApproved(host, code, "A");
    const b = await requestJoin(host, code, "B");

    a.viewer.send({ type: "admit", peerId: b.viewerId });
    assert.equal(expectType(await a.viewer.next(), "error").code, "not-host");
    a.viewer.send({ type: "kick", peerId: a.viewerId });
    assert.equal(expectType(await a.viewer.next(), "error").code, "not-host");
    closeAll(host, a.viewer, b.viewer);
  });

  it("viewer na fila não pode sinalizar o host", async () => {
    const { host, code, hostId } = await createRoom();
    const { viewer } = await requestJoin(host, code);

    viewer.send({ type: "signal", to: hostId, payload: { kind: "answer", sdp: "x" } });
    assert.equal(expectType(await viewer.next(), "error").code, "not-in-room");
    closeAll(host, viewer);
  });

  it("avisa o host quando quem estava na fila desiste", async () => {
    const { host, code } = await createRoom();
    const { viewer, viewerId } = await requestJoin(host, code);

    viewer.close();
    assert.deepEqual(await host.next(), { type: "join-cancelled", peerId: viewerId });
    host.close();
  });

  it("repassa sinalização nos dois sentidos", async () => {
    const { host, code, hostId } = await createRoom();
    const { viewer, viewerId } = await joinApproved(host, code);

    host.send({ type: "signal", to: viewerId, payload: { kind: "offer", sdp: "v=0 offer" } });
    assert.deepEqual(await viewer.next(), {
      type: "signal",
      from: hostId,
      payload: { kind: "offer", sdp: "v=0 offer" },
    });

    viewer.send({ type: "signal", to: hostId, payload: { kind: "answer", sdp: "v=0 answer" } });
    assert.deepEqual(await host.next(), {
      type: "signal",
      from: viewerId,
      payload: { kind: "answer", sdp: "v=0 answer" },
    });
    closeAll(host, viewer);
  });

  it("viewer não pode sinalizar outro viewer", async () => {
    const { host, code } = await createRoom();
    const a = await joinApproved(host, code, "A");
    const b = await joinApproved(host, code, "B");

    a.viewer.send({ type: "signal", to: b.viewerId, payload: { kind: "answer", sdp: "x" } });
    assert.equal(expectType(await a.viewer.next(), "error").code, "unknown-peer");
    closeAll(host, a.viewer, b.viewer);
  });

  it("rejeita código inexistente e mal formado", async () => {
    const client = await TestClient.connect();
    client.send({ type: "join", code: "000000", name: "X" });
    assert.equal(expectType(await client.next(), "error").code, "room-not-found");
    client.send({ type: "join", code: "12ab", name: "X" });
    assert.equal(expectType(await client.next(), "error").code, "bad-message");
    client.close();
  });

  it("mostra a página do link de convite no navegador", async () => {
    const res = await fetch(`${url.replace(/^ws/, "http")}/j/012345`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await res.text(), /012345/);
  });

  it("aceita ping de keepalive sem responder", async () => {
    const client = await TestClient.connect();
    client.send({ type: "ping" });
    client.send({ type: "create", name: "Host" });
    expectType(await client.next(), "created");
    client.close();
  });

  it("responde erro a JSON inválido", async () => {
    const client = await TestClient.connect();
    client.ws.send("{not json");
    assert.equal(expectType(await client.next(), "error").code, "bad-message");
    client.close();
  });

  it("sobrevive a frame acima do limite e continua atendendo", async () => {
    // Node: processo separado, senão o runner do node:test engoliria o crash.
    // Worker: o wrangler dev já é um processo à parte.
    const child =
      target === "node"
        ? spawn(process.execPath, ["index.ts"], {
            cwd: import.meta.dirname,
            env: { ...process.env, PORT: "0" },
          })
        : undefined;
    try {
      const childUrl = child
        ? ((await once(child.stdout, "data")) as [Buffer])[0].toString().match(/ws:\/\/\S+/)![0]
        : url;

      const abusive = new WebSocket(childUrl);
      await once(abusive, "open");
      abusive.send("x".repeat(70 * 1024));
      await once(abusive, "close");

      const probe = new WebSocket(childUrl);
      await once(probe, "open");
      probe.send(JSON.stringify({ type: "create", name: "probe" }));
      const [reply] = (await once(probe, "message")) as [Buffer];
      assert.equal(JSON.parse(reply.toString()).type, "created");
      assert.equal(child?.exitCode ?? null, null);
      probe.close();
    } finally {
      child?.kill();
    }
  });

  it("rejeita payload de sinalização malformado", async () => {
    const { host, code } = await createRoom();
    const { viewer, viewerId } = await joinApproved(host, code);

    host.send({ type: "signal", to: viewerId, payload: null });
    assert.equal(expectType(await host.next(), "error").code, "bad-message");
    closeAll(host, viewer);
  });

  it("viewer não pode mandar offer ao host", async () => {
    const { host, code, hostId } = await createRoom();
    const { viewer } = await joinApproved(host, code);

    viewer.send({ type: "signal", to: hostId, payload: { kind: "offer", sdp: "v=0" } });
    assert.equal(expectType(await viewer.next(), "error").code, "bad-message");
    closeAll(host, viewer);
  });

  it("fecha a sala para viewers e fila quando o host sai", async () => {
    const { host, code } = await createRoom();
    const { viewer } = await joinApproved(host, code);
    const waiting = await requestJoin(host, code);

    host.close();
    assert.deepEqual(await viewer.next(), { type: "room-closed" });
    assert.deepEqual(await waiting.viewer.next(), { type: "room-closed" });

    const late = await TestClient.connect();
    late.send({ type: "join", code, name: "X" });
    assert.equal(expectType(await late.next(), "error").code, "room-not-found");
    closeAll(viewer, waiting.viewer, late);
  });

  it("avisa o host quando um viewer sai", async () => {
    const { host, code } = await createRoom();
    const { viewer, viewerId } = await joinApproved(host, code);

    viewer.close();
    assert.deepEqual(await host.next(), { type: "peer-left", peerId: viewerId });
    host.close();
  });

  it("limita a sala a 8 viewers", async () => {
    const { host, code } = await createRoom();
    const clients: TestClient[] = [];
    for (let i = 0; i < 8; i++) clients.push((await joinApproved(host, code, `A${i}`)).viewer);

    const extra = await TestClient.connect();
    extra.send({ type: "join", code, name: "Extra" });
    assert.equal(expectType(await extra.next(), "error").code, "room-full");
    closeAll(host, extra, ...clients);
  });

  it("limita a fila de espera sem ocupar vagas de viewers", async () => {
    const { host, code } = await createRoom();
    const queued: TestClient[] = [];
    for (let i = 0; i < MAX_PENDING; i++) queued.push((await requestJoin(host, code, `P${i}`)).viewer);

    const extra = await TestClient.connect();
    extra.send({ type: "join", code, name: "Extra" });
    assert.equal(expectType(await extra.next(), "error").code, "room-full");
    closeAll(host, extra, ...queued);
  });

  it("recusa automaticamente quem fica na fila sem resposta", async () => {
    const { host, code } = await createRoom();
    const { viewer, viewerId } = await requestJoin(host, code);

    // pendingTimeoutMs = 1000 no servidor de teste.
    assert.deepEqual(await viewer.next(), { type: "removed", reason: "rejected" });
    assert.deepEqual(await host.next(), { type: "join-cancelled", peerId: viewerId });
    closeAll(host, viewer);
  });

  it("saneia nomes de exibição", async () => {
    const { host, code } = await createRoom();
    const { viewer, name } = await requestJoin(host, code, "  Zé\n\u0007  da   Silva ");
    assert.equal(name, "Zé da Silva");
    closeAll(host, viewer);
  });
});

describe("sanitizeName", () => {
  it("corta no limite e usa padrão quando vazio", () => {
    assert.equal(sanitizeName("x".repeat(50)).length, 32);
    assert.equal(sanitizeName("   "), "Convidado");
    assert.equal(sanitizeName(42), "Convidado");
  });
});
