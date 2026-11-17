import { describe, expect, it } from "vitest";
import type { Sponsor } from "./types";
import {
  applyPlanImport,
  buildPlanImport,
  formatMinutes,
  guessColumnKinds,
  looksLikeHeader,
  normalizeName,
  parseClipboardTable,
  parseMinutes,
  planRowChanged,
  planRowFromSponsor,
  planTotals,
  sponsorPatchFromPlanRow,
  suggestSponsorForFile,
  type PlanRow,
} from "./season-plan";

function sponsor(partial: Partial<Sponsor> & { id: string; name: string }): Sponsor {
  return {
    active: true,
    prematchSeconds: 0,
    matchSeconds: 0,
    matchFirstHalfSeconds: 0,
    matchSecondHalfSeconds: 0,
    halftimeSeconds: 0,
    postmatchSeconds: 0,
    imageDefaultSec: 10,
    createdAt: "2026-08-01T00:00:00.000Z",
    media: [],
    ...partial,
  };
}

/** Zoals een club het in Google Sheets bijhoudt: kopregel, sectiekoppen, LED-kolommen die niet voor het scherm zijn, totalen. */
const CLUB_SHEET = [
  ["LED BOARDING", "NEW", "LED VELD (tijdens match)", "GROOT LED-scherm (binnen de 90 mins)", "Groot LED-scherm (buiten 90 mins)", "EXTRA INFORMATIE"],
  ["PARTNERS", "", "aantal minuten (90')", "aantal minuten (90')", "", ""],
  ["MAIN PARTNER - ALPHA", "x", "8", "6", "", "50% app, 50% stay informed"],
  ["Beta Drinks", "", "3", "2,0", "3.0", "3 minuten tijdens de rust in loop"],
  ["Gamma", "", "1", "", "", ""],
  ["Delta Sport", "", "5", "6", "", "\"6 x 30 sec\tof 12 x 15 sec\""],
  ["SUBTOTAAL", "", "87", "59", "10", ""],
  ["Café Épsilon", "", "", "", "9", "3 voor, 3 rust, 3 na"],
  ["TOTAAL", "", "90", "92", "59", ""],
];

function toClipboard(rows: string[][]): string {
  return rows.map((r) => r.join("\t")).join("\r\n") + "\r\n";
}

describe("parseMinutes / formatMinutes", () => {
  it("leest minuten met komma of punt als seconden", () => {
    expect(parseMinutes("3")).toBe(180);
    expect(parseMinutes("1,5")).toBe(90);
    expect(parseMinutes(" 2.0 ")).toBe(120);
    expect(parseMinutes("")).toBeNull();
    expect(parseMinutes("x")).toBeNull();
    expect(parseMinutes("-1")).toBeNull();
  });

  it("toont seconden als minuten met het decimaalteken van de taal", () => {
    expect(formatMinutes(90)).toBe("1,5");
    expect(formatMinutes(90, ".")).toBe("1.5");
    expect(formatMinutes(180)).toBe("3");
    expect(formatMinutes(0)).toBe("");
  });
});

describe("parseClipboardTable", () => {
  it("leest tabs, CRLF en cellen tussen aanhalingstekens met een tab erin", () => {
    const rows = parseClipboardTable(toClipboard(CLUB_SHEET));
    expect(rows).toHaveLength(CLUB_SHEET.length);
    expect(rows[5][5]).toBe("6 x 30 sec\tof 12 x 15 sec");
    expect(rows.every((r) => r.length === 6)).toBe(true);
  });

  it("leest een cel met een nieuwe regel en dubbele aanhalingstekens", () => {
    const rows = parseClipboardTable('Naam\tInfo\nA\t"regel 1\nregel ""2"""\n');
    expect(rows).toEqual([
      ["Naam", "Info"],
      ["A", 'regel 1\nregel "2"'],
    ]);
  });

  it("laat lege rijen weg", () => {
    expect(parseClipboardTable("A\t1\n\t\n\nB\t2")).toEqual([
      ["A", "1"],
      ["B", "2"],
    ]);
  });
});

describe("kolommen herkennen", () => {
  it("herkent een kopregel en raadt naam, binnen/buiten 90 en notitie", () => {
    const rows = parseClipboardTable(toClipboard(CLUB_SHEET));
    expect(looksLikeHeader(rows)).toBe(true);
    expect(guessColumnKinds(rows[0], 6)).toEqual(["name", "ignore", "ignore", "inside90", "outside90", "notes"]);
  });

  it("herkent fases in een eigen sjabloon", () => {
    expect(
      guessColumnKinds(["Sponsor", "Voor de wedstrijd", "1e helft", "Rust", "2e helft", "Na de match", "Opmerking"], 7),
    ).toEqual(["name", "prematch", "firstHalf", "halftime", "secondHalf", "postmatch", "notes"]);
  });

  it("zonder kopregel is de eerste kolom de naam", () => {
    const rows = [
      ["Alpha", "3"],
      ["Beta", "2"],
    ];
    expect(looksLikeHeader(rows)).toBe(false);
    expect(guessColumnKinds(null, 2)).toEqual(["name", "ignore"]);
  });
});

