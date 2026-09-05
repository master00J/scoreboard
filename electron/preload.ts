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
  reloadDisplayWindow: () => ipcRenderer.invoke("window:reloadDisplay"),
  saveProofOfPlayExport: (opts) => ipcRenderer.invoke("sponsorPlays:saveExport", opts),
  exportMatch: (opts) => ipcRenderer.invoke("match:export", opts),
  getDesktopCaptureSources: () => ipcRenderer.invoke("desktop:getCaptureSources"),
  reportSponsorClipStart: (payload) => ipcRenderer.invoke("display:sponsorClipStart", payload),
  reportSponsorClipEnd: (payload) => ipcRenderer.invoke("display:sponsorClipEnd", payload),
  reportSponsorClipProgress: (payload) => ipcRenderer.invoke("display:sponsorClipProgress", payload),
  getSponsorLedgerSnapshot: () => ipcRenderer.invoke("display:getSponsorLedger"),
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
  openExternalUrl: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  licenseGetStatus: () => ipcRenderer.invoke("license:getStatus"),
  licenseActivate: (opts: { licenseKey: string }) => ipcRenderer.invoke("license:activate", opts),
  getMobileBridgeInfo: () => ipcRenderer.invoke("mobile:getBridgeInfo"),
  getStreamDeckInfo: () => ipcRenderer.invoke("streamdeck:getInfo"),
  getAppResourceMetrics: () => ipcRenderer.invoke("app:getResourceMetrics"),
  exportVenueBackup: () => ipcRenderer.invoke("backup:exportVenue"),
  getMatchTabLayoutSnapshot: () =>
    ipcRenderer.sendSync("control:getMatchTabLayoutSnapshot") as string | null,
  persistMatchTabLayout: (json: string) => {
    ipcRenderer.sendSync("control:persistMatchTabLayout", json);
  },
  reportDisplayPlaybackContext: (payload) => {
    ipcRenderer.send("display:playbackContext", payload);
  },
  reportDisplayMediaDiagnostic: (payload) => {
    ipcRenderer.send("display:mediaDiagnostic", payload);
  },
  getLivestreamSettings: () => ipcRenderer.invoke("livestream:getSettings"),
  saveLivestreamSettings: (partial) => ipcRenderer.invoke("livestream:saveSettings", partial),
  getLivestreamStatus: () => ipcRenderer.invoke("livestream:getStatus"),
  startLivestream: () => ipcRenderer.invoke("livestream:start"),
  stopLivestream: () => ipcRenderer.invoke("livestream:stop"),
  startLivestreamRecord: () => ipcRenderer.invoke("livestream:startRecord"),
  stopLivestreamRecord: () => ipcRenderer.invoke("livestream:stopRecord"),
  listLivestreamCameras: () => ipcRenderer.invoke("livestream:listCameras"),
  listLivestreamAudioDevices: () => ipcRenderer.invoke("livestream:listAudioDevices"),
  listLivestreamAudioOutputs: () => ipcRenderer.invoke("livestream:listAudioOutputs"),
  openLivestreamBrowserInteract: (url) => ipcRenderer.invoke("livestream:openBrowserInteract", url),
  onLivestreamStatus: (listener) => subscribe("livestream:status", listener),
  onLivestreamSettings: (listener) => subscribe("livestream:settings", listener),
  onLivestreamPreview: (listener) => subscribe("livestream:preview", listener),
  onLivestreamAudioMeters: (listener) => subscribe("livestream:audioMeters", listener),
  onLivestreamReadyRequest: (listener) => subscribe("livestream:requestReady", listener),
  reportStreamProgramReady: () => {
    ipcRenderer.send("livestream:programReady");
  },
};

try {
  contextBridge.exposeInMainWorld("electronAPI", bridge);
} catch (err) {
  console.error("[preload] failed to expose electronAPI", err);
}
