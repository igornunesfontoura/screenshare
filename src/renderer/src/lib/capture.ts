import type { CaptureSource, SourceListing } from "../../../../shared/platform.ts";
import { bridge } from "./platform";

export type Resolution = "720p" | "1080p" | "1440p" | "2160p";
export type ContentKind = "motion" | "detail";

export interface CaptureSettings {
  resolution: Resolution;
  fps: 30 | 60;
  bitrateMbps: number;
  // motion: filmes/jogos (prioriza fluidez); detail: texto/apps (prioriza nitidez).
  content: ContentKind;
  systemAudio: boolean;
}

export const DEFAULT_SETTINGS: CaptureSettings = {
  resolution: "1080p",
  fps: 60,
  bitrateMbps: 8,
  content: "motion",
  systemAudio: true,
};

export const RESOLUTIONS: Record<Resolution, { width: number; height: number; label: string }> = {
  "720p": { width: 1280, height: 720, label: "720p" },
  "1080p": { width: 1920, height: 1080, label: "1080p" },
  "1440p": { width: 2560, height: 1440, label: "1440p" },
  "2160p": { width: 3840, height: 2160, label: "4K" },
};

export const BITRATE_RANGE = { min: 2, max: 50 } as const;

export type QualitySettings = Omit<CaptureSettings, "systemAudio">;

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
    audio: audioViaDisplayMedia,
  });
  const [video] = stream.getVideoTracks();
  video.contentHint = settings.content;

  let warning: string | null = null;
  if (settings.systemAudio && !audioViaDisplayMedia) {
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

  return { stream, warning };
}

export function stopCapture(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
  void bridge().stopSystemAudio();
}

async function captureSystemAudio(): Promise<MediaStreamTrack | null> {
  const label = await bridge().startSystemAudio();
  if (!label) return null;

  const device = await waitForAudioInput(label);
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

async function waitForAudioInput(label: string): Promise<MediaDeviceInfo | null> {
  const deadline = performance.now() + AUDIO_DEVICE_WAIT_MS;
  for (;;) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const device = devices.find((d) => d.kind === "audioinput" && d.label === label);
    if (device || performance.now() > deadline) return device ?? null;
    await new Promise((resolve) => setTimeout(resolve, AUDIO_DEVICE_POLL_MS));
  }
}
