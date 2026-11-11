import net from "node:net";
import type { BrowserWindow, WebFrameMain } from "electron";
import { createPcmPacer } from "../lib/pcm-pacer";

const SAMPLE_RATE = 48000;
/** s16le stereo. */
const BYTES_PER_FRAME = 4;
const POLL_MS = 40;
/**
 * Zolang de pagina zelf geluid levert, komt dat in blokken van 2048 frames (43 ms) via een ronde
 * langs de renderer. Pas als er langer dan dit niets komt, vullen we stilte bij; anders zou elke
 * kleine vertraging een hap stilte midden in het geluid zetten.
 */
const LIVE_SLACK_MS = 250;
/** Grootste stuk stilte in één keer (na een hapering van het hoofdproces). */
const MAX_FILL_MS = 2000;
/** Leest ffmpeg niet meer, dan stapelen we geen minuten geluid op in het geheugen. */
const MAX_SOCKET_BACKLOG_BYTES = SAMPLE_RATE * BYTES_PER_FRAME * 5;

const TAP_JS = `(() => {
  if (window.__acBrowserTap) return "ok";
  window.__acBrowserTap = true;
  window.__acQ = [];
  var Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return "noctx";
  var ctx = new Ctx({ sampleRate: 48000 });
  var mix = ctx.createGain();
  var mute = ctx.createGain();
  mute.gain.value = 0;
  var proc = ctx.createScriptProcessor(2048, 2, 2);
  proc.onaudioprocess = function (ev) {
    var left = ev.inputBuffer.getChannelData(0);
    var right = ev.inputBuffer.numberOfChannels > 1 ? ev.inputBuffer.getChannelData(1) : left;
    var n = left.length;
    var pcm = new Array(n * 2);
    var peak = 0;
    for (var i = 0; i < n; i++) {
      var l = left[i];
      var r = right[i];
      var al = l < 0 ? -l : l;
      var ar = r < 0 ? -r : r;
      if (al > peak) peak = al;
      if (ar > peak) peak = ar;
      if (l > 1) l = 1; else if (l < -1) l = -1;
      if (r > 1) r = 1; else if (r < -1) r = -1;
      pcm[i * 2] = (l * 32767) | 0;
      pcm[i * 2 + 1] = (r * 32767) | 0;
    }
    window.__acQ.push({ pcm: pcm, peak: peak });
    if (window.__acQ.length > 12) window.__acQ.splice(0, window.__acQ.length - 8);
  };
  mix.connect(proc);
  proc.connect(mute);
  mute.connect(ctx.destination);
  var hook = function (el) {
    if (!el || el.__acHooked) return;
    el.__acHooked = true;
    try { ctx.createMediaElementSource(el).connect(mix); } catch (e) {}
  };
  var scan = function () {
    document.querySelectorAll("video,audio").forEach(hook);
  };
  scan();
  new MutationObserver(scan).observe(document.documentElement || document.body, { childList: true, subtree: true });
  window.__acDrain = function () {
    var q = window.__acQ;
    window.__acQ = [];
    if (!q.length) return { peak: 0, pcm: [] };
    var peak = 0;
    var pcm = [];
    for (var i = 0; i < q.length; i++) {
      if (q[i].peak > peak) peak = q[i].peak;
      for (var j = 0; j < q[i].pcm.length; j++) pcm.push(q[i].pcm[j]);
    }
    return { peak: peak, pcm: pcm };
  };
  if (ctx.state === "suspended") ctx.resume();
  return "ok";
})()`;

export type BrowserAudioTap = {
  device: string;
  stop: () => void;
};

function framesOf(win: BrowserWindow): WebFrameMain[] {
  try {
    const root = win.webContents.mainFrame;
    return root ? root.framesInSubtree : [];
  } catch {
    return [];
  }
}

