/**
 * `DisplayState.updatedAt` is voor de schermen een volgnummer: een stand met een oudere stempel
 * dan wat ze al tonen, gooien ze weg (`lib/store.ts`). Prisma vult de stempel met de systeemklok,
 * en die kan terugspringen (Windows-tijdsync, handmatige correctie). Zonder ingreep komt er dan
 * even lang geen score-, klok- of moduswijziging meer door.
 *
 * Elke schrijfactie op DisplayState geeft daarom zelf een stempel mee die nooit lager is dan de
 * vorige: de systeemklok als die verder staat, anders de vorige stempel plus één milliseconde.
 */
export function nextStateUpdatedAt(previous: Date | null | undefined, nowMs: number = Date.now()): Date {
  const prevMs = previous instanceof Date ? previous.getTime() : Number.NaN;
  if (Number.isFinite(prevMs) && nowMs <= prevMs) return new Date(prevMs + 1);
  return new Date(nowMs);
}
