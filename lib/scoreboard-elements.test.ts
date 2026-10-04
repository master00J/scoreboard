import { describe, expect, it } from "vitest";
import {
  createElement,
  duplicateElement,
  elementsFromSlots,
  layoutPhaseForStatus,
  layoutRulesFromThemeJson,
  moveElementLayer,
  normalizeElements,
  normalizeLayoutRules,
  pickLayoutRule,
  sixteenByNineHeightPct,
  slotsFromElements,
} from "./scoreboard-elements";
import { DEFAULT_SLOTS, mergeScoreboardTheme, themeForFreeformEdit } from "./scoreboard-theme";
import { applyTemplateToThemeJson, extractVisualTheme } from "./scoreboard-templates";

describe("elementen uit bestaande indelingen", () => {
  it("geeft een indeling zonder elementen dezelfde zeven vakken, sponsors onderaan", () => {
    const theme = mergeScoreboardTheme(null);
    expect(theme.elements.sponsor.map((e) => e.id)).toEqual([
      "sponsor",
      "home",
      "homeScore",
      "away",
      "awayScore",
      "clock",
      "shotClock",
    ]);
    expect(theme.elements.full.map((e) => e.id)).toEqual(["home", "homeScore", "clock", "shotClock", "away", "awayScore"]);
    for (const element of theme.elements.sponsor) {
      expect({ x: element.x, y: element.y, w: element.w, h: element.h }).toEqual(theme.slots[element.id as "home"]);
    }
  });

  it("houdt hele-procentvakken van een oudere versie exact op hun plek", () => {
    const stored = { layoutMode: "custom", slots: { clock: { x: 30, y: 2, w: 26, h: 22 } } };
    const theme = mergeScoreboardTheme(JSON.stringify(stored));
    expect(theme.slots.clock).toEqual({ x: 30, y: 2, w: 26, h: 22 });
    expect(theme.elements.sponsor.find((e) => e.id === "clock")).toMatchObject({ x: 30, y: 2, w: 26, h: 22, type: "clock" });
  });

  it("laat de vakken de opgeslagen elementen volgen", () => {
    const theme = mergeScoreboardTheme(
      JSON.stringify({
        layoutMode: "custom",
        slots: { clock: { x: 1, y: 1, w: 10, h: 10 } },
        elements: { sponsor: [{ id: "clock", type: "clock", x: 40.5, y: 3.2, w: 21.4, h: 18.6 }] },
      }),
    );
    expect(theme.slots.clock).toEqual({ x: 40.5, y: 3.2, w: 21.4, h: 18.6 });
    // De andere klassieke vakken ontbraken in de lijst en komen terug op hun plek.
    expect(theme.elements.sponsor.map((e) => e.id).sort()).toEqual(
      ["away", "awayScore", "clock", "home", "homeScore", "shotClock", "sponsor"].sort(),
    );
  });
});

