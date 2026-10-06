import type { OfficialClockValue } from "./types";

export type ClockDirection = "down" | "up";

/** Wat we op één moment over een officiële klok weten. */
export type ClockEstimate = {
  running: boolean;
  /** De stand die nu op de console staat. */
  shown: number;
  resolution: number;
  direction: ClockDirection;
  /**
   * Beste schatting van de echte stand, in seconden zoals de console telt. Na een tik rekenen we door
   * vanaf dat moment, maar nooit voorbij wat de console toont: staat er "14", dan ligt de echte stand
   * tussen 13 en 14.
   */
  value: number;
  /**
   * Hoe oud een stand hooguit is wanneer we hem zien: de tijd tussen twee berichten. Zoveel kan
   * ArenaCue ongemerkt zijn doorgelopen op het moment dat de console "stil" meldt.
   */
  feedLagSec: number;
  /** Hoe lang geleden we deze stand voor het laatst zagen. */
  ageSec: number;
};

/** Zolang blijft een stand na een tik "lopend" voordat we besluiten dat de klok stilstaat. */
const STALL_MARGIN_MS = 300;
const EPS = 0.001;
/** Grenzen voor de gemeten tijd tussen twee berichten; een console die alleen bij wijziging stuurt, telt als snel. */
const MIN_FEED_LAG_MS = 50;
const MAX_FEED_LAG_MS = 250;

/**
 * Volgt één klok van de console. Zegt het protocol of de klok loopt, dan geloven we dat; anders leiden
 * we het af: een klok die tikt, loopt, en een klok waarvan de stand blijft staan terwijl er wel
 * berichten binnenkomen, staat stil.
 */
export class ClockTracker {
  private last: { seconds: number; resolution: number; atMs: number } | null = null;
  /** Laatste tik: op dat moment was de echte stand precies wat de console toonde. */
  private tick: { seconds: number; atMs: number } | null = null;
  private flag: boolean | undefined;
  /** Laatste moment waarop de klok aantoonbaar vooruitging (tik, of de console zette hem aan). */
  private progressAtMs = 0;
  private moving = false;
  private stalled = false;
  private direction: ClockDirection = "down";
  /** Voortschrijdend gemiddelde van de tijd tussen twee berichten. */
  private periodMs = 200;

  reset(): void {
    this.last = null;
    this.tick = null;
    this.flag = undefined;
    this.moving = false;
    this.stalled = false;
  }

  /** Zegt de console zelf of deze klok loopt? */
  get reportsRunning(): boolean {
    return this.flag !== undefined;
  }

  update(sample: OfficialClockValue, atMs: number, direction: ClockDirection): void {
    const prev = this.last;
    this.direction = direction;
    if (sample.running !== this.flag) {
      if (sample.running === true) {
        this.progressAtMs = atMs;
        this.stalled = false;
      }
      this.flag = sample.running;
    }
    this.last = { seconds: sample.seconds, resolution: sample.resolution, atMs };
    if (!prev) {
      this.progressAtMs = atMs;
      return;
    }
    const gapMs = atMs - prev.atMs;
    if (gapMs > 5 && gapMs < 2000) this.periodMs = this.periodMs * 0.8 + gapMs * 0.2;

    const forward = direction === "down" ? prev.seconds - sample.seconds : sample.seconds - prev.seconds;
    if (Math.abs(forward) > 1e-6) {
      const step = Math.max(prev.resolution, sample.resolution);
      const elapsedSec = Math.max(0, atMs - prev.atMs) / 1000;
      // Vooruit, en niet meer dan er tijd verstreken is (plus anderhalve stap speling): dat is tikken.
      // Achteruit of een sprong is een reset of een correctie aan de jurytafel.
      if (forward > 0 && forward <= elapsedSec + step * 1.5 + 1e-6) {
        this.tick = { seconds: sample.seconds, atMs };
        this.moving = true;
      } else {
        this.tick = null;
        this.moving = false;
      }
      this.progressAtMs = atMs;
      this.stalled = false;
    } else if (atMs - this.progressAtMs > sample.resolution * 1000 + STALL_MARGIN_MS) {
      this.moving = false;
      this.stalled = true;
    }
  }

  /**
   * `heldStopped`: een andere klok bewijst dat deze stilstaat (de shotclock loopt niet zolang de
   * wedstrijdklok stilstaat). Alleen gebruikt als het protocol zelf niets over deze klok zegt.
   */
  estimate(nowMs: number, opts?: { heldStopped?: boolean }): ClockEstimate | null {
    if (!this.last) return null;
    const { seconds: shown, resolution } = this.last;
    // Zonder vlag van de console telt alleen het tikken: blijft de volgende tik uit, dan staat de klok
    // stil, ook als de console alleen bij een wijziging iets stuurt. Met vlag tellen we door tijdens een
    // hapering in de verbinding en stoppen we pas als de stand aantoonbaar blijft staan.
    let running =
      this.flag === undefined
        ? this.moving && nowMs - this.progressAtMs <= resolution * 1000 + STALL_MARGIN_MS
        : this.flag && !this.stalled;
    if (this.flag === undefined && opts?.heldStopped) running = false;

    let value = shown;
    if (running && this.tick) {
      const ranSec = Math.max(0, nowMs - this.tick.atMs) / 1000;
      value =
        this.direction === "down"
          ? Math.max(shown - resolution + EPS, Math.min(shown, this.tick.seconds - ranSec))
          : Math.min(shown + resolution - EPS, Math.max(shown, this.tick.seconds + ranSec));
    }
    const feedLagSec = Math.min(MAX_FEED_LAG_MS, Math.max(MIN_FEED_LAG_MS, this.periodMs)) / 1000;
    const ageSec = Math.max(0, nowMs - this.last.atMs) / 1000;
    return { running, shown, resolution, direction: this.direction, value: Math.max(0, value), feedLagSec, ageSec };
  }
}
