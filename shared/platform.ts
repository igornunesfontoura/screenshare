// Contrato da ponte main ↔ renderer exposta pelo preload em `window.screenshare`.

export type CaptureBackend = "dxgi-wasapi" | "pipewire" | "unsupported";

export interface PlatformInfo {
  version: string;
  os: string;
  arch: string;
  captureBackend: CaptureBackend;
}

export interface CaptureSource {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
}

// No Wayland quem escolhe a tela é o seletor do portal (sistema);
// no Windows/X11 o app mostra a própria lista de fontes.
export type SourceListing = { picker: "system" } | { picker: "app"; sources: CaptureSource[] };

export interface CaptureRequest {
  sourceId: string | null;
  systemAudio: boolean;
}

export interface PreparedCapture {
  // true: o áudio vem junto do getDisplayMedia (loopback do Windows).
  audioViaDisplayMedia: boolean;
}

// Um app que toca áudio no host. `id` é estável entre execuções (binário/executável).
export interface AudioApp {
  id: string;
  name: string;
}

// `supported` false: a plataforma só captura o áudio do sistema inteiro.
export interface AudioAppListing {
  supported: boolean;
  apps: AudioApp[];
}

// Como o áudio do sistema chega ao renderer:
// - device: dispositivo de entrada (Linux) aberto com getUserMedia pelo `label`;
// - pcm: Float32 estéreo intercalado a PCM_SAMPLE_RATE por um MessagePort entregue
//   via `window.postMessage(PCM_PORT_MESSAGE)` (helper do Windows).
export type SystemAudioSource = { kind: "device"; label: string } | { kind: "pcm" };

export const PCM_SAMPLE_RATE = 48_000;
export const PCM_CHANNELS = 2;
export const PCM_PORT_MESSAGE = "screenshare:pcm-port";

// Atualização automática (instalador do Windows e AppImage). O .exe portátil não
// se atualiza sozinho: recebe "available" com o link da página de downloads.
export type UpdateStatus =
  | { state: "idle" }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string }
  | { state: "available"; version: string; url: string };

export interface ScreenShareBridge {
  platformInfo(): Promise<PlatformInfo>;
  listCaptureSources(): Promise<SourceListing>;
  prepareCapture(request: CaptureRequest): Promise<PreparedCapture>;
  // Prepara o áudio do sistema filtrado por app (null: indisponível; no Windows sem
  // helper o áudio vem pelo loopback do getDisplayMedia e isto também devolve null).
  startSystemAudio(): Promise<SystemAudioSource | null>;
  stopSystemAudio(): Promise<void>;
  listAudioApps(): Promise<AudioAppListing>;
  // Apps fora da transmissão; vale na hora, inclusive ao vivo.
  setBlockedAudioApps(ids: string[]): Promise<void>;
  updateStatus(): Promise<UpdateStatus>;
  // Devolve a função que cancela a inscrição.
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
  // Fecha o app e instala a versão baixada (só com status "ready").
  installUpdate(): Promise<void>;
}

export const IPC = {
  platformInfo: "media:platform-info",
  listCaptureSources: "media:list-capture-sources",
  prepareCapture: "media:prepare-capture",
  startSystemAudio: "media:start-system-audio",
  stopSystemAudio: "media:stop-system-audio",
  listAudioApps: "media:list-audio-apps",
  setBlockedAudioApps: "media:set-blocked-audio-apps",
  pcmPort: "media:pcm-port",
  updateStatus: "update:status",
  updateStatusChanged: "update:status-changed",
  installUpdate: "update:install",
} as const;
