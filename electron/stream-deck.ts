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
import type { LivestreamController } from "./livestream";
import { installStreamDeckPlugin } from "./stream-deck-plugin";

type Snapshot = {
  timerRunning?: boolean;
};

export type StreamDeckHandle = {
  info: () => StreamDeckInfo;
  stop: () => Promise<void>;
};

export function startStreamDeck(options: {
  livestream: LivestreamController;
  runCommand: (command: unknown) => Promise<unknown>;
  getSnapshot: () => Promise<unknown>;
  log: (line: string) => void;
}): StreamDeckHandle {
  const port = STREAM_DECK_HTTP_PORT;
  const baseUrl = `http://127.0.0.1:${port}`;
  const pluginInstalled = installStreamDeckPlugin(options.log);

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
          await options.runCommand({ type: "timer:pause" });
        } else {
          await options.runCommand({ type: "timer:start" });
        }
        return { ok: true };
      }
      if (action.id === "score") {
        await runScoreDeckAction(action, (cmd) => options.runCommand(cmd));
        return { ok: true };
      }
      await options.runCommand({ type: "display:blackout" });
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

  const server = http.createServer(async (req, res) => {
    const ip = req.socket.remoteAddress ?? "";
    if (ip !== "127.0.0.1" && ip !== "::1" && ip !== ":ffff:127.0.0.1") {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "Alleen vanaf deze pc." }));
      return;
    }
    const url = new URL(req.url ?? "/", baseUrl);
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
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
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
          // Heet nog "inputs" voor de plug-in; elke knop is nu een scène.
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
        }),
      );
      return;
    }
    const action = parseStreamDeckPath(url.pathname);
    if (!action) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "Onbekende knop." }));
      return;
    }
    const result = await runAction(action);
    res.statusCode = result.ok ? 200 : 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(result));
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
        for (const accelerator of registered) globalShortcut.unregister(accelerator);
        server.close(() => resolve());
      }),
  };
}
