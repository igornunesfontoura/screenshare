// Contrato da ponte main ↔ renderer exposta pelo preload em `window.screenshare`.

export type CaptureBackend = "dxgi-wasapi" | "pipewire" | "unsupported";

export interface PlatformInfo {
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

export interface ScreenShareBridge {
  platformInfo(): Promise<PlatformInfo>;
  listCaptureSources(): Promise<SourceListing>;
  prepareCapture(request: CaptureRequest): Promise<PreparedCapture>;
  // Linux: cria a fonte de áudio do sistema e devolve o nome do dispositivo (ou null).
  startSystemAudio(): Promise<string | null>;
  stopSystemAudio(): Promise<void>;
}

export const IPC = {
  platformInfo: "media:platform-info",
  listCaptureSources: "media:list-capture-sources",
  prepareCapture: "media:prepare-capture",
  startSystemAudio: "media:start-system-audio",
  stopSystemAudio: "media:stop-system-audio",
} as const;