describe("normalizeElements", () => {
  const slots = DEFAULT_SLOTS;

  it("plaatst op één decimaal, minstens 2 % groot en binnen het canvas", () => {
    const [text] = normalizeElements(
      [{ id: "el-1", type: "text", text: "Welkom", x: 95.37, y: -4, w: 30.04, h: 0.5 }],
      "sponsor",
      slots,
    );
    expect(text).toMatchObject({ id: "el-1", type: "text", text: "Welkom", w: 30, h: 2, x: 70, y: 0 });
  });

  it("gooit kapotte items weg en dwingt type en kant van klassieke vakken af", () => {
    const out = normalizeElements(
      [
        null,
        "tekst",
        { id: "home", type: "text", side: "away", x: 5, y: 5, w: 20, h: 20 },
        { id: "el-1", type: "video", x: 1, y: 1, w: 10, h: 10 },
        { id: "bad id!", type: "text", x: 1, y: 1, w: 10, h: 10 },
        { id: "el-2", type: "teamName", side: "away", x: 1, y: 1, w: 10, h: 10 },
        { id: "el-2", type: "text", x: 2, y: 2, w: 10, h: 10 },
      ],
      "sponsor",
      slots,
    );
    expect(out.find((e) => e.id === "home")).toMatchObject({ type: "teamLogo", side: "home", x: 5 });
    expect(out.filter((e) => e.id === "el-2")).toEqual([{ id: "el-2", type: "teamName", side: "away", x: 1, y: 1, w: 10, h: 10 }]);
    expect(out.some((e) => e.id === "el-1")).toBe(false);
    expect(out).toHaveLength(8);
  });

  it("kent op het volledige scorebord geen sponsorvak", () => {
    const out = normalizeElements([{ id: "sponsor", type: "media", x: 0, y: 0, w: 50, h: 50 }], "full", slots);
    expect(out.some((e) => e.type === "media")).toBe(false);
    expect(out).toHaveLength(6);
  });

  it("laat alleen veilige opmaak door", () => {
    const [el] = normalizeElements(
      [
        {
          id: "el-1",
          type: "text",
          text: "x".repeat(500),
          x: 1,
          y: 1,
          w: 10,
          h: 10,
          hidden: true,
          style: {
            color: "#ffcc00",
            background: "red; background-image:url(http://evil.example)",
            fontScale: 9,
            align: "right",
            uppercase: true,
            position: "fixed",
          },
        },
      ],
      "sponsor",
      slots,
    );
    expect(el.text).toHaveLength(160);
    expect(el.hidden).toBe(true);
    expect(el.style).toEqual({ color: "#ffcc00", fontScale: 3, align: "right", uppercase: true });
  });

  it("begrenst het aantal elementen", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `el-${i}`, type: "text", x: 1, y: 1, w: 10, h: 10 }));
    const out = normalizeElements(many, "sponsor", slots);
    expect(out.filter((e) => e.type === "text")).toHaveLength(40);
    expect(out).toHaveLength(47);
  });
});

describe("elementen bewerken", () => {
  it("maakt nieuwe elementen op een standaardplek, de uitploeg gespiegeld", () => {
    const home = createElement("teamName", "el-a", "home");
    const away = createElement("teamName", "el-b", "away");
    expect(home.side).toBe("home");
    expect(away.x).toBeCloseTo(100 - home.x - home.w, 5);
    expect(createElement("text", "el-c").text).toBe("");
    expect(createElement("period", "el-d").side).toBeUndefined();
  });

  it("dupliceert alleen vrije elementen", () => {
    const text = { ...createElement("text", "el-a"), text: "Hallo", style: { color: "#fff" } };
    const copy = duplicateElement(text, "el-b");
    expect(copy).toMatchObject({ id: "el-b", text: "Hallo", x: text.x + 2, y: text.y + 2 });
    expect(copy?.style).not.toBe(text.style);
    expect(duplicateElement(elementsFromSlots(DEFAULT_SLOTS)[0], "el-c")).toBeNull();
  });

  it("verschuift een laag naar voren en naar achteren, niet voorbij de rand", () => {
    const list = elementsFromSlots(DEFAULT_SLOTS);
    const forward = moveElementLayer(list, "sponsor", 1);
    expect(forward.map((e) => e.id).slice(0, 2)).toEqual(["home", "sponsor"]);
    expect(moveElementLayer(list, "sponsor", -1)).toBe(list);
    expect(moveElementLayer(list, "bestaat-niet", 1)).toBe(list);
  });

  it("zet de vakken terug uit de elementen", () => {
    const list = elementsFromSlots(DEFAULT_SLOTS).map((e) => (e.id === "clock" ? { ...e, x: 12.5 } : e));
    expect(slotsFromElements(list, DEFAULT_SLOTS).clock.x).toBe(12.5);
    expect(slotsFromElements(list, DEFAULT_SLOTS).home).toEqual(DEFAULT_SLOTS.home);
  });

  it("rekent 16:9 uit voor het echte schermformaat", () => {
    expect(sixteenByNineHeightPct(50, 1920, 1080)).toBeCloseTo(50, 5);
    // Brede strip 1920×360: een vak van 20 % breed is 384 px, dus 216 px hoog = 60 % van 360.
    expect(sixteenByNineHeightPct(20, 1920, 360)).toBeCloseTo(60, 5);
    expect(sixteenByNineHeightPct(50, 1024, 1024)).toBeCloseTo(28.125, 5);
  });
});

