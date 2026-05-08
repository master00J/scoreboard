import { app, BrowserWindow, desktopCapturer, ipcMain, dialog, Menu, screen, session, shell } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import type {
  DesktopApiRequest,
  ElectronBridge,
  ExportFormat,
} from "../lib/desktop-bridge";
import * as licenseSvc from "./license-service";
import { startMobileBridge, type MobileBridgeHandle } from "./mobile-bridge";
import { startCloudControlAgent, type CloudAgentHandle } from "./cloud-control";
import { getAppResourceMetrics } from "./resource-metrics";

const IS_DEV = !app.isPackaged;

let controlWindow: BrowserWindow | null = null;
let displayWindow: BrowserWindow | null = null;
let runtime: typeof import("./runtime") | null = null;
let desktopContext: ElectronBridge["context"] | null = null;
let mobileBridge: MobileBridgeHandle | null = null;
let cloudAgent: CloudAgentHandle | null = null;

function bootLogPath(): string {
  return path.join(app.getPath("userData"), "boot.log");
}

function bootLog(line: string) {
  const lineWithNl = `[${new Date().toISOString()}] ${line}\n`;
  try {
    const logFile = bootLogPath();
    try {
      const st = fs.statSync(logFile);
      const maxBytes = 5 * 1024 * 1024;
      if (st.size > maxBytes) {
        const keep = fs.readFileSync(logFile, "utf8").slice(-Math.floor(maxBytes / 2));
        fs.writeFileSync(logFile, keep, "utf8");
      }
    } catch {
      /* ignore */
    }
    fs.appendFileSync(bootLogPath(), lineWithNl, "utf8");
  } catch {
    /* ignore */
  }
  console.log(line);
}

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  bootLog(`[process] unhandledRejection ${msg}`);
});

process.on("uncaughtException", (error) => {
  bootLog(`[process] uncaughtException ${error.name}: ${error.message}`);
});

function appRoot(): string {
  return IS_DEV ? path.join(__dirname, "..", "..") : app.getAppPath();
}

function rendererEntryPath(): string {
  return path.join(appRoot(), "renderer-dist", "index.html");
}

