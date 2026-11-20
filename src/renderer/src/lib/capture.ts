import {
  PCM_PORT_MESSAGE,
  PCM_SAMPLE_RATE,
  type CaptureSource,
  type SourceListing,
} from "../../../../shared/platform.ts";
import { DEFAULT_LAYOUT, openCamera, type CameraLayout } from "./camera";
import pcmWorkletUrl from "./pcm-worklet.ts?worker&url";
import { bridge } from "./platform";

export type Resolution = "720p" | "1080p" | "1440p" | "2160p";
export type ContentKind = "motion" | "detail";
// screen: tela/janela (com webcam sobreposta opcional); camera: só a webcam.
export type VideoSource = "screen" | "camera";

export interface CaptureSettings {
  resolution: Resolution;
  fps: 30 | 60;
  bitrateMbps: number;
  // motion: filmes/jogos (prioriza fluidez); detail: texto/apps (prioriza nitidez).
  content: ContentKind;
  systemAudio: boolean;
  source: VideoSource;
  // null: câmera padrão do sistema.
  cameraId: string | null;
  // Só com source "screen": webcam sobreposta, liga/desliga ao vivo.
  cameraOverlay: boolean;
  cameraLayout: CameraLayout;
}

export const DEFAULT_SETTINGS: CaptureSettings = {
  resolution: "1080p",
  fps: 60,
  bitrateMbps: 8,
  content: "motion",
  systemAudio: true,
  source: "screen",
  cameraId: null,
  cameraOverlay: false,
  cameraLayout: DEFAULT_LAYOUT,
};

export const RESOLUTIONS: Record<Resolution, { width: number; height: number; label: string }> = {
  "720p": { width: 1280, height: 720, label: "720p" },
  "1080p": { width: 1920, height: 1080, label: "1080p" },
  "1440p": { width: 2560, height: 1440, label: "1440p" },
  "2160p": { width: 3840, height: 2160, label: "4K" },
};

export const BITRATE_RANGE = { min: 2, max: 50 } as const;

export type QualitySettings = Pick<CaptureSettings, "resolution" | "fps" | "bitrateMbps" | "content">;

export const QUALITY_PRESETS: { id: string; label: string; hint: string; settings: QualitySettings }[] = [
  {
    id: "movie",
    label: "Filme",
    hint: "1080p · 30 FPS · 10 Mbps",
    settings: { resolution: "1080p", fps: 30, bitrateMbps: 10, content: "motion" },
  },
  {
    id: "game",
    label: "Jogo",
    hint: "1080p · 60 FPS · 20 Mbps",
    settings: { resolution: "1080p", fps: 60, bitrateMbps: 20, content: "motion" },
  },
  {
    id: "slides",
    label: "Apresentação",
    hint: "1440p · 30 FPS · 6 Mbps",
    settings: { resolution: "1440p", fps: 30, bitrateMbps: 6, content: "detail" },
  },
  {
    id: "4k",
    label: "4K",
    hint: "2160p · 60 FPS · 35 Mbps",
    settings: { resolution: "2160p", fps: 60, bitrateMbps: 35, content: "motion" },
  },
];

export function matchesPreset(settings: CaptureSettings, preset: QualitySettings): boolean {
  return (Object.keys(preset) as (keyof QualitySettings)[]).every((k) => settings[k] === preset[k]);
}

// O PipeWire publica a fonte remapeada de forma assíncrona após o pactl.
const AUDIO_DEVICE_WAIT_MS = 2000;
const AUDIO_DEVICE_POLL_MS = 100;
// O main entrega o MessagePort do PCM antes de responder ao startSystemAudio; o prazo
// só corre depois da resposta, então pode ser curto.
const PCM_PORT_WAIT_MS = 1000;

// Contexto que toca o PCM do helper do Windows; fechado junto com a captura.
let pcmContext: AudioContext | null = null;

export interface StartedCapture {
  stream: MediaStream;
  // Preenchido quando o áudio do sistema foi pedido mas não pôde ser capturado.
  warning: string | null;
}

export type { CaptureSource, SourceListing };

export function listSources(): Promise<SourceListing> {
  return bridge().listCaptureSources();
}

