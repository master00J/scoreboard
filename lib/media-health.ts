/**
 * Volledige controle van een mediabestand vóór de wedstrijd.
 *
 * De browser leest bij de media-check alleen de kop van een clip. Een MP4 waarvan de tweede helft
 * ontbreekt, slaagt dan, en loopt pas op het stadionscherm vast. Daarom decodeert FFmpeg elk beeld
 * van het bestand (`-f null -`); hier staat hoe we die uitkomst lezen en per bestandsversie bewaren.
 * Geen Node-modules: de media-check in het bedieningspaneel gebruikt dezelfde statussen.
 */

export type MediaKind = "VIDEO" | "IMAGE";

/** ok: speelt volledig. warning: speelt waarschijnlijk, maar kijk het na. broken: vervang het bestand. pending: nog niet volledig gecontroleerd. */
export type MediaHealthStatus = "ok" | "warning" | "broken" | "pending";

export type MediaHealthReason =
  | "ok"
  /** Het bestand staat niet (meer) op de opgeslagen plek. */
  | "missing_file"
  /** FFmpeg kan het niet openen of haalt er geen enkel beeld uit. */
  | "unreadable"
  /** Het bestand stopt met fouten vóór het einde: afgebroken download of kopie. */
  | "truncated"
  /** Zonder fouten, maar duidelijk korter dan de kop van het bestand zegt. */
  | "duration_mismatch"
  /** Volledig gedecodeerd, maar met decoderfouten onderweg. */
  | "decode_errors"
  /** De kop van de video is niet te lezen; nog geen volledige controle. */
  | "probe_failed"
  /** FFmpeg ontbreekt op deze pc: niet volledig te controleren. */
  | "ffmpeg_missing"
  /** De controle duurde te lang en is afgebroken. */
  | "timeout"
  /** Bewegende WebP: FFmpeg kan die niet decoderen, de browser wel. */
  | "not_decodable_here"
  /** Er loopt een wedstrijd: de controle wacht tot erna, zodat het scherm niet hapert. */
  | "deferred_live_match"
  /** Nog niet gecontroleerd. */
  | "not_checked";

/** Resultaat van één volledige decode, bewaard in `MediaItem.mediaCheckJson`. */
export type MediaCheckRecord = {
  v: 1;
  /** Bestandsversie (pad + grootte + wijzigingstijd); zie {@link mediaFileVersionKey}. */
  key: string;
  status: Exclude<MediaHealthStatus, "pending">;
  reason: MediaHealthReason;
  expectedSec: number | null;
  decodedSec: number | null;
  /** Eerste foutregel van FFmpeg, zonder paden. */
  detail: string | null;
  checkedAt: string;
};

/** Wat de media-check per bestand toont. */
export type MediaHealth = {
  status: MediaHealthStatus;
  reason: MediaHealthReason;
  detail: string | null;
  expectedSec: number | null;
  decodedSec: number | null;
};

/** FNV-1a 32-bit: kort en stabiel, en geen pad dat de back-up als bestand zou oppikken. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Sleutel per bestandsversie. Zelfde pad, grootte en wijzigingstijd: niet opnieuw decoderen.
 * Een vervangen of opnieuw gekopieerd bestand krijgt een andere sleutel en wordt opnieuw gecontroleerd.
 */
export function mediaFileVersionKey(resolvedPath: string, sizeBytes: number, mtimeMs: number): string {
  return `${Math.max(0, Math.floor(sizeBytes))}-${Math.max(0, Math.floor(mtimeMs))}-${fnv1a(resolvedPath)}`;
}

export function parseMediaCheckRecord(json: string | null | undefined): MediaCheckRecord | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Partial<MediaCheckRecord> | null;
    if (!value || value.v !== 1 || typeof value.key !== "string") return null;
    if (value.status !== "ok" && value.status !== "warning" && value.status !== "broken") return null;
    if (typeof value.reason !== "string") return null;
    return {
      v: 1,
      key: value.key,
      status: value.status === "ok" && value.reason === "not_decodable_here" ? "warning" : value.status,
      reason: value.reason as MediaHealthReason,
      expectedSec: typeof value.expectedSec === "number" ? value.expectedSec : null,
      decodedSec: typeof value.decodedSec === "number" ? value.decodedSec : null,
      detail: typeof value.detail === "string" ? value.detail : null,
      checkedAt: typeof value.checkedAt === "string" ? value.checkedAt : "",
    };
  } catch {
    return null;
  }
}

