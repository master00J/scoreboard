/**
 * Netwerkbron voor de livestream: een camera of feed die over het netwerk binnenkomt in plaats
 * van via een capture-kaart.
 *
 * Eén brontype dekt vier protocollen, omdat ffmpeg ze alle vier met hetzelfde pad leest:
 * RTSP (IP-camera's van Hikvision, Dahua, Axis), UDP/RTP (een multicast-feed uit VLC of een
 * zendwagen), SRT en RTMP (een zender die naar ons toe pusht).
 *
 * De beelden gaan niet als ruwe pixels naar het hoofdproces: dat is de draad die ook de API, de
 * database en de beeldpomp draait. In plaats daarvan hermuxt een tweede ffmpeg de stream naar
 * fragmented MP4, en speelt de streampagina die af in een <video>. Daarmee decodeert de renderer
 * op zijn eigen draad en blijft de pomp doen wat hij nu al doet: het venster fotograferen.
 */

export const NETWORK_SOURCE_PROTOCOLS = [
  "rtsp:",
  "rtsps:",
  "udp:",
  "rtp:",
  "srt:",
  "rtmp:",
  "rtmps:",
] as const;

export type NetworkSourceProtocol = (typeof NETWORK_SOURCE_PROTOCOLS)[number];

/**
 * `copy` laat de H.264 van de camera ongemoeid: geen hercodering, bijna geen processorbelasting.
 * `h264` hercodeert, voor een camera die H.265 of iets anders levert dat de speler niet aankan.
 * De supervisor begint met `copy` en schakelt zelf over zodra de speler de codec weigert.
 */
export type NetworkSourceCodecMode = "copy" | "h264";

/** Het codecprofiel dat `h264`-modus garandeert, zodat de speler het zonder raden aankan. */
export const NETWORK_SOURCE_H264_CODEC = 'video/mp4; codecs="avc1.640029"';

/** Wat de speler probeert bij `copy`: de camera levert bijna altijd H.264 High of Main. */
export const NETWORK_SOURCE_CODEC_CANDIDATES = [
  'video/mp4; codecs="avc1.640029"',
  'video/mp4; codecs="avc1.4D401F"',
  'video/mp4; codecs="avc1.42E01E"',
] as const;

function parseProtocol(url: string): NetworkSourceProtocol | null {
  try {
    const protocol = new URL(url).protocol;
    return (NETWORK_SOURCE_PROTOCOLS as readonly string[]).includes(protocol)
      ? (protocol as NetworkSourceProtocol)
      : null;
  } catch {
    return null;
  }
}

/**
 * Houdt alleen een adres over dat we aan ffmpeg durven geven.
 *
 * Geeft de ingetypte tekst terug en niet `URL.href`, zodat een RTSP-pad precies blijft zoals de
 * camera het verwacht. Witruimte en stuurtekens vallen af, net als een adres dat met een streepje
 * begint: dat zou ffmpeg als optie lezen in plaats van als invoer.
 */
export function sanitizeNetworkUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2000) return "";
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) return "";
  const protocol = parseProtocol(trimmed);
  if (!protocol) return "";
  try {
    if (!new URL(trimmed).hostname) return "";
  } catch {
    return "";
  }
  return trimmed;
}

export function isSafeNetworkUrl(raw: unknown): boolean {
  return sanitizeNetworkUrl(raw) !== "";
}

export function networkSourceProtocol(url: string): NetworkSourceProtocol | null {
  return parseProtocol(url);
}

/**
 * Verbergt het wachtwoord in een adres. Een RTSP-URL draagt `gebruiker:wachtwoord@` mee, en clubs
 * mailen logbestanden door.
 */
export function maskNetworkUrl(raw: string): string {
  const masked = raw.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, "$1***@");
  return masked.replace(/\b(passphrase|password|pass|token|key)=[^&\s]+/gi, "$1=***");
}

/**
 * Protocolinstellingen. RTSP over TCP, want UDP in een sporthal verliest pakketten en dat geeft
 * blokken in beeld. Een multicast-feed krijgt een ruime wachtrij: loopt die vol, dan is één beeld
 * weggooien beter dan afbreken.
 */
