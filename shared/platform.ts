// Contrato da ponte main ↔ renderer exposta pelo preload em `window.screenshare`.

export type CaptureBackend = "dxgi-wasapi" | "pipewire" | "unsupported";

export interface PlatformInfo {
  os: string;
  arch: string;
  captureBackend: CaptureBackend;
}

export interface ScreenShareBridge {
  platformInfo(): Promise<PlatformInfo>;
}

export const IPC = {
  platformInfo: "media:platform-info",
} as const;
