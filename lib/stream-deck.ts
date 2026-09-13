/** Stream Deck / Companion: eigen knoppen, localhost-paden en optionele F-toetsen. */

export const STREAM_DECK_HTTP_PORT = 17891;
export const STREAM_DECK_PLUGIN_UUID = "com.arenacue.studio";
export const STREAM_DECK_MAX_SLOTS = 24;

export const STREAM_DECK_SLOT_ACCELERATORS = [
  "F13",
  "F14",
  "F15",
  "F16",
  "F17",
  "F18",
  "F19",
  "F20",
  "F21",
  "F22",
  "F23",
  "F24",
] as const;

export type StreamDeckAction =
  | { id: "key"; index: number }
  | { id: "input"; index: number }
  | { id: "preview"; index: number }
  | { id: "cut" }
  | { id: "stream"; mode: "toggle" | "start" | "stop" }
  | { id: "record"; mode: "toggle" | "start" | "stop" }
  | { id: "timer"; mode: "toggle" | "start" | "pause" }
  | { id: "score"; side: "home" | "away"; delta: 1 | -1 }
  | { id: "blackout" };

export type StreamDeckKind = Exclude<StreamDeckAction["id"], "key">;

export type StreamDeckSlot = {
  id: string;
  title: string;
  action: StreamDeckAction;
};

export type StreamDeckBinding = {
  accelerator: string;
  path: string;
  action: StreamDeckAction;
};

/** F13–F24 sturen je eigen knoppen `/key/1` … `/key/12` aan. */
export const STREAM_DECK_BINDINGS: StreamDeckBinding[] = STREAM_DECK_SLOT_ACCELERATORS.map((accelerator, i) => ({
  accelerator,
  path: `/key/${i + 1}`,
  action: { id: "key" as const, index: i + 1 },
}));

export const STREAM_DECK_KINDS: { id: StreamDeckKind; labelKey: string }[] = [
  { id: "input", labelKey: "livestream.deckKindInput" },
  { id: "preview", labelKey: "livestream.deckKindPreview" },
  { id: "cut", labelKey: "livestream.deckKindCut" },
  { id: "stream", labelKey: "livestream.deckKindStream" },
  { id: "record", labelKey: "livestream.deckKindRecord" },
  { id: "timer", labelKey: "livestream.deckKindTimer" },
  { id: "score", labelKey: "livestream.deckKindScore" },
  { id: "blackout", labelKey: "livestream.deckKindBlackout" },
];

function clampSourceIndex(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(8, Math.max(1, Math.round(value)));
}

function clampSlotIndex(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(STREAM_DECK_MAX_SLOTS, Math.max(1, Math.round(value)));
}

export function actionFromKind(
  kind: StreamDeckKind,
  opts: { index?: number; side?: "home" | "away"; delta?: 1 | -1 } = {},
): StreamDeckAction {
  if (kind === "input") return { id: "input", index: clampSourceIndex(opts.index ?? 1) };
  if (kind === "preview") return { id: "preview", index: clampSourceIndex(opts.index ?? 1) };
  if (kind === "cut") return { id: "cut" };
  if (kind === "stream") return { id: "stream", mode: "toggle" };
  if (kind === "record") return { id: "record", mode: "toggle" };
  if (kind === "timer") return { id: "timer", mode: "toggle" };
  if (kind === "score") return { id: "score", side: opts.side === "away" ? "away" : "home", delta: opts.delta ?? 1 };
  return { id: "blackout" };
}

export function parseStreamDeckAction(raw: unknown): StreamDeckAction | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as { id?: unknown; index?: unknown; mode?: unknown; side?: unknown; delta?: unknown };
  if (a.id === "key") return { id: "key", index: clampSlotIndex(Number(a.index)) };
  if (a.id === "input") return { id: "input", index: clampSourceIndex(Number(a.index)) };
  if (a.id === "preview") return { id: "preview", index: clampSourceIndex(Number(a.index)) };
  if (a.id === "cut") return { id: "cut" };
  if (a.id === "stream") {
    const mode = a.mode === "start" || a.mode === "stop" ? a.mode : "toggle";
    return { id: "stream", mode };
  }
  if (a.id === "record") {
    const mode = a.mode === "start" || a.mode === "stop" ? a.mode : "toggle";
    return { id: "record", mode };
  }
  if (a.id === "timer") {
    const mode = a.mode === "start" || a.mode === "pause" ? a.mode : "toggle";
    return { id: "timer", mode };
  }
  if (a.id === "score") {
    return {
      id: "score",
      side: a.side === "away" ? "away" : "home",
      delta: a.delta === -1 ? -1 : 1,
    };
  }
  if (a.id === "blackout") return { id: "blackout" };
  return null;
}

export function createStreamDeckSlot(action: StreamDeckAction, title = ""): StreamDeckSlot {
  return {
    id: `dk${Math.random().toString(36).slice(2, 10)}`,
    title: title.trim().slice(0, 16),
    action,
  };
}

export function defaultStreamDeckSlots(): StreamDeckSlot[] {
  return [];
}