export function networkSourceTransportArgs(url: string): string[] {
  const protocol = parseProtocol(url);
  if (protocol === "rtsp:" || protocol === "rtsps:") {
    // Geen socket-tijdslimiet via ffmpeg: die optie heet `-stimeout` in oudere builds en
    // `-timeout` vanaf 6.x, en een onbekende optie laat ffmpeg meteen stoppen. De supervisor
    // kijkt zelf of er beeld binnenkomt (zie NETWORK_SOURCE_STALL_MS) en herstart anders.
    return ["-rtsp_transport", "tcp"];
  }
  if (protocol === "udp:" || protocol === "rtp:") {
    return ["-fifo_size", "5000000", "-overrun_nonfatal", "1"];
  }
  return [];
}

/**
 * De volledige ffmpeg-opdracht voor de netwerkbron: binnenkomende stream naar fragmented MP4 op
 * stdout, in stukken die de speler meteen kan aanvullen.
 *
 * Geen geluid: dat loopt via de bestaande audiomixer van de studio, zodat een club zijn microfoon
 * of mengpaneel houdt in plaats van het geluid van een camera aan het plafond.
 */
export function networkSourceFfmpegArgs(opts: {
  url: string;
  mode: NetworkSourceCodecMode;
  fps: number;
}): string[] {
  const url = sanitizeNetworkUrl(opts.url);
  if (!url) throw new Error("Ongeldig netwerkadres");
  const gop = Math.max(30, Math.round(opts.fps) * 2);
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-nostats",
    ...networkSourceTransportArgs(url),
    // Niet vooruit bufferen: elke seconde die ffmpeg opspaart is een seconde vertraging op het
    // scherm. Wel genoeg analyseren om de codec te vinden, anders mislukt het hermuxen.
    "-fflags",
    "nobuffer",
    "-flags",
    "low_delay",
    "-probesize",
    "1000000",
    "-analyzeduration",
    "1000000",
    "-i",
    url,
    "-an",
    ...(opts.mode === "copy"
      ? ["-c:v", "copy"]
      : [
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-tune",
          "zerolatency",
          "-profile:v",
          "high",
          "-level",
          "4.1",
          "-pix_fmt",
          "yuv420p",
          "-g",
          String(gop),
        ]),
    "-f",
    "mp4",
    // Dezelfde vlaggen als de opname naar bestand: een lege moov vooraf en een fragment per
    // keyframe, zodat de speler kan beginnen zonder het einde te kennen.
    "-movflags",
    "+frag_keyframe+empty_moov+default_base_moof",
    "pipe:1",
  ];
}

/** Een mislukking die niet aan dit adres ligt maar aan de verbinding: opnieuw proberen helpt. */
export function networkSourceErrorIsTemporary(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("connection refused") ||
    lower.includes("connection reset") ||
    lower.includes("connection timed out") ||
    lower.includes("timed out") ||
    lower.includes("network is unreachable") ||
    lower.includes("no route to host") ||
    lower.includes("end of file") ||
    lower.includes("i/o error")
  );
}

/** Een adres of inlog die niet klopt: opnieuw proberen lost dit niet op. */
export function networkSourceErrorIsFatal(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("401 unauthorized") ||
    lower.includes("unauthorized") ||
    lower.includes("404 not found") ||
    lower.includes("invalid data found") ||
    lower.includes("protocol not found") ||
    lower.includes("no such file or directory")
  );
}

/**
 * Komt er zo lang niets door de pijp, dan hangt de verbinding: afbreken en opnieuw. Dekt het geval
 * waarvoor een ffmpeg-tijdslimiet bedoeld is, zonder af te hangen van hoe die optie in deze build heet.
 */
export const NETWORK_SOURCE_STALL_MS = 10_000;

/** Wachttijd voor de volgende poging: 1, 2, 4, 8, dan 15 seconden. */
export function networkSourceRetryDelayMs(attempt: number): number {
  return Math.min(15_000, 1000 * 2 ** Math.max(0, Math.min(attempt, 4)));
}
