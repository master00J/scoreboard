import { hexToRgb } from "./utils";

export type StreamScoreWidgetAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type StreamScoreWidgetStyle = "broadcast" | "bar" | "minimal" | "stacked" | "split" | "banner";

export type StreamScoreWidgetShape = "rounded" | "sharp" | "pill" | "cut";

export type StreamScoreWidgetNameMode = "short" | "full" | "abbr";

export type StreamScoreWidgetSettings = {
  style: StreamScoreWidgetStyle;
  shape: StreamScoreWidgetShape;
  anchor: StreamScoreWidgetAnchor;
  xPct: number;
  yPct: number;
  scale: number;
  showLogos: boolean;
  showNames: boolean;
  showTimer: boolean;
  showPeriod: boolean;
  nameMode: StreamScoreWidgetNameMode;
  bgColor: string;
  bgOpacity: number;
  textColor: string;
  scoreColor: string;
  timerColor: string;
  accentColor: string;
  borderColor: string;
  borderWidth: number;
  useTeamColors: boolean;
  radiusPx: number;
};

export type StreamScoreWidgetDesign = {
  id: string;
  name: string;
  widget: StreamScoreWidgetSettings;
};

export const DEFAULT_STREAM_SCORE_WIDGET: StreamScoreWidgetSettings = {
  style: "broadcast",
  shape: "rounded",
  anchor: "top-left",
  xPct: 2.4,
  yPct: 3.2,
  scale: 1,
  showLogos: true,
  showNames: true,
  showTimer: true,
  showPeriod: true,
  nameMode: "short",
  bgColor: "#0b1220",
  bgOpacity: 86,
  textColor: "#f8fafc",
  scoreColor: "#ffffff",
  timerColor: "#e2e8f0",
  accentColor: "#38bdf8",
  borderColor: "#ffffff",
  borderWidth: 0,
  useTeamColors: true,
  radiusPx: 10,
};

const ANCHORS: StreamScoreWidgetAnchor[] = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

const STYLES: StreamScoreWidgetStyle[] = ["broadcast", "bar", "minimal", "stacked", "split", "banner"];
const SHAPES: StreamScoreWidgetShape[] = ["rounded", "sharp", "pill", "cut"];

function parseAnchor(value: unknown): StreamScoreWidgetAnchor {
  return ANCHORS.includes(value as StreamScoreWidgetAnchor)
    ? (value as StreamScoreWidgetAnchor)
    : DEFAULT_STREAM_SCORE_WIDGET.anchor;
}

function parseStyle(value: unknown): StreamScoreWidgetStyle {
  return STYLES.includes(value as StreamScoreWidgetStyle) ? (value as StreamScoreWidgetStyle) : "broadcast";
}

function parseShape(value: unknown): StreamScoreWidgetShape {
  return SHAPES.includes(value as StreamScoreWidgetShape) ? (value as StreamScoreWidgetShape) : "rounded";
}

function parseNameMode(value: unknown): StreamScoreWidgetNameMode {
  return value === "full" || value === "abbr" ? value : "short";
}

