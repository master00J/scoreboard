import { describe, expect, it } from "vitest";
import {
  addSceneLayer,
  canAddSceneLayer,
  createNamedScene,
  createSceneLayer,
  FULL_FRAME_RECT,
  PIP_RECT,
  removeSceneLayer,
  sceneHasInput,
  sceneIsComposite,
  duplicateScene,
  layerCssFilter,
  layerCssPlacement,
  layerColorSupported,
  layerFramingIsIdentity,
  layerIsIdentity,
  layerPlacement,
  mergeStreamScenes,
  migrateScenes,
  moveSceneLayer,
  resetSceneLayer,
  transformSceneLayer,
  resolveSceneSelection,
  sanitizeLayerCrop,
  sanitizeLayerRect,
  sceneInputId,
  updateSceneLayer,
  type StreamScene,
} from "./stream-scenes";
import {
  applySceneSelection,
  compositeNetworkUrl,
  mergeLivestreamSettings,
  programSourceKey,
  pumpProgramLayer,
  resolveActiveScene,
  takeScene,
  type LivestreamSettings,
} from "./livestream";
import { letterboxRect } from "./stream-transition";

const legacy = {
  videoInputs: [
    { id: "v1", name: "Camera 1", kind: "camera", cameraDevice: "cam-a" },
    { id: "v2", name: "IP-camera", kind: "network", networkUrl: "rtsp://10.0.0.5/stream" },
    { id: "v-led", name: "LED", kind: "display" },
  ],
  activeVideoInputId: "v2",
  previewVideoInputId: "v-led",
} as unknown as Partial<LivestreamSettings>;

describe("migration of setups from before scenes", () => {
  it("gives every video input its own full-frame scene, in the same order", () => {
    const settings = mergeLivestreamSettings(legacy);
    expect(settings.scenes.map((scene) => scene.id)).toEqual(["s-v1", "s-v2", "s-v-led"]);
    for (const scene of settings.scenes) {
      expect(scene.layers).toHaveLength(1);
      expect(layerIsIdentity(scene.layers[0])).toBe(true);
    }
    expect(settings.scenes.map(sceneInputId)).toEqual(["v1", "v2", "v-led"]);
  });

  it("keeps what was live and what was next", () => {
    const settings = mergeLivestreamSettings(legacy);
    expect(settings.activeSceneId).toBe("s-v2");
    expect(settings.previewSceneId).toBe("s-v-led");
    expect(settings.activeVideoInputId).toBe("v2");
    expect(settings.source).toBe("network");
  });

  it("leaves the picture alone: the pump has nothing to place and the source key is unchanged", () => {
    const before = mergeLivestreamSettings({ ...legacy, activeVideoInputId: "v-led" });
    expect(pumpProgramLayer(before)).toBeNull();
    const { scenes: _scenes, activeSceneId: _a, previewSceneId: _p, ...withoutScenes } = before;
    expect(programSourceKey(before)).toBe(programSourceKey(withoutScenes as LivestreamSettings));
  });

  it("survives a save and a reload unchanged", () => {
    const once = mergeLivestreamSettings(legacy);
    const twice = mergeLivestreamSettings(JSON.parse(JSON.stringify(once)));
    expect(twice.scenes).toEqual(once.scenes);
    expect(twice.activeSceneId).toBe(once.activeSceneId);
    expect(twice.previewSceneId).toBe(once.previewSceneId);
  });

  it("gives the default settings one scene per default input", () => {
    const settings = mergeLivestreamSettings(null);
    expect(settings.scenes.map(sceneInputId)).toEqual(settings.videoInputs.map((input) => input.id));
    expect(settings.activeSceneId).toBe("s-v1");
  });
});

