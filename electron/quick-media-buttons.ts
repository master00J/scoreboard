import fs from "node:fs";
import path from "node:path";
import { parseQuickMediaButtonIds } from "../lib/quick-media-button";

const FILE_NAME = "quick-media-buttons.json";

/**
 * Welke media de regie als snelle knop heeft vastgepind. Het regievenster bewaart die lijst zelf;
 * het meldt haar hier zodat ook de Stream Deck ze kent, en ze blijft bewaard zodat de toetsen na
 * een herstart meteen kloppen.
 */
export function createQuickMediaButtonStore(userDataDir: string, log: (line: string) => void) {
  const file = path.join(userDataDir, FILE_NAME);
  let ids: string[] = [];
  try {
    if (fs.existsSync(file)) ids = parseQuickMediaButtonIds(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    log(`[quick-media] lijst niet gelezen: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    get: (): string[] => ids,
    set: (raw: unknown): void => {
      const next = parseQuickMediaButtonIds(raw);
      if (next.length === ids.length && next.every((id, i) => id === ids[i])) return;
      ids = next;
      try {
        fs.mkdirSync(userDataDir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(ids), "utf8");
      } catch (error) {
        log(`[quick-media] lijst niet bewaard: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
