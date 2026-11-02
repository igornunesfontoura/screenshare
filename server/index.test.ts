import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocket, type WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { startSignalingServer } from "./index.ts";

let wss: WebSocketServer;
let url: string;

before(async () => {
  wss = startSignalingServer(0, { joinsPerMinute: 1000 });
  await new Promise((resolve) => wss.once("listening", resolve));
  url = `ws://localhost:${(wss.address() as AddressInfo).port}`;
});

after(() => {
  for (const ws of wss.clients) ws.terminate();
  wss.close();
});

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

async function createRoom() {
  const host = await TestClient.connect();
  host.send({ type: "create" });
  const created = await host.next();
  assert.equal(created.type, "created");
  return { host, code: created.code, hostId: created.peerId };
}

async function joinRoom(code: string) {
  const viewer = await TestClient.connect();
  viewer.send({ type: "join", code });
  return { viewer, joined: await viewer.next() };
}

describe("signaling server", () => {
  it("cria sala com código de 6 dígitos", async () => {
    const { host, code } = await createRoom();
    assert.match(code, /^\d{6}$/);
    host.close();
  });

  it("viewer entra e host é notificado", async () => {
    const { host, code, hostId } = await createRoom();
    const { viewer, joined } = await joinRoom(code);

    assert.equal(joined.type, "joined");
    assert.equal(joined.type === "joined" && joined.hostId, hostId);
    const notice = await host.next();
    assert.deepEqual(notice, { type: "peer-joined", peerId: joined.type === "joined" && joined.peerId });

    host.close();
    viewer.close();
  });

  it("repassa sinalização nos dois sentidos", async () => {
    const { host, code, hostId } = await createRoom();
    const { viewer, joined } = await joinRoom(code);
    assert.equal(joined.type, "joined");
    await host.next(); // peer-joined

    host.send({ type: "signal", to: joined.peerId, payload: { kind: "offer", sdp: "v=0 offer" } });
    assert.deepEqual(await viewer.next(), {
      type: "signal",
      from: hostId,
      payload: { kind: "offer", sdp: "v=0 offer" },
    });

    viewer.send({ type: "signal", to: hostId, payload: { kind: "answer", sdp: "v=0 answer" } });
    assert.deepEqual(await host.next(), {
      type: "signal",
      from: joined.peerId,
      payload: { kind: "answer", sdp: "v=0 answer" },
    });

    host.close();
    viewer.close();
  });

  it("viewer não pode sinalizar outro viewer", async () => {
    const { host, code } = await createRoom();
    const a = await joinRoom(code);
    const b = await joinRoom(code);
    assert.equal(b.joined.type, "joined");

    a.viewer.send({
      type: "signal",
      to: b.joined.type === "joined" ? b.joined.peerId : "",
      payload: { kind: "answer", sdp: "x" },
    });
    const reply = await a.viewer.next();
    assert.equal(reply.type, "error");
    assert.equal(reply.type === "error" && reply.code, "unknown-peer");

    host.close();
    a.viewer.close();
    b.viewer.close();
  });

  it("rejeita código inexistente e mal formado", async () => {
    const missing = await joinRoom("000000");
    assert.equal(missing.joined.type === "error" && missing.joined.code, "room-not-found");

    const malformed = await joinRoom("12ab");
    assert.equal(malformed.joined.type === "error" && malformed.joined.code, "bad-message");

    missing.viewer.close();
    malformed.viewer.close();
  });

  it("responde erro a JSON inválido", async () => {
    const client = await TestClient.connect();
    client.ws.send("{not json");
    const reply = await client.next();
    assert.equal(reply.type === "error" && reply.code, "bad-message");
    client.close();
  });

  it("sobrevive a frame acima do limite e continua atendendo", async () => {
    // Processo separado: no mesmo processo o runner do node:test engoliria o crash.
    const child = spawn(process.execPath, ["index.ts"], {
      cwd: import.meta.dirname,
      env: { ...process.env, PORT: "0" },
    });
    try {
      const [line] = (await once(child.stdout, "data")) as [Buffer];
      const childUrl = line.toString().match(/ws:\/\/\S+/)![0];

      const abusive = new WebSocket(childUrl);
      await once(abusive, "open");
      abusive.send("x".repeat(70 * 1024));
      await once(abusive, "close");

      const probe = new WebSocket(childUrl);
      await once(probe, "open");
      probe.send(JSON.stringify({ type: "create" }));
      const [reply] = (await once(probe, "message")) as [Buffer];
      assert.equal(JSON.parse(reply.toString()).type, "created");
      assert.equal(child.exitCode, null);
      probe.close();
    } finally {
      child.kill();
    }
  });

  it("rejeita payload de sinalização malformado", async () => {
    const { host, code } = await createRoom();
    const { viewer, joined } = await joinRoom(code);
    await host.next(); // peer-joined

    host.send({ type: "signal", to: joined.type === "joined" ? joined.peerId : "", payload: null });
    const reply = await host.next();
    assert.equal(reply.type === "error" && reply.code, "bad-message");

    host.close();
    viewer.close();
  });

  it("viewer não pode mandar offer ao host", async () => {
    const { host, code, hostId } = await createRoom();
    const { viewer } = await joinRoom(code);
    await host.next(); // peer-joined

    viewer.send({ type: "signal", to: hostId, payload: { kind: "offer", sdp: "v=0" } });
    const reply = await viewer.next();
    assert.equal(reply.type === "error" && reply.code, "bad-message");

    host.close();
    viewer.close();
  });

  it("fecha a sala para os viewers quando o host sai", async () => {
    const { host, code } = await createRoom();
    const { viewer } = await joinRoom(code);
    await host.next(); // peer-joined

    host.close();
    assert.deepEqual(await viewer.next(), { type: "room-closed" });

    const late = await joinRoom(code);
    assert.equal(late.joined.type === "error" && late.joined.code, "room-not-found");
    viewer.close();
    late.viewer.close();
  });

  it("avisa o host quando um viewer sai", async () => {
    const { host, code } = await createRoom();
    const { viewer, joined } = await joinRoom(code);
    await host.next(); // peer-joined

    viewer.close();
    assert.deepEqual(await host.next(), {
      type: "peer-left",
      peerId: joined.type === "joined" && joined.peerId,
    });
    host.close();
  });

  it("limita a sala a 8 viewers", async () => {
    const { host, code } = await createRoom();
    const viewers = [];
    for (let i = 0; i < 8; i++) viewers.push((await joinRoom(code)).viewer);

    const extra = await joinRoom(code);
    assert.equal(extra.joined.type === "error" && extra.joined.code, "room-full");

    host.close();
    for (const v of [...viewers, extra.viewer]) v.close();
  });
});
