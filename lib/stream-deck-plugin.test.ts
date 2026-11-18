import { describe, expect, it } from "vitest";
import { parseStreamDeckPath, STREAM_DECK_PLUGIN_UUID } from "./stream-deck";
import { BOARD_DECK_PATHS, parseBoardDeckPath } from "./stream-deck-board";
import {
  STREAM_DECK_PLUGIN_SCRIPT,
  streamDeckBoardInspectorHtml,
  streamDeckManifest,
  streamDeckPluginFiles,
} from "./stream-deck-plugin";

const API = "http://127.0.0.1:17891";

type Request = {
  url: string;
  aborted: boolean;
  reply: (body: unknown, ok?: boolean) => void;
  fail: () => void;
};

/** Start het plug-inscript met een nagebootst Stream Deck (socket) en een nagebootste app (fetch). */
function boot(options: { worker?: boolean } = {}) {
  const sent: { event: string; context?: string; payload?: { image?: string } }[] = [];
  const requests: Request[] = [];
  const pageTimers: (() => void)[] = [];
  let socket: { onopen?: () => void; onmessage?: (ev: { data: string }) => void } = {};
  let workerTick: (() => void) | null = null;

  class FakeSocket {
    readyState = 1;
    onopen?: () => void;
    onmessage?: (ev: { data: string }) => void;
    constructor(public url: string) {
      socket = this;
    }
    send(text: string) {
      sent.push(JSON.parse(text));
    }
  }
  class FakeWorker {
    constructor() {
      if (options.worker === false) throw new Error("geen worker");
    }
    set onmessage(fn: () => void) {
      workerTick = fn;
    }
  }
  const fetch = (url: string, init?: { signal?: AbortSignal }) =>
    new Promise((resolve, reject) => {
      const request: Request = {
        url,
        aborted: false,
        reply: (body, ok = true) => resolve({ ok, json: async () => body }),
        fail: () => reject(new Error("verbinding geweigerd")),
      };
      init?.signal?.addEventListener("abort", () => {
        request.aborted = true;
        reject(new Error("afgebroken"));
      });
      requests.push(request);
    });

  const connect = new Function(
    "WebSocket",
    "fetch",
    "Worker",
    "URL",
    "Blob",
    "AbortController",
    "setInterval",
    `${STREAM_DECK_PLUGIN_SCRIPT}\nreturn connectElgatoStreamDeckSocket;`,
  )(
    FakeSocket,
    fetch,
    FakeWorker,
    { createObjectURL: () => "blob:tikker" },
    class {},
    AbortController,
    (fn: () => void) => pageTimers.push(fn),
  );
  connect(28196, "PLUGIN-UUID", "registerPlugin");
  socket.onopen?.();

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const deck = (event: string, context: string, action: string, settings: Record<string, unknown> = {}) =>
    socket.onmessage?.({
      data: JSON.stringify({ event, context, action: `${STREAM_DECK_PLUGIN_UUID}.${action}`, payload: { settings } }),
    });
  const open = () => requests.filter((r) => !r.aborted && r.url.startsWith(`${API}/faces`));
  return { sent, requests, pageTimers, deck, flush, open, tick: () => workerTick?.() };
}

function images(sent: { event: string; context?: string; payload?: { image?: string } }[]) {
  return sent.filter((evt) => evt.event === "setImage");
}