describe("vrij bewerken en de bibliotheek", () => {
  it("begint bij een oud frame met de klassieke vakken van dat frame", () => {
    const theme = mergeScoreboardTheme(JSON.stringify({ layoutMode: "left-l", leftBarWidthPx: 320 }));
    const edit = themeForFreeformEdit(theme);
    expect(edit.layoutMode).toBe("left-l");
    expect(edit.elements.sponsor.map((e) => e.id)).toHaveLength(7);
    for (const element of edit.elements.sponsor) {
      expect({ x: element.x, y: element.y, w: element.w, h: element.h }).toEqual(edit.slots[element.id as "home"]);
    }
  });

  it("neemt elementen mee in een opgeslagen indeling en laat ze niet lekken bij een andere", () => {
    const withText = JSON.stringify({
      layoutMode: "custom",
      layoutRules: [{ id: "r1", sport: "BASKETBALL", phase: "*", templateId: "tpl-1" }],
      elements: { sponsor: [{ id: "el-1", type: "text", text: "Welkom", x: 1, y: 1, w: 20, h: 10 }] },
    });
    expect(extractVisualTheme(withText).elements?.sponsor).toHaveLength(1);
    expect(extractVisualTheme(withText)).not.toHaveProperty("layoutRules");

    const plainTemplate = JSON.stringify({ layoutMode: "custom", slots: { clock: { x: 10, y: 10, w: 20, h: 20 } } });
    const applied = JSON.parse(applyTemplateToThemeJson(withText, plainTemplate));
    expect(applied.elements).toBeUndefined();
    expect(applied.layoutRules).toHaveLength(1);
    expect(mergeScoreboardTheme(JSON.stringify(applied)).elements.sponsor.some((e) => e.type === "text")).toBe(false);
  });
});

describe("indeling per situatie", () => {
  it("leidt de fase af uit de wedstrijdstatus", () => {
    expect(layoutPhaseForStatus("SETUP")).toBe("prematch");
    expect(layoutPhaseForStatus("PREMATCH")).toBe("prematch");
    expect(layoutPhaseForStatus("FIRST_HALF")).toBe("play");
    expect(layoutPhaseForStatus("EXTRA_TIME")).toBe("play");
    expect(layoutPhaseForStatus("HALF_TIME")).toBe("break");
    expect(layoutPhaseForStatus("FULL_TIME")).toBe("post");
    expect(layoutPhaseForStatus("POST_MATCH")).toBe("post");
    expect(layoutPhaseForStatus(undefined)).toBe("play");
  });

  it("kiest de meest precieze regel", () => {
    const rules = normalizeLayoutRules([
      { id: "any", sport: "*", phase: "*", templateId: "t-any" },
      { id: "break", sport: "*", phase: "break", templateId: "t-break" },
      { id: "basket", sport: "BASKETBALL", phase: "*", templateId: "t-basket" },
      { id: "basket-break", sport: "BASKETBALL", phase: "break", templateId: "t-basket-break" },
    ]);
    const pick = (sport: string, status: string) => pickLayoutRule(rules, { sport, status })?.templateId;
    expect(pick("FOOTBALL", "FIRST_HALF")).toBe("t-any");
    expect(pick("FOOTBALL", "HALF_TIME")).toBe("t-break");
    expect(pick("BASKETBALL", "FIRST_HALF")).toBe("t-basket");
    expect(pick("BASKETBALL", "HALF_TIME")).toBe("t-basket-break");
    expect(pickLayoutRule([], { sport: "FOOTBALL", status: "FIRST_HALF" })).toBeNull();
    expect(pickLayoutRule(normalizeLayoutRules([rules[2]]), { sport: "VOLLEYBALL", status: "FIRST_HALF" })).toBeNull();
  });

  it("leest alleen geldige regels uit het thema", () => {
    const raw = JSON.stringify({
      layoutRules: [
        { id: "a", sport: "BASKETBALL", phase: "play", templateId: "t1" },
        { id: "a", sport: "FOOTBALL", phase: "play", templateId: "t2" },
        { id: "b", sport: "CURLING", phase: "lunch", templateId: "t3" },
        { id: "c", sport: "FOOTBALL", phase: "post" },
        "kapot",
      ],
    });
    expect(layoutRulesFromThemeJson(raw)).toEqual([
      { id: "a", sport: "BASKETBALL", phase: "play", templateId: "t1" },
      { id: "b", sport: "*", phase: "*", templateId: "t3" },
    ]);
    expect(layoutRulesFromThemeJson("geen json")).toEqual([]);
    expect(layoutRulesFromThemeJson(null)).toEqual([]);
  });
});
