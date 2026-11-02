import type { PlatformInfo } from "../../../../shared/platform.ts";

export type { PlatformInfo };

// Fora do Electron (ex.: renderer aberto direto no navegador) a ponte não existe.
export function getPlatformInfo(): Promise<PlatformInfo> {
  if (!window.screenshare) return Promise.reject(new Error("Ponte do Electron indisponível"));
  return window.screenshare.platformInfo();
}
