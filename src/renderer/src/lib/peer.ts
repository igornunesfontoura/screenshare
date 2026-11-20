import type { Role, SignalPayload } from "../../../../shared/protocol.ts";
import { enableOpusStereo } from "../../../../shared/sdp.ts";
import { OVERLAY_SEND, isCameraLayout, type CameraLayout } from "./camera";
import { cleanChatText, isChatMessage, type ChatMessage } from "./chat";
import { iceServers } from "./ice";
import { StatsSampler, type MediaStats } from "./stats";

const PING_INTERVAL_MS = 2000;
const STATS_INTERVAL_MS = 1000;
const AUDIO_MAX_BITRATE = 256_000;
// Folga do buffer do viewer para a transmissão (áudio e vídeo sincronizados).
// Na internet, um buffer curto obriga o receptor a esticar/inventar áudio, o que
// soa "robotizado" em música e filmes; ~250 ms de atraso são imperceptíveis aqui.
const MEDIA_JITTER_BUFFER_MS = 250;

type ReceiverWithTarget = RTCRtpReceiver & { jitterBufferTarget?: number | null };
type PrioritizedEncoding = RTCRtpEncodingParameters & {
  priority?: RTCPriorityType;
  networkPriority?: RTCPriorityType;
};

type ControlMessage =
  | { t: "ping"; ts: number }
  | { t: "pong"; ts: number }
  | { t: "live"; live: boolean }
  // viewer → host: o host carimba autor/hora e repassa a todos como "chat".
  | { t: "chat-send"; text: string }
  | { t: "chat"; message: ChatMessage }
  // host → viewer: webcam sobreposta (visível ou não) e onde desenhá-la.
  | { t: "camera"; visible: boolean; layout: CameraLayout };

// Webcam sobreposta recebida pelo viewer.
export interface RemoteCamera {
  track: MediaStreamTrack;
  layout: CameraLayout;
}

export interface SendParams {
  maxBitrate: number;
  maxFramerate: number;
  degradation: RTCDegradationPreference;
}

export interface PeerLinkEvents {
  onSignal(payload: SignalPayload): void;
  onStateChange(state: RTCPeerConnectionState): void;
  onRtt(ms: number): void;
  onStats(stats: MediaStats): void;
  onRemoteStream(stream: MediaStream): void;
  onRemoteLive(live: boolean): void;
  // Viewer: webcam sobreposta do host (null = sem webcam).
  onRemoteCamera(camera: RemoteCamera | null): void;
  // Voz recebida pelo transceiver de voz (host: microfone do viewer; viewer: mixagem do host).
  onRemoteVoice(track: MediaStreamTrack): void;
  // Host: texto enviado por este viewer. Viewer: mensagem repassada pelo host.
  onChatSend(text: string): void;
  onChat(message: ChatMessage): void;
  // Canal de controle pronto (o host usa para mandar o histórico do chat).
  onControlOpen(): void;
}

// Uma RTCPeerConnection com um peer remoto. O host é sempre quem faz a offer
// (inclusive em renegociações ao adicionar tracks), então não há colisão de offers.
export class PeerLink {
  readonly pc: RTCPeerConnection;
  private readonly role: Role;
  private readonly events: PeerLinkEvents;
  private control: RTCDataChannel | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private pingTimer: number | undefined;
  private readonly statsTimer: number;
  private readonly stats: StatsSampler;

  // Host: um transceiver por tipo, reaproveitado entre transmissões (replaceTrack).
  private video: RTCRtpTransceiver | null = null;
  private audio: RTCRtpTransceiver | null = null;
  // Webcam sobreposta: sempre criada depois de `video`, então no viewer ela é o
  // segundo transceiver de vídeo (o primeiro é a tela ou a webcam principal).
  private camera: RTCRtpTransceiver | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private cameraLayout: CameraLayout | null = null;
  private sendParams: SendParams | null = null;
  private live = false;
  private mediaQueue: Promise<void> = Promise.resolve();

  // Viewer: tracks recebidas do host.
  private remoteTracks = new Map<string, MediaStreamTrack>();
  private remoteCamera: { track: MediaStreamTrack | null; visible: boolean; layout: CameraLayout | null } = {
    track: null,
    visible: false,
    layout: null,
  };

