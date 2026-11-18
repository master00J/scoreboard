import http from "http";
import { globalShortcut } from "electron";
import { applyScenePreview, takeScene } from "../lib/livestream";
import { sceneInputId } from "../lib/stream-scenes";
import {
  parseStreamDeckPath,
  STREAM_DECK_BINDINGS,
  STREAM_DECK_HTTP_PORT,
  STREAM_DECK_SLOT_ACCELERATORS,
  runScoreDeckAction,
  streamDeckSlotShortTitle,
  type StreamDeckAction,
  type StreamDeckInfo,
} from "../lib/stream-deck";
import {
  boardDeckPlan,
  parseBoardDeckPath,
  type BoardDeckAction,
  type DeckLive,
  type DeckMatch,
  type DeckQuickButton,
  type DeckState,
} from "../lib/stream-deck-board";
import {
  DECK_FACES_MAX_PATHS,
  DECK_TEXTS,
  deckFaces,
  normalizeDeckLocale,
  type DeckStream,
  type DeckTexts,
} from "../lib/stream-deck-faces";
import { getSportProfile } from "../lib/sports";
import type { LivestreamController } from "./livestream";
import { installStreamDeckPlugin } from "./stream-deck-plugin";

type Snapshot = DeckState & {
  matchId?: string | null;
  updatedAt?: string;
};

/** Zo lang houdt de app een vraag van de plug-in open als er niets op de knoppen verandert. */
const FACES_HOLD_MS = 20_000;
/** Zo vaak kijkt de app, zolang de plug-in wacht, of een knop er anders uit moet zien. */
const FACES_CHECK_MS = 250;
/** Wedstrijdgegevens (stand, periode) opnieuw lezen, ook als het scherm geen wijziging meldde. */
const MATCH_MAX_AGE_MS = 5_000;
/** Snelle mediaknoppen opnieuw lezen: een nieuw label of een nieuwe knop staat zo binnen twee tellen op de toets. */
const QUICK_MAX_AGE_MS = 2_000;
const LOCALE_MAX_AGE_MS = 10_000;

export type StreamDeckHandle = {
  info: () => StreamDeckInfo;
  stop: () => Promise<void>;
};

