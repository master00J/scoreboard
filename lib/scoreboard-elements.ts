/**
 * Elementen op het scorebord. Een indeling is een lijst elementen met elk een eigen plek, laag en
 * opmaak. De zeven klassieke vakken (logo's, scores, klok, shotclock, sponsors) zijn elementen met
 * een vaste id; daarnaast kan een club er vrij elementen bij zetten.
 *
 * Dit bestand importeert alleen types uit scoreboard-theme, zodat het thema deze helpers kan gebruiken.
 */
import type { FullScoreboardSlots, FullSlotId, LayoutSlot, LayoutSlotId, ScoreboardSlots } from "./scoreboard-theme";
import { SPORT_TYPES, normalizeSport, type SportType } from "./sports";

export type ElementSurface = "sponsor" | "full";
export type ElementSide = "home" | "away";

export type LayoutElementType =
  | "teamLogo"
  | "teamScore"
  | "clock"
  | "shotClock"
  | "media"
  | "teamName"
  | "teamExtras"
  | "period"
  | "timeOfDay"
  | "text"
  | "image";

/** Types die een club zelf kan toevoegen; de klassieke vakken bestaan altijd precies één keer. */
export const ADDABLE_ELEMENT_TYPES = ["teamName", "teamExtras", "period", "timeOfDay", "text", "image"] as const;
export type AddableElementType = (typeof ADDABLE_ELEMENT_TYPES)[number];

export type ElementAlign = "left" | "center" | "right";

export type LayoutElementStyle = {
  /** Tekstkleur; leeg = de kleur uit het thema. */
  color?: string;
  /** Vlakkleur achter het element. */
  background?: string;
  /** 1 = automatisch passend in het vak. */
  fontScale?: number;
  align?: ElementAlign;
  uppercase?: boolean;
};

export type LayoutElement = LayoutSlot & {
  id: string;
  type: LayoutElementType;
  side?: ElementSide;
  hidden?: boolean;
  /** Alleen `type === "text"`. */
  text?: string;
  /** Alleen `type === "image"`: pad of `/uploads/…`. */
  src?: string;
  style?: LayoutElementStyle;
};

export type LayoutElements = Record<ElementSurface, LayoutElement[]>;

export const ELEMENT_MIN_PCT = 2;
export const ELEMENT_LIMIT = 40;
export const ELEMENT_TEXT_MAX = 160;
export const FONT_SCALE_MIN = 0.4;
export const FONT_SCALE_MAX = 3;

const CLASSIC: Record<LayoutSlotId, { type: LayoutElementType; side?: ElementSide }> = {
  home: { type: "teamLogo", side: "home" },
  homeScore: { type: "teamScore", side: "home" },
  away: { type: "teamLogo", side: "away" },
  awayScore: { type: "teamScore", side: "away" },
  clock: { type: "clock" },
  shotClock: { type: "shotClock" },
  sponsor: { type: "media" },
};

/** Volgorde = laag: eerst getekend ligt onderaan. Gelijk aan de volgorde van vóór de elementen. */
const SPONSOR_ORDER: LayoutSlotId[] = ["sponsor", "home", "homeScore", "away", "awayScore", "clock", "shotClock"];
const FULL_ORDER: FullSlotId[] = ["home", "homeScore", "clock", "shotClock", "away", "awayScore"];

const SIDED_TYPES = new Set<LayoutElementType>(["teamLogo", "teamScore", "teamName", "teamExtras"]);
const TYPES = new Set<LayoutElementType>([
  "teamLogo",
  "teamScore",
  "clock",
  "shotClock",
  "media",
  ...ADDABLE_ELEMENT_TYPES,
]);

export function isClassicElementId(id: string): id is LayoutSlotId {
  return Object.prototype.hasOwnProperty.call(CLASSIC, id);
}

export function classicIdsFor(surface: ElementSurface): LayoutSlotId[] {
  return surface === "full" ? [...FULL_ORDER] : [...SPONSOR_ORDER];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Eén decimaal: op 1920 px is dat 2 px, fijn genoeg om strak uit te lijnen. */
export function roundPct(n: number): number {
  return Math.round(n * 10) / 10;
}

export function normalizeBox(raw: Partial<LayoutSlot> | null | undefined, fallback: LayoutSlot): LayoutSlot {
  const num = (value: unknown, fb: number) => (typeof value === "number" && Number.isFinite(value) ? value : fb);
  const w = roundPct(clamp(num(raw?.w, fallback.w), ELEMENT_MIN_PCT, 100));
  const h = roundPct(clamp(num(raw?.h, fallback.h), ELEMENT_MIN_PCT, 100));
  return {
    x: roundPct(clamp(num(raw?.x, fallback.x), 0, 100 - w)),
    y: roundPct(clamp(num(raw?.y, fallback.y), 0, 100 - h)),
    w,
    h,
  };
}

/** Kleuren komen in een style-attribuut terecht: alleen tekens die in een CSS-kleur horen. */
function normalizeColor(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value || value.length > 40 || !/^[#(),.%\w\s-]+$/.test(value)) return undefined;
  return value;
}

export function normalizeElementStyle(raw: unknown): LayoutElementStyle | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  const style: LayoutElementStyle = {};
  const color = normalizeColor(rec.color);
  const background = normalizeColor(rec.background);
  if (color) style.color = color;
  if (background) style.background = background;
  if (typeof rec.fontScale === "number" && Number.isFinite(rec.fontScale)) {
    const scale = Math.round(clamp(rec.fontScale, FONT_SCALE_MIN, FONT_SCALE_MAX) * 100) / 100;
    if (scale !== 1) style.fontScale = scale;
  }
  if (rec.align === "left" || rec.align === "right") style.align = rec.align;
  if (rec.uppercase === true) style.uppercase = true;
  return Object.keys(style).length > 0 ? style : undefined;
}

function normalizePath(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value || value.length > 4096 || /[\r\n]/.test(value)) return undefined;
  return value;
}

