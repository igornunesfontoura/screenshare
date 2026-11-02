import { useCallback, useEffect, useRef, useState } from "react";
import type { PeerId, Role, ServerMessage } from "../../../../shared/protocol.ts";
import { PeerLink } from "../lib/peer";
import { SIGNALING_URL, SignalingClient } from "../lib/signaling";

export interface PeerStatus {
  state: RTCPeerConnectionState;
  rtt: number | null;
}

export type RoomSession =
  | { status: "idle" }
  | { status: "connecting"; role: Role }
  | { status: "in-room"; role: Role; code: string; selfId: PeerId; hostId: PeerId };

export interface UseRoom {
  session: RoomSession;
  peers: Record<PeerId, PeerStatus>;
  error: string | null;
  createRoom(): Promise<void>;
  joinRoom(code: string): Promise<void>;
  leave(): void;
}

export function useRoom(): UseRoom {
  const [session, setSession] = useState<RoomSession>({ status: "idle" });
  const [peers, setPeers] = useState<Record<PeerId, PeerStatus>>({});
  const [error, setError] = useState<string | null>(null);

  const signaling = useRef<SignalingClient | null>(null);
  const links = useRef(new Map<PeerId, PeerLink>());
  const role = useRef<Role>("host");
  const inRoom = useRef(false);
  // Incrementa a cada teardown; eventos de sockets de tentativas antigas são ignorados.
  const generation = useRef(0);

  const updatePeer = useCallback((id: PeerId, patch: Partial<PeerStatus>) => {
    setPeers((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { state: "new", rtt: null }), ...patch },
    }));
  }, []);

  const dropPeer = useCallback((id: PeerId) => {
    links.current.get(id)?.close();
    links.current.delete(id);
    setPeers(({ [id]: _, ...rest }) => rest);
  }, []);

  const teardown = useCallback((reason: string | null) => {
    generation.current += 1;
    signaling.current?.close();
    signaling.current = null;
    for (const link of links.current.values()) link.close();
    links.current.clear();
    inRoom.current = false;
    setPeers({});
    setSession({ status: "idle" });
    setError(reason);
  }, []);

  const ensureLink = useCallback(
    (id: PeerId): PeerLink => {
      const existing = links.current.get(id);
      if (existing) return existing;

      const link = new PeerLink(role.current, {
        onSignal: (payload) => signaling.current?.send({ type: "signal", to: id, payload }),
        onStateChange: (state) => updatePeer(id, { state }),
        onRtt: (rtt) => updatePeer(id, { rtt }),
      });
      links.current.set(id, link);
      updatePeer(id, { state: "new" });
      return link;
    },
    [updatePeer],
  );

  const handleMessage = useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case "created":
          inRoom.current = true;
          setSession({
            status: "in-room",
            role: "host",
            code: message.code,
            selfId: message.peerId,
            hostId: message.peerId,
          });
          return;
        case "joined":
          inRoom.current = true;
          setSession({
            status: "in-room",
            role: "viewer",
            code: message.code,
            selfId: message.peerId,
            hostId: message.hostId,
          });
          ensureLink(message.hostId);
          return;
        case "peer-joined":
          // Criar o link no host dispara negotiationneeded → offer.
          ensureLink(message.peerId);
          return;
        case "peer-left":
          dropPeer(message.peerId);
          return;
        case "room-closed":
          teardown("O host encerrou a sala.");
          return;
        case "signal":
          ensureLink(message.from)
            .handleSignal(message.payload)
            .catch((err: unknown) => console.error("Falha na negociação WebRTC", err));
          return;
        case "error":
          // Erros durante a entrada (sala inexistente, cheia) encerram a tentativa.
          if (!inRoom.current) teardown(message.message);
          else setError(message.message);
          return;
      }
    },
    [dropPeer, ensureLink, teardown],
  );

  const connect = useCallback(
    async (as: Role, first: Parameters<SignalingClient["send"]>[0]) => {
      teardown(null);
      const attempt = generation.current;
      const isCurrent = () => attempt === generation.current;
      role.current = as;
      setSession({ status: "connecting", role: as });
      try {
        const client = await SignalingClient.connect(SIGNALING_URL, {
          onMessage: (message) => {
            if (isCurrent()) handleMessage(message);
          },
          onClose: () => {
            if (isCurrent()) teardown("Conexão com o servidor de signaling perdida.");
          },
        });
        // O usuário saiu (ou clicou de novo) enquanto o socket abria.
        if (!isCurrent()) {
          client.close();
          return;
        }
        signaling.current = client;
        client.send(first);
      } catch (err) {
        if (isCurrent()) teardown(err instanceof Error ? err.message : String(err));
      }
    },
    [handleMessage, teardown],
  );

  const createRoom = useCallback(() => connect("host", { type: "create" }), [connect]);
  const joinRoom = useCallback(
    (code: string) => connect("viewer", { type: "join", code }),
    [connect],
  );
  const leave = useCallback(() => teardown(null), [teardown]);

  useEffect(() => () => teardown(null), [teardown]);

  return { session, peers, error, createRoom, joinRoom, leave };
}
