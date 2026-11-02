import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import {
  isValidRoomCode,
  sanitizeName,
  type ClientMessage,
  type ServerMessage,
  type SignalPayload,
} from "../shared/protocol.ts";
import { JoinRateLimiter } from "./rate-limit.ts";
import { RoomError, RoomRegistry, type Peer } from "./rooms.ts";

const HEARTBEAT_MS = 30_000;
const MAX_MESSAGE_BYTES = 64 * 1024;

export interface SignalingOptions {
  // Atrás de proxy (Render, Fly.io) o IP real vem em X-Forwarded-For.
  trustProxy?: boolean;
  joinsPerMinute?: number;
  pendingTimeoutMs?: number;
}

export function startSignalingServer(port: number, options: SignalingOptions = {}): WebSocketServer {
  const registry = new RoomRegistry(options.pendingTimeoutMs);
  const joinLimiter = new JoinRateLimiter(options.joinsPerMinute);
  const wss = new WebSocketServer({ port, maxPayload: MAX_MESSAGE_BYTES });
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
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        peer.send({ type: "error", code: "bad-message", message: "JSON inválido." });
        return;
      }

      try {
        handle(registry, peer, message, () => joinLimiter.allow(ip));
      } catch (err) {
        if (err instanceof RoomError) {
          peer.send({ type: "error", code: err.code, message: err.message });
          return;
        }
        // Um bug aqui não pode derrubar todas as salas.
        console.error("Erro inesperado ao tratar mensagem:", err);
        peer.send({ type: "error", code: "bad-message", message: "Mensagem não processada." });
      }
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

function handle(
  registry: RoomRegistry,
  peer: Peer,
  message: ClientMessage,
  allowJoin: () => boolean,
): void {
  switch (message?.type) {
    case "create": {
      const name = sanitizeName(message.name);
      const code = registry.create(peer, name);
      peer.send({ type: "created", code, peerId: peer.id, name });
      return;
    }
    case "join": {
      if (typeof message.code !== "string" || !isValidRoomCode(message.code)) {
        throw new RoomError("bad-message", "Código de sala inválido.");
      }
      // Limita tentativas para dificultar varrer os 10^6 códigos possíveis.
      if (!allowJoin()) {
        throw new RoomError("rate-limited", "Muitas tentativas. Aguarde um minuto.");
      }
      registry.requestJoin(message.code, peer, sanitizeName(message.name));
      return;
    }
    case "admit":
    case "reject":
    case "kick": {
      if (typeof message.peerId !== "string") {
        throw new RoomError("bad-message", "Peer inválido.");
      }
      registry[message.type](peer, message.peerId);
      return;
    }
    case "signal": {
      if (typeof message.to !== "string" || !isSignalPayload(message.payload)) {
        throw new RoomError("bad-message", "Mensagem de sinalização inválida.");
      }
      // Só o host faz offers; aceitar de viewers causaria colisão de negociação.
      if (message.payload.kind === "offer" && !registry.isHost(peer)) {
        throw new RoomError("bad-message", "Apenas o host pode enviar offers.");
      }
      registry.relay(peer, message.to, { type: "signal", from: peer.id, payload: message.payload });
      return;
    }
    case "leave":
      registry.leave(peer);
      return;
    default:
      throw new RoomError("bad-message", "Tipo de mensagem desconhecido.");
  }
}

function isSignalPayload(value: unknown): value is SignalPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  switch (payload.kind) {
    case "offer":
    case "answer":
      return typeof payload.sdp === "string";
    case "candidate":
      return typeof payload.candidate === "object" && payload.candidate !== null;
    default:
      return false;
  }
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