export function createBrowserAudioTap(options: {
  device: string;
  pipePath: string;
  getWindow: () => BrowserWindow | null;
  onPeak: (peak: number) => void;
  log: (line: string) => void;
}): BrowserAudioTap {
  const sockets = new Set<net.Socket>();
  const silence = Buffer.alloc(Math.round((SAMPLE_RATE * MAX_FILL_MS) / 1000) * BYTES_PER_FRAME);
  /**
   * ffmpeg telt de tijd van dit kanaal in frames. Het kanaal levert daarom precies 48000 frames
   * per seconde, of de bron nu geluid geeft, zwijgt of niet in beeld staat. Vroeger kwam er zonder
   * venster maar 20 ms stilte per 40 ms: de geluidsmix kon de stream dan niet bijhouden. Mét
   * venster kwam die stilte bovenop het echte geluid.
   */
  const pacer = createPcmPacer({
    sampleRate: SAMPLE_RATE,
    startMs: performance.now(),
    maxLeadMs: LIVE_SLACK_MS,
    maxFillMs: MAX_FILL_MS,
  });
  let peak = 0;
  /** Laatste keer dat de pagina zelf geluid aanleverde (ook stil geluid telt). */
  let lastAudioMs = Number.NEGATIVE_INFINITY;

  const write = (buf: Buffer) => {
    for (const socket of sockets) {
      if (socket.destroyed || !socket.writable) continue;
      if (socket.writableLength > MAX_SOCKET_BACKLOG_BYTES) continue;
      try {
        socket.write(buf);
      } catch {
        sockets.delete(socket);
      }
    }
  };

  const pipeName = options.pipePath.replace(/^\\\\\.\\pipe\\/i, "");
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });
  server.on("error", (err) => {
    options.log(`[livestream] browser-audio pipe ${options.device}: ${err.message}`);
  });
  server.listen(`\\\\.\\pipe\\${pipeName}`);

  const inject = async (win: BrowserWindow) => {
    for (const frame of framesOf(win)) {
      try {
        await frame.executeJavaScript(TAP_JS, true);
      } catch {
        /* cross-origin / weggehaald frame */
      }
    }
  };

  const drain = async (win: BrowserWindow) => {
    let combined: number[] = [];
    let nextPeak = 0;
    for (const frame of framesOf(win)) {
      try {
        const chunk = (await frame.executeJavaScript(
          `(window.__acDrain && window.__acDrain()) || {peak:0,pcm:[]}`,
          true,
        )) as { peak?: number; pcm?: number[] };
        if (typeof chunk?.peak === "number" && chunk.peak > nextPeak) nextPeak = chunk.peak;
        if (Array.isArray(chunk?.pcm) && chunk.pcm.length) combined = combined.concat(chunk.pcm);
      } catch {
        /* ignore */
      }
    }
    peak = nextPeak;
    options.onPeak(peak);
    const frames = Math.floor(combined.length / 2);
    if (frames < 1) return;
    // Wat verder dan de speling voor zou lopen op de klok, valt weg: het oudste eerst.
    const now = performance.now();
    lastAudioMs = now;
    const accepted = pacer.admit(now, frames);
    if (accepted < 1) return;
    const skip = (frames - accepted) * 2;
    const buf = Buffer.allocUnsafe(accepted * BYTES_PER_FRAME);
    for (let i = 0; i < accepted * 2; i++) {
      const v = Math.max(-32768, Math.min(32767, combined[skip + i] ?? 0));
      buf.writeInt16LE(v, i * 2);
    }
    write(buf);
  };

  const hooked = new WeakSet<Electron.WebContents>();
  const onLoad = () => {
    const win = options.getWindow();
    if (win && !win.isDestroyed()) void inject(win);
  };
  const attach = (win: BrowserWindow) => {
    if (hooked.has(win.webContents)) return;
    hooked.add(win.webContents);
    win.webContents.on("did-frame-finish-load", onLoad);
    void inject(win);
  };

  let poll: ReturnType<typeof setInterval> | null = setInterval(() => {
    const win = options.getWindow();
    const live = !!win && !win.isDestroyed();
    if (live) {
      attach(win);
      void drain(win);
    } else {
      peak = 0;
      options.onPeak(0);
    }
    // Levert de pagina geluid, dan wachten we daar even op. Zonder venster, of met een pagina die
    // (nog) niets afspeelt, is er niets om op te wachten: meteen bijvullen tot het tempo van de klok.
    const now = performance.now();
    const sourceActive = live && now - lastAudioMs < LIVE_SLACK_MS * 2;
    const fill = pacer.fill(now, sourceActive ? LIVE_SLACK_MS : 0);
    if (fill > 0) write(silence.subarray(0, fill * BYTES_PER_FRAME));
  }, POLL_MS);

  return {
    device: options.device,
    stop: () => {
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
      const win = options.getWindow();
      if (win && !win.isDestroyed()) {
        try {
          win.webContents.removeListener("did-frame-finish-load", onLoad);
        } catch {
          /* ignore */
        }
      }
      for (const socket of sockets) {
        try {
          socket.destroy();
        } catch {
          /* ignore */
        }
      }
      sockets.clear();
      server.close();
    },
  };
}
