/**
 * Scènes voor de livestream, zoals in OBS: een scène is een lijst lagen (onderste eerst), elke laag
 * één bron met een eigen kader. Het kader staat in procenten van het programmabeeld (1920×1080),
 * het bijsnijden in procenten van de bron, zodat het niet uitmaakt hoe groot de monitor is waarop je
 * het instelt.
 *
 * Dezelfde rekensom (`layerPlacement`) bepaalt het beeld op twee plaatsen: in de streampagina met CSS
 * (camera en netwerkbron) en in de beeldpomp (website, mediabestand en LED-scherm; alleen kader en
 * bijsnijden, zie `layerColorSupported`). Een laag zonder
 * aanpassingen (`layerIsIdentity`) slaat beide over, zodat bestaande opstellingen exact hetzelfde
 * beeld geven als vóór de scènes.
 */

export type StreamLayerFit = "contain" | "cover" | "stretch";
export const STREAM_LAYER_FITS: readonly StreamLayerFit[] = ["contain", "cover", "stretch"];

/** Kader in % van het programmabeeld. Mag deels buiten beeld staan. */
export type StreamLayerRect = { x: number; y: number; w: number; h: number };

/** Bijsnijden in % van de bron, per kant. */
export type StreamLayerCrop = { top: number; right: number; bottom: number; left: number };

export type StreamSceneLayer = {
  id: string;
  /** Bron uit `LivestreamSettings.videoInputs`. */
  inputId: string;
  visible: boolean;
  rect: StreamLayerRect;
  crop: StreamLayerCrop;
  fit: StreamLayerFit;
  /** 0–100. */
  opacity: number;
  /** 0–200, 100 = ongewijzigd. */
  brightness: number;
  contrast: number;
  saturation: number;
};

export type StreamScene = {
  id: string;
  /** Leeg = de naam van de bron van de onderste laag. */
  name: string;
  layers: StreamSceneLayer[];
};

/** Wat een scène van een bron moet weten; zo blijft dit bestand los van `lib/livestream.ts`. */
export type StreamSceneInputRef = { id: string };

