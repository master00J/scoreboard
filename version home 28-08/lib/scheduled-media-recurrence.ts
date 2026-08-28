/** Bouwt afspeelmomenten op de wedstrijdklok, inclusief start- en eventueel eindmoment. */
export function buildRecurringCueTimes(
  startSec: number,
  endSec: number,
  intervalMinutes: number,
  maxItems = 100,
): number[] {
  const start = Math.max(0, Math.round(startSec));
  const end = Math.max(0, Math.round(endSec));
  const intervalSec = Math.round(intervalMinutes * 60);
  if (
    !Number.isFinite(startSec) ||
    !Number.isFinite(endSec) ||
    !Number.isFinite(intervalMinutes) ||
    end < start ||
    intervalSec < 30 ||
    maxItems < 1
  ) {
    return [];
  }

  const times: number[] = [];
  for (let sec = start; sec <= end && times.length < Math.floor(maxItems); sec += intervalSec) {
    times.push(sec);
  }
  return times;
}