describe("mergeStreamScenes", () => {
  const inputs = [{ id: "v1" }, { id: "v2" }];

  it("drops layers of removed inputs and scenes left without layers", () => {
    const raw = [
      { id: "s-a", name: "A", layers: [{ id: "l1", inputId: "gone" }] },
      { id: "s-b", name: "B", layers: [{ id: "l2", inputId: "v1" }, { id: "l3", inputId: "gone" }] },
    ];
    const scenes = mergeStreamScenes(raw, inputs);
    expect(scenes.map((scene) => scene.id)).toEqual(["s-b"]);
    expect(scenes[0]!.layers.map((layer) => layer.id)).toEqual(["l2"]);
  });

  it("keeps a named scene that was saved with no sources", () => {
    const scenes = mergeStreamScenes(
      [
        { id: "s-empty", name: "Pauze", layers: [] },
        { id: "s1", name: "", layers: [{ id: "l1", inputId: "v1" }] },
      ],
      inputs,
    );
    expect(scenes.map((scene) => scene.id)).toEqual(["s-empty", "s1"]);
    expect(scenes[0]!.layers).toEqual([]);
  });

  it("does not make a new scene for a source that is only used as a layer", () => {
    const scenes = mergeStreamScenes(
      [{ id: "s1", name: "", layers: [{ id: "l1", inputId: "v1" }, { id: "l2", inputId: "v2" }] }],
      inputs,
    );
    expect(scenes.map((scene) => scene.id)).toEqual(["s1"]);
    expect(scenes[0]!.layers.map((layer) => layer.inputId)).toEqual(["v1", "v2"]);
  });

  it("makes duplicate ids unique", () => {
    const raw = [
      { id: "s1", name: "", layers: [{ id: "l1", inputId: "v1" }] },
      { id: "s1", name: "", layers: [{ id: "l1", inputId: "v2" }] },
    ];
    const scenes = mergeStreamScenes(raw, inputs);
    expect(new Set(scenes.map((scene) => scene.id)).size).toBe(2);
    expect(new Set(scenes.flatMap((scene) => scene.layers.map((layer) => layer.id))).size).toBe(2);
  });

  it("clamps broken values instead of failing", () => {
    const [scene] = mergeStreamScenes(
      [
        {
          id: "s1",
          name: "x".repeat(80),
          layers: [
            {
              id: "l1",
              inputId: "v1",
              rect: { x: "a", y: -900, w: 0, h: 9000 },
              crop: { top: 80, bottom: 80, left: -5, right: "z" },
              fit: "weird",
              opacity: 400,
              brightness: -1,
            },
          ],
        },
      ],
      inputs,
    );
    const layer = scene!.layers[0]!;
    expect(scene!.name).toHaveLength(40);
    expect(layer.rect.w).toBe(2);
    expect(layer.rect.h).toBe(400);
    expect(layer.rect.x).toBe(0);
    expect(layer.rect.y).toBeGreaterThanOrEqual(1 - 400);
    expect(layer.crop.top + layer.crop.bottom).toBeLessThanOrEqual(95);
    expect(layer.crop.left).toBe(0);
    expect(layer.fit).toBe("contain");
    expect(layer.opacity).toBe(100);
    expect(layer.brightness).toBe(0);
  });
});