export function startStreamDeck(options: {
  livestream: LivestreamController;
  runCommand: (command: unknown) => Promise<unknown>;
  /** Verse schermtoestand uit de database: voor een druk op een knop. */
  getSnapshot: () => Promise<unknown>;
  /** Schermtoestand die hooguit een seconde oud is: voor wat er op de knoppen staat. */
  getState: () => Promise<unknown>;
  getMatch: (matchId: string) => Promise<DeckMatch | null>;
  /** De snelle mediaknoppen van de regie, in haar volgorde. */
  getQuickButtons: () => Promise<DeckQuickButton[]>;
  getLocale: () => Promise<string>;
  log: (line: string) => void;
}): StreamDeckHandle {
  const port = STREAM_DECK_HTTP_PORT;
  const baseUrl = `http://127.0.0.1:${port}`;
  let stopped = false;

  // De plug-in krijgt de taal van de app, dus eerst die lezen en dan pas wegschrijven.
  let pluginInstalled = false;
  let texts: DeckTexts = DECK_TEXTS.nl;
  let textsAt = 0;
  const readTexts = async (): Promise<DeckTexts> => {
    if (Date.now() - textsAt > LOCALE_MAX_AGE_MS) {
      textsAt = Date.now();
      try {
        texts = DECK_TEXTS[normalizeDeckLocale(await options.getLocale())];
      } catch {
        /* de vorige taal blijft staan */
      }
    }
    return texts;
  };
  void options
    .getLocale()
    .catch(() => "nl")
    .then((locale) => {
      pluginInstalled = installStreamDeckPlugin(normalizeDeckLocale(locale), options.log);
    });

  let quickCache: { at: number; buttons: DeckQuickButton[] } | null = null;
  let quickError = "";
  const readQuick = async (fresh: boolean): Promise<DeckQuickButton[]> => {
    if (fresh || !quickCache || Date.now() - quickCache.at > QUICK_MAX_AGE_MS) {
      try {
        quickCache = { at: Date.now(), buttons: await options.getQuickButtons() };
        quickError = "";
      } catch (error) {
        // De andere toetsen blijven werken; de snelle knoppen houden wat ze hadden.
        const message = error instanceof Error ? error.message : String(error);
        if (message !== quickError) options.log(`[stream-deck] snelle knoppen: ${message}`);
        quickError = message;
        quickCache = { at: Date.now(), buttons: quickCache?.buttons ?? [] };
      }
    }
    return quickCache.buttons;
  };

  let matchCache: { key: string; at: number; match: DeckMatch | null } | null = null;
  const readLive = async (fresh = false): Promise<DeckLive> => {
    const state = (await (fresh ? options.getSnapshot() : options.getState())) as Snapshot | null;
    const quick = await readQuick(fresh);
    if (fresh) matchCache = null;
    if (!state) return { state: null, match: null, quick };
    if (!state.matchId) return { state, match: null, quick };
    // Elke wijziging aan de wedstrijd tikt ook de schermtoestand aan; dat is het sein om opnieuw te lezen.
    const key = `${state.matchId}|${state.updatedAt ?? ""}`;
    if (!matchCache || matchCache.key !== key || Date.now() - matchCache.at > MATCH_MAX_AGE_MS) {
      matchCache = { key, at: Date.now(), match: await options.getMatch(state.matchId) };
    }
    return { state, match: matchCache.match, quick };
  };

  const readStream = (): DeckStream => {
    const settings = options.livestream.getSettings();
    const status = options.livestream.getStatus();
    return {
      running: status.running,
      recording: status.recording,
      scenes: settings.scenes.map((scene) => ({
        name: scene.name || settings.videoInputs.find((item) => item.id === sceneInputId(scene))?.name || "",
        program: scene.id === settings.activeSceneId,
        preview: scene.id === settings.previewSceneId,
      })),
      slots: settings.streamDeckSlots,
    };
  };

  const readFaces = async (paths: string[]) =>
    deckFaces(paths, {
      live: await readLive(),
      stream: readStream(),
      texts: await readTexts(),
      now: Date.now(),
    });

  /** Stuurt een commando; een weigering (geen wedstrijd, niet voor deze sport) wordt een fout op de knop. */
  const send = async (command: unknown): Promise<unknown> => {
    const ack = (await options.runCommand(command)) as { ok?: boolean; error?: string } | null;
    if (ack && ack.ok === false) throw new Error(ack.error ?? "Commando geweigerd");
    return ack;
  };

  const runAction = async (action: StreamDeckAction): Promise<{ ok: boolean; error?: string }> => {
    try {
      if (action.id === "key") {
        const slot = options.livestream.getSettings().streamDeckSlots[action.index - 1];
        if (!slot) return { ok: false, error: `Geen knop ${action.index}` };
        return runAction(slot.action);
      }
      if (action.id === "input" || action.id === "preview") {
        // Knop N = scène N. Na de overstap naar scènes is dat dezelfde volgorde als de bronnen.
        const settings = options.livestream.getSettings();
        const scene = settings.scenes[action.index - 1];
        if (!scene) return { ok: false, error: `Geen scène ${action.index}` };
        if (action.id === "preview") {
          options.livestream.saveSettings(applyScenePreview(settings, scene.id));
        } else {
          options.livestream.saveSettings(takeScene(settings, scene.id));
        }
        return { ok: true };
      }
      if (action.id === "cut") {
        const settings = options.livestream.getSettings();
        const id = settings.previewSceneId || settings.activeSceneId;
        options.livestream.saveSettings(takeScene(settings, id));
        return { ok: true };
      }
      if (action.id === "stream") {
        const running = options.livestream.getStatus().running;
        if (action.mode === "start" || (action.mode === "toggle" && !running)) {
          await options.livestream.start();
        } else {
          await options.livestream.stop();
        }
        return { ok: true };
      }
      if (action.id === "record") {
        const recording = options.livestream.getStatus().recording;
        if (action.mode === "start" || (action.mode === "toggle" && !recording)) {
          await options.livestream.startRecord();
        } else {
          await options.livestream.stopRecord();
        }
        return { ok: true };
      }
      if (action.id === "timer") {
        const snap = (await options.getSnapshot()) as Snapshot | null;
        const running = Boolean(snap?.timerRunning);
        if (action.mode === "pause" || (action.mode === "toggle" && running)) {
          await send({ type: "timer:pause" });
        } else {
          await send({ type: "timer:start" });
        }
        return { ok: true };
      }
      if (action.id === "score") {
        const { match } = await readLive(true);
        const goalSport = match ? getSportProfile(match.sport).supportsGoalVisuals : true;
        await runScoreDeckAction(action, send, goalSport);
        return { ok: true };
      }
      await send({ type: "display:blackout" });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  /** Scorebordknop: de live toestand bepaalt welke commando's hij stuurt. */
  const runBoardAction = async (action: BoardDeckAction): Promise<{ ok: boolean; error?: string }> => {
    try {
      // Vers lezen: de druk hoort bij de wedstrijd van nu, niet bij die van enkele seconden terug.
      const plan = boardDeckPlan(action, await readLive(true));
      if (!plan.ok) return { ok: false, error: plan.issue };
      for (const command of plan.commands) await send(command);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const registered: string[] = [];
  STREAM_DECK_SLOT_ACCELERATORS.forEach((accelerator, index) => {
    try {
      const ok = globalShortcut.register(accelerator, () => {
        const slot = options.livestream.getSettings().streamDeckSlots[index];
        if (slot) void runAction(slot.action);
      });
      if (ok) registered.push(accelerator);
      else options.log(`[stream-deck] toets ${accelerator} was al in gebruik`);
    } catch (error) {
      options.log(
        `[stream-deck] toets ${accelerator} faalde: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  const writeJson = (res: http.ServerResponse, status: number, payload: unknown) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  };

  /**
   * De plug-in vraagt hoe zijn knoppen eruitzien en krijgt antwoord zodra dat anders is dan wat hij
   * al heeft (`since`). Zo staat een lopende klok of een nieuwe stand meteen op de knop, zonder dat
   * de plug-in zelf op een timer moet vragen.
   */
  const serveFaces = async (url: URL, res: http.ServerResponse) => {
    const paths = url.searchParams.getAll("p").slice(0, DECK_FACES_MAX_PATHS);
    const since = url.searchParams.get("since") ?? "";
    let gone = false;
    res.on("close", () => {
      gone = true;
    });
    const deadline = Date.now() + FACES_HOLD_MS;
    for (;;) {
      const body = await readFaces(paths);
      if (gone || stopped) return;
      if (body.etag !== since || Date.now() >= deadline) {
        writeJson(res, 200, { ok: true, ...body });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, FACES_CHECK_MS));
    }
  };

  const server = http.createServer(async (req, res) => {
    const ip = req.socket.remoteAddress ?? "";
    if (ip !== "127.0.0.1" && ip !== "::1" && ip !== ":ffff:127.0.0.1") {
      writeJson(res, 403, { ok: false, error: "Alleen vanaf deze pc." });
      return;
    }
    const url = new URL(req.url ?? "/", baseUrl);
    try {
      if (url.pathname === "/faces") {
        await serveFaces(url, res);
        return;
      }
      if (url.pathname === "/" || url.pathname === "" || url.pathname === "/status") {
        const settings = options.livestream.getSettings();
        const status = options.livestream.getStatus();
        const programIndex = Math.max(
          1,
          settings.scenes.findIndex((scene) => scene.id === settings.activeSceneId) + 1,
        );
        const previewIndex = Math.max(
          1,
          settings.scenes.findIndex((scene) => scene.id === settings.previewSceneId) + 1,
        );
        writeJson(res, 200, {
          ok: true,
          service: "arenacue-stream-deck",
          running: status.running,
          recording: status.recording,
          programIndex,
          previewIndex,
          keys: settings.streamDeckSlots.map((slot, index) => ({
            index: index + 1,
            id: slot.id,
            title: streamDeckSlotShortTitle(slot),
            path: `/key/${index + 1}`,
            action: slot.action,
            accelerator: STREAM_DECK_SLOT_ACCELERATORS[index] ?? "",
          })),
          // Heet nog "inputs" voor Companion; elke knop is nu een scène.
          inputs: settings.scenes.map((scene, index) => {
            const input = settings.videoInputs.find((item) => item.id === sceneInputId(scene));
            return {
              index: index + 1,
              id: scene.id,
              name: scene.name || input?.name || "",
              kind: input?.kind ?? "camera",
              program: scene.id === settings.activeSceneId,
              preview: scene.id === settings.previewSceneId,
            };
          }),
          bindings: STREAM_DECK_BINDINGS,
        });
        return;
      }
      const action = parseStreamDeckPath(url.pathname);
      const board = action ? null : parseBoardDeckPath(url.pathname);
      if (!action && !board) {
        writeJson(res, 404, { ok: false, error: "Onbekende knop." });
        return;
      }
      const result = action ? await runAction(action) : await runBoardAction(board!);
      writeJson(res, result.ok ? 200 : 400, result);
    } catch (error) {
      options.log(`[stream-deck] ${url.pathname}: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) writeJson(res, 500, { ok: false, error: "Interne fout." });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    options.log(`[stream-deck] ${baseUrl} · toetsen ${registered.join(", ") || "geen"}`);
  });
  server.on("error", (error) => {
    options.log(`[stream-deck] HTTP: ${error instanceof Error ? error.message : String(error)}`);
  });

  return {
    info: () => ({
      enabled: true,
      port,
      baseUrl,
      pluginInstalled: pluginInstalled,
      bindings: STREAM_DECK_BINDINGS,
    }),
    stop: () =>
      new Promise((resolve) => {
        stopped = true;
        for (const accelerator of registered) globalShortcut.unregister(accelerator);
        server.close(() => resolve());
        // Open vragen van de plug-in houden de server anders tot hun wachttijd open.
        server.closeAllConnections();
      }),
  };
}