  // Voz nos dois sentidos. O host cria este transceiver primeiro (m-line 0) em modo
  // sendrecv; o viewer o adota na primeira offer. Assim o viewer transmite o microfone
  // com replaceTrack, sem precisar fazer offer (só o host negocia).
  private voice: RTCRtpTransceiver | null = null;
  private voiceTrack: MediaStreamTrack | null = null;

  constructor(role: Role, events: PeerLinkEvents) {
    this.role = role;
    this.events = events;
    this.pc = new RTCPeerConnection({ iceServers: iceServers() });
    this.stats = new StatsSampler(role === "host" ? "outbound-rtp" : "inbound-rtp");

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) events.onSignal({ kind: "candidate", candidate: candidate.toJSON() });
    };
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      events.onStateChange(state);
      // ICE restart dispara negotiationneeded → nova offer com credenciais ICE novas.
      if (state === "failed" && role === "host") this.pc.restartIce();
    };

    this.pc.ontrack = ({ track, transceiver }) => {
      if (transceiver === this.pc.getTransceivers()[0]) {
        events.onRemoteVoice(track);
        return;
      }
      if (role === "viewer") {
        (transceiver.receiver as ReceiverWithTarget).jitterBufferTarget = MEDIA_JITTER_BUFFER_MS;
        if (track.kind === "video" && this.videoTransceivers().indexOf(transceiver) === 1) {
          this.remoteCamera.track = track;
          this.emitRemoteCamera();
          return;
        }
        this.remoteTracks.set(track.kind, track);
        events.onRemoteStream(new MediaStream([...this.remoteTracks.values()]));
      }
    };

    if (role === "host") {
      this.voice = this.pc.addTransceiver("audio", { direction: "sendrecv" });
      this.pc.onnegotiationneeded = () => {
        this.sendOffer().catch((err: unknown) => console.error("Falha ao criar offer", err));
      };
      this.attachControl(this.pc.createDataChannel("control"));
    } else {
      this.pc.ondatachannel = ({ channel }) => {
        if (channel.label === "control") this.attachControl(channel);
      };
    }

    this.statsTimer = window.setInterval(() => {
      if (this.pc.connectionState !== "connected") return;
      this.stats
        .sample(this.pc, this.mainVideoMid())
        .then((stats) => stats && events.onStats(stats))
        .catch(() => undefined);
    }, STATS_INTERVAL_MS);
  }

  // Host: passa a enviar este stream (ou para de enviar, com null).
  setLocalStream(stream: MediaStream | null, params: SendParams): Promise<void> {
    // Serializado: trocas rápidas de stream não podem intercalar replaceTrack.
    this.mediaQueue = this.mediaQueue
      .then(() => this.applyLocalStream(stream, params))
      .catch((err: unknown) => console.error("Falha ao trocar a mídia enviada", err));
    return this.mediaQueue;
  }

  // Host: webcam sobreposta à tela (null = desligada) e onde os viewers a desenham.
  setCamera(track: MediaStreamTrack | null, layout: CameraLayout): Promise<void> {
    this.cameraTrack = track;
    this.cameraLayout = layout;
    this.mediaQueue = this.mediaQueue
      .then(() => this.applyCamera())
      .catch((err: unknown) => console.error("Falha ao trocar a webcam enviada", err));
    return this.mediaQueue;
  }

  // false quando o canal ainda não abriu (a mensagem não foi enviada).
  // Host: mixagem para este viewer. Viewer: o próprio microfone (null = silêncio).
  setVoiceTrack(track: MediaStreamTrack | null): void {
    this.voiceTrack = track;
    if (!this.voice) return;
    this.voice.sender
      .replaceTrack(track)
      .catch((err: unknown) => console.error("Falha ao trocar a trilha de voz", err));
  }

  sendChatText(text: string): boolean {
    return this.sendControl({ t: "chat-send", text });
  }

  deliverChat(message: ChatMessage): void {
    this.sendControl({ t: "chat", message });
  }

  async handleSignal(payload: SignalPayload): Promise<void> {
    switch (payload.kind) {
      case "offer": {
        // Só o host faz offers; uma offer recebida pelo host é inválida.
        if (this.role === "host") return;
        await this.pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
        await this.flushCandidates();
        this.adoptVoiceTransceiver();
        const answer = await this.pc.createAnswer();
        // O receptor declara que aceita Opus estéreo em bitrate alto.
        await this.pc.setLocalDescription({ type: "answer", sdp: enableOpusStereo(answer.sdp!) });
        this.events.onSignal({ kind: "answer", sdp: this.pc.localDescription!.sdp });
        return;
      }
      case "answer":
        if (this.role === "viewer") return;
        await this.pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
        await this.flushCandidates();
        // As encodings só existem depois da negociação; aplica bitrate/FPS agora,
        // na mesma fila das trocas de mídia para não intercalar setParameters.
        this.mediaQueue = this.mediaQueue.then(() => this.applySendParams());
        await this.mediaQueue;
        return;
      case "candidate":
        // Candidatos podem chegar antes da descrição remota; guardamos até lá.
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(payload.candidate);
        else this.pendingCandidates.push(payload.candidate);
        return;
    }
  }

  close(): void {
    window.clearInterval(this.pingTimer);
    window.clearInterval(this.statsTimer);
    this.control?.close();
    this.pc.close();
  }

  private adoptVoiceTransceiver(): void {
    if (this.voice) return;
    const [first] = this.pc.getTransceivers();
    if (first?.receiver.track.kind !== "audio") return;
    this.voice = first;
    // Antes da answer: assim ela sai sendrecv e o viewer pode falar depois sem renegociar.
    first.direction = "sendrecv";
    if (this.voiceTrack) void first.sender.replaceTrack(this.voiceTrack);
  }

  private async applyLocalStream(stream: MediaStream | null, params: SendParams): Promise<void> {
    this.sendParams = params;
    const videoTrack = stream?.getVideoTracks()[0] ?? null;
    const audioTrack = stream?.getAudioTracks()[0] ?? null;

    this.video = await this.attachTrack(this.video, videoTrack, stream);
    this.audio = await this.attachTrack(this.audio, audioTrack, stream);
    if (this.video && videoTrack) preferHardwareFriendlyCodecs(this.video);

    await this.applySendParams();
    this.live = Boolean(videoTrack);
    this.sendControl({ t: "live", live: this.live });
    await this.applyCamera();
  }

  // A webcam sobreposta só existe junto da transmissão principal: o transceiver dela
  // nasce depois do vídeo principal, o que fixa a ordem que o viewer usa para separá-los.
  private async applyCamera(): Promise<void> {
    const track = this.live ? this.cameraTrack : null;
    if (this.video) {
      if (!this.camera && track) {
        this.camera = this.pc.addTransceiver(track, { direction: "sendonly", streams: [new MediaStream([track])] });
      } else if (this.camera && this.camera.sender.track !== track) {
        await this.camera.sender.replaceTrack(track);
      }
      if (this.camera && track) await this.setCameraParameters(this.camera.sender);
    }
    this.sendCameraState();
  }

  private async setCameraParameters(sender: RTCRtpSender): Promise<void> {
    try {
      const params = sender.getParameters();
      if (!params.encodings.length) return;
      const encoding = params.encodings[0] as PrioritizedEncoding;
      encoding.maxBitrate = OVERLAY_SEND.maxBitrate;
      encoding.maxFramerate = OVERLAY_SEND.maxFramerate;
      // Em congestionamento, a tela e o som vêm antes da webcam.
      encoding.priority = "low";
      encoding.networkPriority = "low";
      await sender.setParameters(params);
    } catch (err) {
      console.warn("Falha ao aplicar bitrate da webcam", err);
    }
  }

  private sendCameraState(): void {
    if (this.role !== "host" || !this.cameraLayout) return;
    const visible = Boolean(this.live && this.cameraTrack && this.camera);
    this.sendControl({ t: "camera", visible, layout: this.cameraLayout });
  }

  private videoTransceivers(): RTCRtpTransceiver[] {
    return this.pc.getTransceivers().filter((t) => t.receiver.track.kind === "video");
  }

  // mid do vídeo principal, para as estatísticas não lerem a webcam sobreposta.
  private mainVideoMid(): string | null {
    return (this.role === "host" ? this.video?.mid : this.videoTransceivers()[0]?.mid) ?? null;
  }

  private emitRemoteCamera(): void {
    const { track, visible, layout } = this.remoteCamera;
    this.events.onRemoteCamera(track && visible && layout ? { track, layout } : null);
  }

  private async attachTrack(
    transceiver: RTCRtpTransceiver | null,
    track: MediaStreamTrack | null,
    stream: MediaStream | null,
  ): Promise<RTCRtpTransceiver | null> {
    if (!transceiver) {
      // Criar o transceiver dispara negotiationneeded → offer com a nova m-line.
      if (!track || !stream) return null;
      return this.pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
    }
    await transceiver.sender.replaceTrack(track);
    if (stream) transceiver.sender.setStreams(stream);
    return transceiver;
  }

  // Nunca rejeita: uma falha aqui não pode impedir o aviso "live" aos viewers.
  private async applySendParams(): Promise<void> {
    try {
      await this.setSendParameters();
    } catch (err) {
      console.warn("Falha ao aplicar bitrate/FPS", err);
    }
  }

  private async setSendParameters(): Promise<void> {
    const params = this.sendParams;
    if (!params) return;

    if (this.camera?.sender.track) await this.setCameraParameters(this.camera.sender);

    const videoSender = this.video?.sender;
    if (videoSender?.track) {
      const video = videoSender.getParameters();
      if (video.encodings.length) {
        video.encodings[0].maxBitrate = params.maxBitrate;
        video.encodings[0].maxFramerate = params.maxFramerate;
        (video as RTCRtpSendParameters & { degradationPreference?: RTCDegradationPreference })
          .degradationPreference = params.degradation;
        await videoSender.setParameters(video);
      }
    }

    const audioSender = this.audio?.sender;
    if (audioSender?.track) {
      const audio = audioSender.getParameters();
      if (audio.encodings.length) {
        const encoding = audio.encodings[0] as PrioritizedEncoding;
        encoding.maxBitrate = AUDIO_MAX_BITRATE;
        // Em congestionamento, o vídeo cede antes do som.
        encoding.priority = "high";
        encoding.networkPriority = "high";
        await audioSender.setParameters(audio);
      }
    }
  }

  private async sendOffer(): Promise<void> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription({ type: "offer", sdp: enableOpusStereo(offer.sdp!) });
    this.events.onSignal({ kind: "offer", sdp: this.pc.localDescription!.sdp });
  }

  private async flushCandidates(): Promise<void> {
    const pending = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of pending) await this.pc.addIceCandidate(candidate);
  }

  // Canal de controle: RTT e estado da transmissão; nas próximas fases leva chat e comandos.
  private attachControl(channel: RTCDataChannel): void {
    this.control = channel;
    channel.onopen = () => {
      if (this.role === "host") {
        this.sendControl({ t: "live", live: this.live });
        this.sendCameraState();
      }
      this.events.onControlOpen();
      this.pingTimer = window.setInterval(() => {
        this.sendControl({ t: "ping", ts: performance.now() });
      }, PING_INTERVAL_MS);
    };
    channel.onclose = () => window.clearInterval(this.pingTimer);
    channel.onmessage = (event) => {
      let message: ControlMessage;
      try {
        message = JSON.parse(event.data as string) as ControlMessage;
      } catch {
        return;
      }
      switch (message.t) {
        case "ping":
          this.sendControl({ t: "pong", ts: message.ts });
          return;
        case "pong":
          this.events.onRtt(Math.round(performance.now() - message.ts));
          return;
        case "live":
          if (this.role === "viewer") this.events.onRemoteLive(message.live === true);
          return;
        case "camera":
          if (this.role !== "viewer" || !isCameraLayout(message.layout)) return;
          this.remoteCamera.visible = message.visible === true;
          this.remoteCamera.layout = message.layout;
          this.emitRemoteCamera();
          return;
        case "chat-send": {
          const text = cleanChatText(message.text);
          if (this.role === "host" && text) this.events.onChatSend(text);
          return;
        }
        case "chat":
          if (this.role === "viewer" && isChatMessage(message.message)) {
            this.events.onChat(message.message);
          }
          return;
      }
    };
  }

  private sendControl(message: ControlMessage): boolean {
    if (this.control?.readyState !== "open") return false;
    this.control.send(JSON.stringify(message));
    return true;
  }
}

// H.264 primeiro: é o codec com encode por hardware mais difundido (NVENC, VAAPI,
// Media Foundation). Os demais ficam como fallback na ordem do Chromium.
function preferHardwareFriendlyCodecs(transceiver: RTCRtpTransceiver): void {
  const codecs = RTCRtpReceiver.getCapabilities("video")?.codecs;
  if (!codecs) return;
  const isH264 = (codec: RTCRtpCodec) => codec.mimeType.toLowerCase() === "video/h264";
  transceiver.setCodecPreferences([...codecs.filter(isH264), ...codecs.filter((c) => !isH264(c))]);
}
