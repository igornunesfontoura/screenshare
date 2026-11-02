import { randomInt, randomUUID } from "node:crypto";
import {
  MAX_VIEWERS,
  ROOM_CODE_LENGTH,
  type ErrorCode,
  type PeerId,
  type ServerMessage,
} from "../shared/protocol.ts";

export interface Peer {
  id: PeerId;
  send(message: ServerMessage): void;
}

interface Room {
  code: string;
  host: Peer;
  viewers: Map<PeerId, Peer>;
}

export class RoomError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// Estado de salas em memória. Um peer participa de no máximo uma sala.
export class RoomRegistry {
  private rooms = new Map<string, Room>();
  private roomOf = new Map<PeerId, Room>();

  static newPeerId(): PeerId {
    return randomUUID();
  }

  get size(): number {
    return this.rooms.size;
  }

  create(host: Peer): string {
    this.assertFree(host);
    const code = this.uniqueCode();
    const room: Room = { code, host, viewers: new Map() };
    this.rooms.set(code, room);
    this.roomOf.set(host.id, room);
    return code;
  }

  isHost(peer: Peer): boolean {
    return this.roomOf.get(peer.id)?.host.id === peer.id;
  }

  join(code: string, viewer: Peer): Room {
    this.assertFree(viewer);
    const room = this.rooms.get(code);
    if (!room) throw new RoomError("room-not-found", "Sala não encontrada.");
    if (room.viewers.size >= MAX_VIEWERS) {
      throw new RoomError("room-full", "A sala está cheia.");
    }
    room.viewers.set(viewer.id, viewer);
    this.roomOf.set(viewer.id, room);
    room.host.send({ type: "peer-joined", peerId: viewer.id });
    return room;
  }

  // Repassa sinalização apenas entre host e viewers da mesma sala.
  relay(from: Peer, to: PeerId, message: ServerMessage): void {
    const room = this.roomOf.get(from.id);
    if (!room) throw new RoomError("not-in-room", "Você não está em uma sala.");
    const fromIsHost = room.host.id === from.id;
    const target = fromIsHost
      ? room.viewers.get(to)
      : to === room.host.id
        ? room.host
        : undefined;
    if (!target) throw new RoomError("unknown-peer", "Peer de destino inválido.");
    target.send(message);
  }

  leave(peer: Peer): void {
    const room = this.roomOf.get(peer.id);
    if (!room) return;
    this.roomOf.delete(peer.id);

    if (room.host.id === peer.id) {
      for (const viewer of room.viewers.values()) {
        this.roomOf.delete(viewer.id);
        viewer.send({ type: "room-closed" });
      }
      this.rooms.delete(room.code);
      return;
    }

    room.viewers.delete(peer.id);
    room.host.send({ type: "peer-left", peerId: peer.id });
  }

  private assertFree(peer: Peer): void {
    if (this.roomOf.has(peer.id)) {
      throw new RoomError("already-in-room", "Você já está em uma sala.");
    }
  }

  private uniqueCode(): string {
    const max = 10 ** ROOM_CODE_LENGTH;
    for (let attempt = 0; attempt < 100; attempt++) {
      const code = randomInt(0, max).toString().padStart(ROOM_CODE_LENGTH, "0");
      if (!this.rooms.has(code)) return code;
    }
    throw new RoomError("server-full", "Servidor sem códigos livres. Tente mais tarde.");
  }
}
