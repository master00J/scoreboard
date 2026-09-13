import net from "node:net";
import type { BrowserWindow, WebFrameMain } from "electron";

const SAMPLE_RATE = 48000;
const SILENCE_MS = 20;
const POLL_MS = 40;

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
  const silence = Buffer.alloc(Math.max(4, Math.round((SAMPLE_RATE * 4 * SILENCE_MS) / 1000)));
  let lastWrite = 0;
  let peak = 0;

  const write = (buf: Buffer) => {
    lastWrite = Date.now();
    for (const socket of sockets) {
      if (socket.destroyed || !socket.writable) continue;
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
    if (combined.length >= 2) {
      const buf = Buffer.allocUnsafe(combined.length * 2);
      for (let i = 0; i < combined.length; i++) {
        const v = Math.max(-32768, Math.min(32767, combined[i] ?? 0));
        buf.writeInt16LE(v, i * 2);
      }
      write(buf);
    }
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
    if (win && !win.isDestroyed()) {
      attach(win);
      void drain(win);
    } else {
      peak = 0;
      options.onPeak(0);
    }
    if (Date.now() - lastWrite >= SILENCE_MS) write(silence);
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
