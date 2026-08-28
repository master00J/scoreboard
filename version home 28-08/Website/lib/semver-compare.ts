/** Kern semver (vóór eerste - of +). */
export function parseSemverParts(v: string): number[] {
  const core = v.split(/[-+]/)[0] ?? v;
  return core.split(".").map((p) => parseInt(p.replace(/\D/g, ""), 10) || 0);
}

/** Negatief als a ouder is dan b. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}