describe("scene selection", () => {
  const base = mergeLivestreamSettings(legacy);
  const zoom = duplicateScene(base.scenes[1]!, "IP zoom");
  const withZoom = mergeLivestreamSettings({ ...base, scenes: [...base.scenes, zoom] });

  it("follows older callers that only pick an input", () => {
    const next = mergeLivestreamSettings({ ...withZoom, activeVideoInputId: "v1" });
    expect(next.activeSceneId).toBe("s-v1");
  });

  it("keeps a second scene of the same input when that one is asked for", () => {
    const next = mergeLivestreamSettings({ ...withZoom, ...applySceneSelection(withZoom, zoom.id) });
    expect(next.activeSceneId).toBe(zoom.id);
    expect(next.activeVideoInputId).toBe("v2");
    expect(resolveActiveScene(next)?.name).toBe("IP zoom");
  });

  it("puts the next usable scene on preview after a take", () => {
    const partial = takeScene(withZoom, "s-v1", (input) => input.kind !== "display");
    expect(partial.activeSceneId).toBe("s-v1");
    expect(partial.previewSceneId).toBe("s-v2");
    expect(partial.previewVideoInputId).toBe("v2");
  });

  it("keeps an empty named scene on preview", () => {
    const scenes = mergeStreamScenes(
      [
        { id: "s1", name: "", layers: [{ id: "l1", inputId: "v1" }] },
        { id: "s-empty", name: "Pauze", layers: [] },
      ],
      [
        { id: "v1" },
        { id: "v2" },
      ],
    );
    const sel = resolveSceneSelection(scenes, {
      activeSceneId: "s1",
      activeInputId: "v1",
      previewSceneId: "s-empty",
      previewInputId: "v1",
    });
    expect(sel.activeSceneId).toBe("s1");
    expect(sel.previewSceneId).toBe("s-empty");
  });

  it("falls back to the first scene for an unknown input", () => {
    const sel = resolveSceneSelection(withZoom.scenes, {
      activeSceneId: "nope",
      activeInputId: "nope",
      previewSceneId: "",
      previewInputId: "",
    });
    expect(sel.activeSceneId).toBe("s-v1");
    expect(sel.previewSceneId).not.toBe("s-v1");
  });

  it("ignores colour for window sources, which the pump cannot filter", () => {
    const scenes = updateSceneLayer(withZoom.scenes, "s-v-led", "l-v-led", { brightness: 150 });
    const led = mergeLivestreamSettings({ ...withZoom, scenes, activeVideoInputId: "v-led", activeSceneId: "s-v-led" });
    expect(pumpProgramLayer(led)).toBeNull();
  });

  it("only hands framing to the pump for window sources that are not full frame", () => {
    const scenes = updateSceneLayer(withZoom.scenes, "s-v-led", "l-v-led", { rect: { x: 10, y: 10, w: 50, h: 50 } });
    const led = mergeLivestreamSettings({ ...withZoom, scenes, activeVideoInputId: "v-led", activeSceneId: "s-v-led" });
    expect(pumpProgramLayer(led)?.rect.w).toBe(50);
    const camScenes = updateSceneLayer(withZoom.scenes, "s-v1", "l-v1", { rect: { x: 10, y: 10, w: 50, h: 50 } });
    const cam = mergeLivestreamSettings({ ...withZoom, scenes: camScenes, activeVideoInputId: "v1", activeSceneId: "s-v1" });
    expect(pumpProgramLayer(cam)).toBeNull();
  });
});

describe("layer order", () => {
  const layers = ["a", "b", "c"].map((id) => createSceneLayer({ id, inputId: "v1" }));
  it("moves a layer up and down like the scoreboard editor", () => {
    expect(moveSceneLayer(layers, "a", 1).map((l) => l.id)).toEqual(["b", "a", "c"]);
    expect(moveSceneLayer(layers, "c", -1).map((l) => l.id)).toEqual(["a", "c", "b"]);
    expect(moveSceneLayer(layers, "c", 1)).toBe(layers);
    expect(moveSceneLayer(layers, "x", 1)).toBe(layers);
  });
});

