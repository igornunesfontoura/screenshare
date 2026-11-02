// Protocolo de signaling compartilhado entre o servidor (server/) e o app (src/).
// O servidor só repassa SDP/ICE; a mídia trafega direto entre os peers.

export type PeerId = string;
export type Role = "host" | "viewer";

export const ROOM_CODE_LENGTH = 6;
export const MAX_VIEWERS = 8;
// Fila de espera separada: lotar a fila não pode bloquear a sala inteira.
export const MAX_PENDING = 4;
export const MAX_NAME_LENGTH = 32;
// O cliente manda "ping" nesse intervalo: proxies (Cloudflare) derrubam WebSocket
// ocioso e o servidor no Workers não consegue mandar ping de protocolo.
export const KEEPALIVE_MS = 30_000;

export type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "candidate"; candidate: RTCIceCandidateInit };

export type ClientMessage =
  | { type: "create"; name: string }
  | { type: "join"; code: string; name: string }
  // Só o host: decide sobre pedidos de entrada e remove viewers.
  | { type: "admit"; peerId: PeerId }
  | { type: "reject"; peerId: PeerId }
  | { type: "kick"; peerId: PeerId }
  | { type: "signal"; to: PeerId; payload: SignalPayload }
  | { type: "leave" }
  | { type: "ping" };

export type ServerMessage =
  | { type: "created"; code: string; peerId: PeerId; name: string }
  // Viewer: aguardando o host aprovar.
  | { type: "waiting"; code: string }
  | { type: "joined"; code: string; peerId: PeerId; hostId: PeerId; hostName: string; name: string }
  // Host: alguém pediu para entrar, ou desistiu antes da resposta.
  | { type: "join-request"; peerId: PeerId; name: string }
  | { type: "join-cancelled"; peerId: PeerId }
  | { type: "peer-joined"; peerId: PeerId; name: string }
  | { type: "peer-left"; peerId: PeerId }
  // Viewer: recusado na entrada ou expulso depois.
  | { type: "removed"; reason: "rejected" | "kicked" }
  | { type: "room-closed" }
  | { type: "signal"; from: PeerId; payload: SignalPayload }
  | { type: "error"; code: ErrorCode; message: string };

export type ErrorCode =
  | "bad-message"
  | "room-not-found"
  | "room-full"
  | "already-in-room"
  | "not-in-room"
  | "not-host"
  | "unknown-peer"
  | "rate-limited"
  | "server-full";

export function isValidRoomCode(code: string): boolean {
  return new RegExp(`^\\d{${ROOM_CODE_LENGTH}}$`).test(code);
}

// Nome de exibição: texto curto, sem quebras/controle; vazio vira "Convidado".
export function sanitizeName(name: unknown): string {
  if (typeof name !== "string") return "Convidado";
  const clean = name.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
  return clean.slice(0, MAX_NAME_LENGTH) || "Convidado";
}
