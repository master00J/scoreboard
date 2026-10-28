/**
 * Overgangen tussen bronnen in de livestream, zoals een beeldmixer. De encoder blijft doorlopen; de
 * beeldpomp mengt het laatste beeld van de oude bron met de nieuwe (of met een kaart met het clublogo).
 * Alles werkt op ruwe BGRA-beelden van gelijke grootte.
 */

export const STREAM_TRANSITIONS = ["cut", "fade", "logo"] as const;
export type StreamTransitionKind = (typeof STREAM_TRANSITIONS)[number];

export const TRANSITION_MS_MIN = 200;
export const TRANSITION_MS_MAX = 3000;
export const DEFAULT_TRANSITION: StreamTransitionKind = "fade";
export const DEFAULT_TRANSITION_MS = 600;

export function parseStreamTransition(value: unknown): StreamTransitionKind {
  return STREAM_TRANSITIONS.includes(value as StreamTransitionKind) ? (value as StreamTransitionKind) : DEFAULT_TRANSITION;
}

export function clampTransitionMs(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_TRANSITION_MS;
  return Math.min(TRANSITION_MS_MAX, Math.max(TRANSITION_MS_MIN, n));
}

export type TransitionLayer = "from" | "card" | "to";

/** Wat er op dit moment van de overgang te zien is: `a` gemengd met `b` voor aandeel `t` (0 = alleen a). */
export type TransitionMix = { done: true } | { done: false; a: TransitionLayer; b: TransitionLayer; t: number };

/**
 * Verloop van een overgang. Fade: oude bron vloeit over in de nieuwe. Logo: oude bron vloeit over in de
 * kaart met het clublogo (40%), de kaart blijft even staan (20%), en vloeit dan over in de nieuwe bron.
 */
export function transitionMix(kind: StreamTransitionKind, elapsedMs: number, durationMs: number): TransitionMix {
  if (kind === "cut" || durationMs <= 0 || elapsedMs >= durationMs) return { done: true };
  const p = Math.max(0, elapsedMs) / durationMs;
  if (kind === "fade") return { done: false, a: "from", b: "to", t: easeInOut(p) };
  if (p < 0.4) return { done: false, a: "from", b: "card", t: easeInOut(p / 0.4) };
  if (p < 0.6) return { done: false, a: "card", b: "card", t: 1 };
  return { done: false, a: "card", b: "to", t: easeInOut((p - 0.6) / 0.4) };
}

function easeInOut(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/**
 * Mengt twee BGRA-beelden: out = a·(1−t) + b·t. Per pixel als 32-bits getal, twee kanalen tegelijk,
 * zodat een 1080p-beeld in enkele milliseconden klaar is.
 */
export function blendBgra(out: Uint8Array, a: Uint8Array, b: Uint8Array, t: number): void {
  const n = Math.min(out.length, a.length, b.length) >>> 2;
  const wb = Math.round(Math.min(1, Math.max(0, t)) * 256);
  const wa = 256 - wb;
  if (out.byteOffset % 4 || a.byteOffset % 4 || b.byteOffset % 4) {
    // Niet uitgelijnd (kleine Buffers uit Nodes pool): per byte, trager maar correct.
    for (let i = 0; i < n * 4; i++) out[i] = (a[i]! * wa + b[i]! * wb) >>> 8;
    return;
  }
  const o32 = new Uint32Array(out.buffer, out.byteOffset, n);
  const a32 = new Uint32Array(a.buffer, a.byteOffset, n);
  const b32 = new Uint32Array(b.buffer, b.byteOffset, n);
  for (let i = 0; i < n; i++) {
    const x = a32[i]!;
    const y = b32[i]!;
    const rb = (((x & 0x00ff00ff) * wa + (y & 0x00ff00ff) * wb) >>> 8) & 0x00ff00ff;
    const ga = ((((x >>> 8) & 0x00ff00ff) * wa + ((y >>> 8) & 0x00ff00ff) * wb) >>> 8) & 0x00ff00ff;
    o32[i] = (rb | (ga << 8)) >>> 0;
  }
}

/** Waar een beeld van een andere verhouding komt: zo groot mogelijk, gecentreerd, zwarte randen (zoals ffmpeg pad). */
export function letterboxRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { x: number; y: number; w: number; h: number } {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: dstW, h: dstH };
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = Math.min(dstW, Math.max(2, Math.round((srcW * scale) / 2) * 2));
  const h = Math.min(dstH, Math.max(2, Math.round((srcH * scale) / 2) * 2));
  return { x: Math.floor((dstW - w) / 2), y: Math.floor((dstH - h) / 2), w, h };
}

