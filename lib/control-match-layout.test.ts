import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATCH_TAB_LAYOUT,
  moveMatchTabPanel,
  parseMatchTabLayoutJson,
} from "./control-match-layout";

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

  it("wisselt panelen binnen dezelfde kolom", () => {
    const next = moveMatchTabPanel(
      DEFAULT_MATCH_TAB_LAYOUT,
      "display",
      "left",
      "left",
      { after: "sponsor-hud" },
    );
    const left = next.orderLeft;
    expect(left.indexOf("display")).toBeGreaterThan(left.indexOf("sponsor-hud"));
    expect(left.filter((id) => id === "display")).toHaveLength(1);
  });
});
