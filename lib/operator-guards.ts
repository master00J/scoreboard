/**
 * Vangnetten voor invoer in de bediening: een dubbelklik of een leeg getalveld mag de stand of het
 * stadionscherm niet ontregelen.
 */

/**
 * Laat dezelfde knop niet twee keer vlak na elkaar afgaan.
 *
 * Een dubbelklik (of een muisknop die dendert) telde een punt twee keer en zette "Verlenging"
 * meteen door naar de tweede verlenging. `accept(key)` zegt of de klik mag doorgaan; een tweede
 * klik op dezelfde `key` binnen `windowMs` niet. Andere knoppen lopen elkaar niet in de weg.
 *
 * De klok is monotoon (`performance.now`), zodat een sprong van de systeemklok geen knop blokkeert.
 */
export function createRepeatGuard(
  windowMs: number,
  now: () => number = () => performance.now(),
): (key: string) => boolean {
  const lastAccepted = new Map<string, number>();
  return (key) => {
    const at = now();
    const previous = lastAccepted.get(key);
    if (previous !== undefined && at >= previous && at - previous < windowMs) return false;
    lastAccepted.set(key, at);
    return true;
  };
}

/** Kort genoeg om twee bewuste klikken door te laten, lang genoeg voor een dubbelklik. */
export const SCORE_REPEAT_GUARD_MS = 250;

/** Na een periodewissel verandert de knop van betekenis ("Verlenging" wordt "2e verlenging"). */
export const PERIOD_REPEAT_GUARD_MS = 1000;

export const PLAYER_INTRO_MIN_INTERVAL_SEC = 1;
export const PLAYER_INTRO_MAX_INTERVAL_SEC = 30;
export const PLAYER_INTRO_DEFAULT_INTERVAL_SEC = 3;

/**
 * Seconden tussen twee spelers bij de automatische spelersintro. Een leeg veld geeft 0 en dat werd
 * een interval van 0 ms: de intro raasde door alle spelers en het paneel liep vol met commando's.
 */
export function playerIntroIntervalSec(raw: unknown): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) return PLAYER_INTRO_DEFAULT_INTERVAL_SEC;
  return Math.min(PLAYER_INTRO_MAX_INTERVAL_SEC, Math.max(PLAYER_INTRO_MIN_INTERVAL_SEC, value));
}
