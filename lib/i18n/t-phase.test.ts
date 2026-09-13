import { describe, expect, it } from "vitest";
import { ensureI18n } from "./index";
import { tMatchPeriod, tMatchStatus, tSportPeriodLabel } from "./t-phase";

describe("vertaalde periode-labels", () => {
  it("geeft in het Engels 1ST HALF i.p.v. 1E HELFT", async () => {
    const i18n = ensureI18n("en");
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    expect(tSportPeriodLabel(t, "FOOTBALL", 1)).toBe("1ST HALF");
    expect(tSportPeriodLabel(t, "FOOTBALL", 2)).toBe("2ND HALF");
    expect(tMatchStatus(t, "FIRST_HALF")).toBe("1st half");
    expect(
      tMatchPeriod(t, { sport: "FOOTBALL", status: "FIRST_HALF", currentPeriod: 1 }),
    ).toBe("1ST HALF");
  });

  it("houdt Nederlands voor de widget", async () => {
    const i18n = ensureI18n("nl");
    await i18n.changeLanguage("nl");
    const t = i18n.t.bind(i18n);
    expect(tSportPeriodLabel(t, "FOOTBALL", 1)).toBe("1E HELFT");
  });
});