export const STREAM_SCENE_LIMIT = 24;
export const STREAM_SCENE_LAYER_LIMIT = 8;
export const FULL_FRAME_RECT: StreamLayerRect = { x: 0, y: 0, w: 100, h: 100 };
export const NO_CROP: StreamLayerCrop = { top: 0, right: 0, bottom: 0, left: 0 };
export const LAYER_RECT_MIN = 2;
export const LAYER_RECT_MAX = 400;
/** Samen per as nooit meer dan dit wegsnijden: er moet iets van de bron overblijven. */
export const LAYER_CROP_MAX = 95;
export const LAYER_FILTER_MAX = 200;

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Twee decimalen is ruim genoeg (0,01% van 1920 px is minder dan een pixel) en houdt de JSON klein. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function randomId(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

export function sanitizeLayerRect(raw: unknown): StreamLayerRect {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<StreamLayerRect>;
  const w = round2(clamp(num(r.w, 100), LAYER_RECT_MIN, LAYER_RECT_MAX));
  const h = round2(clamp(num(r.h, 100), LAYER_RECT_MIN, LAYER_RECT_MAX));
  // Altijd een stukje in beeld laten, anders raak je de laag kwijt op de monitor.
  const x = round2(clamp(num(r.x, 0), 1 - w, 99));
  const y = round2(clamp(num(r.y, 0), 1 - h, 99));
  return { x, y, w, h };
}

export function sanitizeLayerCrop(raw: unknown): StreamLayerCrop {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<StreamLayerCrop>;
  const side = (value: unknown) => round2(clamp(num(value, 0), 0, LAYER_CROP_MAX));
  let { top, right, bottom, left } = {
    top: side(c.top),
    right: side(c.right),
    bottom: side(c.bottom),
    left: side(c.left),
  };
  if (left + right > LAYER_CROP_MAX) {
    const k = LAYER_CROP_MAX / (left + right);
    left = round2(left * k);
    right = round2(right * k);
  }
  if (top + bottom > LAYER_CROP_MAX) {
    const k = LAYER_CROP_MAX / (top + bottom);
    top = round2(top * k);
    bottom = round2(bottom * k);
  }
  return { top, right, bottom, left };
}

export function parseLayerFit(value: unknown): StreamLayerFit {
  return STREAM_LAYER_FITS.includes(value as StreamLayerFit) ? (value as StreamLayerFit) : "contain";
}

function filterValue(value: unknown): number {
  return Math.round(clamp(num(value, 100), 0, LAYER_FILTER_MAX));
}

export function createSceneLayer(partial: Partial<StreamSceneLayer> & { inputId: string }): StreamSceneLayer {
  return {
    id: typeof partial.id === "string" && ID_RE.test(partial.id) ? partial.id : randomId("l"),
    inputId: partial.inputId,
    visible: partial.visible !== false,
    rect: sanitizeLayerRect(partial.rect ?? FULL_FRAME_RECT),
    crop: sanitizeLayerCrop(partial.crop ?? NO_CROP),
    fit: parseLayerFit(partial.fit),
    opacity: Math.round(clamp(num(partial.opacity, 100), 0, 100)),
    brightness: filterValue(partial.brightness),
    contrast: filterValue(partial.contrast),
    saturation: filterValue(partial.saturation),
  };
}

/** De laag zoals een nieuwe bron hem krijgt: volledig beeld, ingepast, zonder filters. */
export function resetSceneLayer(layer: StreamSceneLayer): StreamSceneLayer {
  return createSceneLayer({ id: layer.id, inputId: layer.inputId, visible: layer.visible });
}

/** Scène met één laag over het hele beeld: zo zag elke bron er uit vóór de scènes. */
export function sceneForInput(input: StreamSceneInputRef, id = `s-${input.id}`): StreamScene {
  return {
    id,
    name: "",
    layers: [createSceneLayer({ id: `l-${input.id}`, inputId: input.id })],
  };
}

/** Opstellingen van vóór de scènes: één scène per bron, in dezelfde volgorde. */
export function migrateScenes(inputs: StreamSceneInputRef[]): StreamScene[] {
  return inputs.slice(0, STREAM_SCENE_LIMIT).map((input) => sceneForInput(input));
}

/**
 * Leest opgeslagen scènes. Lagen naar een verwijderde bron vallen weg, een scène zonder lagen ook.
 * Een bron die in geen enkele scène zit, krijgt er een: zo blijft elke bron te kiezen.
 */
export function mergeStreamScenes(raw: unknown, inputs: StreamSceneInputRef[]): StreamScene[] {
  if (!Array.isArray(raw) || raw.length === 0) return migrateScenes(inputs);
  const inputIds = new Set(inputs.map((input) => input.id));
  const sceneIds = new Set<string>();
  const layerIds = new Set<string>();
  const out: StreamScene[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || out.length >= STREAM_SCENE_LIMIT) continue;
    const r = item as Partial<StreamScene>;
    const layers: StreamSceneLayer[] = [];
    for (const rawLayer of Array.isArray(r.layers) ? r.layers : []) {
      if (!rawLayer || typeof rawLayer !== "object" || layers.length >= STREAM_SCENE_LAYER_LIMIT) continue;
      const l = rawLayer as Partial<StreamSceneLayer>;
      if (typeof l.inputId !== "string" || !inputIds.has(l.inputId)) continue;
      const layer = createSceneLayer({ ...l, inputId: l.inputId });
      if (layerIds.has(layer.id)) layer.id = randomId("l");
      layerIds.add(layer.id);
      layers.push(layer);
    }
    if (layers.length === 0) continue;
    let id = typeof r.id === "string" && ID_RE.test(r.id) ? r.id : randomId("s");
    if (sceneIds.has(id)) id = randomId("s");
    sceneIds.add(id);
    out.push({ id, name: typeof r.name === "string" ? r.name.trim().slice(0, 40) : "", layers });
  }
  for (const input of inputs) {
    if (out.length >= STREAM_SCENE_LIMIT) break;
    if (out.some((scene) => sceneInputId(scene) === input.id)) continue;
    const scene = sceneForInput(input, sceneIds.has(`s-${input.id}`) ? randomId("s") : `s-${input.id}`);
    if (layerIds.has(scene.layers[0]!.id)) scene.layers[0]!.id = randomId("l");
    out.push(scene);
  }
  return out.length > 0 ? out : migrateScenes(inputs);
}

/**
 * De laag die bepaalt welke bron live gaat: de onderste zichtbare. In deze fase heeft een scène in
 * de bediening één bronlaag; met meer lagen (beeld-in-beeld) blijft dit de hoofdbron.
 */
