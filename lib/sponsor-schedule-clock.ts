/**
 * Gedeelde sponsor-slotklok (adjustedT + freeze/wrap) voor display en Sponsor-HUD.
 * Zelfde semantiek als voorheen inline in `app/display/page.tsx`.
 */

export type SponsorScheduleClock = {
  key: string;
  adjustedT: number;
  lastRawT: number;
  initialized: boolean;
  wasFrozen: boolean;
  /**
   * True na de laatste `sponsorScheduleTime`-aanroep als de klok hard gereset werd
   * (eerste init, andere key, of Set time / preset-sprong).
   * Callers wissen dan de hang-ref zodat pauze/reset geen stale sponsor vasthoudt.
   */
  hardReset: boolean;
};

export type SponsorScheduleClockRef = { current: SponsorScheduleClock };

export function createSponsorScheduleClock(): SponsorScheduleClock {
  return {
    key: "",
    adjustedT: 0,
    lastRawT: 0,
    initialized: false,
    wasFrozen: false,
    hardReset: false,
  };
}

/** Terugspringen groter dan dit ⇒ hard reset (Set time terug / preset). */
export const SPONSOR_SCHEDULE_BACK_JUMP_SEC = 1;

/**
 * Vooruitspringen groter dan dit (terwijl niet frozen) ⇒ hard reset.
 * Groter dan typische UI-lag, kleiner dan manuele Set time / grote presets.
 */
export const SPONSOR_SCHEDULE_FORWARD_JUMP_SEC = 15;

export function sponsorScheduleTime(
  ref: SponsorScheduleClockRef,
  key: string,
  rawT: number,
  frozen: boolean,
  maxT: number,
): number {
  const clock = ref.current;
  clock.hardReset = false;

  const backJump =
    clock.initialized && rawT < clock.lastRawT - SPONSOR_SCHEDULE_BACK_JUMP_SEC;
  const forwardJump =
    clock.initialized &&
    !frozen &&
    rawT > clock.lastRawT + SPONSOR_SCHEDULE_FORWARD_JUMP_SEC;

  if (!clock.initialized || clock.key !== key || backJump || forwardJump) {
    clock.key = key;
    clock.adjustedT = rawT;
    clock.lastRawT = rawT;
    clock.initialized = true;
    clock.wasFrozen = frozen;
    clock.hardReset = true;
    return Math.min(Math.max(0, clock.adjustedT), maxT);
  }

  if (frozen) {
    clock.lastRawT = rawT;
    clock.wasFrozen = true;
    return Math.min(Math.max(0, clock.adjustedT), maxT);
  }

  if (clock.wasFrozen) {
    clock.lastRawT = rawT;
    clock.wasFrozen = false;
    return Math.min(Math.max(0, clock.adjustedT), maxT);
  }

  const delta = Math.max(0, rawT - clock.lastRawT);
  clock.adjustedT = Math.min(maxT, clock.adjustedT + delta);
  clock.lastRawT = rawT;
  return Math.min(Math.max(0, clock.adjustedT), maxT);
}
