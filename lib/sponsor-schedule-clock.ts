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
};

export type SponsorScheduleClockRef = { current: SponsorScheduleClock };

export function sponsorScheduleTime(
  ref: SponsorScheduleClockRef,
  key: string,
  rawT: number,
  frozen: boolean,
  maxT: number,
): number {
  const clock = ref.current;
  if (!clock.initialized || clock.key !== key || rawT < clock.lastRawT - 1) {
    clock.key = key;
    clock.adjustedT = rawT;
    clock.lastRawT = rawT;
    clock.initialized = true;
    clock.wasFrozen = frozen;
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
