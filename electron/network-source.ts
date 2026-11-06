import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { guardChildPipes } from "../lib/child-pipe";
import {
  NETWORK_SOURCE_SILENCE_MS,
  NETWORK_SOURCE_STALL_MS,
  maskNetworkUrl,
  networkSourceErrorIsFatal,
  networkSourceErrorIsTemporary,
  networkSourceFfmpegArgs,
  networkSourceRetryDelayMs,
  sanitizeNetworkUrl,
  type NetworkSourceCodecMode,
} from "../lib/network-source";

export type NetworkSourceDeps = {
  /** Pad naar de meegeleverde ffmpeg, of null als die ontbreekt. */
  ffmpegPath: () => string | null;
  log: (line: string) => void;
  /** Stuurt naar de streampagina. Geeft false als dat venster er niet (meer) is. */
  send: (channel: string, payload: unknown) => boolean;
};

export type NetworkSourceStatus = {
  /** Gemaskeerd adres: dit gaat naar de bediening en naar logbestanden. */
  url: string;
  running: boolean;
  /** Levert de pijp op dit moment beeld? */
  receiving: boolean;
  mode: NetworkSourceCodecMode;
  error: string | null;
  attempt: number;
};

export type NetworkSourceController = {
  start: (url: string, fps: number) => void;
  stop: () => void;
  /** De speler kan deze codec niet: opnieuw met hercodering naar H.264. */
  useH264: () => void;
  /**
   * De streampagina mist het init-segment (ze is herladen terwijl de bron al liep): ffmpeg
   * opnieuw starten, want alleen een nieuwe start levert dat segment opnieuw.
   */
  restartForInit: () => void;
  status: () => NetworkSourceStatus;
};

const CHUNK_CHANNEL = "network-source:chunk";
const RESET_CHANNEL = "network-source:reset";
const STATUS_CHANNEL = "network-source:status";

/**
 * Houdt één netwerkbron in de lucht: ffmpeg hermuxt naar fragmented MP4 en elk stuk gaat naar de
 * streampagina, die het in een <video> aanvult.
 *
 * Alles wat kan blijven hangen in een sporthal is hier een hersteldraad: een camera die herstart,
 * een netwerkkabel die er even uit gaat, een switch die herconfigureert. De stream zelf blijft
 * lopen, want ffmpeg aan de uitvoerkant wordt hier nooit aangeraakt — die krijgt het laatste beeld
 * herhaald van de pomp tot er weer beeld is.
 */
