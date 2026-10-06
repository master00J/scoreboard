import type { OfficialClockDecoder, OfficialClockReading } from "../types";
import { asciiText, ByteQueue, fieldNumber } from "./shared";

/**
 * Bodet Scorepad, "Network output and protocols" (réf. 608264A). Ook Mobatime-borden sturen dit formaat.
 *
 * Bericht: SOH adres STX ctrl <tekst> ETX LRC. De tekst begint met een berichtnummer van twee cijfers:
 *   18  wedstrijdklok basketbal (statusbyte, sport, MMSS of SS'D't in de laatste minuut)
 *   36  tienden van de wedstrijdklok in de laatste minuut (SSt)
 *   50  shotclock (statusbyte, SS of St)
 *   01  wedstrijdklok handbal, 11 wedstrijdklok ijshockey (zelfde opbouw als 18)
 * In de statusbyte betekent bit 1 = 1 dat de klok stilstaat.
 */

const SOH = 0x01;
const STX = 0x02;
const ETX = 0x03;
/** Langste bericht in het document is 20 tekens; ruim daarboven is het geen Bodet-bericht. */
const MAX_FRAME = 64;

/** Controlebyte: XOR van alles na SOH tot en met ETX, op 7 bits, en nooit een stuurteken. */
export function bodetLrc(bytes: Uint8Array, from: number, toInclusive: number): number {
  let lrc = 0;
  for (let i = from; i <= toInclusive; i++) lrc ^= bytes[i];
  lrc &= 0x7f;
  return lrc < 0x20 ? lrc + 0x20 : lrc;
}

function clockStopped(status: number): boolean {
  return (status & 0x02) !== 0;
}

/** Wedstrijdklok uit de vier tekens van bericht 18/01/11: "MMSS", of "SS" + 'D' + tiende. */
function gameClockField(text: string): { seconds: number; resolution: number } | null {
  if (text.length < 4) return null;
  if (text[2] === "D") {
    const seconds = fieldNumber(text.slice(0, 2));
    const tenths = fieldNumber(text[3]);
    return seconds === null || tenths === null ? null : { seconds: seconds + tenths / 10, resolution: 0.1 };
  }
  // Minuten onder de tien komen met een spatie ervoor; een leeg minutenveld is nul.
  const minutes = text.slice(0, 2).trim() === "" ? 0 : fieldNumber(text.slice(0, 2));
  const seconds = fieldNumber(text.slice(2, 4));
  return minutes === null || seconds === null ? null : { seconds: minutes * 60 + seconds, resolution: 1 };
}

export function createBodetDecoder(): OfficialClockDecoder {
  const queue = new ByteQueue();
  let frames = 0;
  let rejected = 0;
  /** Bericht 36 heeft geen statusbyte: de klok loopt zoals het laatste bericht 18 zei. */
  let gameRunning: boolean | undefined;

  function readMessage(message: Uint8Array): OfficialClockReading | null {
    const id = asciiText(message, 0, 2);
    if (id === "18" || id === "01" || id === "11") {
      const value = gameClockField(asciiText(message, 4, 8));
      if (!value) return null;
      gameRunning = !clockStopped(message[2]);
      return { game: { ...value, running: gameRunning } };
    }
    if (id === "36") {
      const seconds = fieldNumber(asciiText(message, 2, 4));
      const tenths = fieldNumber(asciiText(message, 4, 5));
      if (seconds === null || tenths === null) return null;
      return { game: { seconds: seconds + tenths / 10, resolution: 0.1, running: gameRunning } };
    }
    if (id === "50") {
      const status = message[2];
      // Bit 3: het shotclockscherm is leeg.
      if ((status & 0x08) !== 0) return { shot: null };
      const running = !clockStopped(status);
      if ((status & 0x10) !== 0) {
        const seconds = fieldNumber(asciiText(message, 3, 4));
        const tenths = fieldNumber(asciiText(message, 4, 5));
        if (seconds === null || tenths === null) return null;
        return { shot: { seconds: seconds + tenths / 10, resolution: 0.1, running } };
      }
      const seconds = fieldNumber(asciiText(message, 3, 5));
      return seconds === null ? null : { shot: { seconds, resolution: 1, running } };
    }
    return {};
  }

  return {
    push(chunk) {
      queue.append(chunk);
      const out: OfficialClockReading[] = [];
      for (;;) {
        const data = queue.bytes;
        const start = data.indexOf(SOH);
        if (start < 0) {
          queue.drop(data.length);
          break;
        }
        if (start > 0) queue.drop(start);
        const frame = queue.bytes;
        if (frame.length < 4) break;
        if (frame[2] !== STX) {
          queue.drop(1);
          continue;
        }
        const etx = frame.indexOf(ETX, 4);
        if (etx < 0) {
          if (frame.length > MAX_FRAME) queue.drop(1);
          else break;
          continue;
        }
        if (etx > MAX_FRAME) {
          queue.drop(1);
          continue;
        }
        if (frame.length < etx + 2) break;
        if (frame[etx + 1] !== bodetLrc(frame, 1, etx)) {
          rejected += 1;
          queue.drop(1);
          continue;
        }
        const reading = readMessage(frame.subarray(4, etx));
        if (reading) {
          frames += 1;
          if (reading.game || reading.shot !== undefined) out.push(reading);
        } else {
          rejected += 1;
        }
        queue.drop(etx + 2);
      }
      return out;
    },
    stats: () => ({ frames, rejected }),
  };
}