export function sceneMainLayer(scene: StreamScene | null | undefined): StreamSceneLayer | null {
  if (!scene) return null;
  return scene.layers.find((layer) => layer.visible) ?? scene.layers[0] ?? null;
}

export function sceneInputId(scene: StreamScene | null | undefined): string {
  return sceneMainLayer(scene)?.inputId ?? "";
}

/**
 * Welke scènes live en klaar staan. Oudere code (Stream Deck, het Live-paneel) kiest nog een bron in
 * plaats van een scène: past de gevraagde scène niet bij die bron, dan telt de eerste scène met die
 * bron. Zo blijven beide manieren hetzelfde beeld geven.
 */
export function resolveSceneSelection(
  scenes: StreamScene[],
  opts: {
    activeSceneId: unknown;
    activeInputId: string;
    previewSceneId: unknown;
    previewInputId: string;
  },
): { activeSceneId: string; previewSceneId: string } {
  const byId = (id: unknown) => (typeof id === "string" ? scenes.find((scene) => scene.id === id) : undefined);
  const requestedActive = byId(opts.activeSceneId);
  const active =
    (requestedActive && sceneHasInput(requestedActive, opts.activeInputId) ? requestedActive : undefined) ??
    scenes.find((scene) => sceneInputId(scene) === opts.activeInputId) ??
    scenes[0];
  const requestedPreview = byId(opts.previewSceneId);
  const preview =
    (requestedPreview && sceneHasInput(requestedPreview, opts.previewInputId) ? requestedPreview : undefined) ??
    scenes.find((scene) => scene.id !== active?.id && sceneInputId(scene) === opts.previewInputId) ??
    scenes.find((scene) => sceneInputId(scene) === opts.previewInputId) ??
    scenes.find((scene) => scene.id !== active?.id);
  return { activeSceneId: active?.id ?? "", previewSceneId: preview?.id ?? "" };
}

/** Komt deze bron ergens in de scène voor (ook als beeld-in-beeld)? */
export function sceneHasInput(scene: StreamScene, inputId: string): boolean {
  return Boolean(inputId) && scene.layers.some((layer) => layer.inputId === inputId);
}

/**
 * Een scène met meer dan één laag tekent de streampagina helemaal zelf (beeld-in-beeld). Een scène
 * met één laag blijft zoals in fase 1: de bron opent zoals altijd, met hooguit een kader.
 */
export function sceneIsComposite(scene: StreamScene | null | undefined): boolean {
  return Boolean(scene && scene.layers.length > 1);
}

/**
 * Bronnen die de streampagina zelf kan tekenen. Een website en het LED-scherm hebben een eigen
 * venster en kunnen (nog) geen laag naast een andere bron zijn.
 */
export const LAYER_KINDS_IN_PAGE = ["camera", "media", "network"] as const;

export function layerKindInPage(kind: string): boolean {
  return (LAYER_KINDS_IN_PAGE as readonly string[]).includes(kind);
}

/** Waar een nieuwe laag komt: rechtsonder, een derde van het beeld, zoals beeld-in-beeld in OBS. */
export const PIP_RECT: StreamLayerRect = { x: 66, y: 62, w: 30, h: 30 };

/**
 * Kan deze bron als extra laag in de scène? Alleen soorten die de pagina tekent, en één netwerkbron
 * per scène (er draait één ontvanger).
 */
export function canAddSceneLayer(
  scene: StreamScene,
  input: { id: string; kind: string },
  kindOf: (inputId: string) => string | undefined,
): boolean {
  if (scene.layers.length >= STREAM_SCENE_LAYER_LIMIT) return false;
  if (!layerKindInPage(input.kind)) return false;
  if (!scene.layers.every((layer) => layerKindInPage(kindOf(layer.inputId) ?? ""))) return false;
  if (input.kind === "network") {
    const networks = new Set(
      scene.layers.filter((layer) => kindOf(layer.inputId) === "network").map((layer) => layer.inputId),
    );
    if (networks.size > 0 && !networks.has(input.id)) return false;
  }
  return true;
}

/** Nieuwe laag bovenop, als beeld-in-beeld. */
export function addSceneLayer(scene: StreamScene, inputId: string): { scene: StreamScene; layerId: string } {
  const layer = createSceneLayer({ inputId, rect: PIP_RECT });
  return { scene: { ...scene, layers: [...scene.layers, layer] }, layerId: layer.id };
}

