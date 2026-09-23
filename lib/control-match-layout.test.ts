import { describe, expect, it } from "vitest";
import { DEFAULT_MATCH_TAB_LAYOUT, nudgeColumnPair, parseMatchTabLayoutJson } from "./control-match-layout";

describe("parseMatchTabLayoutJson", () => {
  it("behoudt panelen die naar een andere kolom zijn verplaatst", () => {
    const layout = parseMatchTabLayoutJson(
      JSON.stringify({
        orderLeft: ["timer", "display"],
        orderCenter: ["sponsor-overview", "preview", "match-live"],
        orderRight: ["match-info"],
        collapsed: {},
      }),
    );

    expect(layout.orderCenter).toContain("sponsor-overview");
    expect(layout.orderLeft).not.toContain("sponsor-overview");
  });

  it("migreert de oude standaardindeling naar de gedeelde drieconsole-indeling", () => {
    const layout = parseMatchTabLayoutJson(
      JSON.stringify({
        orderLeft: [
          "timer",
          "display",
          "sponsor-hud",
          "sponsor-overview",
          "sponsor-timeline",
          "player-intro",
          "external",
        ],
        orderCenter: ["preview", "match-live", "event-log"],
        orderRight: ["match-info"],
        collapsed: {},
      }),
    );

    expect(layout).toEqual(DEFAULT_MATCH_TAB_LAYOUT);
  });

  it("leest kolombreedtes en paneelhoogtes", () => {
    const layout = parseMatchTabLayoutJson(
      JSON.stringify({
        orderLeft: ["timer"],
        orderCenter: ["preview"],
        orderRight: ["display"],
        collapsed: {},
        columnWeights: { left: 50, center: 20, right: 30 },
        panelHeights: { preview: 420, display: 80 },
      }),
    );

    expect(layout.columnWeights).toEqual({ left: 50, center: 20, right: 30 });
    expect(layout.panelHeights.preview).toBe(420);
    expect(layout.panelHeights.display).toBe(140);
  });

  it("vult ontbrekende groottes met de standaard", () => {
    const layout = parseMatchTabLayoutJson(
      JSON.stringify({
        orderLeft: ["timer"],
        orderCenter: ["preview"],
        orderRight: ["display"],
      }),
    );

    expect(layout.columnWeights).toEqual(DEFAULT_MATCH_TAB_LAYOUT.columnWeights);
    expect(layout.panelHeights).toEqual({});
  });
});

describe("nudgeColumnPair", () => {
  it("maakt de linkerkolom breder ten koste van het midden", () => {
    const next = nudgeColumnPair({ left: 34, center: 25, right: 41 }, "left", "center", 8);
    expect(next.left).toBeGreaterThan(34);
    expect(next.center).toBeLessThan(25);
    expect(next.left + next.center + next.right).toBe(100);
  });
});
