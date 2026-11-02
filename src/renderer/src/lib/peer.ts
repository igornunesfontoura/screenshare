import type { Role, SignalPayload } from "../../../../shared/protocol.ts";
import { iceServers } from "./ice";

const PING_INTERVAL_MS = 2000;

type ControlMessage = { t: "ping"; ts: number } | { t: "pong"; ts: number };

export interface PeerLinkEvents {
  onSignal(payload: SignalPayload): void;
  onStateChange(state: RTCPeerConnectionState): void;
  onRtt(ms: number): void;
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

  constructor(role: Role, events: PeerLinkEvents) {
    this.role = role;
    this.events = events;
    this.pc = new RTCPeerConnection({ iceServers: iceServers() });

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) events.onSignal({ kind: "candidate", candidate: candidate.toJSON() });
    };
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      events.onStateChange(state);
      // ICE restart dispara negotiationneeded → nova offer com credenciais ICE novas.
      if (state === "failed" && role === "host") this.pc.restartIce();
    };

    if (role === "host") {
      this.pc.onnegotiationneeded = () => {
        this.sendOffer().catch((err: unknown) => console.error("Falha ao criar offer", err));
      };
      this.attachControl(this.pc.createDataChannel("control"));
    } else {
      this.pc.ondatachannel = ({ channel }) => {
        if (channel.label === "control") this.attachControl(channel);
      };
    }
  }

  async handleSignal(payload: SignalPayload): Promise<void> {
    switch (payload.kind) {
      case "offer":
        // Só o host faz offers; uma offer recebida pelo host é inválida.
        if (this.role === "host") return;
        await this.pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
        await this.flushCandidates();
        await this.pc.setLocalDescription();
        this.events.onSignal({ kind: "answer", sdp: this.pc.localDescription!.sdp });
        return;
      case "answer":
        if (this.role === "viewer") return;
        await this.pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
        await this.flushCandidates();
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
    this.control?.close();
    this.pc.close();
  }

  private async sendOffer(): Promise<void> {
    await this.pc.setLocalDescription();
    this.events.onSignal({ kind: "offer", sdp: this.pc.localDescription!.sdp });
  }

  private async flushCandidates(): Promise<void> {
    const pending = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of pending) await this.pc.addIceCandidate(candidate);
  }

  // Canal de controle: por enquanto só mede RTT; nas próximas fases leva chat e comandos.
  private attachControl(channel: RTCDataChannel): void {
    this.control = channel;
    channel.onopen = () => {
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
      if (message.t === "ping") this.sendControl({ t: "pong", ts: message.ts });
      else this.events.onRtt(Math.round(performance.now() - message.ts));
    };
  }

  private sendControl(message: ControlMessage): void {
    if (this.control?.readyState === "open") this.control.send(JSON.stringify(message));
  }
}
