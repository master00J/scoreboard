/**
 * Schermtijd die echt zichtbaar was, voor proof-of-play.
 *
 * Een sponsor betaalt voor seconden die het publiek zag. De klok start dus pas als er bewijs is
 * dat het beeld op het scherm staat: een foto die geladen en gedecodeerd is, of het eerste
 * getekende frame van een video. Kiezen, laden of een vastgelopen decoder telt niet mee.
 *
 * - Foto: muurklok zolang het beeld zichtbaar is en niet onderbroken.
 * - Video: alleen vooruitgang van de speelkop. Een speelkop die stilstaat (decoder hangt op
 *   1,21 s van een clip van 8 s) levert 1,21 s op, niet 8 s. Een sprong vooruit (seek) telt
 *   hoogstens zoveel als er intussen echt verstreken is.
 *
 * Seconden blijven onafgerond; afronden gebeurt alleen bij tonen.
 *
 * Pure logica zonder React of DOM, zodat het in Vitest getest kan worden.
 */

export type VisiblePlayKind = "IMAGE" | "VIDEO";

export type VisiblePlayClock = {
  kind: VisiblePlayKind;
  /** Moment waarop het beeld voor het eerst echt op het scherm stond, of null. */
  shownAtMs: number | null;
  /** Onderbroken (overlay, venster verborgen, pauze): er telt niets bij. */
  paused: boolean;
  /** Foto: opgetelde zichtbare ms van afgesloten stukken. Video: opgetelde vooruitgang van de speelkop. */
  accumulatedMs: number;
  /** Foto: begin van het lopende zichtbare stuk. */
  runStartedAtMs: number | null;
  /** Video: laatst geziene speelkop (s) en wanneer. */
  lastPositionSec: number | null;
  lastPositionAtMs: number | null;
  /** Hoogste speelkop die gezien is (s), los van de opgetelde tijd: voor meldingen. */
  maxPositionSec: number;
};

/** Ruimte voor het verschil tussen muurklok en speelkop (timeupdate komt ~4× per seconde). */
const VIDEO_WALL_SLACK_MS = 350;

export function createVisiblePlayClock(kind: VisiblePlayKind, paused = false): VisiblePlayClock {
  return {
    kind,
    shownAtMs: null,
    paused,
    accumulatedMs: 0,
    runStartedAtMs: null,
    lastPositionSec: null,
    lastPositionAtMs: null,
    maxPositionSec: 0,
  };
}

export function visiblePlayShown(clock: VisiblePlayClock): boolean {
  return clock.shownAtMs != null;
}

/** Bewijs dat het beeld op het scherm staat (foto gedecodeerd, eerste videoframe). */
export function markVisiblePlayShown(clock: VisiblePlayClock, nowMs: number, positionSec?: number): void {
  if (clock.shownAtMs != null) return;
  clock.shownAtMs = nowMs;
  if (clock.kind === "IMAGE") {
    clock.runStartedAtMs = clock.paused ? null : nowMs;
    return;
  }
  if (positionSec != null && Number.isFinite(positionSec)) {
    clock.lastPositionSec = Math.max(0, positionSec);
    clock.lastPositionAtMs = nowMs;
    clock.maxPositionSec = Math.max(clock.maxPositionSec, clock.lastPositionSec);
  }
}

/** Onderbreking aan of uit. Tijdens een onderbreking telt niets bij. */
export function setVisiblePlayPaused(clock: VisiblePlayClock, paused: boolean, nowMs: number): void {
  if (clock.paused === paused) return;
  clock.paused = paused;
  if (clock.kind === "IMAGE") {
    if (paused) {
      if (clock.runStartedAtMs != null) {
        clock.accumulatedMs += Math.max(0, nowMs - clock.runStartedAtMs);
        clock.runStartedAtMs = null;
      }
    } else if (clock.shownAtMs != null) {
      clock.runStartedAtMs = nowMs;
    }
    return;
  }
  // Video: na een onderbreking telt pas vooruitgang vanaf de eerstvolgende positie.
  clock.lastPositionSec = null;
  clock.lastPositionAtMs = null;
}

/**
 * Nieuwe speelkop van een video. Telt alleen vooruitgang die het publiek kon zien: het beeld
 * stond al op het scherm, er was geen onderbreking, en de sprong is niet groter dan de tijd die
 * intussen echt verstreken is (plus een kleine marge).
 */
export function observeVisiblePlayPosition(
  clock: VisiblePlayClock,
  positionSec: number,
  nowMs: number,
): void {
  if (clock.kind !== "VIDEO") return;
  if (!Number.isFinite(positionSec)) return;
  const pos = Math.max(0, positionSec);
  if (clock.shownAtMs == null || clock.paused) {
    return;
  }
  const prevPos = clock.lastPositionSec;
  const prevAt = clock.lastPositionAtMs;
  clock.lastPositionSec = pos;
  clock.lastPositionAtMs = nowMs;
  clock.maxPositionSec = Math.max(clock.maxPositionSec, pos);
  if (prevPos == null || prevAt == null) return;
  const deltaMs = (pos - prevPos) * 1000;
  // Terug (lus, seek terug) of stilstand: niets.
  if (!(deltaMs > 0)) return;
  const wallMs = Math.max(0, nowMs - prevAt);
  clock.accumulatedMs += Math.min(deltaMs, wallMs + VIDEO_WALL_SLACK_MS);
}

/** Zichtbare seconden tot nu, onafgerond. */
export function visiblePlayMs(clock: VisiblePlayClock, nowMs: number): number {
  if (clock.kind === "IMAGE") {
    const running = clock.runStartedAtMs == null ? 0 : Math.max(0, nowMs - clock.runStartedAtMs);
    return clock.accumulatedMs + running;
  }
  return clock.accumulatedMs;
}

export function visiblePlaySec(clock: VisiblePlayClock, nowMs: number): number {
  return visiblePlayMs(clock, nowMs) / 1000;
}

/**
 * Hoeveel er van een clip geboekt wordt. Niets als het beeld nooit zichtbaar was; anders de
 * zichtbare tijd, hoogstens `capSec` (beschermt tegen een kapotte containerduur).
 */
export function billableVisibleSec(clock: VisiblePlayClock, nowMs: number, capSec?: number): number {
  if (clock.shownAtMs == null) return 0;
  const sec = visiblePlaySec(clock, nowMs);
  if (capSec != null && Number.isFinite(capSec) && capSec >= 0) return Math.min(sec, capSec);
  return sec;
}

/** Afronden voor weergave: pas bij tonen, nooit bij opslaan of optellen. */
export function presentSeconds(sec: number): number {
  if (!Number.isFinite(sec) || sec <= 0) return 0;
  return Math.round(sec);
}
