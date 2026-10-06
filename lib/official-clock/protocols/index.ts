import type {
  OfficialClockConnection,
  OfficialClockDecoder,
  OfficialClockProtocolId,
  OfficialClockReading,
} from "../types";
import { createArenaCueDecoder } from "./arenacue";
import { createBodetDecoder } from "./bodet";
import { createDaktronicsDecoder } from "./daktronics";
import { createStramatelDecoder } from "./stramatel";
import { createSwissTimingDecoder } from "./swisstiming";

export type OfficialClockProtocol = {
  id: OfficialClockProtocolId;
  /** Verbinding die bij dit merk het meest voorkomt; het paneel stelt die voor. */
  connection: OfficialClockConnection;
  /** Voorgestelde netwerkpoort. */
  port: number;
  /** Seriële snelheid (8 databits, geen pariteit, 1 stopbit) als de operator er geen kiest. */
  baudRate: number;
  /**
   * Waarop de koppeling steunt, zodat het paneel eerlijk kan zeggen hoe zeker ze is:
   * `manual` = handleiding van de fabrikant én een echte opname, `capture` = alleen een echte opname,
   * `community` = open broncode van anderen, `own` = ons eigen formaat.
   */
  basis: "manual" | "capture" | "community" | "own";
  create: () => OfficialClockDecoder & { endOfDatagram?: () => OfficialClockReading[] };
};

export const OFFICIAL_CLOCK_PROTOCOL_LIST: OfficialClockProtocol[] = [
  { id: "bodet", connection: "tcp-listen", port: 4001, baudRate: 9600, basis: "manual", create: createBodetDecoder },
  { id: "stramatel", connection: "serial", port: 4001, baudRate: 19200, basis: "capture", create: createStramatelDecoder },
  {
    id: "swisstiming",
    connection: "serial",
    port: 4001,
    baudRate: 9600,
    basis: "capture",
    create: createSwissTimingDecoder,
  },
  {
    id: "daktronics",
    connection: "serial",
    port: 4001,
    baudRate: 19200,
    basis: "community",
    create: createDaktronicsDecoder,
  },
  { id: "arenacue", connection: "udp", port: 4010, baudRate: 9600, basis: "own", create: createArenaCueDecoder },
];

export function officialClockProtocol(id: OfficialClockProtocolId): OfficialClockProtocol {
  return OFFICIAL_CLOCK_PROTOCOL_LIST.find((protocol) => protocol.id === id) ?? OFFICIAL_CLOCK_PROTOCOL_LIST[0];
}