export function clampWidget(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function parseHex(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : fallback;
}

export function pctFromAnchor(anchor: StreamScoreWidgetAnchor): { xPct: number; yPct: number } {
  const top = 3.2;
  const bottom = 86;
  if (anchor === "top-center") return { xPct: 32, yPct: top };
  if (anchor === "top-right") return { xPct: 62, yPct: top };
  if (anchor === "bottom-left") return { xPct: 2.4, yPct: bottom };
  if (anchor === "bottom-center") return { xPct: 32, yPct: bottom };
  if (anchor === "bottom-right") return { xPct: 62, yPct: bottom };
  return { xPct: 2.4, yPct: top };
}

export function mergeStreamScoreWidget(
  raw: Partial<StreamScoreWidgetSettings> | null | undefined,
): StreamScoreWidgetSettings {
  const r = raw ?? {};
  const d = DEFAULT_STREAM_SCORE_WIDGET;
  const anchor = parseAnchor(r.anchor);
  const fromAnchor = pctFromAnchor(anchor);
  const hasFreePos = typeof r.xPct === "number" || typeof r.yPct === "number";
  return {
    style: parseStyle(r.style),
    shape: parseShape(r.shape),
    anchor,
    xPct: clampWidget(Number(r.xPct ?? (hasFreePos ? d.xPct : fromAnchor.xPct)), 0, 92),
    yPct: clampWidget(Number(r.yPct ?? (hasFreePos ? d.yPct : fromAnchor.yPct)), 0, 92),
    scale: clampWidget(Number(r.scale ?? d.scale), 0.5, 2.5),
    showLogos: typeof r.showLogos === "boolean" ? r.showLogos : d.showLogos,
    showNames: typeof r.showNames === "boolean" ? r.showNames : d.showNames,
    showTimer: typeof r.showTimer === "boolean" ? r.showTimer : d.showTimer,
    showPeriod: typeof r.showPeriod === "boolean" ? r.showPeriod : d.showPeriod,
    nameMode: parseNameMode(r.nameMode),
    bgColor: parseHex(r.bgColor, d.bgColor),
    bgOpacity: clampWidget(Math.round(Number(r.bgOpacity ?? d.bgOpacity)), 20, 100),
    textColor: parseHex(r.textColor, d.textColor),
    scoreColor: parseHex(r.scoreColor, d.scoreColor),
    timerColor: parseHex(r.timerColor, d.timerColor),
    accentColor: parseHex(r.accentColor, d.accentColor),
    borderColor: parseHex(r.borderColor, d.borderColor),
    borderWidth: clampWidget(Math.round(Number(r.borderWidth ?? d.borderWidth)), 0, 6),
    useTeamColors: typeof r.useTeamColors === "boolean" ? r.useTeamColors : d.useTeamColors,
    radiusPx: clampWidget(Math.round(Number(r.radiusPx ?? d.radiusPx)), 0, 28),
  };
}

export function mergeScoreWidgetDesigns(raw: unknown): StreamScoreWidgetDesign[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item, i) => ({
      id: typeof item.id === "string" && item.id ? item.id : `design-${i}`,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 40) : `Design ${i + 1}`,
      widget: mergeStreamScoreWidget(item.widget as Partial<StreamScoreWidgetSettings>),
    }))
    .slice(0, 24);
}

export function widgetScoreEdge(widget: Pick<StreamScoreWidgetSettings, "anchor" | "yPct">): "top" | "bottom" {
  if (typeof widget.yPct === "number") return widget.yPct < 50 ? "top" : "bottom";
  return widget.anchor.startsWith("top") ? "top" : "bottom";
}

export function streamWidgetClearancePx(widget: StreamScoreWidgetSettings): number {
  return Math.round(78 * widget.scale + 20);
}

export function widgetPanelBackground(bg: string, opacityPct: number): string {
  const { r, g, b } = hexToRgb(bg);
  return `rgba(${r},${g},${b},${clampWidget(opacityPct, 0, 100) / 100})`;
}

export function widgetShapeStyle(widget: StreamScoreWidgetSettings): {
  borderRadius: number | string;
  clipPath?: string;
} {
  if (widget.shape === "sharp") return { borderRadius: 0 };
  if (widget.shape === "pill") return { borderRadius: 999 };
  if (widget.shape === "cut") {
    return { borderRadius: 0, clipPath: "polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)" };
  }
  return { borderRadius: widget.radiusPx };
}

export function widgetTeamLabel(
  team: { name: string; shortName: string },
  mode: StreamScoreWidgetNameMode,
): string {
  if (mode === "full") return team.name;
  const short = team.shortName || team.name;
  if (mode === "abbr") return short.slice(0, 3).toUpperCase();
  return short;
}

export const BUILTIN_WIDGET_DESIGNS: { id: string; nameKey: string; patch: Partial<StreamScoreWidgetSettings> }[] = [
  { id: "broadcast", nameKey: "livestream.widgetStyleBroadcast", patch: { style: "broadcast", shape: "rounded" } },
  { id: "bar", nameKey: "livestream.widgetStyleBar", patch: { style: "bar", shape: "sharp", radiusPx: 0 } },
  { id: "minimal", nameKey: "livestream.widgetStyleMinimal", patch: { style: "minimal", shape: "pill" } },
  { id: "stacked", nameKey: "livestream.widgetStyleStacked", patch: { style: "stacked", shape: "rounded" } },
  { id: "split", nameKey: "livestream.widgetStyleSplit", patch: { style: "split", shape: "rounded" } },
  { id: "banner", nameKey: "livestream.widgetStyleBanner", patch: { style: "banner", shape: "sharp", radiusPx: 0 } },
];

/** FFmpeg: letterbox naar exact 16:9 zonder crop. */
export function sixteenByNineScaleFilter(width: number, height: number): string {
  const w = width % 2 === 0 ? width : width + 1;
  const h = height % 2 === 0 ? height : height + 1;
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;
}
