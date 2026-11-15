import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type ScreenShareBridge, type UpdateStatus } from "../../shared/platform.ts";

const bridge: ScreenShareBridge = {
  platformInfo: () => ipcRenderer.invoke(IPC.platformInfo),
  listCaptureSources: () => ipcRenderer.invoke(IPC.listCaptureSources),
  prepareCapture: (request) => ipcRenderer.invoke(IPC.prepareCapture, request),
  startSystemAudio: () => ipcRenderer.invoke(IPC.startSystemAudio),
  stopSystemAudio: () => ipcRenderer.invoke(IPC.stopSystemAudio),
  updateStatus: () => ipcRenderer.invoke(IPC.updateStatus),
  onUpdateStatus: (listener) => {
    const handler = (_event: IpcRendererEvent, status: UpdateStatus) => listener(status);
    ipcRenderer.on(IPC.updateStatusChanged, handler);
    return () => ipcRenderer.removeListener(IPC.updateStatusChanged, handler);
  },
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
};

contextBridge.exposeInMainWorld("screenshare", bridge);
