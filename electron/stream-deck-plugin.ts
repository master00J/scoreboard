import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { STREAM_DECK_PLUGIN_UUID } from "../lib/stream-deck";
import type { DeckLocale } from "../lib/stream-deck-faces";
import { streamDeckPluginFiles } from "../lib/stream-deck-plugin";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Zet de plug-in in de map van Stream Deck. De inhoud zelf staat in `lib/stream-deck-plugin.ts`. */
export function installStreamDeckPlugin(locale: DeckLocale, log: (line: string) => void): boolean {
  try {
    const dest = path.join(
      app.getPath("appData"),
      "Elgato",
      "StreamDeck",
      "Plugins",
      `${STREAM_DECK_PLUGIN_UUID}.sdPlugin`,
    );
    fs.mkdirSync(path.join(dest, "images"), { recursive: true });
    for (const file of streamDeckPluginFiles(locale)) {
      fs.writeFileSync(path.join(dest, file.name), file.text);
    }
    const png = Buffer.from(PNG_1X1, "base64");
    fs.writeFileSync(path.join(dest, "images", "plugin.png"), png);
    fs.writeFileSync(path.join(dest, "images", "plugin@2x.png"), png);
    log(`[stream-deck] plugin gezet in ${dest} — herstart Stream Deck om hem te zien`);
    return true;
  } catch (error) {
    log(`[stream-deck] plugin niet gezet: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
