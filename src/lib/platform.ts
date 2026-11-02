import { invoke } from "@tauri-apps/api/core";

export type CaptureBackend = "dxgi-wasapi" | "pipewire" | "unsupported";

export interface PlatformInfo {
  os: string;
  arch: string;
  captureBackend: CaptureBackend;
}

export function getPlatformInfo(): Promise<PlatformInfo> {
  return invoke<PlatformInfo>("platform_info");
}