describe("plug-inscript", () => {
  it("meldt zich aan bij Stream Deck", () => {
    const { sent } = boot();
    expect(sent).toEqual([{ event: "registerPlugin", uuid: "PLUGIN-UUID" }]);
  });

  it("vraagt de app naar de knoppen die te zien zijn en zet het beeld neer", async () => {
    const p = boot();
    p.deck("willAppear", "ctx1", "board", { path: "/period/next" });
    expect(p.open()).toHaveLength(1);
    expect(p.open()[0]!.url).toBe(`${API}/faces?p=%2Fperiod%2Fnext&since=`);

    p.open()[0]!.reply({ ok: true, etag: "a1", faces: { "/period/next": { svg: "<svg>Q2 & #1</svg>" } } });
    await p.flush();
    expect(images(p.sent)).toEqual([
      {
        event: "setImage",
        context: "ctx1",
        payload: { image: `data:image/svg+xml,${encodeURIComponent("<svg>Q2 & #1</svg>")}`, target: 0 },
      },
    ]);
    // Het volgende verzoek blijft open staan tot de app iets nieuws te melden heeft.
    const next = p.open().at(-1)!;
    expect(next.url).toBe(`${API}/faces?p=%2Fperiod%2Fnext&since=a1`);
  });

  it("stuurt een knop die niet veranderde niet opnieuw", async () => {
    const p = boot();
    p.deck("willAppear", "clock", "board", { path: "/timer/toggle" });
    p.deck("willAppear", "score", "board", { path: "/score/home/up" });
    p.open()[0]!.reply({
      ok: true,
      etag: "a",
      faces: { "/timer/toggle": { svg: "<svg>10:00</svg>" }, "/score/home/up": { svg: "<svg>0</svg>" } },
    });
    await p.flush();
    expect(images(p.sent)).toHaveLength(2);
    p.open().at(-1)!.reply({
      ok: true,
      etag: "b",
      faces: { "/timer/toggle": { svg: "<svg>10:01</svg>" }, "/score/home/up": { svg: "<svg>0</svg>" } },
    });
    await p.flush();
    expect(images(p.sent).map((evt) => evt.context)).toEqual(["clock", "score", "clock"]);
  });

  it("vraagt elk pad één keer, ook als het op twee knoppen staat", () => {
    const p = boot();
    p.deck("willAppear", "a", "board", { path: "/break" });
    p.deck("willAppear", "b", "board", { path: "/break" });
    p.deck("willAppear", "c", "blackout");
    expect(p.open()).toHaveLength(1);
    expect(p.open()[0]!.url).toBe(`${API}/faces?p=%2Fbreak&p=%2Fblackout&since=`);
  });

  it("roept bij een druk het pad van de knop aan", async () => {
    const p = boot();
    p.deck("willAppear", "ctx1", "board", { path: "/score/away/plus3" });
    p.deck("keyDown", "ctx1", "board", { path: "/score/away/plus3" });
    expect(p.requests.map((r) => r.url)).toContain(`${API}/score/away/plus3`);
    expect(p.sent.some((evt) => evt.event === "showAlert")).toBe(false);
  });

  it("waarschuwt op de knop als de app weigert of niet draait", async () => {
    const p = boot();
    p.deck("keyDown", "ctx1", "board", { path: "/period/next" });
    p.requests.find((r) => r.url === `${API}/period/next`)!.reply({ ok: false, error: "noMatch" }, false);
    await p.flush();
    expect(p.sent.filter((evt) => evt.event === "showAlert")).toEqual([{ event: "showAlert", context: "ctx1" }]);

    p.deck("keyDown", "ctx2", "timer");
    p.requests.find((r) => r.url === `${API}/timer/toggle`)!.fail();
    await p.flush();
    expect(p.sent.filter((evt) => evt.event === "showAlert")).toHaveLength(2);
  });

  it("houdt de bestaande knoppen op hun pad", () => {
    const p = boot();
    const cases: [string, Record<string, unknown>, string][] = [
      ["key", { slot: 3 }, "/key/3"],
      ["input", { index: 2 }, "/input/2"],
      ["preview", {}, "/preview/1"],
      ["cut", {}, "/cut"],
      ["stream", {}, "/stream/toggle"],
      ["record", {}, "/record/toggle"],
      ["timer", {}, "/timer/toggle"],
      ["score", { side: "away" }, "/score/away/up"],
      ["blackout", {}, "/blackout"],
      // Een scorebordknop die nog niet ingesteld is, is de klok: de eerste keuze in de lijst.
      ["board", {}, "/timer/toggle"],
    ];
    for (const [action, settings, path] of cases) {
      p.deck("keyDown", `ctx-${action}`, action, settings);
      expect(p.requests.some((r) => r.url === `${API}${path}`), `${action} → ${path}`).toBe(true);
    }
  });

  it("volgt een knop die een andere functie krijgt", () => {
    const p = boot();
    p.deck("willAppear", "ctx1", "board", { path: "/break" });
    p.deck("didReceiveSettings", "ctx1", "board", { path: "/fulltime" });
    expect(p.open()).toHaveLength(1);
    expect(p.open()[0]!.url).toContain("p=%2Ffulltime");
    p.deck("willDisappear", "ctx1", "board");
    expect(p.open()).toHaveLength(0);
  });

  it("wist de knoppen als de app wegvalt en probeert opnieuw op de tik van de worker", async () => {
    const p = boot();
    p.deck("willAppear", "ctx1", "board", { path: "/timer/toggle" });
    p.open()[0]!.reply({ ok: true, etag: "a", faces: { "/timer/toggle": { svg: "<svg>10:00</svg>" } } });
    await p.flush();
    p.open().at(-1)!.fail();
    await p.flush();
    // Terug naar het rustbeeld uit het manifest: een stilstaande klok mag niet blijven staan.
    expect(images(p.sent).at(-1)).toEqual({ event: "setImage", context: "ctx1", payload: { target: 0 } });
    const before = p.requests.length;
    await p.flush();
    expect(p.requests.length).toBe(before);

    p.tick();
    expect(p.requests.length).toBe(before + 1);
    expect(p.requests.at(-1)!.url).toBe(`${API}/faces?p=%2Ftimer%2Ftoggle&since=`);
    // De pagina zelf zet geen timer: die loopt in een verborgen pagina nog maar één keer per minuut.
    expect(p.pageTimers).toHaveLength(0);
  });

  it("blijft niet in een lus vragen als er iets anders dan ArenaCue antwoordt", async () => {
    const p = boot();
    p.deck("willAppear", "ctx1", "board", { path: "/timer/toggle" });
    p.open()[0]!.reply({ hello: "world" });
    await p.flush();
    await p.flush();
    expect(p.requests).toHaveLength(1);

    p.tick();
    p.requests.at(-1)!.reply({ ok: true, etag: "", faces: {} });
    await p.flush();
    await p.flush();
    expect(p.requests).toHaveLength(2);
  });

  it("valt zonder worker terug op een gewone timer", () => {
    const p = boot({ worker: false });
    expect(p.pageTimers).toHaveLength(1);
    p.deck("willAppear", "ctx1", "board", { path: "/timer/toggle" });
    p.open()[0]!.fail();
  });
});

