import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, PeerId, Role, ServerMessage } from "../../../../shared/protocol.ts";
import { ChatRateLimiter, appendMessage, cleanChatText, type ChatMessage } from "../lib/chat";
import type { CameraLayout } from "../lib/camera";
import { PeerLink, type RemoteCamera, type SendParams } from "../lib/peer";
import { SIGNALING_URL, SignalingClient } from "../lib/signaling";
import { VoiceMixer } from "../lib/voice";
import type { MediaStats } from "../lib/stats";

export interface PeerStatus {
  name: string;
  state: RTCPeerConnectionState;
  rtt: number | null;
  stats: MediaStats | null;
  // Só no viewer: o que chega do host.
  stream: MediaStream | null;
  live: boolean;
  // Só no viewer: webcam sobreposta do host.
  camera: RemoteCamera | null;
}

export interface JoinRequest {
  peerId: PeerId;
  name: string;
}

// O que o host está transmitindo agora (stream null = nada).
export interface OutgoingMedia {
  stream: MediaStream | null;
  params: SendParams;
  // Webcam sobreposta à tela (null = desligada).
  camera: MediaStreamTrack | null;
  cameraLayout: CameraLayout;
}

export type RoomSession =
  | { status: "idle" }
  | { status: "connecting"; role: Role }
  | { status: "waiting"; code: string }
  | {
      status: "in-room";
      role: Role;
      code: string;
      selfId: PeerId;
      selfName: string;
      hostId: PeerId;
      hostName: string;
    };

export interface UseRoom {
  session: RoomSession;
  peers: Record<PeerId, PeerStatus>;
  requests: JoinRequest[];
  messages: ChatMessage[];
  error: string | null;
  createRoom(name: string): Promise<void>;
  joinRoom(code: string, name: string): Promise<void>;
  admit(peerId: PeerId): void;
  reject(peerId: PeerId): void;
  kick(peerId: PeerId): void;
  // false se a mensagem não pôde ser enviada (canal ainda abrindo).
  sendChat(text: string): boolean;
  leave(): void;
}

const EMPTY_PEER: PeerStatus = {
  name: "",
  state: "new",
  rtt: null,
  stats: null,
  stream: null,
  live: false,
  camera: null,
};

const REMOVED_REASONS = {
  rejected: "O host recusou sua entrada.",
  kicked: "Você foi removido da sala pelo host.",
} as const;

export interface VoiceInput {
  micTrack: MediaStreamTrack | null;
  // Volume de reprodução das vozes recebidas (0..1).
  volume: number;
}

