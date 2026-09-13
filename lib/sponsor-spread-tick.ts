/** Eén advance per tick-key — voorkomt dubbele klok/hang-mutatie (StrictMode, herhaalde memo). */
export function applySponsorSpreadTick<T>(
  cache: { current: { key: string; value: T } | null },
  key: string,
  compute: () => T,
): T {
  if (cache.current?.key === key) return cache.current.value;
  const value = compute();
  cache.current = { key, value };
  return value;
}
