import type { OfficialClockDecoder, OfficialClockReading } from "../types";
import { asciiText, ByteQueue, parseClockText } from "./shared";

/**
 * Daktronics All Sport 5000, RTD-uitgang (Real Time Data). Gebaseerd op open broncode die deze
 * uitgang uitleest; niet nagekeken tegen een opname van een echte console.
 *
 * Pakket: SYN <kop> SOH <code> STX <tekst> EOT <controle> ETB. De laatste vier cijfers van de code
 * zeggen op welke positie de tekst in één lange regel hoort. In die regel staat:
 *   positie 1, 5 tekens    wedstrijdklok ("mm:ss" of "ss.t")
 *   positie 28, 1 teken    's' zolang de wedstrijdklok stilstaat
 *   positie 201, 8 tekens  shotclock (leeg = uit)
 * Of de shotclock loopt, staat er niet in: dat leiden we af uit het tikken.
 */

const SYN = 0x16;
const SOH = 0x01;
const STX = 0x02;
const EOT = 0x04;
const ETB = 0x17;
const LINE_LENGTH = 512;
const MAX_PACKET = 600;

const GAME = { start: 0, length: 5 };
const GAME_STOPPED = 27;
const SHOT = { start: 200, length: 8 };

export function createDaktronicsDecoder(): OfficialClockDecoder {
  const queue = new ByteQueue();
  const line = new Array<string>(LINE_LENGTH).fill(" ");
  /** Posities die de console al minstens één keer gestuurd heeft; de rest is nog onbekend. */
  const known = new Array<boolean>(LINE_LENGTH).fill(false);
  let frames = 0;
  let rejected = 0;

  function knownRange(start: number, length: number): boolean {
    for (let i = start; i < start + length; i++) if (!known[i]) return false;
    return true;
  }

  function apply(packet: Uint8Array): OfficialClockReading | null {
    const soh = packet.indexOf(SOH);
    const stx = packet.indexOf(STX, soh + 1);
    const eot = packet.indexOf(EOT, stx + 1);
    if (soh < 0 || stx < 0 || eot < 0) return null;
    const code = asciiText(packet, soh + 1, stx);
    if (!/^\d{4,}$/.test(code)) return null;
    const position = Number(code.slice(-4));
    const text = asciiText(packet, stx + 1, eot);
    if (position + text.length > LINE_LENGTH) return null;
    for (let i = 0; i < text.length; i++) {
      line[position + i] = text[i];
      known[position + i] = true;
    }

    const touches = (start: number, length: number) => position < start + length && position + text.length > start;
    const reading: OfficialClockReading = {};
    if ((touches(GAME.start, GAME.length) || touches(GAME_STOPPED, 1)) && knownRange(GAME.start, GAME.length)) {
      const game = parseClockText(line.slice(GAME.start, GAME.start + GAME.length).join(""));
      if (game) {
        reading.game = { ...game, running: known[GAME_STOPPED] ? line[GAME_STOPPED].toLowerCase() !== "s" : undefined };
      }
    }
    if (touches(SHOT.start, SHOT.length) && knownRange(SHOT.start, SHOT.length)) {
      const shotText = line.slice(SHOT.start, SHOT.start + SHOT.length).join("");
      if (shotText.trim() === "") {
        reading.shot = null;
      } else {
        const shot = parseClockText(shotText);
        if (shot) reading.shot = { ...shot };
      }
    }
    return reading;
  }

  return {
    push(chunk) {
      queue.append(chunk);
      const out: OfficialClockReading[] = [];
      for (;;) {
        const data = queue.bytes;
        const start = data.indexOf(SYN);
        if (start < 0) {
          queue.drop(data.length);
          break;
        }
        if (start > 0) queue.drop(start);
        const packet = queue.bytes;
        const end = packet.indexOf(ETB, 1);
        if (end < 0) {
          if (packet.length > MAX_PACKET) queue.drop(1);
          else break;
          continue;
        }
        const reading = apply(packet.subarray(0, end + 1));
        if (reading) {
          frames += 1;
          if (reading.game || reading.shot !== undefined) out.push(reading);
        } else {
          rejected += 1;
        }
        queue.drop(end + 1);
      }
      return out;
    },
    stats: () => ({ frames, rejected }),
  };
}