/** ArenaCue-icoon voor vensters (.exe-icoon komt van electron-builder `build.icon`). */
function windowIconPath(): string | undefined {
  const p = path.join(appRoot(), "public", "app-icon.png");
  try {
    if (fs.existsSync(p)) {
      return p;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function prismaDatabaseUrl(dbPath: string): string {
  return `file:${dbPath.replace(/\\/g, "/")}`;
}

function configureDesktopContext() {
  const root = appRoot();
  const userDataDir = app.getPath("userData");
  const dataDir = path.join(userDataDir, "data");
  const uploadsDir = path.join(userDataDir, "uploads");

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });

  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = IS_DEV ? "development" : "production";
  env.DATABASE_URL = prismaDatabaseUrl(path.join(dataDir, "stadium.db"));
  env.STADIUM_UPLOADS_DIR = uploadsDir;

  bootLog(`appRoot=${root} packaged=${app.isPackaged}`);
  bootLog(`DATABASE_URL=${process.env.DATABASE_URL}`);

  return {
    isElectron: true as const,
    appRoot: root,
    userDataDir,
    uploadsDir,
  };
}

async function loadRuntime() {
  desktopContext = configureDesktopContext();
  runtime = await import("./runtime");
  await runtime.initDesktopRuntime({
    getControlWindow: () => controlWindow,
    getDisplayWindow: () => displayWindow,
    log: bootLog,
  });
  mobileBridge = await startMobileBridge({
    runtime: {
      apiRequest: (req) => runtime!.apiRequest(req),
      getDisplaySnapshot: () => runtime!.getDisplaySnapshot(),
      getSponsorLedgerSnapshot: () => runtime!.getSponsorLedgerSnapshot(),
      runCommand: (command) => runtime!.runCommand(command as any),
    },
    log: bootLog,
  });
  cloudAgent = startCloudControlAgent({
    runtime: {
      getDisplaySnapshot: () => runtime!.getDisplaySnapshot(),
      runCommand: (command) => runtime!.runCommand(command as any),
    },
    log: bootLog,
  });
}

function loadView(win: BrowserWindow, view: "control" | "display") {
  return win.loadFile(rendererEntryPath(), {
    query: { view },
  });
}

/**
 * Monitor voor het stadionscherm: bij twee schermen de niet-primaire (meestal HDMI → processor → muur),
 * anders de primaire. Zo blijft de taakbalk op de bedieningsmonitor staan.
 */
function stadiumDisplay() {
  const primary = screen.getPrimaryDisplay();
  const external = screen.getAllDisplays().find((d) => d.id !== primary.id);
  return external ?? primary;
}

function isLikelyVirtualAdapter(name: string): boolean {
  return /bluetooth|docker|hyper-v|loopback|npcap|tap|virtual|vmware|vethernet|wsl/i.test(name);
}

function localNetworkUrls(port: number): string[] {
  const primaryUrls: string[] = [];
  const fallbackUrls: string[] = [];
  const nets = os.networkInterfaces();
  for (const [name, entries] of Object.entries(nets)) {
    for (const net of entries ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      const url = `http://${net.address}:${port}`;
      if (isLikelyVirtualAdapter(name)) fallbackUrls.push(url);
      else primaryUrls.push(url);
    }
  }
  const urls = [...primaryUrls, ...fallbackUrls];
  return urls.length > 0 ? urls : [`http://localhost:${port}`];
}

function mobileLocalPairCodes(handle: MobileBridgeHandle): string[] {
  return localNetworkUrls(handle.port).map((bridgeUrl) =>
    [
      "ACPAIR:local",
      encodeURIComponent(bridgeUrl),
      encodeURIComponent(handle.pairingCode),
      encodeURIComponent(handle.operatorPin ?? ""),
    ].join("|"),
  );
}

/**
 * Display-venster op de gekozen monitor in echte fullscreen — Windows verbergt dan de taakbalk op díé monitor.
 * (Werkgebied gebruiken zou juist ruimte voor de taakbalk vrijlaten.)
 */
function applyDisplayFullscreen(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return;
  try {
    const { x, y, width, height } = stadiumDisplay().bounds;
    win.setBounds({ x, y, width, height });
    if (!win.isFullScreen()) win.setFullScreen(true);
  } catch {
    try {
      win.maximize();
    } catch {
      /* ignore */
    }
  }
}

function createWindows() {
  const preload = path.join(__dirname, "preload.js");

  const winIcon = windowIconPath();

  controlWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Stadium Scoreboard — Control",
    backgroundColor: "#09090b",
    show: true,
    ...(winIcon ? { icon: winIcon } : {}),
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false },
  });
  void loadView(controlWindow, "control");
  controlWindow.webContents.on("did-finish-load", () => {
    void runtime?.broadcastDisplayState();
  });
  if (IS_DEV && process.env.OPEN_DEVTOOLS_ON_START === "1") {
    controlWindow.webContents.openDevTools({ mode: "detach" });
  }
  controlWindow.on("closed", () => {
    controlWindow = null;
  });

  displayWindow = new BrowserWindow({
    title: "Stadium Scoreboard — Display",
    backgroundColor: "#000000",
    frame: false,
    show: false,
    fullscreenable: true,
    ...(winIcon ? { icon: winIcon } : {}),
    /** Windows: resize-rand i.p.v. alleen `maximize()` bij frameless. */
    thickFrame: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  void loadView(displayWindow, "display");
  /** Bounds op stadionscherm, dan fullscreen — geen taakbalk op die monitor. */
  displayWindow.once("ready-to-show", () => {
    applyDisplayFullscreen(displayWindow);
    displayWindow?.show();
    setImmediate(() => applyDisplayFullscreen(displayWindow));
  });
  displayWindow.webContents.on("did-finish-load", () => {
    void runtime?.broadcastDisplayState();
  });
  displayWindow.webContents.on("render-process-gone", (_event, details) => {
    bootLog(`[display] render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
    const win = displayWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.reloadIgnoringCache();
    }
  });
  displayWindow.webContents.on("unresponsive", () => {
    bootLog("[display] renderer unresponsive -> reload");
    const win = displayWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.reloadIgnoringCache();
    }
  });
  displayWindow.on("closed", () => {
    displayWindow = null;
  });

  buildMenu();
}

function buildMenu() {
  const uploadsDir = desktopContext?.uploadsDir ?? path.join(app.getPath("userData"), "uploads");
  const menu = Menu.buildFromTemplate([
    {
      label: "Bestand",
      submenu: [
        {
          label: "Verberg display-venster",
          click: () => displayWindow?.hide(),
        },
        {
          label: "Toon display-venster",
          click: () => {
            displayWindow?.show();
            displayWindow?.focus();
          },
        },
        {
          label: "Display fullscreen aan/uit",
          accelerator: "F11",
          click: () => displayWindow?.setFullScreen(!displayWindow?.isFullScreen()),
        },
        { type: "separator" },
        {
          label: "Open log-map (foutopsporing)",
          click: () => shell.openPath(app.getPath("userData")),
        },
        {
          label: "Open uploads-map",
          click: () => shell.openPath(uploadsDir),
        },
        { type: "separator" },
        { role: "quit", label: "Afsluiten" },
      ],
    },
    {
      label: "Weergave",
      submenu: [
        { role: "reload", label: "Herladen" },
        { type: "separator" },
        { role: "toggleDevTools", label: "DevTools (control)" },
        {
          label: "DevTools (display)",
          click: () => displayWindow?.webContents.openDevTools(),
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Licenties en open source…",
          click: () => {
            void openLegalBundleFolder();
          },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

/** Juridisch: Chromium/npm-attributie (`extraResources` → resources/legal bij packaged build). */
function legalBundleDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "legal");
  }
  return path.join(appRoot(), "legal-dist");
}

async function openLegalBundleFolder() {
  const dir = legalBundleDir();
  try {
    if (!fs.existsSync(dir)) {
      await dialog.showMessageBox({
        type: "info",
        title: "Licenties",
        message: "Licentiemap niet gevonden.",
        detail:
          "Voer lokaal `npm run legal:desktop` uit (genereert legal-dist/), of bouw de installatie opnieuw met `npm run electron:build`.",
      });
      return;
    }
    const err = await shell.openPath(dir);
    if (err) {
      await dialog.showMessageBox({
        type: "warning",
        title: "Licenties",
        message: "Kon de licentiemap niet openen.",
        detail: err,
      });
    }
  } catch (e) {
    bootLog(`openLegalBundleFolder failed ${String(e)}`);
    await dialog.showMessageBox({
      type: "error",
      title: "Licenties",
      message: "Kon de licentiemap niet openen.",
      detail: String(e),
    });
  }
}

function registerIpc() {
  ipcMain.handle("desktop:getCaptureSources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      fetchWindowIcons: true,
      thumbnailSize: { width: 400, height: 225 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
    }));
  });

  ipcMain.on("app:getContext", (event) => {
    event.returnValue = desktopContext;
  });

  ipcMain.handle("app:getVersion", () => app.getVersion());

  ipcMain.handle("app:getResourceMetrics", () => getAppResourceMetrics());

  ipcMain.handle("mobile:getBridgeInfo", () => ({
    enabled: mobileBridge != null,
    port: mobileBridge?.port ?? null,
    pairingCode: mobileBridge?.pairingCode ?? null,
    operatorPin: mobileBridge?.operatorPin ?? null,
    bridgeUrls: mobileBridge ? localNetworkUrls(mobileBridge.port) : [],
    pairCodes: mobileBridge ? mobileLocalPairCodes(mobileBridge) : [],
    operatorPinConfigured: !!mobileBridge?.operatorPin,
    cloud: {
      enabled: cloudAgent != null,
      baseUrl: cloudAgent?.baseUrl ?? null,
      venueId: cloudAgent?.venueId ?? null,
      pairCode: cloudAgent?.customerPairCode ?? null,
    },
  }));

  ipcMain.handle("shell:openExternal", async (_, url: unknown) => {
    if (typeof url !== "string" || !/^https:\/\//i.test(url.trim())) {
      return { ok: false };
    }
    try {
      await shell.openExternal(url.trim());
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle(
    "dialog:openFile",
    async (
      _,
      opts: {
        title?: string;
        filters?: Electron.FileFilter[];
        multiSelections?: boolean;
      },
    ) => {
      const win = BrowserWindow.getFocusedWindow() ?? controlWindow;
      const options = {
        title: opts.title,
        filters: opts.filters ?? [],
        properties: [
          "openFile" as const,
          ...(opts.multiSelections ? (["multiSelections"] as const) : []),
        ],
      };
      return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
    },
  );

  ipcMain.handle(
    "dialog:openFolder",
    async (
      _,
      opts: { title?: string; extensions?: string[] },
    ) => {
      const win = BrowserWindow.getFocusedWindow() ?? controlWindow;
      const options = {
        title: opts.title,
        properties: ["openDirectory" as const],
      };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true, folderPath: null, files: [] as Array<{ name: string; path: string }> };
      }
      const folderPath = result.filePaths[0];
      const extSet = opts.extensions
        ? new Set(opts.extensions.map((ext) => ext.toLowerCase().replace(/^\./, "")))
        : null;
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile())
        .map((e) => ({ name: e.name, path: path.join(folderPath, e.name) }))
        .filter((f) => {
          if (!extSet) return true;
          const ext = path.extname(f.name).slice(1).toLowerCase();
          return extSet.has(ext);
        })
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      return { canceled: false, folderPath, files };
    },
  );

  ipcMain.handle("api:request", async (_, req: DesktopApiRequest) => {
    if (!runtime) throw new Error("Runtime not initialized");
    bootLog(`[api] ${req.method} ${req.path}${req.search ?? ""}`);
    const response = await runtime.apiRequest(req);
    bootLog(`[api] ${req.method} ${req.path} -> ${response.status}`);
    return response;
  });

  ipcMain.handle("display:command", async (_, cmd) => {
    if (!runtime) throw new Error("Runtime not initialized");
    return runtime.runCommand(cmd);
  });

  ipcMain.handle("display:getSnapshot", async () => {
    if (!runtime) throw new Error("Runtime not initialized");
    return runtime.getDisplaySnapshot();
  });

  ipcMain.handle("display:getSponsorLedger", async () => {
    if (!runtime) throw new Error("Runtime not initialized");
    return runtime.getSponsorLedgerSnapshot();
  });

  ipcMain.handle("display:sponsorClipStart", async (_, payload) => {
    if (!runtime) throw new Error("Runtime not initialized");
    runtime.sponsorTelemetryClipStart(payload);
    return { ok: true };
  });

  ipcMain.handle("display:sponsorClipEnd", async (_, payload) => {
    if (!runtime) throw new Error("Runtime not initialized");
    runtime.sponsorTelemetryClipEnd(payload);
    return { ok: true };
  });

  ipcMain.handle("window:focusDisplay", async () => {
    if (!displayWindow) return;
    applyDisplayFullscreen(displayWindow);
    displayWindow.show();
    displayWindow.focus();
    setImmediate(() => applyDisplayFullscreen(displayWindow));
  });

  ipcMain.handle("window:reloadDisplay", async () => {
    if (!displayWindow) return { ok: false };
    try {
      displayWindow.webContents.reloadIgnoringCache();
      setImmediate(() => {
        if (displayWindow) applyDisplayFullscreen(displayWindow);
      });
      return { ok: true };
    } catch (err) {
      console.error("[main] reload display failed", err);
      return { ok: false };
    }
  });

  ipcMain.handle(
    "sponsorPlays:saveExport",
    async (
      _,
      payload: { base64: string; defaultFileName: string; format: "pdf" | "xlsx" },
    ) => {
      const ext = payload.format === "pdf" ? "pdf" : "xlsx";
      let defaultPath = payload.defaultFileName.trim() || `proof-of-play.${ext}`;
      if (!defaultPath.toLowerCase().endsWith(`.${ext}`)) {
        defaultPath = `${defaultPath.replace(/\.(pdf|xlsx)$/i, "")}.${ext}`;
      }
      const win = BrowserWindow.getFocusedWindow() ?? controlWindow;
      const options = {
        defaultPath,
        filters: [
          payload.format === "pdf"
            ? { name: "PDF", extensions: ["pdf"] }
            : { name: "Excel", extensions: ["xlsx"] },
        ],
      };
      const saveResult = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (saveResult.canceled || !saveResult.filePath) {
        return { canceled: true };
      }
      try {
        const buf = Buffer.from(payload.base64, "base64");
        fs.writeFileSync(saveResult.filePath, buf);
      } catch (err) {
        console.error("[main] sponsorPlays:saveExport write failed", err);
        return { canceled: true };
      }
      await shell.showItemInFolder(saveResult.filePath);
      return { canceled: false, filePath: saveResult.filePath };
    },
  );

  ipcMain.handle(
    "match:export",
    async (_, payload: { matchId: string; format: ExportFormat }) => {
      if (!runtime) throw new Error("Runtime not initialized");
      const exportData = await runtime.buildMatchExport(payload.matchId, payload.format);
      const win = BrowserWindow.getFocusedWindow() ?? controlWindow;
      const options = {
        defaultPath: exportData.suggestedName,
        filters: [
          payload.format === "html"
            ? { name: "HTML", extensions: ["html"] }
            : { name: "JSON", extensions: ["json"] },
        ],
      };
      const saveResult = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (saveResult.canceled || !saveResult.filePath) {
        return { canceled: true };
      }
      fs.writeFileSync(saveResult.filePath, exportData.content, "utf8");
      if (payload.format === "html") {
        await shell.openPath(saveResult.filePath);
      }
      return { canceled: false, filePath: saveResult.filePath };
    },
  );

  ipcMain.handle("license:getStatus", async () => {
    if (licenseSvc.skipLicenseGateFromEnv()) {
      return { gate: false, organizationLabel: null };
    }
    if (!desktopContext) {
      return { gate: true, machinePreview: "—", message: "Desktop niet geïnitialiseerd." };
    }
    const dir = desktopContext.userDataDir;
    const mid = licenseSvc.getOrCreateMachineId(dir);
    const preview = licenseSvc.machinePreview(mid);
    const base = licenseSvc.getLicenseApiBase();
    const prev = licenseSvc.readStoredLicense(dir);
    if (!prev) {
      return { gate: true, machinePreview: preview, prefillLicenseKey: null };
    }
    const r = await licenseSvc.remoteLicenseCheck(base, prev.licenseKey, mid);
    if (r.kind === "network") {
      if (licenseSvc.withinGrace(prev.lastVerifiedAt)) {
        return {
          gate: false,
          organizationLabel: prev.organizationLabel ?? null,
          offlineGrace: true,
        };
      }
      return {
        gate: true,
        machinePreview: preview,
        message:
          "Geen verbinding met de licentie-server. Controleer internet of probeer later. (Offline: max. 7 dagen na laatste geslaagde online check.)",
        prefillLicenseKey: prev.licenseKey,
      };
    }
    if (r.kind === "error") {
      return {
        gate: true,
        machinePreview: preview,
        message: r.message,
        prefillLicenseKey: prev.licenseKey,
      };
    }
    if (!r.activated) {
      return {
        gate: true,
        machinePreview: preview,
        message:
          "Deze pc is nog niet gekoppeld aan je licentie. Voer je sleutel in en klik op Activeren op deze pc.",
        prefillLicenseKey: prev.licenseKey,
      };
    }
    const prevLicense = licenseSvc.readStoredLicense(dir);
    licenseSvc.writeStoredLicense(dir, {
      licenseKey: prev.licenseKey,
      lastVerifiedAt: new Date().toISOString(),
      organizationLabel: r.organizationLabel,
      ...(r.plan !== undefined ? { plan: r.plan } : {}),
      ...(r.planLabel !== undefined ? { planLabel: r.planLabel } : {}),
      ...(r.features !== undefined ? { features: r.features } : {}),
      ...(r.controlCloudBaseUrl !== undefined
        ? { controlCloudBaseUrl: r.controlCloudBaseUrl }
        : prevLicense?.controlCloudBaseUrl !== undefined
          ? { controlCloudBaseUrl: prevLicense.controlCloudBaseUrl }
          : {}),
      ...(r.controlDesktopKey !== undefined
        ? { controlDesktopKey: r.controlDesktopKey }
        : prevLicense?.controlDesktopKey !== undefined
          ? { controlDesktopKey: prevLicense.controlDesktopKey }
          : {}),
      ...(r.controlVenueId !== undefined
        ? { controlVenueId: r.controlVenueId }
        : prevLicense?.controlVenueId !== undefined
          ? { controlVenueId: prevLicense.controlVenueId }
          : {}),
      ...(r.controlOperatorPairToken !== undefined
        ? { controlOperatorPairToken: r.controlOperatorPairToken }
        : prevLicense?.controlOperatorPairToken !== undefined
          ? { controlOperatorPairToken: prevLicense.controlOperatorPairToken }
          : {}),
    });
    return {
      gate: false,
      organizationLabel: r.organizationLabel,
    };
  });

  ipcMain.handle("license:activate", async (_, opts: { licenseKey?: string }) => {
    if (!desktopContext) {
      return { ok: false, message: "Desktop niet geïnitialiseerd." };
    }
    const raw = typeof opts?.licenseKey === "string" ? opts.licenseKey : "";
    const key = raw.trim().toUpperCase();
    if (key.length < 8) {
      return { ok: false, message: "Voer een geldige licentiesleutel in." };
    }
    const dir = desktopContext.userDataDir;
    const mid = licenseSvc.getOrCreateMachineId(dir);
    const label = licenseSvc.defaultDeviceLabel();
    const base = licenseSvc.getLicenseApiBase();
    const r = await licenseSvc.remoteLicenseActivate(base, key, mid, label);
    if (r.kind === "network") {
      return { ok: false, message: "Netwerkfout. Controleer internet." };
    }
    if (r.kind === "error") {
      return { ok: false, message: r.message, reason: r.reason };
    }
    licenseSvc.writeStoredLicense(dir, {
      licenseKey: key,
      lastVerifiedAt: new Date().toISOString(),
      organizationLabel: r.organizationLabel,
      ...(r.plan !== undefined ? { plan: r.plan } : {}),
      ...(r.planLabel !== undefined ? { planLabel: r.planLabel } : {}),
      ...(r.features !== undefined ? { features: r.features } : {}),
      ...(r.controlCloudBaseUrl !== undefined ? { controlCloudBaseUrl: r.controlCloudBaseUrl } : {}),
      ...(r.controlDesktopKey !== undefined ? { controlDesktopKey: r.controlDesktopKey } : {}),
      ...(r.controlVenueId !== undefined ? { controlVenueId: r.controlVenueId } : {}),
      ...(r.controlOperatorPairToken !== undefined ? { controlOperatorPairToken: r.controlOperatorPairToken } : {}),
    });
    return {
      ok: true,
      organizationLabel: r.organizationLabel,
      status: r.status,
    };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (controlWindow) {
      if (controlWindow.isMinimized()) controlWindow.restore();
      controlWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    bootLog("=== Stadium Scoreboard start ===");

    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      if (permission === "media" || permission === "display-capture") {
        callback(true);
      } else {
        callback(false);
      }
    });

    try {
      await loadRuntime();
      registerIpc();
      createWindows();
      bootLog("Desktop runtime OK — open vensters.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      bootLog(`FATAL: ${message}`);
      dialog.showErrorBox(
        "Stadium Scoreboard — opstartfout",
        `De desktop-app kon niet initialiseren.\n\n${message}\n\nLogbestand:\n${bootLogPath()}`,
      );
      app.quit();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (mobileBridge) {
    void mobileBridge.stop();
    mobileBridge = null;
  }
  if (cloudAgent) {
    cloudAgent.stop();
    cloudAgent = null;
  }
  runtime?.disposeDesktopRuntime();
});