function classicElement(id: LayoutSlotId, box: LayoutSlot): LayoutElement {
  const def = CLASSIC[id];
  return { id, type: def.type, ...(def.side ? { side: def.side } : {}), ...box };
}

export function elementsFromSlots(slots: ScoreboardSlots): LayoutElement[] {
  return SPONSOR_ORDER.map((id) => classicElement(id, slots[id]));
}

export function elementsFromFullSlots(slots: FullScoreboardSlots): LayoutElement[] {
  return FULL_ORDER.map((id) => classicElement(id, slots[id]));
}

/**
 * Leest opgeslagen elementen. Ongeldige items vallen weg; een klassiek vak dat ontbreekt komt terug
 * op zijn plek uit `classicSlots`, zodat score of klok nooit stil verdwijnt door kapotte data.
 */
export function normalizeElements(
  raw: unknown,
  surface: ElementSurface,
  classicSlots: Partial<Record<LayoutSlotId, LayoutSlot>>,
): LayoutElement[] {
  const classicIds = classicIdsFor(surface);
  const derived = () => classicIds.map((id) => classicElement(id, classicSlots[id] as LayoutSlot));
  if (!Array.isArray(raw)) return derived();

  const out: LayoutElement[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, ELEMENT_LIMIT)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim().slice(0, 40) : "";
    if (!id || seen.has(id) || !/^[\w-]+$/.test(id)) continue;

    if (isClassicElementId(id)) {
      if (!classicIds.includes(id)) continue;
      const base = classicElement(id, normalizeBox(rec as Partial<LayoutSlot>, classicSlots[id] as LayoutSlot));
      const style = normalizeElementStyle(rec.style);
      out.push({ ...base, ...(rec.hidden === true ? { hidden: true } : {}), ...(style ? { style } : {}) });
      seen.add(id);
      continue;
    }

    const type = rec.type as LayoutElementType;
    if (!(ADDABLE_ELEMENT_TYPES as readonly string[]).includes(type) || !TYPES.has(type)) continue;
    const element: LayoutElement = {
      id,
      type,
      ...normalizeBox(rec as Partial<LayoutSlot>, { x: 40, y: 40, w: 20, h: 10 }),
    };
    if (SIDED_TYPES.has(type)) element.side = rec.side === "away" ? "away" : "home";
    if (rec.hidden === true) element.hidden = true;
    if (type === "text") element.text = typeof rec.text === "string" ? rec.text.slice(0, ELEMENT_TEXT_MAX) : "";
    if (type === "image") {
      const src = normalizePath(rec.src);
      if (src) element.src = src;
    }
    const style = normalizeElementStyle(rec.style);
    if (style) element.style = style;
    out.push(element);
    seen.add(id);
  }

  for (const id of classicIds) {
    if (!seen.has(id)) out.push(classicElement(id, classicSlots[id] as LayoutSlot));
  }
  return out;
}

/** Plek van de klassieke vakken, voor code en oudere versies die nog met `slots` werken. */
export function slotsFromElements<T extends Partial<Record<LayoutSlotId, LayoutSlot>>>(
  elements: LayoutElement[],
  fallback: T,
): T {
  const next: Record<string, LayoutSlot> = { ...(fallback as Record<string, LayoutSlot>) };
  for (const element of elements) {
    if (isClassicElementId(element.id) && element.id in next) {
      next[element.id] = { x: element.x, y: element.y, w: element.w, h: element.h };
    }
  }
  return next as T;
}

const NEW_ELEMENT_BOX: Record<AddableElementType, LayoutSlot> = {
  teamName: { x: 4, y: 4, w: 20, h: 8 },
  teamExtras: { x: 4, y: 50, w: 20, h: 8 },
  period: { x: 40, y: 4, w: 20, h: 8 },
  // Rechtsonder: rechtsboven staat de teamnaam van de bezoekers al.
  timeOfDay: { x: 84, y: 90, w: 14, h: 8 },
  // Onderaan: daar is op beide standaardindelingen plaats, zonder de klok of het videovak te bedekken.
  text: { x: 3, y: 87, w: 30, h: 9 },
  image: { x: 68, y: 84, w: 14, h: 14 },
};

