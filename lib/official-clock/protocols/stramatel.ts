import type { OfficialClockDecoder, OfficialClockReading } from "../types";
import { asciiText, ByteQueue, fieldNumber } from "./shared";

/**
 * Stramatel-console, seriële uitgang voor tv-koppeling. Stramatel publiceert dit formaat niet; de
 * indeling hieronder is afgeleid uit een opname van een volledige basketbalwedstrijd.
 *
 * Bericht: 0xF8, type, ..., 0x0D. Alleen type '3' (54 bytes) bevat de klokken:
 *   [4..7]   wedstrijdklok: "MMSS" (minuten met voorloopspatie) of "SSt " in de laatste minuut
 *   [20]     '0' klok loopt, '1' klok staat stil, 'R' rust: het bord toont dan de pauzeklok
 *   [48..49] shotclock in hele seconden
 *   [51]     '0' shotclock loopt, anders stil
 *   [52]     '0' shotclock uit (leeg scherm)
 */

const START = 0xf8;
const END = 0x0d;
const MAIN_TYPE = 0x33;
const MAIN_LENGTH = 54;
const MAX_FRAME = 160;

function readMain(frame: Uint8Array): OfficialClockReading | null {
  const reading: OfficialClockReading = {};

  const state = String.fromCharCode(frame[20]);
  // Tijdens de rust is het klokveld de pauzeklok: dat is geen wedstrijdtijd, dus geen stand.
  if (state !== "R") {
    const field = asciiText(frame, 4, 8);
    let value: { seconds: number; resolution: number } | null = null;
    if (field[3] === " ") {
      const seconds = fieldNumber(field.slice(0, 2));
      const tenths = fieldNumber(field[2]);
      if (seconds !== null && tenths !== null) value = { seconds: seconds + tenths / 10, resolution: 0.1 };
    } else {
      const minutes = field.slice(0, 2).trim() === "" ? 0 : fieldNumber(field.slice(0, 2));
      const seconds = fieldNumber(field.slice(2, 4));
      if (minutes !== null && seconds !== null) value = { seconds: minutes * 60 + seconds, resolution: 1 };
    }
    if (!value) return null;
    reading.game = { ...value, running: state === "0" ? true : state === "1" ? false : undefined };
  }

  if (String.fromCharCode(frame[52]) === "0") {
    reading.shot = null;
  } else {
    const seconds = fieldNumber(asciiText(frame, 48, 50));
    if (seconds !== null) {
      reading.shot = { seconds, resolution: 1, running: String.fromCharCode(frame[51]) === "0" };
    }
  }
  return reading;
}

export function createStramatelDecoder(): OfficialClockDecoder {
  const queue = new ByteQueue();
  let frames = 0;
  let rejected = 0;

  return {
    push(chunk) {
      queue.append(chunk);
      const out: OfficialClockReading[] = [];
      for (;;) {
        const data = queue.bytes;
        const start = data.indexOf(START);
        if (start < 0) {
          queue.drop(data.length);
          break;
        }
        if (start > 0) queue.drop(start);
        const frame = queue.bytes;
        const end = frame.indexOf(END, 1);
        if (end < 0) {
          if (frame.length > MAX_FRAME) queue.drop(1);
          else break;
          continue;
        }
        // Een nieuw startteken vóór het einde: het vorige bericht was afgekapt.
        const restart = frame.indexOf(START, 1);
        if (restart > 0 && restart < end) {
          rejected += 1;
          queue.drop(restart);
          continue;
        }
        const length = end + 1;
        if (frame[1] === MAIN_TYPE) {
          const reading = length === MAIN_LENGTH ? readMain(frame.subarray(0, length)) : null;
          if (reading) {
            frames += 1;
            if (reading.game || reading.shot !== undefined) out.push(reading);
          } else {
            rejected += 1;
          }
        }
        // Andere types (spelersgegevens, teksten) zijn geldig maar bevatten geen klok.
        queue.drop(length);
      }
      return out;
    },
    stats: () => ({ frames, rejected }),
  };
}
