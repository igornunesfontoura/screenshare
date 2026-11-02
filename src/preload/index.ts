import { contextBridge, ipcRenderer } from "electron";
import { IPC, type ScreenShareBridge } from "../../shared/platform.ts";

const bridge: ScreenShareBridge = {
  platformInfo: () => ipcRenderer.invoke(IPC.platformInfo),
};

contextBridge.exposeInMainWorld("screenshare", bridge);