export function useRoom(outgoing: OutgoingMedia, voice: VoiceInput): UseRoom {
  const [session, setSession] = useState<RoomSession>({ status: "idle" });
  const [peers, setPeers] = useState<Record<PeerId, PeerStatus>>({});
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [error, setError] = useState<string | null>(null);

  const signaling = useRef<SignalingClient | null>(null);
  const links = useRef(new Map<PeerId, PeerLink>());
  const role = useRef<Role>("host");
  const inRoom = useRef(false);
  // Identidade própria e nomes dos viewers, lidos ao carimbar mensagens no host.
  const self = useRef<{ id: PeerId; name: string } | null>(null);
  const names = useRef(new Map<PeerId, string>());
  const kicked = useRef(new Set<PeerId>());
  // O servidor não é confiável: o host só abre conexão com quem ele mesmo aprovou.
  const admitted = useRef(new Set<PeerId>());
  const chatLimiter = useRef(new ChatRateLimiter());
  // Incrementa a cada teardown; eventos de sockets de tentativas antigas são ignorados.
  const generation = useRef(0);
  // Lido por ensureLink para que viewers que entram depois já recebam a transmissão.
  const outgoingRef = useRef(outgoing);
  const voiceRef = useRef(voice);
  // Toca as vozes recebidas; no host também monta a mixagem de cada viewer.
  const mixer = useRef<VoiceMixer | null>(null);
  const getMixer = useCallback(() => {
    if (!mixer.current) {
      mixer.current = new VoiceMixer();
      mixer.current.setVolume(voiceRef.current.volume);
      if (role.current === "host") mixer.current.setLocal(voiceRef.current.micTrack);
    }
    return mixer.current;
  }, []);

  const send = useCallback((message: ClientMessage) => signaling.current?.send(message), []);

  const updatePeer = useCallback((id: PeerId, patch: Partial<PeerStatus>) => {
    setPeers((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? EMPTY_PEER), ...patch },
    }));
  }, []);

  // Host: registra a mensagem e repassa a todos os viewers conectados.
  const broadcastChat = useCallback((message: ChatMessage) => {
    // O ref é atualizado já: um canal que abra antes do próximo render
    // precisa receber esta mensagem no histórico.
    messagesRef.current = appendMessage(messagesRef.current, message);
    setMessages(messagesRef.current);
    for (const link of links.current.values()) link.deliverChat(message);
  }, []);

  const systemNotice = useCallback(
    (text: string) => {
      broadcastChat({
        id: crypto.randomUUID(),
        kind: "system",
        from: "system",
        name: "",
        text,
        ts: Date.now(),
      });
    },
    [broadcastChat],
  );

  const dropPeer = useCallback(
    (id: PeerId) => {
      mixer.current?.removePeer(id);
      links.current.get(id)?.close();
      links.current.delete(id);
      setPeers(({ [id]: _, ...rest }) => rest);
      const name = names.current.get(id);
      names.current.delete(id);
      chatLimiter.current.forget(id);
      const wasKicked = kicked.current.delete(id);
      if (name) systemNotice(wasKicked ? `${name} foi removido pelo host.` : `${name} saiu.`);
    },
    [systemNotice],
  );

  const teardown = useCallback((reason: string | null) => {
    generation.current += 1;
    signaling.current?.close();
    signaling.current = null;
    for (const link of links.current.values()) link.close();
    links.current.clear();
    mixer.current?.close();
    mixer.current = null;
    names.current.clear();
    kicked.current.clear();
    admitted.current.clear();
    self.current = null;
    inRoom.current = false;
    setPeers({});
    setRequests([]);
    setMessages([]);
    setSession({ status: "idle" });
    setError(reason);
  }, []);

  const ensureLink = useCallback(
    (id: PeerId): PeerLink => {
      const existing = links.current.get(id);
      if (existing) return existing;

      const link = new PeerLink(role.current, {
        onSignal: (payload) => send({ type: "signal", to: id, payload }),
        onStateChange: (state) => updatePeer(id, { state }),
        onRtt: (rtt) => updatePeer(id, { rtt }),
        onStats: (stats) => updatePeer(id, { stats }),
        onRemoteStream: (stream) => updatePeer(id, { stream }),
        onRemoteLive: (live) => updatePeer(id, { live }),
        onRemoteCamera: (camera) => updatePeer(id, { camera }),
        onRemoteVoice: (track) => getMixer().addRemote(id, track),
        onChatSend: (text) => {
          const name = names.current.get(id);
          if (!name || !chatLimiter.current.allow(id)) return;
          broadcastChat({ id: crypto.randomUUID(), kind: "user", from: id, name, text, ts: Date.now() });
        },
        onChat: (message) => setMessages((prev) => appendMessage(prev, message)),
        onControlOpen: () => {
          // Quem entra depois recebe o que já foi conversado.
          if (role.current !== "host") return;
          for (const message of messagesRef.current) link.deliverChat(message);
        },
      });
      links.current.set(id, link);
      updatePeer(id, { state: "new", name: names.current.get(id) ?? "" });
      // Host envia a este viewer a mixagem (sem a voz dele); viewer envia o microfone.
      link.setVoiceTrack(
        role.current === "host" ? getMixer().outputFor(id) : voiceRef.current.micTrack,
      );
      if (role.current === "host") {
        const media = outgoingRef.current;
        if (media.stream) void link.setLocalStream(media.stream, media.params);
        void link.setCamera(media.camera, media.cameraLayout);
      }
      return link;
    },
    [broadcastChat, getMixer, send, updatePeer],
  );

  const handleMessage = useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case "created":
          inRoom.current = true;
          self.current = { id: message.peerId, name: message.name };
          setSession({
            status: "in-room",
            role: "host",
            code: message.code,
            selfId: message.peerId,
            selfName: message.name,
            hostId: message.peerId,
            hostName: message.name,
          });
          return;
        case "waiting":
          setSession({ status: "waiting", code: message.code });
          return;
        case "joined":
          inRoom.current = true;
          self.current = { id: message.peerId, name: message.name };
          names.current.set(message.hostId, message.hostName);
          setSession({
            status: "in-room",
            role: "viewer",
            code: message.code,
            selfId: message.peerId,
            selfName: message.name,
            hostId: message.hostId,
            hostName: message.hostName,
          });
          ensureLink(message.hostId);
          return;
        case "join-request":
          setRequests((prev) => [
            ...prev.filter((r) => r.peerId !== message.peerId),
            { peerId: message.peerId, name: message.name },
          ]);
          return;
        case "join-cancelled":
          setRequests((prev) => prev.filter((r) => r.peerId !== message.peerId));
          return;
        case "peer-joined":
          // Um servidor malicioso poderia "anunciar" um viewer que o host nunca
          // aprovou para receber a transmissão; só aceitamos quem foi aprovado aqui.
          if (role.current !== "host" || !admitted.current.has(message.peerId)) return;
          names.current.set(message.peerId, message.name);
          // Criar o link no host dispara negotiationneeded → offer.
          ensureLink(message.peerId);
          systemNotice(`${message.name} entrou.`);
          return;
        case "peer-left":
          dropPeer(message.peerId);
          return;
        case "removed":
          teardown(REMOVED_REASONS[message.reason]);
          return;
        case "room-closed":
          teardown("O host encerrou a sala.");
          return;
        case "signal": {
          // Só sinalização de peers já conhecidos (host aprovado ou o próprio host);
          // nunca cria conexão nova a partir de uma mensagem do servidor.
          const link = links.current.get(message.from);
          link
            ?.handleSignal(message.payload)
            .catch((err: unknown) => console.error("Falha na negociação WebRTC", err));
          return;
        }
        case "error":
          // Erros durante a entrada (sala inexistente, cheia) encerram a tentativa.
          if (!inRoom.current) teardown(message.message);
          else setError(message.message);
          return;
      }
    },
    [dropPeer, ensureLink, systemNotice, teardown],
  );

  const connect = useCallback(
    async (as: Role, first: ClientMessage) => {
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

  const createRoom = useCallback(
    (name: string) => connect("host", { type: "create", name }),
    [connect],
  );
  const joinRoom = useCallback(
    (code: string, name: string) => connect("viewer", { type: "join", code, name }),
    [connect],
  );

  const decide = useCallback(
    (type: "admit" | "reject", peerId: PeerId) => {
      if (type === "admit") admitted.current.add(peerId);
      send({ type, peerId });
      setRequests((prev) => prev.filter((r) => r.peerId !== peerId));
    },
    [send],
  );
  const admit = useCallback((peerId: PeerId) => decide("admit", peerId), [decide]);
  const reject = useCallback((peerId: PeerId) => decide("reject", peerId), [decide]);
  const kick = useCallback(
    (peerId: PeerId) => {
      kicked.current.add(peerId);
      send({ type: "kick", peerId });
    },
    [send],
  );

  const sendChat = useCallback(
    (raw: string) => {
      const text = cleanChatText(raw);
      const me = self.current;
      if (!text || !me) return false;
      if (role.current === "host") {
        broadcastChat({ id: crypto.randomUUID(), kind: "user", from: me.id, name: me.name, text, ts: Date.now() });
        return true;
      }
      // O viewer só vê a própria mensagem quando o host a repassa (ordem única).
      return [...links.current.values()].some((link) => link.sendChatText(text));
    },
    [broadcastChat],
  );

  const leave = useCallback(() => teardown(null), [teardown]);

  // Stream principal e webcam mudam separadamente: mexer na webcam (ou no canto
  // dela) não pode reaplicar o stream da tela.
  const { stream: outStream, params: outParams, camera: outCamera, cameraLayout: outLayout } = outgoing;
  useEffect(() => {
    outgoingRef.current = outgoing;
  }, [outgoing]);
  useEffect(() => {
    if (role.current !== "host") return;
    for (const link of links.current.values()) void link.setLocalStream(outStream, outParams);
  }, [outStream, outParams]);
  useEffect(() => {
    if (role.current !== "host") return;
    for (const link of links.current.values()) void link.setCamera(outCamera, outLayout);
  }, [outCamera, outLayout]);

  useEffect(() => {
    voiceRef.current = voice;
    mixer.current?.setVolume(voice.volume);
  }, [voice]);

  // Microfone ligado/desligado: o host troca a entrada da mixagem; o viewer, a trilha enviada.
  useEffect(() => {
    if (role.current === "host") {
      if (voice.micTrack || mixer.current) getMixer().setLocal(voice.micTrack);
      return;
    }
    for (const link of links.current.values()) link.setVoiceTrack(voice.micTrack);
  }, [voice.micTrack, getMixer]);

  useEffect(() => () => teardown(null), [teardown]);

  return {
    session,
    peers,
    requests,
    messages,
    error,
    createRoom,
    joinRoom,
    admit,
    reject,
    kick,
    sendChat,
    leave,
  };
}