/** Laag weg; de laatste laag van een scène blijft. */
export function removeSceneLayer(scene: StreamScene, layerId: string): StreamScene {
  if (scene.layers.length <= 1) return scene;
  const layers = scene.layers.filter((layer) => layer.id !== layerId);
  return layers.length === scene.layers.length ? scene : { ...scene, layers };
}

/** Zelfde als `moveElementLayer` in de scorebord-editor: +1 = een laag naar voren (hoger). */
export function moveSceneLayer(layers: StreamSceneLayer[], id: string, delta: 1 | -1): StreamSceneLayer[] {
  const from = layers.findIndex((layer) => layer.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= layers.length) return layers;
  const next = [...layers];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

export function updateSceneLayer(
  scenes: StreamScene[],
  sceneId: string,
  layerId: string,
  patch: Partial<Omit<StreamSceneLayer, "id" | "inputId">>,
): StreamScene[] {
  return scenes.map((scene) =>
    scene.id !== sceneId
      ? scene
      : {
          ...scene,
          layers: scene.layers.map((layer) =>
            layer.id === layerId ? createSceneLayer({ ...layer, ...patch, id: layer.id, inputId: layer.inputId }) : layer,
          ),
        },
  );
}

/** Kopie van een scène met nieuwe id's, bv. "Camera 1 ingezoomd" naast "Camera 1". */
export function duplicateScene(scene: StreamScene, name: string): StreamScene {
  return {
    id: randomId("s"),
    name: name.trim().slice(0, 40),
    layers: scene.layers.map((layer) => ({ ...layer, id: randomId("l"), rect: { ...layer.rect }, crop: { ...layer.crop } })),
  };
}

export function layerHasColorFilter(layer: StreamSceneLayer): boolean {
  return layer.brightness !== 100 || layer.contrast !== 100 || layer.saturation !== 100;
}

function rectIsFull(rect: StreamLayerRect): boolean {
  return rect.x === 0 && rect.y === 0 && rect.w === 100 && rect.h === 100;
}

function cropIsNone(crop: StreamLayerCrop): boolean {
  return crop.top === 0 && crop.right === 0 && crop.bottom === 0 && crop.left === 0;
}

/** Staat de bron op zijn plaats van vóór de scènes (heel beeld, niet bijgesneden, ingepast)? */
export function layerFramingIsIdentity(layer: StreamSceneLayer | null | undefined): boolean {
  if (!layer) return true;
  return layer.visible && rectIsFull(layer.rect) && cropIsNone(layer.crop) && layer.fit === "contain";
}

/** Ziet de bron er uit zoals vóór de scènes? Dan rekent niemand iets uit. */
export function layerIsIdentity(layer: StreamSceneLayer | null | undefined): boolean {
  if (!layer) return true;
  return layerFramingIsIdentity(layer) && layer.opacity === 100 && !layerHasColorFilter(layer);
}

/**
 * Kleurfilters en dekking kan alleen de streampagina (op de GPU): camera en netwerkbron. In de
 * beeldpomp kost het 11–16 ms per 1080p-beeld op de hoofddraad, te veel voor een vloeiende stream.
 */
export function layerColorSupported(kind: string, composite = false): boolean {
  // In een beeld-in-beeld-scène tekent de pagina ook mediabestanden, dus ook daar met de GPU.
  if (composite) return layerKindInPage(kind);
  return kind === "camera" || kind === "network";
}

/** CSS-filter voor de kleurinstellingen van een laag. */
export function layerCssFilter(layer: StreamSceneLayer): string | undefined {
  if (!layerHasColorFilter(layer)) return undefined;
  return `brightness(${layer.brightness / 100}) contrast(${layer.contrast / 100}) saturate(${layer.saturation / 100})`;
}

export type PixelRect = { x: number; y: number; w: number; h: number };

/**
 * Welk deel van de bron (`src`, in bronpixels) waar in het programmabeeld komt (`dst`, in
 * uitvoerpixels). Zonder afronden en zonder bijknippen aan de rand: dat doet de aanroeper.
 */
export function layerPlacementExact(
  srcW: number,
  srcH: number,
  layer: Pick<StreamSceneLayer, "rect" | "crop" | "fit">,
  outW: number,
  outH: number,
): { src: PixelRect; dst: PixelRect } {
  const sw = Math.max(1, srcW);
  const sh = Math.max(1, srcH);
  const { crop, rect } = layer;
  const cropped: PixelRect = {
    x: (sw * crop.left) / 100,
    y: (sh * crop.top) / 100,
    w: Math.max(1e-6, (sw * (100 - crop.left - crop.right)) / 100),
    h: Math.max(1e-6, (sh * (100 - crop.top - crop.bottom)) / 100),
  };
  const box: PixelRect = {
    x: (outW * rect.x) / 100,
    y: (outH * rect.y) / 100,
    w: (outW * rect.w) / 100,
    h: (outH * rect.h) / 100,
  };
  if (layer.fit === "stretch") return { src: cropped, dst: box };
  if (layer.fit === "cover") {
    const s = Math.max(box.w / cropped.w, box.h / cropped.h);
    const vw = box.w / s;
    const vh = box.h / s;
    return {
      src: { x: cropped.x + (cropped.w - vw) / 2, y: cropped.y + (cropped.h - vh) / 2, w: vw, h: vh },
      dst: box,
    };
  }
  const s = Math.min(box.w / cropped.w, box.h / cropped.h);
  const dw = cropped.w * s;
  const dh = cropped.h * s;
  return { src: cropped, dst: { x: box.x + (box.w - dw) / 2, y: box.y + (box.h - dh) / 2, w: dw, h: dh } };
}

/**
 * Zelfde plaatsing in hele pixels, bijgeknipt tot het programmabeeld; voor de beeldpomp.
 * `null` = niets van de laag in beeld.
 */
export function layerPlacement(
  srcW: number,
  srcH: number,
  layer: Pick<StreamSceneLayer, "rect" | "crop" | "fit">,
  outW: number,
  outH: number,
): { src: PixelRect; dst: PixelRect } | null {
  const { src, dst } = layerPlacementExact(srcW, srcH, layer, outW, outH);
  const kx = src.w / dst.w;
  const ky = src.h / dst.h;
  let dx0 = dst.x;
  let dy0 = dst.y;
  let dx1 = dst.x + dst.w;
  let dy1 = dst.y + dst.h;
  let sx0 = src.x;
  let sy0 = src.y;
  if (dx0 < 0) {
    sx0 -= dx0 * kx;
    dx0 = 0;
  }
  if (dy0 < 0) {
    sy0 -= dy0 * ky;
    dy0 = 0;
  }
  dx1 = Math.min(outW, dx1);
  dy1 = Math.min(outH, dy1);
  const sx1 = sx0 + (dx1 - dx0) * kx;
  const sy1 = sy0 + (dy1 - dy0) * ky;
  const d = {
    x: Math.round(dx0),
    y: Math.round(dy0),
    w: Math.round(dx1) - Math.round(dx0),
    h: Math.round(dy1) - Math.round(dy0),
  };
  if (d.w <= 0 || d.h <= 0) return null;
  const maxW = Math.max(1, Math.round(srcW));
  const maxH = Math.max(1, Math.round(srcH));
  const s = {
    x: clamp(Math.floor(sx0), 0, maxW - 1),
    y: clamp(Math.floor(sy0), 0, maxH - 1),
    w: 0,
    h: 0,
  };
  s.w = clamp(Math.ceil(sx1) - s.x, 1, maxW - s.x);
  s.h = clamp(Math.ceil(sy1) - s.y, 1, maxH - s.y);
  return { src: s, dst: d };
}

/**
 * Dezelfde plaatsing als CSS-maten. `box` is het zichtbare vak in % van het programmabeeld (met
 * `overflow: hidden`), `media` is de hele bron in % van dat vak.
 */
export function layerCssPlacement(
  srcW: number,
  srcH: number,
  layer: Pick<StreamSceneLayer, "rect" | "crop" | "fit">,
): { box: PixelRect; media: PixelRect } {
  const { src, dst } = layerPlacementExact(srcW, srcH, layer, 100, 100);
  return {
    box: dst,
    media: {
      x: (-src.x / src.w) * 100,
      y: (-src.y / src.h) * 100,
      w: (Math.max(1, srcW) / src.w) * 100,
      h: (Math.max(1, srcH) / src.h) * 100,
    },
  };
}
