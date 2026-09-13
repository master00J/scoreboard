import { describe, expect, it } from "vitest";
import {
  DEFAULT_STREAM_SCORE_WIDGET,
  mergeScoreWidgetDesigns,
  mergeStreamScoreWidget,
  sixteenByNineScaleFilter,
  widgetScoreEdge,
  widgetTeamLabel,
} from "./stream-score-widget";

describe("mergeStreamScoreWidget", () => {
  it("vult defaults", () => {
    expect(mergeStreamScoreWidget({})).toEqual(DEFAULT_STREAM_SCORE_WIDGET);
  });

  it("klampt schaal en anker", () => {
    const w = mergeStreamScoreWidget({ scale: 9, anchor: "nope" as never, bgOpacity: 2 });
    expect(w.scale).toBe(2.5);
    expect(w.anchor).toBe("top-left");
    expect(w.bgOpacity).toBe(20);
  });

  it("zet oude ankers om naar vrije positie", () => {
    const w = mergeStreamScoreWidget({ anchor: "bottom-right" });
    expect(w.xPct).toBeGreaterThan(50);
    expect(w.yPct).toBeGreaterThan(50);
  });

  it("bewaart eigen designs", () => {
    const list = mergeScoreWidgetDesigns([
      { id: "a", name: "  Goud  ", widget: { style: "banner", bgColor: "#1c1408" } },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Goud");
    expect(list[0].widget.style).toBe("banner");
    expect(list[0].widget.bgColor).toBe("#1c1408");
  });
});

describe("widget helpers", () => {
  it("legt sponsor tegenover de widget", () => {
    expect(widgetScoreEdge({ anchor: "top-left", yPct: 3 })).toBe("top");
    expect(widgetScoreEdge({ anchor: "bottom-center", yPct: 86 })).toBe("bottom");
  });

  it("korte namen voor TV-bug", () => {
    const team = { name: "Royal Antwerp FC", shortName: "RAFC" };
    expect(widgetTeamLabel(team, "short")).toBe("RAFC");
    expect(widgetTeamLabel(team, "abbr")).toBe("RAF");
    expect(widgetTeamLabel(team, "full")).toBe("Royal Antwerp FC");
  });

  it("16:9-pad is even en letterbox", () => {
    expect(sixteenByNineScaleFilter(1920, 1080)).toContain("pad=1920:1080");
    expect(sixteenByNineScaleFilter(1280, 720)).toContain("scale=1280:720");
    expect(sixteenByNineScaleFilter(1920, 1080)).toContain("flags=lanczos");
  });
});
