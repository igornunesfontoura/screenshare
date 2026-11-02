/// <reference types="vite/client" />

import type { ScreenShareBridge } from "../../../shared/platform.ts";

declare global {
  interface ImportMetaEnv {
    readonly VITE_SIGNALING_URL?: string;
    readonly VITE_TURN_URL?: string;
    readonly VITE_TURN_USERNAME?: string;
    readonly VITE_TURN_CREDENTIAL?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    screenshare?: ScreenShareBridge;
  }
}