export function mergeStreamDeckSlots(raw: unknown): StreamDeckSlot[] {
  if (!Array.isArray(raw)) return defaultStreamDeckSlots();
  const out: StreamDeckSlot[] = [];
  for (const item of raw.slice(0, STREAM_DECK_MAX_SLOTS)) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; title?: unknown; action?: unknown };
    const action = parseStreamDeckAction(row.action);
    if (!action || action.id === "key") continue;
    const id =
      typeof row.id === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(row.id)
        ? row.id
        : createStreamDeckSlot(action).id;
    out.push({
      id,
      title: typeof row.title === "string" ? row.title.trim().slice(0, 16) : "",
      action,
    });
  }
  return out;
}

export function parseStreamDeckPath(pathname: string): StreamDeckAction | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  const key = /^\/key\/([1-9]|1[0-9]|2[0-4])$/.exec(p);
  if (key) return { id: "key", index: Number(key[1]) };
  const input = /^\/input\/([1-8])$/.exec(p);
  if (input) return { id: "input", index: Number(input[1]) };
  const preview = /^\/preview\/([1-8])$/.exec(p);
  if (preview) return { id: "preview", index: Number(preview[1]) };
  if (p === "/cut") return { id: "cut" };
  if (p === "/stream/toggle") return { id: "stream", mode: "toggle" };
  if (p === "/stream/start") return { id: "stream", mode: "start" };
  if (p === "/stream/stop") return { id: "stream", mode: "stop" };
  if (p === "/record/toggle") return { id: "record", mode: "toggle" };
  if (p === "/record/start") return { id: "record", mode: "start" };
  if (p === "/record/stop") return { id: "record", mode: "stop" };
  if (p === "/timer/toggle") return { id: "timer", mode: "toggle" };
  if (p === "/timer/start") return { id: "timer", mode: "start" };
  if (p === "/timer/pause") return { id: "timer", mode: "pause" };
  if (p === "/score/home/up") return { id: "score", side: "home", delta: 1 };
  if (p === "/score/home/down") return { id: "score", side: "home", delta: -1 };
  if (p === "/score/away/up") return { id: "score", side: "away", delta: 1 };
  if (p === "/score/away/down") return { id: "score", side: "away", delta: -1 };
  if (p === "/blackout") return { id: "blackout" };
  return null;
}

export function streamDeckActionLabelKey(action: StreamDeckAction): string {
  if (action.id === "key") return "livestream.deckSlot";
  if (action.id === "input") return "livestream.deckInput";
  if (action.id === "preview") return "livestream.deckPreview";
  if (action.id === "cut") return "livestream.switcherCut";
  if (action.id === "stream") return "livestream.deckStream";
  if (action.id === "record") return "livestream.deckRecord";
  if (action.id === "timer") return "livestream.deckTimer";
  if (action.id === "score") {
    return action.side === "home" ? "livestream.deckScoreHome" : "livestream.deckScoreAway";
  }
  return "livestream.deckBlackout";
}

export function streamDeckSlotShortTitle(slot: StreamDeckSlot): string {
  if (slot.title.trim()) return slot.title.trim();
  const action = slot.action;
  if (action.id === "input") return `BRON ${action.index}`;
  if (action.id === "preview") return `NEXT ${action.index}`;
  if (action.id === "cut") return "CUT";
  if (action.id === "stream") return "LIVE";
  if (action.id === "record") return "REC";
  if (action.id === "timer") return "KLOK";
  if (action.id === "score") return action.side === "away" ? "UIT +1" : "THUIS +1";
  if (action.id === "blackout") return "ZWART";
  return `KEY ${action.index}`;
}

export function streamDeckSlotLabel(
  slot: StreamDeckSlot,
  t: (key: string, opts?: Record<string, string | number>) => string,
): string {
  if (slot.title.trim()) return slot.title.trim();
  const n = slot.action.id === "input" || slot.action.id === "preview" ? slot.action.index : slot.action.id === "key" ? slot.action.index : 0;
  return t(streamDeckActionLabelKey(slot.action), { n });
}

export type StreamDeckInfo = {
  enabled: boolean;
  port: number;
  baseUrl: string;
  pluginInstalled: boolean;
  bindings: StreamDeckBinding[];
};

/** goal:prepare startte de intro (schutterkiezer + spelersvisual volgen). */
export function goalPrepareStartedVisual(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  return Boolean((result as { visual?: unknown }).visual);
}

type ScoreDeckCommand =
  | { type: "goal:prepare"; side: "home" | "away" }
  | { type: "score:adjust"; side: "home" | "away"; delta: number };

/**
 * Thuis +1: start goal-intro (spelersvisual na schutter). Uit of −1: alleen score.
 * Als de thuis-visual uit staat, telt dit als gewone +1.
 */
export async function runScoreDeckAction(
  action: Extract<StreamDeckAction, { id: "score" }>,
  runCommand: (cmd: ScoreDeckCommand) => Promise<unknown>,
): Promise<void> {
  if (action.delta === 1 && action.side === "home") {
    const ack = await runCommand({ type: "goal:prepare", side: "home" });
    const result =
      ack && typeof ack === "object" && "result" in ack
        ? (ack as { result?: unknown }).result
        : undefined;
    if (!goalPrepareStartedVisual(result)) {
      await runCommand({ type: "score:adjust", side: "home", delta: 1 });
    }
    return;
  }
  await runCommand({ type: "score:adjust", side: action.side, delta: action.delta });
}
