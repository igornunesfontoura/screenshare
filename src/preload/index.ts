import { contextBridge, ipcRenderer } from "electron";
import { IPC, type ScreenShareBridge } from "../../shared/platform.ts";

const bridge: ScreenShareBridge = {
  platformInfo: () => ipcRenderer.invoke(IPC.platformInfo),
  listCaptureSources: () => ipcRenderer.invoke(IPC.listCaptureSources),
  prepareCapture: (request) => ipcRenderer.invoke(IPC.prepareCapture, request),
  startSystemAudio: () => ipcRenderer.invoke(IPC.startSystemAudio),
  stopSystemAudio: () => ipcRenderer.invoke(IPC.stopSystemAudio),
};

contextBridge.exposeInMainWorld("screenshare", bridge);