/** Uitvoer van `ffmpeg -progress pipe:1`: het laatste aantal beelden en de gedecodeerde tijd. */
export function parseDecodeProgress(stdout: string): { frames: number; decodedSec: number | null } {
  let frames = 0;
  let outTimeUs: number | null = null;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    const frame = line.match(/^frame=(\d+)$/);
    if (frame) frames = Number(frame[1]);
    const time = line.match(/^out_time_us=(-?\d+)$/);
    if (time) outTimeUs = Number(time[1]);
  }
  const decodedSec =
    outTimeUs != null && Number.isFinite(outTimeUs) && outTimeUs > 0 ? outTimeUs / 1_000_000 : null;
  return { frames, decodedSec };
}

/** Regels die FFmpeg bij elke fout herhaalt en die niets zeggen over de oorzaak. */
const GENERIC_ERROR_LINE =
  /Task finished with error|Terminating thread|Error opening input files?|Error processing packet in decoder|Error while (decoding|filtering)|Conversion failed|Nothing was written/i;

/** De foutregels van FFmpeg (`-v error`), zonder adressen en zonder het pad van het bestand. */
export function decodeErrorLines(stderr: string): string[] {
  const out: string[] = [];
  for (const raw of stderr.split(/\r?\n/)) {
    const line = raw
      .replace(/\[[^\]]*@\s*(0x)?[0-9a-fA-F]+\]\s*/g, "")
      .replace(/\[(in|out|vist|aist|dec|enc)[^\]]*\]\s*/g, "")
      .trim();
    if (!line) continue;
    out.push(line);
  }
  return out;
}

