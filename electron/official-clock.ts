import { spawn, type ChildProcess } from "child_process";
import dgram from "dgram";
import fs from "fs";
import net from "net";
import path from "path";
import { officialClockProtocol } from "../lib/official-clock/protocols";
import type { OfficialClockTargets } from "../lib/official-clock/sync";
import { ClockTracker, type ClockDirection, type ClockEstimate } from "../lib/official-clock/tracker";
import {
  normalizeOfficialClockSettings,
  OFFICIAL_CLOCK_OFF_STATUS,
  type OfficialClockDecoder,
  type OfficialClockHoldReason,
  type OfficialClockReading,
  type OfficialClockSettings,
  type OfficialClockStatus,
} from "../lib/official-clock/types";

/**
 * Leest mee met de console van de jurytafel en stuurt de klokken van ArenaCue bij. Deze dienst leest
 * alleen: er gaat nooit iets naar de console. Valt het signaal weg, dan blijft ArenaCue op zijn eigen
 * klok doorlopen en werkt de handbediening zoals altijd.
 */

/** Zo lang zonder bruikbaar bericht noemen we het signaal weg. */
const SIGNAL_TIMEOUT_MS = 3000;
/** Een stand die ouder is, sturen we niet meer door: dan liever niets dan iets verouderds. */
const READING_FRESH_MS = 1500;
const EVALUATE_EVERY_MS = 100;
const STATUS_EVERY_MS = 250;
const RECONNECT_AFTER_MS = 2000;
/** Zoveel bytes zonder één herkend bericht: verkeerd merk of verkeerde snelheid gekozen. */
const UNRECOGNIZED_AFTER_BYTES = 400;
const CAPTURE_MAX_BYTES = 20 * 1024 * 1024;
const CAPTURE_MAX_MS = 10 * 60 * 1000;

export type OfficialClockRuntime = {
  /** Telt de klok van de actieve wedstrijd op of af? */
  getContext: () => Promise<{ direction: ClockDirection }>;
  sync: (targets: OfficialClockTargets) => Promise<{ gameHold: OfficialClockHoldReason | null }>;
  setHornMute: (mute: { game: boolean; shot: boolean }) => void;
};

export type OfficialClockHandle = {
  getSettings: () => OfficialClockSettings;
  saveSettings: (raw: unknown) => OfficialClockSettings;
  getStatus: () => OfficialClockStatus;
  listSerialPorts: () => Promise<string[]>;
  startCapture: () => { ok: boolean; path?: string; error?: string };
  stopCapture: () => void;
  captureDir: () => string;
  stop: () => void;
};

type Link = { close: () => void };

