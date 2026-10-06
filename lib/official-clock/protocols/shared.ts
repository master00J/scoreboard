import type { OfficialClockValue } from "../types";

/** Meer dan dit zonder volledig bericht is ruis (verkeerde snelheid, verkeerd merk): weggooien. */
const MAX_PENDING_BYTES = 4096;

/** Verzamelt binnenkomende bytes tot er volledige berichten in zitten. */
export class ByteQueue {
  private data: Uint8Array = new Uint8Array(0);

  append(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    const merged = new Uint8Array(this.data.length + chunk.length);
    merged.set(this.data, 0);
    merged.set(chunk, this.data.length);
    // Bij overloop de oudste bytes laten vallen: het nieuwste bericht is het enige dat telt.
    this.data = merged.length > MAX_PENDING_BYTES ? merged.subarray(merged.length - MAX_PENDING_BYTES) : merged;
  }

  get bytes(): Uint8Array {
    return this.data;
  }

  /** Verwijdert de eerste `count` bytes. */
  drop(count: number): void {
    this.data = count >= this.data.length ? new Uint8Array(0) : this.data.subarray(count);
  }
}

export function asciiText(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end && i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/**
 * Getal uit een vast veld met voorloopspaties ("  7", " 12", "024"). `null` als het veld leeg is of
 * iets anders dan cijfers bevat: dan slaan we die stand over in plaats van een verkeerde te tonen.
 */
export function fieldNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/**
 * Klokstand zoals hij op een bord staat: "8:05", "12:00", "59.9", "24", "1:23.4".
 * `null` als de tekst leeg is of geen klokstand is.
 */
export function parseClockText(text: string): Pick<OfficialClockValue, "seconds" | "resolution"> | null {
  const trimmed = text.trim();
  let m = /^(\d{1,3}):(\d{2})(?:\.(\d))?$/.exec(trimmed);
  if (m) {
    const tenths = m[3] === undefined ? 0 : Number(m[3]) / 10;
    return { seconds: Number(m[1]) * 60 + Number(m[2]) + tenths, resolution: m[3] === undefined ? 1 : 0.1 };
  }
  m = /^(\d{1,3})\.(\d)$/.exec(trimmed);
  if (m) return { seconds: Number(m[1]) + Number(m[2]) / 10, resolution: 0.1 };
  m = /^(\d{1,4})$/.exec(trimmed);
  if (m) return { seconds: Number(m[1]), resolution: 1 };
  return null;
}
