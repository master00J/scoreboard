import { describe, expect, it } from "vitest";
import { parseMatchTabLayoutJson } from "./control-match-layout";

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
});
