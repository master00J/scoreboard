import { describe, expect, it } from "vitest";
import { DEFAULT_MATCH_TAB_LAYOUT, parseMatchTabLayoutJson } from "./control-match-layout";

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
});