// Captura vídeo (e áudio do sistema, se pedido) e devolve um único MediaStream.
export async function startCapture(
  sourceId: string | null,
  settings: CaptureSettings,
): Promise<StartedCapture> {
  const { width, height } = RESOLUTIONS[settings.resolution];
  if (settings.source === "camera") {
    const video = await openCamera(settings.cameraId, { width, height, fps: settings.fps });
    const stream = new MediaStream([video]);
    // addSystemAudio não rejeita: falhas de áudio viram aviso.
    return { stream, warning: await addSystemAudio(stream, settings.systemAudio) };
  }

  const { audioViaDisplayMedia } = await bridge().prepareCapture({
    sourceId,
    systemAudio: settings.systemAudio,
  });

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { ideal: width, max: width },
      height: { ideal: height, max: height },
      frameRate: { ideal: settings.fps, max: settings.fps },
    },
    // Windows (loopback): pede ao Chromium para excluir o áudio do próprio app,
    // senão as vozes do chat tocadas aqui voltam para os viewers. Ignorado se não suportado.
    audio: audioViaDisplayMedia ? ({ restrictOwnAudio: true } as MediaTrackConstraints) : false,
  });
  const [video] = stream.getVideoTracks();
  video.contentHint = settings.content;

  const warning = await addSystemAudio(stream, settings.systemAudio && !audioViaDisplayMedia);
  return { stream, warning };
}

// Junta o áudio do sistema ao stream; devolve um aviso se ele foi pedido e falhou.
async function addSystemAudio(stream: MediaStream, wanted: boolean): Promise<string | null> {
  let warning: string | null = null;
  if (wanted) {
    try {
      const audio = await captureSystemAudio();
      if (audio) stream.addTrack(audio);
      else warning = "Áudio do sistema indisponível; transmitindo só o vídeo.";
    } catch (err) {
      // Sem áudio a transmissão ainda é útil; seguimos só com o vídeo.
      console.warn("Falha ao capturar o áudio do sistema", err);
      warning = "Falha ao capturar o áudio do sistema; transmitindo só o vídeo.";
    }
  }
  // Sem isto o WebRTC trata a trilha como voz (processamento e codificação de fala).
  for (const audio of stream.getAudioTracks()) audio.contentHint = "music";
  return warning;
}

export function stopCapture(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
  void pcmContext?.close();
  pcmContext = null;
  void bridge().stopSystemAudio();
}

async function captureSystemAudio(): Promise<MediaStreamTrack | null> {
  const port = waitForPcmPort();
  const source = await bridge().startSystemAudio();
  if (!source) {
    port.cancel();
    return null;
  }
  if (source.kind === "pcm") {
    port.arm();
    const received = await port.promise;
    // Sem porta ou sem worklet o helper não pode ficar capturando à toa.
    if (!received) {
      void bridge().stopSystemAudio();
      return null;
    }
    try {
      return await playPcm(received);
    } catch (err) {
      void bridge().stopSystemAudio();
      throw err;
    }
  }
  port.cancel();

  const device = await waitForAudioInput(source.label);
  if (!device) return null;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: device.deviceId },
      channelCount: 2,
      sampleRate: 48000,
      // Processamento de voz estraga música e filmes.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  return stream.getAudioTracks()[0] ?? null;
}

// Escuta o MessagePort que o preload repassa por window.postMessage.
// O listener entra antes do invoke; o prazo só é armado (arm) quando o main responde.
function waitForPcmPort(): { promise: Promise<MessagePort | null>; arm(): void; cancel(): void } {
  let finish: (port: MessagePort | null) => void = () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<MessagePort | null>((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.data !== PCM_PORT_MESSAGE || !event.ports[0]) return;
      finish(event.ports[0]);
    };
    finish = (port) => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(port);
    };
    window.addEventListener("message", onMessage);
  });
  return {
    promise,
    arm: () => {
      timer = setTimeout(() => finish(null), PCM_PORT_WAIT_MS);
    },
    cancel: () => finish(null),
  };
}

async function playPcm(port: MessagePort): Promise<MediaStreamTrack | null> {
  void pcmContext?.close();
  const context = new AudioContext({ sampleRate: PCM_SAMPLE_RATE, latencyHint: "interactive" });
  pcmContext = context;
  try {
    await context.audioWorklet.addModule(pcmWorkletUrl);
    const player = new AudioWorkletNode(context, "pcm-player", {
      numberOfInputs: 0,
      outputChannelCount: [2],
    });
    player.port.postMessage({ port }, [port]);
    const destination = context.createMediaStreamDestination();
    player.connect(destination);
    // O contexto não toca em nenhuma saída, então pode nascer suspenso sem gesto.
    await context.resume();
    return destination.stream.getAudioTracks()[0] ?? null;
  } catch (err) {
    port.close();
    void context.close();
    if (pcmContext === context) pcmContext = null;
    throw err;
  }
}

async function waitForAudioInput(label: string): Promise<MediaDeviceInfo | null> {
  const deadline = performance.now() + AUDIO_DEVICE_WAIT_MS;
  for (;;) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const device = devices.find((d) => d.kind === "audioinput" && d.label === label);
    if (device || performance.now() > deadline) return device ?? null;
    await new Promise((resolve) => setTimeout(resolve, AUDIO_DEVICE_POLL_MS));
  }
}