describe("plug-inbestanden", () => {
  const manifest = streamDeckManifest("nl");

  it("heeft wat Stream Deck in het manifest vraagt", () => {
    expect(manifest.UUID).toBe(STREAM_DECK_PLUGIN_UUID);
    expect(manifest.Version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(manifest.SDKVersion).toBe(2);
    expect(manifest.CodePath).toBe("plugin.html");
  });

  it("biedt de scorebordknop aan en houdt de bestaande acties", () => {
    const ids = manifest.Actions.map((item) => item.UUID);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      ["board", "key", "input", "preview", "cut", "stream", "record", "timer", "score", "blackout"].map(
        (id) => `${STREAM_DECK_PLUGIN_UUID}.${id}`,
      ),
    );
    expect(streamDeckManifest("fr").Actions[0]!.Name).toBe("Touche tableau de score");
  });

  it("schrijft elk bestand weg waar het manifest naar verwijst", () => {
    const names = streamDeckPluginFiles("nl").map((file) => file.name);
    expect(names).toContain(manifest.CodePath);
    expect(names).toContain(manifest.PropertyInspectorPath);
    for (const item of manifest.Actions) {
      expect(names, item.UUID).toContain(`${item.Icon}.svg`);
      for (const state of item.States) expect(names).toContain(`${state.Image}.svg`);
      const inspector = (item as { PropertyInspectorPath?: string }).PropertyInspectorPath;
      if (inspector) expect(names).toContain(inspector);
    }
    expect(names).toContain(`${manifest.CategoryIcon}.svg`);
  });

  it("biedt in het instelscherm alleen paden aan die de app kent", () => {
    const page = streamDeckBoardInspectorHtml("en");
    const values = [...page.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map((m) => [m[1]!, m[2]!]);
    expect(values.map(([path]) => path)).toEqual([...BOARD_DECK_PATHS]);
    for (const [path] of values) {
      expect(parseStreamDeckPath(path) ?? parseBoardDeckPath(path), path).not.toBeNull();
    }
    expect(values[0]![1]).toBe("Clock start / pause");
  });
});
