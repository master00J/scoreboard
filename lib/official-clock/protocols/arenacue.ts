import type { OfficialClockDecoder, OfficialClockReading, OfficialClockValue } from "../types";
import { parseClockText } from "./shared";

/**
 * Open ArenaCue-formaat voor consoles zonder eigen koppeling: een tussenprogramma (cijferherkenning
 * met een camera, een eigen script, een Raspberry Pi aan de console) stuurt één JSON-regel per stand.
 *
 *   {"clock":"8:31","clockRunning":true,"shot":14,"shotRunning":true}
 *
 * `clock` en `shot` zijn seconden (getal) of de tekst van het bord ("8:31", "45.3"). `shot: null`
 * betekent shotclock uit. De `...Running`-velden mogen ontbreken; dan leiden we het af uit het tikken.
 * Elk veld mag ontbreken: een regel met alleen `shot` laat de wedstrijdklok ongemoeid.
 */

const MAX_LINE = 2048;

function clockValue(raw: unknown, running: unknown): OfficialClockValue | null {
  let value: { seconds: number; resolution: number } | null = null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw < 100_000) {
    value = { seconds: Math.round(raw * 10) / 10, resolution: Number.isInteger(raw) ? 1 : 0.1 };
  } else if (typeof raw === "string") {
    value = parseClockText(raw);
  }
  if (!value) return null;
  return typeof running === "boolean" ? { ...value, running } : value;
}

function readLine(text: string): OfficialClockReading | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  const reading: OfficialClockReading = {};
  if ("clock" in rec) {
    const game = clockValue(rec.clock, rec.clockRunning);
    if (!game) return null;
    reading.game = game;
  }
  if ("shot" in rec) {
    if (rec.shot === null) {
      reading.shot = null;
    } else {
      const shot = clockValue(rec.shot, rec.shotRunning);
      if (!shot) return null;
      reading.shot = shot;
    }
  }
  return reading;
}

export function createArenaCueDecoder(): OfficialClockDecoder & { endOfDatagram(): OfficialClockReading[] } {
  const utf8 = new TextDecoder("utf-8");
  let pending = "";
  let frames = 0;
  let rejected = 0;

  function take(lines: string[]): OfficialClockReading[] {
    const out: OfficialClockReading[] = [];
    for (const raw of lines) {
      const text = raw.trim();
      if (!text) continue;
      const reading = readLine(text);
      if (!reading) {
        rejected += 1;
        continue;
      }
      frames += 1;
      if (reading.game || reading.shot !== undefined) out.push(reading);
    }
    return out;
  }

  return {
    push(chunk) {
      pending += utf8.decode(chunk, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      if (pending.length > MAX_LINE) {
        pending = "";
        rejected += 1;
      }
      return take(lines);
    },
    /** Een UDP-pakket is één bericht, ook zonder regeleinde. */
    endOfDatagram() {
      const rest = pending;
      pending = "";
      return take([rest]);
    },
    stats: () => ({ frames, rejected }),
  };
}