/** Nieuw element op een standaardplek. `id` komt van de aanroeper, zodat dit zuiver blijft. */
export function createElement(type: AddableElementType, id: string, side: ElementSide = "home"): LayoutElement {
  const box = { ...NEW_ELEMENT_BOX[type] };
  if (side === "away" && SIDED_TYPES.has(type)) box.x = roundPct(100 - box.x - box.w);
  return {
    id,
    type,
    ...box,
    ...(SIDED_TYPES.has(type) ? { side } : {}),
    ...(type === "text" ? { text: "" } : {}),
  };
}

/** Kopie van een vrij element, iets verschoven. Klassieke vakken kunnen niet dubbel bestaan. */
export function duplicateElement(element: LayoutElement, id: string): LayoutElement | null {
  if (isClassicElementId(element.id)) return null;
  const box = normalizeBox({ x: element.x + 2, y: element.y + 2, w: element.w, h: element.h }, element);
  return { ...element, ...box, id, ...(element.style ? { style: { ...element.style } } : {}) };
}

/** Verschuift een element één laag: +1 = naar voren, -1 = naar achteren. */
export function moveElementLayer(elements: LayoutElement[], id: string, delta: 1 | -1): LayoutElement[] {
  const from = elements.findIndex((element) => element.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= elements.length) return elements;
  const next = [...elements];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Hoogte (in % van het canvas) waarbij een vak van `widthPct` breed 16:9 is op dit schermformaat. */
export function sixteenByNineHeightPct(widthPct: number, canvasW: number, canvasH: number): number {
  if (canvasW <= 0 || canvasH <= 0) return widthPct;
  return (widthPct * canvasW * 9) / (16 * canvasH);
}

/* ————————————————————————— indeling per situatie ————————————————————————— */

export type LayoutPhase = "prematch" | "play" | "break" | "post";
export const LAYOUT_PHASES: LayoutPhase[] = ["prematch", "play", "break", "post"];

export type LayoutRule = {
  id: string;
  /** "*" = elke sport. */
  sport: SportType | "*";
  /** "*" = elke fase. */
  phase: LayoutPhase | "*";
  /** Opgeslagen indeling uit de bibliotheek. */
  templateId: string;
};

export const LAYOUT_RULE_LIMIT = 24;

export function layoutPhaseForStatus(status: string | null | undefined): LayoutPhase {
  if (status === "SETUP" || status === "PREMATCH") return "prematch";
  if (status === "HALF_TIME") return "break";
  if (status === "FULL_TIME" || status === "POST_MATCH") return "post";
  return "play";
}

export function normalizeLayoutRules(raw: unknown): LayoutRule[] {
  if (!Array.isArray(raw)) return [];
  const out: LayoutRule[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, LAYOUT_RULE_LIMIT)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim().slice(0, 40) : "";
    const templateId = typeof rec.templateId === "string" ? rec.templateId.trim().slice(0, 80) : "";
    if (!id || seen.has(id) || !templateId) continue;
    const sport =
      rec.sport === "*" || !(SPORT_TYPES as readonly string[]).includes(String(rec.sport)) ? "*" : normalizeSport(rec.sport);
    const phase = LAYOUT_PHASES.includes(rec.phase as LayoutPhase) ? (rec.phase as LayoutPhase) : "*";
    out.push({ id, sport, phase, templateId });
    seen.add(id);
  }
  return out;
}

/** Leest de regels uit dezelfde JSON als het scorebordthema. */
export function layoutRulesFromThemeJson(raw: string | null | undefined): LayoutRule[] {
  if (!raw || typeof raw !== "string" || !raw.trim()) return [];
  try {
    return normalizeLayoutRules((JSON.parse(raw) as { layoutRules?: unknown }).layoutRules);
  } catch {
    return [];
  }
}

/**
 * De regel die nu geldt. Hoe preciezer de regel, hoe eerder ze wint: sport én fase gaat vóór
 * alleen sport, dat vóór alleen fase, dat vóór "altijd". Bij gelijke stand wint de bovenste.
 */
export function pickLayoutRule(
  rules: LayoutRule[],
  situation: { sport: unknown; status: string | null | undefined },
): LayoutRule | null {
  const sport = normalizeSport(situation.sport);
  const phase = layoutPhaseForStatus(situation.status);
  let best: LayoutRule | null = null;
  let bestScore = -1;
  for (const rule of rules) {
    if (rule.sport !== "*" && rule.sport !== sport) continue;
    if (rule.phase !== "*" && rule.phase !== phase) continue;
    const score = (rule.sport !== "*" ? 2 : 0) + (rule.phase !== "*" ? 1 : 0);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}