describe("buildPlanImport", () => {
  const rows = parseClipboardTable(toClipboard(CLUB_SHEET)).slice(1);
  const kinds = guessColumnKinds(parseClipboardTable(toClipboard(CLUB_SHEET))[0], 6);

  it("verdeelt binnen de 90 over de helften en buiten de 90 over de gekozen fases", () => {
    const { rows: out, skipped } = buildPlanImport(rows, kinds, { outsideSplit: ["prematch", "halftime"] });
    const beta = out.find((r) => r.name === "Beta Drinks")!;
    expect(beta.seconds).toEqual({ firstHalf: 60, secondHalf: 60, prematch: 90, halftime: 90 });
    expect(beta.notes).toBe("3 minuten tijdens de rust in loop");

    const alpha = out.find((r) => r.name === "MAIN PARTNER - ALPHA")!;
    expect(alpha.seconds).toEqual({ firstHalf: 180, secondHalf: 180, prematch: 0, halftime: 0 });

    const epsilon = out.find((r) => r.name === "Café Épsilon")!;
    expect(epsilon.seconds).toEqual({ firstHalf: 0, secondHalf: 0, prematch: 270, halftime: 270 });

    expect(out.map((r) => r.name)).toEqual(["MAIN PARTNER - ALPHA", "Beta Drinks", "Delta Sport", "Café Épsilon"]);
    expect(skipped).toEqual([
      { name: "PARTNERS", reason: "no_times" },
      { name: "Gamma", reason: "no_times" },
      { name: "SUBTOTAAL", reason: "total" },
      { name: "TOTAAL", reason: "total" },
    ]);
  });

  it("deelt een oneven aantal seconden zonder verlies", () => {
    const { rows: out } = buildPlanImport([["A", "", "", "", "0,25", ""]], kinds, {
      outsideSplit: ["prematch", "halftime", "postmatch"],
    });
    const s = out[0].seconds;
    expect((s.prematch ?? 0) + (s.halftime ?? 0) + (s.postmatch ?? 0)).toBe(15);
    expect(s.postmatch).toBe(5);
  });

  it("zonder naamkolom komt er niets uit", () => {
    expect(buildPlanImport(rows, ["ignore", "ignore", "ignore", "inside90", "ignore", "ignore"], { outsideSplit: [] }).rows).toEqual([]);
  });
});

describe("applyPlanImport", () => {
  const existing: PlanRow[] = [
    planRowFromSponsor(sponsor({ id: "a", name: "Main Partner – Alpha", matchFirstHalfSeconds: 180, matchSecondHalfSeconds: 180 })),
    planRowFromSponsor(sponsor({ id: "b", name: "Beta Drinks", prematchSeconds: 60, postmatchSeconds: 120 })),
    planRowFromSponsor(sponsor({ id: "z", name: "Zeta", halftimeSeconds: 60 })),
  ];

  it("werkt bestaande sponsors bij op naam, maakt nieuwe aan en laat de rest staan", () => {
    const rows = parseClipboardTable(toClipboard(CLUB_SHEET));
    const built = buildPlanImport(rows.slice(1), guessColumnKinds(rows[0], 6), { outsideSplit: ["prematch", "halftime"] });
    const { rows: next, summary } = applyPlanImport(existing, built.rows);

    expect(summary.created).toEqual(["Delta Sport", "Café Épsilon"]);
    expect(summary.updated).toEqual(["Main Partner – Alpha", "Beta Drinks"]);
    expect(summary.unchanged).toBe(0);

    const beta = next.find((r) => r.id === "b")!;
    expect(beta.seconds).toEqual({ prematch: 90, firstHalf: 60, halftime: 90, secondHalf: 60, postmatch: 120 });

    expect(next.find((r) => r.id === "z")!.seconds.halftime).toBe(60);
    expect(next.filter((r) => r.id === null).map((r) => r.name)).toEqual(["Delta Sport", "Café Épsilon"]);
    expect(existing[1].seconds.prematch).toBe(60);
  });

  it("een tweede keer dezelfde plak verandert niets meer", () => {
    const rows = parseClipboardTable(toClipboard(CLUB_SHEET));
    const built = buildPlanImport(rows.slice(1), guessColumnKinds(rows[0], 6), { outsideSplit: ["prematch", "halftime"] });
    const once = applyPlanImport(existing, built.rows).rows;
    const twice = applyPlanImport(once, built.rows);
    expect(twice.summary.created).toEqual([]);
    expect(twice.summary.updated).toEqual([]);
    expect(twice.summary.unchanged).toBe(4);
  });

  it("meldt namen die twee keer in de plak staan", () => {
    const { summary } = applyPlanImport(existing, [
      { name: "Zeta", seconds: { halftime: 120 }, notes: null },
      { name: "ZETA", seconds: { halftime: 180 }, notes: null },
    ]);
    expect(summary.duplicates).toEqual(["ZETA"]);
  });
});

