/**
 * Officiële klok volgen: ArenaCue leest mee met de console van de jurytafel en stuurt zijn eigen
 * wedstrijdklok en shotclock bij. Het leest alleen; er gaat nooit iets naar de console terug.
 */

export const OFFICIAL_CLOCK_PROTOCOLS = ["bodet", "stramatel", "swisstiming", "daktronics", "arenacue"] as const;
export type OfficialClockProtocolId = (typeof OFFICIAL_CLOCK_PROTOCOLS)[number];

export const OFFICIAL_CLOCK_CONNECTIONS = ["tcp-listen", "tcp-connect", "udp", "serial"] as const;
/**
 * `tcp-listen`: de console (of haar omvormer) belt in op deze pc. `tcp-connect`: deze pc belt in op een
 * serieel-naar-netwerk-omvormer. `serial`: een COM-poort (USB-kabel) op deze pc.
 */
export type OfficialClockConnection = (typeof OFFICIAL_CLOCK_CONNECTIONS)[number];

export type OfficialClockSettings = {
  enabled: boolean;
  protocol: OfficialClockProtocolId;
  connection: OfficialClockConnection;
  /** Adres van de omvormer bij `tcp-connect`. */
  host: string;
  /** Poort voor `tcp-listen`, `tcp-connect` en `udp`. */
  port: number;
  /** COM-poort (Windows) of apparaatpad (macOS) bij `serial`. */
  serialPath: string;
  /** 0 = de snelheid die bij het protocol hoort. */
  baudRate: number;
  followGameClock: boolean;
  followShotClock: boolean;
  /** `auto` = dezelfde richting als de sport in ArenaCue. */
  gameClockDirection: "auto" | "down" | "up";
  /** De console heeft een eigen claxon: die van ArenaCue zwijgt voor klokken die gevolgd worden. */
  muteHorn: boolean;
};

/** Eén klokstand zoals de console hem op dat moment toont. */
export type OfficialClockValue = {
  seconds: number;
  /** Kleinste stap van deze stand: 1 = hele seconden, 0.1 = tienden. */
  resolution: number;
  /** Loopt de klok volgens de console? `undefined` = het protocol zegt het niet. */
  running?: boolean;
};

/** Wat één bericht van de console ons vertelt. Velden die het bericht niet bevat, ontbreken. */
export type OfficialClockReading = {
  game?: OfficialClockValue;
  /** `null` = de shotclock staat uit (leeg scherm). */
  shot?: OfficialClockValue | null;
};

export type OfficialClockDecoder = {
  /** Voedt ruwe bytes en geeft de standen uit alle volledige berichten terug, in volgorde. */
  push(chunk: Uint8Array): OfficialClockReading[];
  /** Tellers voor het statuspaneel: herkende en afgekeurde berichten. */
  stats(): { frames: number; rejected: number };
};

export type OfficialClockLinkState =
  /** Volgen staat uit. */
  | "off"
  /** Poort open of aan het verbinden, nog geen bruikbaar bericht. */
  | "waiting"
  /** Er komen berichten binnen die we begrijpen. */
  | "receiving"
  /** Er kwamen berichten, maar nu al even niet meer: ArenaCue loopt op zijn eigen klok verder. */
  | "lost"
  /** Poort of verbinding kon niet geopend worden. */
  | "error";

export type OfficialClockStatus = {
  link: OfficialClockLinkState;
  /** Technische foutmelding bij `error`, voor de operator en het logboek. */
  error: string | null;
  /** Er komen bytes binnen, maar geen enkel bericht past bij het gekozen merk. */
  unrecognized: boolean;
  frames: number;
  rejected: number;
  /** Laatste standen van de console, voor de controle "klopt dit met het bord?". */
  game: { seconds: number; resolution: number; running: boolean } | null;
  /** `off: true` = de shotclock staat uit op de console. */
  shot: { seconds: number; resolution: number; running: boolean; off: boolean } | null;
  followingGameClock: boolean;
  followingShotClock: boolean;
  /** Waarom de wedstrijdklok nu niet gevolgd wordt, als dat zo is. */
  gameClockHold: OfficialClockHoldReason | null;
  /** Loopt er een opname van de ruwe datastroom? Pad van het bestand. */
  capturePath: string | null;
};

export type OfficialClockHoldReason =
  /** Geen actieve wedstrijd, of de sport heeft geen wedstrijdklok. */
  | "no_match_clock"
  /** De console toont meer tijd dan een periode in ArenaCue duurt (pauzeklok of andere instelling). */
  | "longer_than_period";

export const DEFAULT_OFFICIAL_CLOCK_SETTINGS: OfficialClockSettings = {
  enabled: false,
  protocol: "bodet",
  connection: "tcp-listen",
  host: "",
  port: 4001,
  serialPath: "",
  baudRate: 0,
  followGameClock: true,
  followShotClock: true,
  gameClockDirection: "auto",
  muteHorn: true,
};

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/** Leest instellingen uit een bestand of van het bedieningspaneel; alles wat niet klopt valt terug op de standaard. */
export function normalizeOfficialClockSettings(raw: unknown): OfficialClockSettings {
  const d = DEFAULT_OFFICIAL_CLOCK_SETTINGS;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...d };
  const rec = raw as Record<string, unknown>;
  const port = Math.round(Number(rec.port));
  const baudRate = Math.round(Number(rec.baudRate));
  const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
  return {
    enabled: bool(rec.enabled, d.enabled),
    protocol: isOneOf(OFFICIAL_CLOCK_PROTOCOLS, rec.protocol) ? rec.protocol : d.protocol,
    connection: isOneOf(OFFICIAL_CLOCK_CONNECTIONS, rec.connection) ? rec.connection : d.connection,
    // Alleen tekens die in een hostnaam of IP-adres voorkomen: het adres gaat naar het besturingssysteem.
    host: typeof rec.host === "string" ? rec.host.trim().replace(/[^A-Za-z0-9.:\-_]/g, "").slice(0, 255) : d.host,
    port: Number.isFinite(port) && port >= 1 && port <= 65535 ? port : d.port,
    serialPath:
      typeof rec.serialPath === "string" ? rec.serialPath.trim().replace(/[^A-Za-z0-9./\-_]/g, "").slice(0, 120) : d.serialPath,
    baudRate: Number.isFinite(baudRate) && baudRate >= 300 && baudRate <= 921600 ? baudRate : 0,
    followGameClock: bool(rec.followGameClock, d.followGameClock),
    followShotClock: bool(rec.followShotClock, d.followShotClock),
    gameClockDirection: isOneOf(["auto", "down", "up"] as const, rec.gameClockDirection)
      ? rec.gameClockDirection
      : d.gameClockDirection,
    muteHorn: bool(rec.muteHorn, d.muteHorn),
  };
}

export const OFFICIAL_CLOCK_OFF_STATUS: OfficialClockStatus = {
  link: "off",
  error: null,
  unrecognized: false,
  frames: 0,
  rejected: 0,
  game: null,
  shot: null,
  followingGameClock: false,
  followingShotClock: false,
  gameClockHold: null,
  capturePath: null,
};
