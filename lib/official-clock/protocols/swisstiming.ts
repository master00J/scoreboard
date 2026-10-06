import type { OfficialClockDecoder, OfficialClockReading } from "../types";
import { asciiText, ByteQueue, parseClockText } from "./shared";

/**
 * Swiss Timing-console (basketbal), seriële uitgang. Geen openbare documentatie; de indeling is
 * afgeleid uit een opname van een volledige wedstrijd.
 *
 * Bericht: STX <tekst> ETX controlebyte, waarbij de controlebyte de XOR is van STX tot en met ETX.
 * Alleen het bericht dat met 'D' begint (24 tekens) bevat de klokken:
 *   [1..5]   wedstrijdklok: "MM:SS" of "SS.t " in de laatste minuut
 *   [18]     '1' klok loopt, anders stil ('2' = periode afgelopen). Tijdens de rust telt het
 *            klokveld de pauze af terwijl hier '0' blijft staan.
 *   [22..23] shotclock in hele seconden, twee spaties = uit
 * Of de shotclock loopt, zegt het bericht niet: dat leiden we af uit het tikken.
 */

const STX = 0x02;
const ETX = 0x03;
const DATA_LENGTH = 24;
const MAX_FRAME = 160;

function readData(body: Uint8Array): OfficialClockReading | null {
  const game = parseClockText(asciiText(body, 1, 6));
  if (!game) return null;
  const reading: OfficialClockReading = {
    game: { ...game, running: String.fromCharCode(body[18]) === "1" },
  };
  const shotText = asciiText(body, 22, 24);
  if (shotText.trim() === "") {
    reading.shot = null;
  } else {
    const shot = parseClockText(shotText);
    if (shot) reading.shot = { ...shot };
  }
  return reading;
}

export function createSwissTimingDecoder(): OfficialClockDecoder {
  const queue = new ByteQueue();
  let frames = 0;
  let rejected = 0;

  return {
    push(chunk) {
      queue.append(chunk);
      const out: OfficialClockReading[] = [];
      for (;;) {
        const data = queue.bytes;
        const start = data.indexOf(STX);
        if (start < 0) {
          queue.drop(data.length);
          break;
        }
        if (start > 0) queue.drop(start);
        const frame = queue.bytes;
        const etx = frame.indexOf(ETX, 1);
        if (etx < 0) {
          if (frame.length > MAX_FRAME) queue.drop(1);
          else break;
          continue;
        }
        if (frame.length < etx + 2) break;
        let check = 0;
        for (let i = 0; i <= etx; i++) check ^= frame[i];
        if (check !== frame[etx + 1]) {
          // Spelersberichten bevatten soms zelf een ETX-byte en vallen dan hier uit; alleen een
          // afgekeurd klokbericht telt als storing.
          if (frame[1] === 0x44) rejected += 1;
          queue.drop(1);
          continue;
        }
        const body = frame.subarray(1, etx);
        if (body[0] === 0x44) {
          const reading = body.length === DATA_LENGTH ? readData(body) : null;
          if (reading) {
            frames += 1;
            out.push(reading);
          } else {
            rejected += 1;
          }
        }
        // Andere berichten (datum, spelers) hebben een geldige controlebyte maar geen klok.
        queue.drop(etx + 2);
      }
      return out;
    },
    stats: () => ({ frames, rejected }),
  };
}
