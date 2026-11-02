import type { PeerId } from "../../../../shared/protocol.ts";

export type VoiceMode = "off" | "ptt" | "open";

// event.code da tecla de push-to-talk (posição física, independe do layout).
export const PTT_CODE = "KeyV";
export const PTT_LABEL = "V";

export async function openMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

interface RemoteVoice {
  // Toca a voz para quem está nesta máquina. No Chromium, áudio remoto do WebRTC
  // só flui para o WebAudio se também estiver ligado a um elemento de mídia.
  element: HTMLAudioElement;
  source: MediaStreamAudioSourceNode;
}

// Reprodução das vozes recebidas e, no host, a mixagem enviada a cada viewer:
// microfone do host + vozes de todos os outros viewers, nunca a do próprio viewer.
export class VoiceMixer {
  private readonly context = new AudioContext();
  private local: MediaStreamAudioSourceNode | null = null;
  private readonly remotes = new Map<PeerId, RemoteVoice>();
  private readonly outputs = new Map<PeerId, MediaStreamAudioDestinationNode>();
  private volume = 1;

  setLocal(track: MediaStreamTrack | null): void {
    this.local?.disconnect();
    this.local = track ? this.context.createMediaStreamSource(new MediaStream([track])) : null;
    this.rewire();
  }

  addRemote(peerId: PeerId, track: MediaStreamTrack): void {
    this.removeRemote(peerId);
    const stream = new MediaStream([track]);
    const element = new Audio();
    element.srcObject = stream;
    element.volume = this.volume;
    void element.play().catch(() => undefined);
    void this.context.resume();
    this.remotes.set(peerId, { element, source: this.context.createMediaStreamSource(stream) });
    this.rewire();
  }

  // Trilha de voz que o host envia para este viewer (estável; a mixagem muda por trás).
  outputFor(peerId: PeerId): MediaStreamTrack {
    let output = this.outputs.get(peerId);
    if (!output) {
      output = this.context.createMediaStreamDestination();
      this.outputs.set(peerId, output);
      this.rewire();
    }
    return output.stream.getAudioTracks()[0];
  }

  removePeer(peerId: PeerId): void {
    this.removeRemote(peerId);
    this.closeOutput(peerId);
    this.rewire();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    for (const remote of this.remotes.values()) remote.element.volume = volume;
  }

  close(): void {
    for (const peerId of [...this.remotes.keys()]) this.removeRemote(peerId);
    for (const peerId of [...this.outputs.keys()]) this.closeOutput(peerId);
    this.local?.disconnect();
    void this.context.close();
  }

  private closeOutput(peerId: PeerId): void {
    const output = this.outputs.get(peerId);
    if (!output) return;
    output.disconnect();
    for (const track of output.stream.getTracks()) track.stop();
    this.outputs.delete(peerId);
  }

  private removeRemote(peerId: PeerId): void {
    const remote = this.remotes.get(peerId);
    if (!remote) return;
    remote.source.disconnect();
    remote.element.pause();
    remote.element.srcObject = null;
    this.remotes.delete(peerId);
  }

  private rewire(): void {
    this.local?.disconnect();
    for (const remote of this.remotes.values()) remote.source.disconnect();
    for (const [target, output] of this.outputs) {
      this.local?.connect(output);
      for (const [from, remote] of this.remotes) {
        if (from !== target) remote.source.connect(output);
      }
    }
  }
}