describe("layerPlacement", () => {
  const full = createSceneLayer({ inputId: "v1" });

  it("fills the frame with a 16:9 source", () => {
    expect(layerPlacement(1920, 1080, full, 1920, 1080)).toEqual({
      src: { x: 0, y: 0, w: 1920, h: 1080 },
      dst: { x: 0, y: 0, w: 1920, h: 1080 },
    });
  });

  it("pillarboxes a 4:3 source where the old letterbox put it", () => {
    const placed = layerPlacement(1440, 1080, full, 1920, 1080)!;
    const old = letterboxRect(1440, 1080, 1920, 1080);
    expect(placed.dst).toEqual({ x: old.x, y: old.y, w: old.w, h: old.h });
  });

  it("cover fills the box and cuts the overflow from the middle", () => {
    const layer = createSceneLayer({ inputId: "v1", fit: "cover" });
    const placed = layerPlacement(1440, 1080, layer, 1920, 1080)!;
    expect(placed.dst).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(placed.src).toEqual({ x: 0, y: 135, w: 1440, h: 810 });
  });

  it("stretch maps the cropped source onto the whole box", () => {
    const layer = createSceneLayer({ inputId: "v1", fit: "stretch", crop: { top: 0, right: 50, bottom: 0, left: 0 } });
    const placed = layerPlacement(1920, 1080, layer, 1920, 1080)!;
    expect(placed.src).toEqual({ x: 0, y: 0, w: 960, h: 1080 });
    expect(placed.dst).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it("zooms in by cropping (contain keeps the aspect)", () => {
    const layer = createSceneLayer({ inputId: "v1", crop: { top: 25, right: 25, bottom: 25, left: 25 } });
    const placed = layerPlacement(1920, 1080, layer, 1920, 1080)!;
    expect(placed.src).toEqual({ x: 480, y: 270, w: 960, h: 540 });
    expect(placed.dst).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it("puts a picture-in-picture box in the corner", () => {
    const layer = createSceneLayer({ inputId: "v1", rect: { x: 70, y: 5, w: 25, h: 25 } });
    const placed = layerPlacement(1920, 1080, layer, 1920, 1080)!;
    expect(placed.dst).toEqual({ x: 1344, y: 54, w: 480, h: 270 });
  });

  it("clips a box that sticks out of the frame, and the source with it", () => {
    const layer = createSceneLayer({ inputId: "v1", rect: { x: -50, y: 0, w: 100, h: 100 } });
    const placed = layerPlacement(1920, 1080, layer, 1920, 1080)!;
    expect(placed.dst).toEqual({ x: 0, y: 0, w: 960, h: 1080 });
    expect(placed.src).toEqual({ x: 960, y: 0, w: 960, h: 1080 });
  });

  it("returns null when nothing is in frame", () => {
    const layer = { ...full, rect: { x: 120, y: 0, w: 50, h: 50 } };
    expect(layerPlacement(1920, 1080, layer, 1920, 1080)).toBeNull();
  });

  it("gives CSS sizes that match the pixel placement", () => {
    const layer = createSceneLayer({ inputId: "v1", fit: "cover", rect: { x: 10, y: 20, w: 40, h: 30 } });
    const css = layerCssPlacement(1440, 1080, layer);
    const px = layerPlacement(1440, 1080, layer, 1920, 1080)!;
    expect(css.box.x).toBeCloseTo((px.dst.x / 1920) * 100, 1);
    expect(css.box.w).toBeCloseTo((px.dst.w / 1920) * 100, 1);
    // De bron staat zo in het vak dat het zichtbare stuk precies het `src`-stuk is.
    const visibleLeft = (-css.media.x / css.media.w) * 1440;
    expect(visibleLeft).toBeCloseTo(px.src.x, 0);
    expect((100 / css.media.w) * 1440).toBeCloseTo(px.src.w, 0);
  });

  it("keeps 16:9 contain as a full 16:9 frame in CSS, not a square letterbox", () => {
    const layer = createSceneLayer({ inputId: "v1" });
    const css = layerCssPlacement(1920, 1080, layer);
    expect(css.box.x).toBeCloseTo(0, 5);
    expect(css.box.y).toBeCloseTo(0, 5);
    expect(css.box.w).toBeCloseTo(100, 5);
    expect(css.box.h).toBeCloseTo(100, 5);
  });

  it("does not jump format when a 16:9 fit-layer is a few pixels narrower", () => {
    const layer = createSceneLayer({
      inputId: "v1",
      rect: { x: 0, y: 0, w: (1274 / 1280) * 100, h: 100 },
    });
    const css = layerCssPlacement(1920, 1080, layer);
    expect(css.box.h).toBeGreaterThan(99);
    expect(css.box.w).toBeCloseTo((1274 / 1280) * 100, 1);
    expect(css.box.y).toBeLessThan(1);
  });

  it("gives CSS contain sizes that match 16:9 pixel placement", () => {
    const layer = createSceneLayer({ inputId: "v1", fit: "contain", rect: { x: 10, y: 20, w: 40, h: 50 } });
    const css = layerCssPlacement(1920, 1080, layer);
    const px = layerPlacement(1920, 1080, layer, 1920, 1080)!;
    expect(css.box.x).toBeCloseTo((px.dst.x / 1920) * 100, 1);
    expect(css.box.y).toBeCloseTo((px.dst.y / 1080) * 100, 1);
    expect(css.box.w).toBeCloseTo((px.dst.w / 1920) * 100, 1);
    expect(css.box.h).toBeCloseTo((px.dst.h / 1080) * 100, 1);
  });
});

describe("layer values", () => {
  it("is identity only when nothing changed", () => {
    const layer = createSceneLayer({ inputId: "v1" });
    expect(layerIsIdentity(layer)).toBe(true);
    expect(layerIsIdentity({ ...layer, fit: "cover" })).toBe(false);
    expect(layerIsIdentity({ ...layer, opacity: 99 })).toBe(false);
    expect(layerIsIdentity({ ...layer, saturation: 0 })).toBe(false);
    expect(layerIsIdentity({ ...layer, crop: { ...layer.crop, left: 1 } })).toBe(false);
    expect(layerIsIdentity(resetSceneLayer({ ...layer, opacity: 10, rect: { x: 5, y: 5, w: 10, h: 10 } }))).toBe(true);
  });

  it("separates framing from colour, which only the page can do", () => {
    const layer = createSceneLayer({ inputId: "v1", brightness: 150 });
    expect(layerFramingIsIdentity(layer)).toBe(true);
    expect(layerIsIdentity(layer)).toBe(false);
    expect(layerColorSupported("camera")).toBe(true);
    expect(layerColorSupported("network")).toBe(true);
    expect(layerColorSupported("display")).toBe(false);
    expect(layerColorSupported("media")).toBe(false);
  });

  it("writes the CSS filter only when a filter is set", () => {
    const layer = createSceneLayer({ inputId: "v1" });
    expect(layerCssFilter(layer)).toBeUndefined();
    expect(layerCssFilter({ ...layer, brightness: 120 })).toBe("brightness(1.2) contrast(1) saturate(1)");
  });

  it("keeps at least a sliver of the box in frame", () => {
    expect(sanitizeLayerRect({ x: 500, y: -500, w: 20, h: 20 })).toEqual({ x: 99, y: -19, w: 20, h: 20 });
  });

  it("never crops the whole source away", () => {
    const crop = sanitizeLayerCrop({ left: 90, right: 90, top: 10, bottom: 0 });
    expect(crop.left + crop.right).toBeLessThanOrEqual(95);
    expect(crop.top).toBe(10);
  });

  it("duplicates a scene with new ids", () => {
    const scene: StreamScene = migrateScenes([{ id: "v1" }])[0]!;
    const copy = duplicateScene(scene, "Zoom");
    expect(copy.id).not.toBe(scene.id);
    expect(copy.layers[0]!.id).not.toBe(scene.layers[0]!.id);
    expect(copy.layers[0]!.inputId).toBe("v1");
  });
});

describe("picture-in-picture scenes", () => {
  const settings = mergeLivestreamSettings({
    videoInputs: [
      { id: "v1", name: "Camera 1", kind: "camera", cameraDevice: "cam-a" },
      { id: "v2", name: "Camera 2", kind: "camera", cameraDevice: "cam-b" },
      { id: "v3", name: "IP", kind: "network", networkUrl: "rtsp://10.0.0.5/a" },
      { id: "v4", name: "IP 2", kind: "network", networkUrl: "rtsp://10.0.0.6/a" },
      { id: "v5", name: "Site", kind: "browser", browserUrl: "https://example.com" },
      { id: "v-led", name: "LED", kind: "display" },
    ],
    activeVideoInputId: "v1",
  } as unknown as Partial<LivestreamSettings>);
  const kindOf = (id: string) => settings.videoInputs.find((input) => input.id === id)?.kind;
  const cam1 = settings.scenes.find((scene) => scene.id === "s-v1")!;

  it("stretches, fits and fills a layer to the screen like OBS", () => {
    const layer = createSceneLayer({ inputId: "v1", rect: PIP_RECT, fit: "contain" });
    expect(transformSceneLayer(layer, "stretch")).toEqual({
      rect: FULL_FRAME_RECT,
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      fit: "stretch",
    });
    expect(transformSceneLayer(layer, "fit").fit).toBe("contain");
    expect(transformSceneLayer(layer, "fill").fit).toBe("cover");
    const centered = transformSceneLayer(layer, "center").rect!;
    expect(centered.w).toBe(PIP_RECT.w);
    expect(centered.x).toBeCloseTo((100 - PIP_RECT.w) / 2);
    expect(centered.y).toBeCloseTo((100 - PIP_RECT.h) / 2);
  });

  it("fills the frame with the first source, then stacks the next one", () => {
    const empty = createNamedScene("Pauze");
    expect(empty?.layers).toEqual([]);
    const first = addSceneLayer(empty!, "v1");
    expect(first.scene.layers[0]!.rect).toEqual(FULL_FRAME_RECT);
    const second = addSceneLayer(first.scene, "v2");
    expect(second.scene.layers[1]!.rect).toEqual(PIP_RECT);
  });

  it("adds a layer on top as a picture-in-picture box", () => {
    const { scene, layerId } = addSceneLayer(cam1, "v2");
    expect(scene.layers.map((layer) => layer.inputId)).toEqual(["v1", "v2"]);
    expect(scene.layers[1]!.id).toBe(layerId);
    expect(scene.layers[1]!.rect).toEqual(PIP_RECT);
    expect(sceneIsComposite(scene)).toBe(true);
    expect(sceneIsComposite(cam1)).toBe(false);
  });

  it("only adds sources the stream page can draw, and one network source", () => {
    const input = (id: string) => settings.videoInputs.find((item) => item.id === id)!;
    expect(canAddSceneLayer(cam1, input("v2"), kindOf)).toBe(true);
    expect(canAddSceneLayer(cam1, input("v-led"), kindOf)).toBe(true);
    expect(canAddSceneLayer(cam1, input("v5"), kindOf)).toBe(false);
    expect(canAddSceneLayer(createNamedScene("Leeg")!, input("v5"), kindOf)).toBe(true);
    const led = settings.scenes.find((scene) => scene.id === "s-v-led")!;
    expect(canAddSceneLayer(led, input("v1"), kindOf)).toBe(true);
    const withIp = addSceneLayer(cam1, "v3").scene;
    expect(canAddSceneLayer(withIp, input("v3"), kindOf)).toBe(false);
    expect(canAddSceneLayer(withIp, input("v4"), kindOf)).toBe(false);
    const site = settings.scenes.find((scene) => scene.id === "s-v5")!;
    expect(canAddSceneLayer(site, input("v1"), kindOf)).toBe(false);
  });

  it("keeps LED in the live scene key like any other source", () => {
    const pip = addSceneLayer(cam1, "v-led");
    const live = mergeLivestreamSettings({
      ...settings,
      scenes: settings.scenes.map((scene) => (scene.id === cam1.id ? pip.scene : scene)),
    });
    expect(programSourceKey(live)).toBe("scene|camera:cam-a,display:v-led");
    expect(pumpProgramLayer(live)).toBeNull();
  });

  it("can remove every source from a scene", () => {
    const { scene, layerId } = addSceneLayer(cam1, "v2");
    expect(removeSceneLayer(scene, layerId).layers.map((layer) => layer.inputId)).toEqual(["v1"]);
    expect(removeSceneLayer(cam1, cam1.layers[0]!.id).layers).toEqual([]);
  });

  it("reopens the stream only when a source joins or leaves the live scene", () => {
    const pip = addSceneLayer(cam1, "v2");
    const live = mergeLivestreamSettings({
      ...settings,
      scenes: settings.scenes.map((scene) => (scene.id === cam1.id ? pip.scene : scene)),
    });
    expect(live.activeSceneId).toBe(cam1.id);
    const key = programSourceKey(live);
    expect(key).toBe("scene|camera:cam-a,camera:cam-b");
    const moved = mergeLivestreamSettings({
      ...live,
      scenes: updateSceneLayer(live.scenes, cam1.id, pip.layerId, { rect: { x: 5, y: 5, w: 20, h: 20 } }),
    });
    expect(programSourceKey(moved)).toBe(key);
    const reordered = mergeLivestreamSettings({
      ...live,
      scenes: live.scenes.map((scene) =>
        scene.id === cam1.id ? { ...scene, layers: moveSceneLayer(scene.layers, scene.layers[0]!.id, 1) } : scene,
      ),
    });
    // De onderste laag is nu camera 2, maar de scène blijft live en hetzelfde geopend.
    expect(reordered.activeSceneId).toBe(cam1.id);
    expect(programSourceKey(reordered)).toBe(key);
    expect(pumpProgramLayer(reordered)).toBeNull();
  });

  it("finds the network address of a composite scene", () => {
    const scene = addSceneLayer(cam1, "v3").scene;
    expect(compositeNetworkUrl(scene, settings.videoInputs)).toBe("rtsp://10.0.0.5/a");
    expect(compositeNetworkUrl(cam1, settings.videoInputs)).toBe("");
    expect(sceneHasInput(scene, "v3")).toBe(true);
  });
});
