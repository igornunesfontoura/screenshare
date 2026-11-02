import {
  isValidRoomCode,
  sanitizeName,
  type ClientMessage,
  type SignalPayload,
} from "../shared/protocol.ts";
import { RoomError, type Peer, type RoomRegistry } from "./rooms.ts";

// Tratamento de mensagens independente do transporte: usado pelo servidor Node
// (index.ts) e pelo Durable Object do Cloudflare Workers (worker.ts).

export const MAX_MESSAGE_BYTES = 64 * 1024;

export function receive(
  registry: RoomRegistry,
  peer: Peer,
  raw: string,
  allowJoin: () => boolean,
): void {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw);
  } catch {
    peer.send({ type: "error", code: "bad-message", message: "JSON inválido." });
    return;
  }

  try {
    handle(registry, peer, message, allowJoin);
  } catch (err) {
    if (err instanceof RoomError) {
      peer.send({ type: "error", code: err.code, message: err.message });
      return;
    }
    // Um bug aqui não pode derrubar todas as salas.
    console.error("Erro inesperado ao tratar mensagem:", err);
    peer.send({ type: "error", code: "bad-message", message: "Mensagem não processada." });
  }
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
    case "ping":
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
