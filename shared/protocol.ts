// Protocolo de signaling compartilhado entre o servidor (server/) e o app (src/).
// O servidor só repassa SDP/ICE; a mídia trafega direto entre os peers.

export type PeerId = string;
export type Role = "host" | "viewer";

export const ROOM_CODE_LENGTH = 6;
export const MAX_VIEWERS = 8;

export type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "candidate"; candidate: RTCIceCandidateInit };

export type ClientMessage =
  | { type: "create" }
  | { type: "join"; code: string }
  | { type: "signal"; to: PeerId; payload: SignalPayload }
  | { type: "leave" };

export type ServerMessage =
  | { type: "created"; code: string; peerId: PeerId }
  | { type: "joined"; code: string; peerId: PeerId; hostId: PeerId }
  | { type: "peer-joined"; peerId: PeerId }
  | { type: "peer-left"; peerId: PeerId }
  | { type: "room-closed" }
  | { type: "signal"; from: PeerId; payload: SignalPayload }
  | { type: "error"; code: ErrorCode; message: string };

export type ErrorCode =
  | "bad-message"
  | "room-not-found"
  | "room-full"
  | "already-in-room"
  | "not-in-room"
  | "unknown-peer"
  | "rate-limited"
  | "server-full";

export function isValidRoomCode(code: string): boolean {
  return new RegExp(`^\\d{${ROOM_CODE_LENGTH}}$`).test(code);
}