/** Kopieert een BGRA-beeld (w×h) in een groter BGRA-canvas op (x, y), zonder te mengen. */
export function placeBgra(
  dst: Uint8Array,
  dstW: number,
  src: Uint8Array,
  srcW: number,
  srcH: number,
  x: number,
  y: number,
): void {
  const rowBytes = srcW * 4;
  for (let row = 0; row < srcH; row++) {
    const from = row * rowBytes;
    dst.set(src.subarray(from, from + rowBytes), ((y + row) * dstW + x) * 4);
  }
}

/**
 * Zet een logo met transparantie op een ondoorzichtige achtergrond. Electron levert bitmaps met
 * voorvermenigvuldigde alfa, dus: uit = logo + achtergrond·(1 − alfa).
 */
export function drawOverBgra(
  dst: Uint8Array,
  dstW: number,
  src: Uint8Array,
  srcW: number,
  srcH: number,
  x: number,
  y: number,
): void {
  for (let row = 0; row < srcH; row++) {
    let s = row * srcW * 4;
    let d = ((y + row) * dstW + x) * 4;
    for (let col = 0; col < srcW; col++, s += 4, d += 4) {
      const alpha = src[s + 3]!;
      if (alpha === 0) continue;
      const keep = 255 - alpha;
      for (let c = 0; c < 3; c++) {
        const under = Math.floor((dst[d + c]! * keep + 127) / 255);
        dst[d + c] = Math.min(255, src[s + c]! + under);
      }
      dst[d + 3] = 255;
    }
  }
}

/** Effen BGRA-vlak in een kleur (#rrggbb); de achtergrond van de logokaart. */
export function solidBgra(width: number, height: number, hex: string): Uint8Array {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  const [r, g, b] = m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [10, 12, 16];
  const out = new Uint8Array(width * height * 4);
  const px = new Uint32Array(out.buffer);
  px.fill(((255 << 24) | (r << 16) | (g << 8) | b) >>> 0);
  return out;
}

/** Keuzes voor de duur in de studio; een eerder ingestelde waarde blijft kiesbaar. */
export function transitionDurationOptions(current: number): number[] {
  return [...new Set([300, 600, 1000, 1500, 2000, clampTransitionMs(current)])].sort((a, b) => a - b);
}

/**
 * Is dit beeld (vrijwel) zwart? Een camera die net opstart, levert eerst zwarte beeldjes; een overgang
 * daarheen zou naar zwart vloeien. Steekproef van ±2000 pixels: goedkoop genoeg voor elk beeldje.
 */
export function isNearlyBlackBgra(frame: Uint8Array, threshold = 4): boolean {
  const pixels = frame.length >>> 2;
  if (pixels === 0) return true;
  const step = Math.max(1, Math.floor(pixels / 2000));
  let sum = 0;
  let count = 0;
  for (let p = 0; p < pixels; p += step) {
    const i = p * 4;
    sum += (frame[i]! + frame[i + 1]! * 2 + frame[i + 2]!) / 4;
    count++;
  }
  return sum / count < threshold;
}

/** Zo lang wacht een overgang hooguit op een eerste niet-zwart beeld van de nieuwe bron. */
export const TRANSITION_WAIT_FOR_PICTURE_MS = 2500;
