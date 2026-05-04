import { contextBridge, ipcRenderer } from "electron";
import type { ElectronBridge } from "../lib/desktop-bridge";
import type { SponsorLedgerPayload } from "../lib/sponsor-telemetry";

function subscribe<T>(channel: string, listener: (payload: T) => void) {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.off(channel, wrapped);
  };
}

let context: ElectronBridge["context"];
try {
  context = ipcRenderer.sendSync("app:getContext") as ElectronBridge["context"];
} catch (err) {
  console.error("[preload] failed to read context sync", err);
  context = {
    isElectron: true,
    appRoot: "",
    userDataDir: "",
    uploadsDir: "",
  };
}

const bridge: ElectronBridge = {
  context,
  selectFile: (opts) => ipcRenderer.invoke("dialog:openFile", opts),
  selectFolder: (opts) => ipcRenderer.invoke("dialog:openFolder", opts),
  apiRequest: (req) => ipcRenderer.invoke("api:request", req),
  sendCommand: (cmd) => ipcRenderer.invoke("display:command", cmd),
  getDisplaySnapshot: () => ipcRenderer.invoke("display:getSnapshot"),
  onDisplayState: (listener) => subscribe("display:state", listener),
  onTick: (listener) => subscribe("display:tick", listener),
  onSponsorLedger: (listener) =>
    subscribe<SponsorLedgerPayload | null>("display:sponsorLedger", listener),
  onDisplayError: (listener) => subscribe("display:error", listener),
  focusDisplayWindow: () => ipcRenderer.invoke("window:focusDisplay"),
  exportMatch: (opts) => ipcRenderer.invoke("match:export", opts),
  getDesktopCaptureSources: () => ipcRenderer.invoke("desktop:getCaptureSources"),
  reportSponsorClipStart: (payload) => ipcRenderer.invoke("display:sponsorClipStart", payload),
  reportSponsorClipEnd: (payload) => ipcRenderer.invoke("display:sponsorClipEnd", payload),
  getSponsorLedgerSnapshot: () => ipcRenderer.invoke("display:getSponsorLedger"),
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
  openExternalUrl: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
};

try {
  contextBridge.exposeInMainWorld("electronAPI", bridge);
} catch (err) {
  console.error("[preload] failed to expose electronAPI", err);
}
