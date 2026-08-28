const KEY_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomSegment(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += KEY_CHARS[Math.floor(Math.random() * KEY_CHARS.length)]!;
  }
  return s;
}

/** Leesbare unieke sleutel voor nieuwe licenties. */
export function generateLicenseKey(): string {
  return `ARENA-${randomSegment(4)}-${randomSegment(4)}-${randomSegment(4)}`;
}