describe("planrijen en database", () => {
  it("leest een oude sponsor met alleen matchSeconds als 1e helft", () => {
    const row = planRowFromSponsor(sponsor({ id: "o", name: "Oud", matchSeconds: 240 }));
    expect(row.seconds.firstHalf).toBe(240);
    expect(row.seconds.secondHalf).toBe(0);
  });

  it("schrijft de voetbalkolommen en de som van beide helften", () => {
    const row = planRowFromSponsor(sponsor({ id: "a", name: " Alpha ", notes: "  na Beta " }));
    row.seconds = { prematch: 60, firstHalf: 90, halftime: 30, secondHalf: 120, postmatch: 0 };
    expect(sponsorPatchFromPlanRow(row)).toEqual({
      name: "Alpha",
      active: true,
      prematchSeconds: 60,
      matchFirstHalfSeconds: 90,
      matchSecondHalfSeconds: 120,
      matchSeconds: 210,
      halftimeSeconds: 30,
      postmatchSeconds: 0,
      notes: "na Beta",
    });
  });

  it("ziet een wijziging in tijd, naam, actief of notitie", () => {
    const original = planRowFromSponsor(sponsor({ id: "a", name: "Alpha" }));
    expect(planRowChanged({ ...original }, original)).toBe(false);
    expect(planRowChanged({ ...original, name: "Alpha " }, original)).toBe(false);
    expect(planRowChanged({ ...original, notes: "x" }, original)).toBe(true);
    expect(planRowChanged({ ...original, active: false }, original)).toBe(true);
    expect(planRowChanged({ ...original, seconds: { ...original.seconds, halftime: 1 } }, original)).toBe(true);
    expect(planRowChanged(original, undefined)).toBe(true);
  });

  it("telt alleen actieve sponsors in de totalen", () => {
    const a = planRowFromSponsor(sponsor({ id: "a", name: "A", halftimeSeconds: 120 }));
    const b = planRowFromSponsor(sponsor({ id: "b", name: "B", halftimeSeconds: 60, active: false }));
    expect(planTotals([a, b]).halftime).toBe(120);
  });
});

describe("suggestSponsorForFile", () => {
  const sponsors = [
    { id: "alpha", name: "MAIN PARTNER - ALPHA" },
    { id: "ebury", name: "Eburon" },
    { id: "stanno", name: "Stannox" },
    { id: "roots", name: "The Roots" },
    { id: "mossel", name: "Van Mossel" },
    { id: "heylen", name: "Heylen Vastgoed" },
    { id: "heylen-extra", name: "Heylen Vastgoed (extra)" },
    { id: "port", name: "Port of Antwerp Bruges" },
  ];

  it("vindt de sponsor in vrije bestandsnamen", () => {
    expect(suggestSponsorForFile("1 Alpha Daily 250725.mp4", sponsors)).toBe("alpha");
    expect(suggestSponsorForFile("ANT EBURON LED 1920x1080.mp4", sponsors)).toBe("ebury");
    expect(suggestSponsorForFile("Stannox_RAFC_BigScreen_4K_3840x2160_25fps.mp4", sponsors)).toBe("stanno");
    expect(suggestSponsorForFile("THE ROOTS T4 groot scherm.mp4", sponsors)).toBe("roots");
    expect(suggestSponsorForFile("C:\\Drive\\T4\\Van Mossel 250725.mp4", sponsors)).toBe("mossel");
    expect(suggestSponsorForFile("VanMossel.png", sponsors)).toBe("mossel");
  });

  it("stelt niets voor als het niet duidelijk is", () => {
    expect(suggestSponsorForFile("AM_GREECE_VIDEO_05_FINAL_16x9_H264.mp4", sponsors)).toBeNull();
    expect(suggestSponsorForFile("Copy of POAB-x-academy-16x9.png", sponsors)).toBeNull();
    expect(suggestSponsorForFile("Heylen Vastgoed.mp4", sponsors)).toBeNull();
  });
});

describe("normalizeName", () => {
  it("negeert hoofdletters, accenten en leestekens", () => {
    expect(normalizeName("  Café  Épsilon! ")).toBe("cafe epsilon");
    expect(normalizeName("Main Partner – Alpha")).toBe(normalizeName("MAIN PARTNER - ALPHA"));
  });
});
