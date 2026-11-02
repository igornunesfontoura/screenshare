import { randomInt, randomUUID } from "node:crypto";
import {
  MAX_PENDING,
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

interface Member {
  peer: Peer;
  name: string;
  // Só para quem está na fila: recusa automática se o host não responder.
  expiry?: ReturnType<typeof setTimeout>;
}

const DEFAULT_PENDING_TIMEOUT_MS = 60_000;

interface Room {
  code: string;
  host: Member;
  // Aguardando aprovação do host: não podem sinalizar nem ver nada da sala.
  pending: Map<PeerId, Member>;
  viewers: Map<PeerId, Member>;
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
  private readonly pendingTimeoutMs: number;

  constructor(pendingTimeoutMs = DEFAULT_PENDING_TIMEOUT_MS) {
    this.pendingTimeoutMs = pendingTimeoutMs;
  }

  private roomOf = new Map<PeerId, Room>();

  static newPeerId(): PeerId {
    return randomUUID();
  }

  get size(): number {
    return this.rooms.size;
  }

  isHost(peer: Peer): boolean {
    return this.roomOf.get(peer.id)?.host.peer.id === peer.id;
  }

  create(host: Peer, name: string): string {
    this.assertFree(host);
    const code = this.uniqueCode();
    const room: Room = { code, host: { peer: host, name }, pending: new Map(), viewers: new Map() };
    this.rooms.set(code, room);
    this.roomOf.set(host.id, room);
    return code;
  }

  // Coloca o viewer na fila de aprovação e avisa o host.
  requestJoin(code: string, viewer: Peer, name: string): void {
    this.assertFree(viewer);
    const room = this.rooms.get(code);
    if (!room) throw new RoomError("room-not-found", "Sala não encontrada.");
    if (room.viewers.size >= MAX_VIEWERS) {
      throw new RoomError("room-full", "A sala está cheia.");
    }
    if (room.pending.size >= MAX_PENDING) {
      throw new RoomError("room-full", "Muitos pedidos aguardando o host. Tente em instantes.");
    }
    const expiry = setTimeout(() => this.expirePending(room, viewer.id), this.pendingTimeoutMs);
    room.pending.set(viewer.id, { peer: viewer, name, expiry });
    this.roomOf.set(viewer.id, room);
    viewer.send({ type: "waiting", code });
    room.host.peer.send({ type: "join-request", peerId: viewer.id, name });
  }

  admit(host: Peer, peerId: PeerId): void {
    const room = this.hostRoom(host);
    const member = room.pending.get(peerId);
    if (!member) throw new RoomError("unknown-peer", "Pedido de entrada não encontrado.");
    if (room.viewers.size >= MAX_VIEWERS) throw new RoomError("room-full", "A sala está cheia.");
    clearTimeout(member.expiry);
    room.pending.delete(peerId);
    room.viewers.set(peerId, member);
    member.peer.send({
      type: "joined",
      code: room.code,
      peerId,
      hostId: host.id,
      hostName: room.host.name,
      name: member.name,
    });
    host.send({ type: "peer-joined", peerId, name: member.name });
  }

  reject(host: Peer, peerId: PeerId): void {
    const room = this.hostRoom(host);
    const member = room.pending.get(peerId);
    if (!member) throw new RoomError("unknown-peer", "Pedido de entrada não encontrado.");
    clearTimeout(member.expiry);
    room.pending.delete(peerId);
    this.roomOf.delete(peerId);
    member.peer.send({ type: "removed", reason: "rejected" });
  }

  private expirePending(room: Room, peerId: PeerId): void {
    const member = room.pending.get(peerId);
    if (!member) return;
    room.pending.delete(peerId);
    this.roomOf.delete(peerId);
    member.peer.send({ type: "removed", reason: "rejected" });
    room.host.peer.send({ type: "join-cancelled", peerId });
  }

  kick(host: Peer, peerId: PeerId): void {
    const room = this.hostRoom(host);
    const member = room.viewers.get(peerId);
    if (!member) throw new RoomError("unknown-peer", "Espectador não encontrado.");
    room.viewers.delete(peerId);
    this.roomOf.delete(peerId);
    member.peer.send({ type: "removed", reason: "kicked" });
    host.send({ type: "peer-left", peerId });
  }

  // Repassa sinalização apenas entre o host e viewers já aprovados.
  relay(from: Peer, to: PeerId, message: ServerMessage): void {
    const room = this.roomOf.get(from.id);
    if (!room) throw new RoomError("not-in-room", "Você não está em uma sala.");
    const fromIsHost = room.host.peer.id === from.id;
    if (!fromIsHost && !room.viewers.has(from.id)) {
      throw new RoomError("not-in-room", "Aguardando aprovação do host.");
    }
    const target = fromIsHost
      ? room.viewers.get(to)?.peer
      : to === room.host.peer.id
        ? room.host.peer
        : undefined;
    if (!target) throw new RoomError("unknown-peer", "Peer de destino inválido.");
    target.send(message);
  }

  leave(peer: Peer): void {
    const room = this.roomOf.get(peer.id);
    if (!room) return;
    this.roomOf.delete(peer.id);

    if (room.host.peer.id === peer.id) {
      for (const member of [...room.viewers.values(), ...room.pending.values()]) {
        clearTimeout(member.expiry);
        this.roomOf.delete(member.peer.id);
        member.peer.send({ type: "room-closed" });
      }
      this.rooms.delete(room.code);
      return;
    }

    const pending = room.pending.get(peer.id);
    if (pending) {
      clearTimeout(pending.expiry);
      room.pending.delete(peer.id);
      room.host.peer.send({ type: "join-cancelled", peerId: peer.id });
      return;
    }
    room.viewers.delete(peer.id);
    room.host.peer.send({ type: "peer-left", peerId: peer.id });
  }

  private hostRoom(peer: Peer): Room {
    const room = this.roomOf.get(peer.id);
    if (!room || room.host.peer.id !== peer.id) {
      throw new RoomError("not-host", "Só o host pode fazer isso.");
    }
    return room;
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
