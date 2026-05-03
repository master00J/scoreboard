import { app, BrowserWindow, desktopCapturer, ipcMain, dialog, Menu, screen, session, shell } from "electron";
import fs from "fs";
import path from "path";
import type {
  DesktopApiRequest,
  ElectronBridge,
  ExportFormat,
} from "../lib/desktop-bridge";

const IS_DEV = !app.isPackaged;

let controlWindow: BrowserWindow | null = null;
let displayWindow: BrowserWindow | null = null;
let runtime: typeof import("./runtime") | null = null;
let desktopContext: ElectronBridge["context"] | null = null;

function bootLogPath(): string {
  return path.join(app.getPath("userData"), "boot.log");
}

function bootLog(line: string) {
  const lineWithNl = `[${new Date().toISOString()}] ${line}\n`;
  try {
    fs.appendFileSync(bootLogPath(), lineWithNl, "utf8");
  } catch {
    /* ignore */
  }
  console.log(line);
}

function appRoot(): string {
  return IS_DEV ? path.join(__dirname, "..", "..") : app.getAppPath();
}

function rendererEntryPath(): string {
  return path.join(appRoot(), "renderer-dist", "index.html");
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

  controlWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Stadium Scoreboard — Control",
    backgroundColor: "#09090b",
    show: true,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false },
  });
  void loadView(controlWindow, "control");
  controlWindow.webContents.on("did-finish-load", () => {
    void runtime?.broadcastDisplayState();
  });
  controlWindow.webContents.openDevTools({ mode: "detach" });
  controlWindow.on("closed", () => {
    controlWindow = null;
  });

  displayWindow = new BrowserWindow({
    title: "Stadium Scoreboard — Display",
    backgroundColor: "#000000",
    frame: false,
    show: false,
    fullscreenable: true,
    /** Windows: resize-rand i.p.v. alleen `maximize()` bij frameless. */
    thickFrame: true,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false },
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
  ]);
  Menu.setApplicationMenu(menu);
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
  runtime?.disposeDesktopRuntime();
});
