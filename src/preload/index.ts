import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, PCM_PORT_MESSAGE, type ScreenShareBridge, type UpdateStatus } from "../../shared/platform.ts";

const bridge: ScreenShareBridge = {
  platformInfo: () => ipcRenderer.invoke(IPC.platformInfo),
  listCaptureSources: () => ipcRenderer.invoke(IPC.listCaptureSources),
  prepareCapture: (request) => ipcRenderer.invoke(IPC.prepareCapture, request),
  startSystemAudio: () => ipcRenderer.invoke(IPC.startSystemAudio),
  stopSystemAudio: () => ipcRenderer.invoke(IPC.stopSystemAudio),
  listAudioApps: () => ipcRenderer.invoke(IPC.listAudioApps),
  setBlockedAudioApps: (ids) => ipcRenderer.invoke(IPC.setBlockedAudioApps, ids),
  updateStatus: () => ipcRenderer.invoke(IPC.updateStatus),
  onUpdateStatus: (listener) => {
    const handler = (_event: IpcRendererEvent, status: UpdateStatus) => listener(status);
    ipcRenderer.on(IPC.updateStatusChanged, handler);
    return () => ipcRenderer.removeListener(IPC.updateStatusChanged, handler);
  },
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
};

contextBridge.exposeInMainWorld("screenshare", bridge);

// MessagePorts não passam pelo contextBridge: o do áudio PCM (Windows) segue por
// window.postMessage, como na documentação do Electron.
// (O tsconfig do preload não inclui a lib DOM, daí o tipo mínimo do window.)
const page = globalThis as unknown as {
  postMessage(message: unknown, targetOrigin: string, transfer: unknown[]): void;
};
ipcRenderer.on(IPC.pcmPort, (event) => {
  page.postMessage(PCM_PORT_MESSAGE, "*", event.ports);
});
