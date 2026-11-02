import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import type { ServerMessage } from "../shared/protocol.ts";
import { MAX_MESSAGE_BYTES, receive } from "./handler.ts";
import { httpPage } from "./http-page.ts";
import { JoinRateLimiter } from "./rate-limit.ts";
import { RoomRegistry, type Peer } from "./rooms.ts";

const HEARTBEAT_MS = 30_000;

export interface SignalingOptions {
  // Atrás de proxy (Render, Fly.io) o IP real vem em X-Forwarded-For.
  trustProxy?: boolean;
  joinsPerMinute?: number;
  pendingTimeoutMs?: number;
}

export function startSignalingServer(port: number, options: SignalingOptions = {}): WebSocketServer {
  const registry = new RoomRegistry(options.pendingTimeoutMs);
  const joinLimiter = new JoinRateLimiter(options.joinsPerMinute);
  // HTTP próprio para responder ao link de convite aberto no navegador.
  const http = createServer((req, res) => {
    const page = httpPage(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`);
    res.writeHead(200, { "content-type": page.type }).end(page.body);
  });
  const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE_BYTES });
  wss.on("close", () => http.close());
  http.listen(port);
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on("error", (err) => console.error("Erro no servidor de signaling:", err));

  wss.on("connection", (ws, req) => {
    const ip = clientIp(req, options.trustProxy ?? false);
    const peer: Peer = {
      id: RoomRegistry.newPeerId(),
      send(message: ServerMessage) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
      },
    };
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));

    // Frame acima do limite, UTF-8 inválido etc. Sem este listener o processo cai.
    ws.on("error", () => ws.terminate());

    ws.on("message", (raw) => {
      receive(registry, peer, raw.toString(), () => joinLimiter.allow(ip));
    });

    ws.on("close", () => registry.leave(peer));
  });

  // Derruba conexões mortas (ex.: notebook suspenso) para liberar as salas.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
    joinLimiter.prune();
  }, HEARTBEAT_MS);
  wss.on("close", () => clearInterval(heartbeat));

  return wss;
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (trustProxy && typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

if (import.meta.main) {
  const wss = startSignalingServer(Number(process.env.PORT ?? 8787), {
    trustProxy: process.env.TRUST_PROXY === "1",
  });
  wss.on("listening", () => {
    const { port } = wss.address() as AddressInfo;
    console.log(`Signaling server ouvindo em ws://localhost:${port}`);
  });
  // Sem a porta (ex.: EADDRINUSE) o processo não serve para nada; sai com erro.
  wss.once("error", () => process.exit(1));

  // Como PID 1 num container o Node não trata SIGTERM sozinho; encerra limpo.
  const shutdown = () => {
    for (const client of wss.clients) client.terminate();
    wss.close(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