export function createNetworkSource(deps: NetworkSourceDeps): NetworkSourceController {
  /** Geen stdin: ffmpeg leest hier van het netwerk, niet van ons. */
  type SourceProcess = ChildProcessByStdio<null, Readable, Readable>;
  let child: SourceProcess | null = null;
  let url = "";
  let fps = 30;
  let mode: NetworkSourceCodecMode = "copy";
  let wanted = false;
  let error: string | null = null;
  let attempt = 0;
  let receiving = false;
  let retryTimer: NodeJS.Timeout | null = null;
  let stallTimer: NodeJS.Timeout | null = null;
  let silenceTimer: NodeJS.Timeout | null = null;
  let stderrTail = "";
  /** Tegen een lus wanneer de pagina blijft vragen terwijl het probleem elders zit. */
  let initRestarts = 0;
  let lastInitRestartAt = 0;

  const emitStatus = () => {
    deps.send(STATUS_CHANNEL, status());
  };

  const status = (): NetworkSourceStatus => ({
    url: url ? maskNetworkUrl(url) : "",
    running: wanted,
    receiving,
    mode,
    error,
    attempt,
  });

  const clearTimers = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  };

  const killChild = () => {
    const proc = child;
    child = null;
    if (!proc || proc.killed) return;
    try {
      proc.kill();
    } catch {
      /* al weg */
    }
  };

  /**
   * Twee klokken op dezelfde stilte. De korte vertelt de bediening dat er geen beeld is; de lange
   * besluit dat de verbinding hangt en begint opnieuw. Bij UDP valt de zender weg zonder dat ffmpeg
   * stopt, dus zonder deze klokken zou de studio "beeld" blijven melden bij een zwart scherm.
   */
  const armStall = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (!wanted || !receiving) return;
      receiving = false;
      error = "Geen beeld van de bron…";
      deps.log("[netwerkbron] stilte op de lijn — nog geen herstart");
      emitStatus();
    }, NETWORK_SOURCE_SILENCE_MS);
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      if (!wanted) return;
      deps.log(`[netwerkbron] geen beeld in ${NETWORK_SOURCE_STALL_MS} ms — opnieuw verbinden`);
      receiving = false;
      error = "Geen beeld van de bron — opnieuw verbinden…";
      emitStatus();
      killChild();
      scheduleRetry();
    }, NETWORK_SOURCE_STALL_MS);
  };

  const scheduleRetry = () => {
    if (!wanted || retryTimer) return;
    const delay = networkSourceRetryDelayMs(attempt);
    attempt += 1;
    deps.log(`[netwerkbron] nieuwe poging over ${delay} ms (poging ${attempt})`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (wanted) spawnFfmpeg();
    }, delay);
  };

  const spawnFfmpeg = () => {
    const ffmpeg = deps.ffmpegPath();
    if (!ffmpeg) {
      error = "FFmpeg ontbreekt.";
      deps.log("[netwerkbron] ffmpeg niet gevonden");
      emitStatus();
      return;
    }
    let args: string[];
    try {
      args = networkSourceFfmpegArgs({ url, mode, fps });
    } catch (e) {
      // Komt alleen voor als het adres de controle niet haalt; opnieuw proberen lost dat niet op.
      wanted = false;
      error = e instanceof Error ? e.message : String(e);
      emitStatus();
      return;
    }

    // Nieuw ffmpeg betekent een nieuw init-segment, dus de speler moet opnieuw beginnen.
    deps.send(RESET_CHANNEL, { mode });
    deps.log(`[netwerkbron] start ${maskNetworkUrl(url)} (${mode})`);

    const proc = spawn(ffmpeg, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child = proc;
    stderrTail = "";
    guardChildPipes(proc, (pipe, err) => deps.log(`[netwerkbron] ffmpeg ${pipe}: ${err.message}`));
    armStall();

    proc.stdout.on("data", (buf: Buffer) => {
      if (child !== proc || !wanted) return;
      if (!receiving) {
        receiving = true;
        attempt = 0;
        initRestarts = 0;
        error = null;
        deps.log(`[netwerkbron] beeld binnen van ${maskNetworkUrl(url)}`);
        emitStatus();
      }
      armStall();
      // Het venster kan weg zijn tijdens een bronwissel; dan stopt de bron zichzelf.
      if (!deps.send(CHUNK_CHANNEL, buf)) {
        deps.log("[netwerkbron] streamvenster is weg — stoppen");
        stop();
      }
    });

    proc.stderr.on("data", (buf: Buffer) => {
      const text = buf.toString("utf8");
      stderrTail = `${stderrTail}${text}`.slice(-2000);
      const line = text.trim();
      if (line) deps.log(`[netwerkbron] ${maskNetworkUrl(line).slice(0, 300)}`);
    });

    proc.on("close", (code) => {
      if (child !== proc) return;
      child = null;
      receiving = false;
      if (!wanted) {
        emitStatus();
        return;
      }
      if (networkSourceErrorIsFatal(stderrTail)) {
        // Verkeerd adres of verkeerde inlog: blijven proberen helpt niet en vult het log.
        wanted = false;
        clearTimers();
        error = `Bron weigert de verbinding: ${firstUsefulLine(stderrTail)}`;
        deps.log(`[netwerkbron] gestopt, niet herstelbaar (code ${code ?? "?"})`);
        emitStatus();
        return;
      }
      error = networkSourceErrorIsTemporary(stderrTail)
        ? "Verbinding met de bron verloren — opnieuw verbinden…"
        : `Bron stopte (code ${code ?? "?"}) — opnieuw verbinden…`;
      emitStatus();
      scheduleRetry();
    });

    emitStatus();
  };

  const start = (nextUrl: string, nextFps: number) => {
    const safe = sanitizeNetworkUrl(nextUrl);
    if (!safe) {
      wanted = false;
      clearTimers();
      killChild();
      url = "";
      error = "Ongeldig netwerkadres";
      emitStatus();
      return;
    }
    const previous = url;
    const sameStream = safe === previous && Math.round(nextFps) === fps && wanted;
    if (sameStream && child) return;
    clearTimers();
    killChild();
    // Een ander adres mag weer met de goedkope weg beginnen: dat een vorige camera H.265 gaf,
    // zegt niets over deze.
    if (safe !== previous) mode = "copy";
    initRestarts = 0;
    lastInitRestartAt = 0;
    url = safe;
    fps = Math.round(nextFps) || 30;
    wanted = true;
    attempt = 0;
    receiving = false;
    error = null;
    spawnFfmpeg();
  };

  const stop = () => {
    wanted = false;
    clearTimers();
    killChild();
    receiving = false;
    emitStatus();
  };

  /** Hoe vaak we voor een ontbrekend init-segment herstarten voor we het opgeven. */
  const MAX_INIT_RESTARTS = 3;

  const restartForInit = () => {
    if (!wanted || !url) return;
    const now = Date.now();
    // De pagina vraagt dit elke paar seconden tot er beeld is; één herstart per keer is genoeg.
    if (now - lastInitRestartAt < 3000) return;
    if (initRestarts >= MAX_INIT_RESTARTS) {
      if (!error) {
        error = "De speler krijgt geen bruikbaar beeld van de bron.";
        emitStatus();
      }
      return;
    }
    lastInitRestartAt = now;
    initRestarts += 1;
    deps.log(`[netwerkbron] streampagina mist het begin — opnieuw starten (${initRestarts})`);
    clearTimers();
    killChild();
    receiving = false;
    spawnFfmpeg();
  };

  const useH264 = () => {
    if (mode === "h264") return;
    mode = "h264";
    deps.log("[netwerkbron] speler weigert de codec — opnieuw met hercodering naar H.264");
    if (!wanted) return;
    clearTimers();
    killChild();
    attempt = 0;
    receiving = false;
    spawnFfmpeg();
  };

  return { start, stop, useH264, restartForInit, status };
}

function firstUsefulLine(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .pop();
  return maskNetworkUrl(line ?? "onbekende fout").slice(0, 200);
}

export const NETWORK_SOURCE_CHANNELS = {
  chunk: CHUNK_CHANNEL,
  reset: RESET_CHANNEL,
  status: STATUS_CHANNEL,
} as const;