/** Windows: seriële poort uitlezen met wat in elke Windows zit, zonder extra onderdeel in de app. */
function windowsSerialScript(serialPath: string, baudRate: number): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$port = New-Object System.IO.Ports.SerialPort '${serialPath}', ${baudRate}, ([System.IO.Ports.Parity]::None), 8, ([System.IO.Ports.StopBits]::One)`,
    "$port.ReadTimeout = 500",
    "$port.Open()",
    "$out = [Console]::OpenStandardOutput()",
    "$buffer = New-Object byte[] 4096",
    "try {",
    "  while ($true) {",
    "    $count = 0",
    "    try { $count = $port.Read($buffer, 0, $buffer.Length) } catch [System.TimeoutException] { $count = 0 }",
    "    if ($count -gt 0) { $out.Write($buffer, 0, $count); $out.Flush() }",
    // Is ArenaCue weg (ook na een crash), dan de poort vrijgeven in plaats van hem bezet te houden.
    `    elseif (-not (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue)) { break }`,
    "  }",
    "} finally { $port.Close() }",
  ].join("\n");
}

function spawnSerialReader(serialPath: string, baudRate: number): ChildProcess {
  if (process.platform === "win32") {
    return spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", windowsSerialScript(serialPath, baudRate)],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
  }
  // macOS: poort instellen en doorgeven; pad en snelheid gaan als argumenten mee, niet in de opdracht zelf.
  return spawn(
    "/bin/sh",
    ["-c", 'stty -f "$0" "$1" cs8 -cstopb -parenb raw -echo && exec cat "$0"', serialPath, String(baudRate)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

export function startOfficialClock(options: {
  settingsPath: string;
  captureDir: string;
  runtime: OfficialClockRuntime;
  log: (line: string) => void;
  onStatus: (status: OfficialClockStatus) => void;
  /** Alleen voor tests: sneller merken dat het signaal weg is. */
  signalTimeoutMs?: number;
}): OfficialClockHandle {
  const { runtime, log } = options;
  const signalTimeoutMs = options.signalTimeoutMs ?? SIGNAL_TIMEOUT_MS;

  let settings = readSettings();
  let link: Link | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let stopped = false;
  /** Telt op bij elke (her)start van de verbinding; oude callbacks herkennen zo dat ze verlopen zijn. */
  let generation = 0;

  let decoder: (OfficialClockDecoder & { endOfDatagram?: () => OfficialClockReading[] }) | null = null;
  const gameTracker = new ClockTracker();
  const shotTracker = new ClockTracker();
  /** Laatste melding over de shotclock: uit (leeg scherm) of een stand. */
  let shotOff = false;

  let linkError: string | null = null;
  let bytesSeen = 0;
  let lastFrameAtMs: number | null = null;
  let everReceived = false;
  let gameHold: OfficialClockHoldReason | null = null;
  /** Telt de wedstrijdklok op of af? Onbekend tot de app het zegt; tot dan volgen we niets. */
  let direction: ClockDirection | null = null;
  let contextAtMs = 0;
  let syncing = false;
  let lastLinkState = "";

  let capture: { stream: fs.WriteStream; filePath: string; bytes: number; startedAtMs: number } | null = null;
  let status: OfficialClockStatus = { ...OFFICIAL_CLOCK_OFF_STATUS };
  let lastStatusJson = "";
  let lastStatusAtMs = 0;

  function readSettings(): OfficialClockSettings {
    try {
      return normalizeOfficialClockSettings(JSON.parse(fs.readFileSync(options.settingsPath, "utf8")));
    } catch {
      return normalizeOfficialClockSettings(null);
    }
  }

  function resetReadings() {
    gameTracker.reset();
    shotTracker.reset();
    shotOff = false;
    lastFrameAtMs = null;
    bytesSeen = 0;
    gameHold = null;
  }

  function onBytes(chunk: Buffer, datagram: boolean) {
    if (!decoder) return;
    if (capture) writeCapture(chunk);
    bytesSeen += chunk.length;
    const readings = decoder.push(chunk);
    if (datagram && decoder.endOfDatagram) readings.push(...decoder.endOfDatagram());
    if (readings.length === 0) return;
    const now = Date.now();
    lastFrameAtMs = now;
    everReceived = true;
    if (direction === null) return;
    for (const reading of readings) {
      if (reading.game) gameTracker.update(reading.game, now, direction);
      if (reading.shot === null) {
        shotOff = true;
        shotTracker.reset();
      } else if (reading.shot) {
        shotOff = false;
        shotTracker.update(reading.shot, now, "down");
      }
    }
    void evaluate();
  }

  function fail(reason: string, mine: number) {
    // Een socket meldt een fout vaak twee keer (error én close): één herverbinding volstaat.
    if (mine !== generation || stopped || reconnectTimer) return;
    linkError = reason;
    log(`[official-clock] ${reason}`);
    closeLink();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!stopped && settings.enabled && mine === generation) open();
    }, RECONNECT_AFTER_MS);
  }

  function closeLink() {
    const current = link;
    link = null;
    if (!current) return;
    try {
      current.close();
    } catch {
      /* al dicht */
    }
  }

  function open() {
    closeLink();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    generation += 1;
    const mine = generation;
    const protocol = officialClockProtocol(settings.protocol);
    decoder = protocol.create();
    resetReadings();
    linkError = null;

    try {
      if (settings.connection === "tcp-listen") {
        const sockets = new Set<net.Socket>();
        const server = net.createServer((socket) => {
          sockets.add(socket);
          log(`[official-clock] console verbonden vanaf ${socket.remoteAddress ?? "?"}`);
          socket.on("data", (chunk) => mine === generation && onBytes(chunk, false));
          socket.on("error", () => undefined);
          socket.on("close", () => sockets.delete(socket));
        });
        server.on("error", (err) => fail(`poort ${settings.port} kan niet open: ${err.message}`, mine));
        server.listen(settings.port);
        link = {
          close: () => {
            for (const socket of sockets) socket.destroy();
            server.close();
          },
        };
      } else if (settings.connection === "tcp-connect") {
        if (!settings.host) throw new Error("geen adres ingevuld");
        const socket = net.connect({ host: settings.host, port: settings.port });
        socket.setKeepAlive(true, 5000);
        socket.on("data", (chunk) => mine === generation && onBytes(chunk, false));
        socket.on("error", (err) => fail(`geen verbinding met ${settings.host}:${settings.port}: ${err.message}`, mine));
        socket.on("close", () => fail(`verbinding met ${settings.host}:${settings.port} gesloten`, mine));
        link = { close: () => socket.destroy() };
      } else if (settings.connection === "udp") {
        const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
        socket.on("message", (chunk) => mine === generation && onBytes(chunk, true));
        socket.on("error", (err) => fail(`poort ${settings.port} kan niet open: ${err.message}`, mine));
        socket.bind(settings.port);
        link = { close: () => socket.close() };
      } else {
        if (!settings.serialPath) throw new Error("geen seriële poort gekozen");
        const baudRate = settings.baudRate || protocol.baudRate;
        const child = spawnSerialReader(settings.serialPath, baudRate);
        let stderr = "";
        child.stdout?.on("data", (chunk: Buffer) => mine === generation && onBytes(chunk, false));
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr = (stderr + chunk.toString("utf8")).slice(-600);
        });
        child.on("error", (err) => fail(`seriële poort ${settings.serialPath}: ${err.message}`, mine));
        child.on("exit", () => {
          const detail = stderr.trim().split(/\r?\n/)[0] ?? "";
          fail(`seriële poort ${settings.serialPath} gesloten${detail ? `: ${detail}` : ""}`, mine);
        });
        link = { close: () => child.kill() };
      }
      log(`[official-clock] volgt ${settings.protocol} via ${settings.connection}`);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err), mine);
    }
  }

  function writeCapture(chunk: Buffer) {
    if (!capture) return;
    capture.stream.write(chunk);
    capture.bytes += chunk.length;
    if (capture.bytes >= CAPTURE_MAX_BYTES || Date.now() - capture.startedAtMs >= CAPTURE_MAX_MS) stopCapture();
  }

  function stopCapture() {
    if (!capture) return;
    capture.stream.end();
    log(`[official-clock] opname gestopt: ${capture.filePath} (${capture.bytes} bytes)`);
    capture = null;
  }

  function buildStatus(
    now: number,
    linkState: OfficialClockStatus["link"],
    following: { game: boolean; shot: boolean },
    hold: OfficialClockHoldReason | null,
  ): OfficialClockStatus {
    const stats = decoder?.stats() ?? { frames: 0, rejected: 0 };
    const game = gameTracker.estimate(now);
    const shot = shotTracker.estimate(now);
    return {
      link: linkState,
      error: linkState === "error" ? linkError : null,
      unrecognized: stats.frames === 0 && bytesSeen >= UNRECOGNIZED_AFTER_BYTES,
      frames: stats.frames,
      rejected: stats.rejected,
      game: game ? { seconds: game.shown, resolution: game.resolution, running: game.running } : null,
      shot: shotOff
        ? { seconds: 0, resolution: 1, running: false, off: true }
        : shot
          ? { seconds: shot.shown, resolution: shot.resolution, running: shot.running, off: false }
          : null,
      followingGameClock: following.game,
      followingShotClock: following.shot,
      gameClockHold: hold,
      capturePath: capture?.filePath ?? null,
    };
  }

  function publish(next: OfficialClockStatus, now: number) {
    status = next;
    const json = JSON.stringify(next);
    if (json === lastStatusJson) return;
    // Een wisseling van verbinding meteen melden; de lopende klokstanden hooguit vier keer per seconde.
    if (next.link === lastLinkState && now - lastStatusAtMs < STATUS_EVERY_MS) return;
    lastStatusJson = json;
    lastStatusAtMs = now;
    lastLinkState = next.link;
    options.onStatus(next);
  }

  async function evaluate() {
    if (stopped) return;
    const now = Date.now();
    if (!settings.enabled) {
      runtime.setHornMute({ game: false, shot: false });
      publish({ ...OFFICIAL_CLOCK_OFF_STATUS, capturePath: capture?.filePath ?? null }, now);
      return;
    }

    if (now - contextAtMs > 1000) {
      contextAtMs = now;
      void runtime
        .getContext()
        .then((context) => {
          const next = settings.gameClockDirection === "auto" ? context.direction : settings.gameClockDirection;
          // Andere sport of andere instelling: wat we over de wedstrijdklok afleidden, klopt niet meer.
          if (next !== direction) gameTracker.reset();
          direction = next;
        })
        .catch(() => undefined);
    }

    const receiving = lastFrameAtMs !== null && now - lastFrameAtMs <= signalTimeoutMs;
    const linkState: OfficialClockStatus["link"] = receiving ? "receiving" : linkError ? "error" : everReceived ? "lost" : "waiting";

    // Een stilstaande klok blijft geldig zolang de verbinding leeft (veel consoles sturen een stand pas
    // opnieuw als hij verandert). Een lopende klok waarvan we al even niets hoorden, sturen we niet door.
    const usable = (estimate: ClockEstimate | null) =>
      estimate !== null && (!estimate.running || estimate.ageSec * 1000 <= READING_FRESH_MS) ? estimate : null;
    const gameSeen = receiving ? usable(gameTracker.estimate(now)) : null;
    const game = settings.followGameClock ? gameSeen : null;
    // Zegt de console dat de wedstrijdklok stilstaat, dan loopt de shotclock ook niet.
    const heldStopped = gameSeen !== null && gameTracker.reportsRunning && !gameSeen.running;
    const shot: OfficialClockTargets["shot"] =
      receiving && settings.followShotClock
        ? shotOff
          ? "off"
          : usable(shotTracker.estimate(now, { heldStopped }))
        : null;


    if ((game || shot) && !syncing) {
      syncing = true;
      try {
        gameHold = (await runtime.sync({ game, shot })).gameHold;
      } catch (err) {
        log(`[official-clock] bijsturen mislukt: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        syncing = false;
      }
    }

    const following = { game: game !== null && gameHold === null, shot: shot !== null };
    runtime.setHornMute({ game: settings.muteHorn && following.game, shot: settings.muteHorn && following.shot });
    // Een reden tonen we alleen als er een verse stand was die we bewust niet overnamen.
    publish(buildStatus(now, linkState, following, game !== null ? gameHold : null), now);
  }

  const timer = setInterval(() => void evaluate(), EVALUATE_EVERY_MS);
  if (settings.enabled) open();

  return {
    getSettings: () => settings,
    saveSettings: (raw) => {
      settings = normalizeOfficialClockSettings(raw);
      try {
        fs.mkdirSync(path.dirname(options.settingsPath), { recursive: true });
        fs.writeFileSync(options.settingsPath, JSON.stringify(settings, null, 2), "utf8");
      } catch (err) {
        log(`[official-clock] instellingen niet bewaard: ${err instanceof Error ? err.message : String(err)}`);
      }
      everReceived = false;
      contextAtMs = 0;
      if (settings.enabled) {
        open();
      } else {
        generation += 1;
        closeLink();
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        decoder = null;
        linkError = null;
        resetReadings();
        log("[official-clock] uitgezet");
      }
      void evaluate();
      return settings;
    },
    getStatus: () => status,
    listSerialPorts: () =>
      new Promise((resolve) => {
        if (process.platform !== "win32") {
          fs.readdir("/dev", (err, names) =>
            resolve(err ? [] : names.filter((name) => name.startsWith("cu.")).map((name) => `/dev/${name}`).sort()),
          );
          return;
        }
        const child = spawn(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", "[System.IO.Ports.SerialPort]::GetPortNames()"],
          { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
        );
        let out = "";
        child.stdout?.on("data", (chunk: Buffer) => {
          out += chunk.toString("utf8");
        });
        child.on("error", () => resolve([]));
        child.on("exit", () =>
          resolve(
            [...new Set(out.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^COM\d+$/i.test(line)))].sort(
              (a, b) => Number(a.slice(3)) - Number(b.slice(3)),
            ),
          ),
        );
      }),
    startCapture: () => {
      if (!settings.enabled || !link) return { ok: false, error: "not_enabled" };
      if (capture) return { ok: true, path: capture.filePath };
      try {
        fs.mkdirSync(options.captureDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const filePath = path.join(options.captureDir, `official-clock-${settings.protocol}-${stamp}.bin`);
        capture = { stream: fs.createWriteStream(filePath), filePath, bytes: 0, startedAtMs: Date.now() };
        capture.stream.on("error", () => stopCapture());
        log(`[official-clock] opname gestart: ${filePath}`);
        return { ok: true, path: filePath };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    stopCapture,
    captureDir: () => options.captureDir,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopCapture();
      generation += 1;
      closeLink();
      runtime.setHornMute({ game: false, shot: false });
    },
  };
}