function errorDetail(lines: string[]): string | null {
  const useful = lines.find((line) => !GENERIC_ERROR_LINE.test(line)) ?? lines[0];
  if (!useful) return null;
  // Een pad hoort niet in de database-tekst: de back-up zou het anders als mediabestand zien.
  const cleaned = useful.replace(/([A-Za-z]:)?[\\/][^\s'"]+/g, "…").trim();
  return cleaned.length > 160 ? `${cleaned.slice(0, 157)}…` : cleaned;
}

export type DecodeRun = {
  exitCode: number | null;
  timedOut: boolean;
  /** stdout van `-progress pipe:1`. */
  progress: string;
  /** stderr met `-v error`. */
  stderr: string;
};

/**
 * Een video die met fouten stopt en zoveel korter is dan verwacht, is afgekapt.
 * Kleine verschillen (een laatste beeld, audio die iets langer loopt) tellen niet.
 */
const TRUNCATED_WITH_ERRORS_SEC = 0.5;
/** Zonder fouten: alleen een duidelijk verschil melden, en dan als waarschuwing. */
function cleanShortfallLimit(expectedSec: number): number {
  return Math.max(2, expectedSec * 0.1);
}

export function classifyDecodeRun(input: {
  kind: MediaKind;
  /** Duur volgens de kop van het bestand of de database; null = onbekend. */
  expectedSec: number | null;
  run: DecodeRun;
}): Omit<MediaCheckRecord, "v" | "key" | "checkedAt"> {
  const { kind, run } = input;
  const expectedSec =
    input.expectedSec != null && Number.isFinite(input.expectedSec) && input.expectedSec > 0
      ? input.expectedSec
      : null;
  const { frames, decodedSec } = parseDecodeProgress(run.progress);
  const errors = decodeErrorLines(run.stderr);
  const detail = errorDetail(errors);
  const base = { expectedSec, decodedSec: kind === "VIDEO" ? decodedSec : null, detail };

  if (run.timedOut) return { ...base, status: "warning", reason: "timeout" };
  if (frames <= 0) return { ...base, status: "broken", reason: "unreadable" };

  if (kind === "IMAGE") {
    if (run.exitCode !== 0) return { ...base, status: "broken", reason: "unreadable" };
    if (errors.length > 0) return { ...base, status: "warning", reason: "decode_errors" };
    return { ...base, status: "ok", reason: "ok", detail: null };
  }

  const shortfall = expectedSec != null && decodedSec != null ? expectedSec - decodedSec : 0;
  if (run.exitCode !== 0) {
    return {
      ...base,
      status: "broken",
      reason: shortfall > TRUNCATED_WITH_ERRORS_SEC ? "truncated" : "unreadable",
    };
  }
  if (errors.length > 0 && shortfall > TRUNCATED_WITH_ERRORS_SEC) {
    return { ...base, status: "broken", reason: "truncated" };
  }
  if (expectedSec != null && shortfall > cleanShortfallLimit(expectedSec)) {
    return { ...base, status: "warning", reason: "duration_mismatch" };
  }
  if (errors.length > 0) return { ...base, status: "warning", reason: "decode_errors" };
  return { ...base, status: "ok", reason: "ok", detail: null };
}

/** Een omgezette kopie mag alleen het origineel vervangen als ze volledig en foutloos decodeert. */
export function isValidTranscodeOutput(record: Pick<MediaCheckRecord, "status">): boolean {
  return record.status === "ok";
}

/** Hoe lang één decode mag duren: ruim boven realtime, zodat alleen een vastgelopen FFmpeg stopt. */
export function decodeTimeoutMs(kind: MediaKind, expectedSec: number | null): number {
  if (kind === "IMAGE") return 30_000;
  const sec = expectedSec != null && Number.isFinite(expectedSec) && expectedSec > 0 ? expectedSec : 300;
  return Math.min(15 * 60_000, 60_000 + Math.ceil(sec * 3) * 1000);
}

/** Bewegende WebP (VP8X met animatievlag): FFmpeg kan die niet decoderen, Chromium wel. */
export function isAnimatedWebp(head: Uint8Array): boolean {
  if (head.length < 21) return false;
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  return (
    ascii(0, 4) === "RIFF" &&
    ascii(8, 12) === "WEBP" &&
    ascii(12, 16) === "VP8X" &&
    (head[20]! & 0x02) !== 0
  );
}

/**
 * Status voor de media-check: de bewaarde decode als die bij deze bestandsversie hoort,
 * anders wat de snelle kop-controle zei. `probe_failed` blijft zichtbaar als waarschuwing.
 */
export function mediaHealthFor(input: {
  fileExists: boolean;
  currentKey: string | null;
  record: MediaCheckRecord | null;
  /** Reden van `inspectVideoForDisplay` of `MediaItem.playbackWarning`, voor video. */
  probeReason?: string | null;
  /** Er loopt een wedstrijd en de decode is uitgesteld. */
  deferred?: boolean;
}): MediaHealth {
  const empty = { detail: null, expectedSec: null, decodedSec: null };
  if (!input.fileExists) return { ...empty, status: "broken", reason: "missing_file" };
  const record = input.record && input.currentKey && input.record.key === input.currentKey ? input.record : null;
  if (record && record.status !== "ok") {
    return {
      status: record.status,
      reason: record.reason,
      detail: record.detail,
      expectedSec: record.expectedSec,
      decodedSec: record.decodedSec,
    };
  }
  if (input.probeReason === "probe_failed") {
    return { ...empty, status: "warning", reason: "probe_failed" };
  }
  if (record) {
    return {
      status: "ok",
      reason: "ok",
      detail: null,
      expectedSec: record.expectedSec,
      decodedSec: record.decodedSec,
    };
  }
  if (input.probeReason === "ffmpeg_missing") {
    return { ...empty, status: "warning", reason: "ffmpeg_missing" };
  }
  return {
    ...empty,
    status: "pending",
    reason: input.deferred ? "deferred_live_match" : "not_checked",
  };
}
