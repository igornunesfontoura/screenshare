import type { PlatformInfo, ScreenShareBridge } from "../../../../shared/platform.ts";

export type { PlatformInfo };

// Fora do Electron (ex.: renderer aberto direto no navegador) a ponte não existe.
export function bridge(): ScreenShareBridge {
  if (!window.screenshare) throw new Error("Ponte do Electron indisponível");
  return window.screenshare;
}

export function hasBridge(): boolean {
  return Boolean(window.screenshare);
}

export async function getPlatformInfo(): Promise<PlatformInfo> {
  return bridge().platformInfo();
}
