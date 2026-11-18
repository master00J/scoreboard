import { describe, expect, it } from "vitest";
import type { MediaItem, Sponsor } from "./types";
import { mergeSponsorsWithClubMedia } from "./club-media-rotation";
import { activeSponsorsForSection, buildSponsorAppearancePlan } from "./sponsor-distribution";
import {
  applyPlanImport,
  buildPlanImport,
  clubMediaPatchFromPlanRow,
  clubMediaWrites,
  cueStatusForPlanPhase,
  formatClock,
  parseClockText,
  pendingClip,
  pendingClipConflicts,
  planCuesFromApi,
  planCapacity,
  planEffectiveSeconds,
  planRowsFromDatabase,
  sectionKindFromHeader,
  changedClipTags,
  mergeFreshClips,
  planPhasesFromTags,
  tagsJsonFromPlanPhases,
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
      { name: "Zeta", kind: "sponsor", seconds: { halftime: 120 }, notes: null },
      { name: "ZETA", kind: "sponsor", seconds: { halftime: 180 }, notes: null },
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
      guaranteeJson: null,
    });
  });

  it("schrijft en herkent een gewijzigde garantie", () => {
    const original = planRowFromSponsor(sponsor({ id: "a", name: "Alpha" }));
    expect(original.guarantee).toEqual({ kind: "seconds", catchUpIn: [] });
    const changed = { ...original, guarantee: { kind: "plays" as const, catchUpIn: ["halftime" as const] } };
    expect(planRowChanged(changed, original)).toBe(true);
    expect(JSON.parse(sponsorPatchFromPlanRow(changed).guaranteeJson as string)).toEqual({
      kind: "plays",
      catchUpIn: ["halftime"],
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

function media(partial: Partial<MediaItem> & { id: string }): MediaItem {
  return {
    type: "VIDEO",
    path: `C:/media/${partial.id}.mp4`,
    title: partial.id,
    durationSec: 30,
    active: true,
    sponsorId: null,
    sponsorName: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...partial,
  } as MediaItem;
}

describe("sponsors en clubmedia uit de sheet", () => {
  it("rijen onder een kop als communicatie of marcom worden clubmedia, onder partners sponsors", () => {
    const sheet = [
      ["Naam", "binnen de 90", "Info"],
      ["PARTNERS", "", ""],
      ["Alpha", "6", ""],
      ["CLUB COMMUNICATIE LED", "", ""],
      ["Free Your Seat", "2", ""],
      ["EXTRA MARCOM", "", ""],
      ["Opstelling", "1", "tonen als de omroeper ze afleest"],
      ["MATCHSPONSOR", "", ""],
      ["Beta (extra)", "4", ""],
    ];
    const rows = parseClipboardTable(sheet.map((r) => r.join("\t")).join("\n"));
    const built = buildPlanImport(rows.slice(1), guessColumnKinds(rows[0], 3), { outsideSplit: [] });
    expect(built.rows.map((r) => [r.name, r.kind])).toEqual([
      ["Alpha", "sponsor"],
      ["Free Your Seat", "club"],
      ["Opstelling", "club"],
      ["Beta (extra)", "sponsor"],
    ]);
    const { rows: table } = applyPlanImport([], built.rows);
    expect(table.map((r) => r.kind)).toEqual(["sponsor", "club", "club", "sponsor"]);
    expect(table.every((r) => r.clips.length === 0)).toBe(true);
  });

  it("herkent sectiekoppen", () => {
    expect(sectionKindFromHeader("RAFC COMMUNICATIE LED")).toBe("club");
    expect(sectionKindFromHeader("EXTRA MARCOM")).toBe("club");
    expect(sectionKindFromHeader("PARTNERS")).toBe("sponsor");
    expect(sectionKindFromHeader("Reds Forever")).toBeNull();
  });
});

describe("clubmedia in het plan", () => {
  const clubItem = media({
    id: "pop",
    title: "Pop-up",
    clubPhaseBudgetJson: JSON.stringify({ prematch: 120, firstHalf: 0, halftime: 60, secondHalf: 0, postmatch: 0 }),
    notes: "drie keer zoveel voor de match",
  });
  const loose = media({ id: "los", title: "Losse clip" });
  const linked = media({ id: "s1", sponsorId: "a", clubPhaseBudgetJson: JSON.stringify({ prematch: 60 }) });

  it("toont alleen losse media met zendtijd als clubmedia", () => {
    const rows = planRowsFromDatabase([sponsor({ id: "a", name: "Alpha" })], [clubItem, loose, linked]);
    expect(rows.map((r) => [r.key, r.kind])).toEqual([
      ["a", "sponsor"],
      ["club:pop", "club"],
    ]);
    const club = rows[1];
    expect(club.seconds).toEqual({ prematch: 120, firstHalf: 0, halftime: 60, secondHalf: 0, postmatch: 0 });
    expect(club.notes).toBe("drie keer zoveel voor de match");
    expect(club.clips.map((c) => [c.path, c.type, c.durationSec, c.phases])).toEqual([
      ["C:/media/pop.mp4", "VIDEO", 30, null],
    ]);
  });

  it("schrijft de zendtijd als budget op het media-item; alles op 0 haalt het uit de rotatie", () => {
    const [club] = planRowsFromDatabase([], [clubItem]);
    expect(JSON.parse(clubMediaPatchFromPlanRow(club).clubPhaseBudgetJson as string)).toEqual({
      prematch: 120,
      firstHalf: 0,
      secondHalf: 0,
      halftime: 60,
      postmatch: 0,
    });
    const off = { ...club, seconds: { prematch: 0, firstHalf: 0, halftime: 0, secondHalf: 0, postmatch: 0 } };
    expect(clubMediaPatchFromPlanRow(off).clubPhaseBudgetJson).toBeNull();
  });

  it("ziet een nieuw of ander bestand als wijziging", () => {
    const [club] = planRowsFromDatabase([], [clubItem]);
    expect(planRowChanged({ ...club }, club)).toBe(false);
    const extra = pendingClip({ path: "C:/ander.mp4", type: "VIDEO", durationSec: 30 });
    expect(planRowChanged({ ...club, clips: [...club.clips, extra] }, club)).toBe(true);
    expect(planRowChanged({ ...club, clips: [] }, club)).toBe(true);
  });
});

describe("clubmedia met meerdere bestanden in het plan", () => {
  const budget = JSON.stringify({ prematch: 0, firstHalf: 120, secondHalf: 120, halftime: 0, postmatch: 0 });
  const fys1 = media({ id: "fys1", title: "FYS 1.mp4", durationSec: 20, clubGroup: "Free Your Seat", clubPhaseBudgetJson: budget, createdAt: "2026-08-01T00:00:01.000Z" });
  const fys2 = media({
    id: "fys2",
    title: "FYS 2.mp4",
    durationSec: 30,
    clubGroup: "Free Your Seat",
    clubPhaseBudgetJson: budget,
    sponsorPhaseTagsJson: JSON.stringify(["secondHalf", "extraTime"]),
    createdAt: "2026-08-01T00:00:02.000Z",
  });
  const loose = media({ id: "pop", title: "Pop-up", clubPhaseBudgetJson: JSON.stringify({ halftime: 60 }) });

  it("een groep wordt één clubrij met al zijn bestanden en hun fases", () => {
    const rows = planRowsFromDatabase([], [fys1, loose, fys2]);
    expect(rows.map((r) => [r.key, r.name, r.clips.map((c) => c.id)])).toEqual([
      ["clubgroup:free your seat", "Free Your Seat", ["fys1", "fys2"]],
      ["club:pop", "Pop-up", ["pop"]],
    ]);
    expect(rows[0].clips.map((c) => c.phases)).toEqual([null, ["secondHalf"]]);
    expect(rows[0].seconds.firstHalf).toBe(120);
  });

  it("opslaan schrijft groepsnaam, budget en eigen fases op elk bestand, maakt nieuwe aan en geeft weggehaalde vrij", () => {
    const [row] = planRowsFromDatabase([], [fys1, fys2]);
    const added = pendingClip({ path: "C:/club/FYS 3.png", type: "IMAGE", durationSec: 10 });
    const edited: PlanRow = {
      ...row,
      notes: "na de opstelling",
      clips: [{ ...row.clips[0], phases: ["firstHalf"] }, { ...added, phases: ["secondHalf"] }],
    };
    const w = clubMediaWrites(edited, row);
    expect(w.update).toEqual([
      {
        id: "fys1",
        body: {
          clubPhaseBudgetJson: JSON.stringify({ prematch: 0, firstHalf: 120, secondHalf: 120, halftime: 0, postmatch: 0 }),
          notes: "na de opstelling",
          clubGroup: "Free Your Seat",
          active: true,
          sponsorPhaseTagsJson: JSON.stringify(["firstHalf"]),
        },
      },
    ]);
    expect(w.create).toHaveLength(1);
    expect(w.create[0]).toMatchObject({
      path: "C:/club/FYS 3.png",
      type: "IMAGE",
      title: "FYS 3.png",
      clubGroup: "Free Your Seat",
      sponsorPhaseTagsJson: JSON.stringify(["secondHalf", "extraTime"]),
    });
    expect(w.release).toEqual([{ id: "fys2", body: { clubPhaseBudgetJson: null, clubGroup: null } }]);
  });

  it("de rotatie van het plan is dezelfde als die van het scherm na opslaan", () => {
    const rows = planRowsFromDatabase([], [fys1, fys2, loose]);
    const ctx = { sponsorsById: new Map<string, Sponsor>(), mediaById: new Map([fys1, fys2, loose].map((m) => [m.id, m])) };
    const eff = planEffectiveSeconds(rows, ctx);
    const merged = mergeSponsorsWithClubMedia([], [fys1, fys2, loose]);
    for (const [phase, section, status] of [
      ["firstHalf", "match", "FIRST_HALF"],
      ["secondHalf", "match", "SECOND_HALF"],
      ["halftime", "halftime", "HALF_TIME"],
    ] as const) {
      const engine = buildSponsorAppearancePlan(activeSponsorsForSection(merged, section, status), section, status);
      expect(eff.totals[phase]).toBe(engine.reduce((sum, p) => sum + p.appearanceSecs.reduce((a, b) => a + b, 0), 0));
    }
    /** 1e helft: alleen FYS 1 (20s) → 6 × 20 = 120. 2e helft: 20 + 30 + 20 + 30 + 20 = 120. */
    expect(eff.byRow.get("clubgroup:free your seat")!.firstHalf).toBe(120);
  });
});

describe("vaste tijdstippen", () => {
  const alpha = sponsor({
    id: "a",
    name: "Alpha",
    matchFirstHalfSeconds: 60,
    matchSeconds: 60,
    media: [media({ id: "a1", sponsorId: "a", durationSec: 30 })],
  });
  const club = media({ id: "pop", title: "Pop-up", durationSec: 15, clubPhaseBudgetJson: JSON.stringify({ firstHalf: 30 }) });
  const rows = planRowsFromDatabase([alpha], [club]);
  const ctx = { sponsorsById: new Map([["a", alpha]]), mediaById: new Map([["pop", club]]) };
  const cues = planCuesFromApi([
    { id: "c1", mediaId: "a1", matchStatus: "FIRST_HALF", triggerSec: 660, endSec: null, enabled: true, media: { durationSec: 30 } },
    { id: "c2", mediaId: "pop", matchStatus: "FIRST_HALF", triggerSec: 1200, endSec: 1260, enabled: true },
    { id: "c3", mediaId: "loose", matchStatus: "SECOND_HALF", triggerSec: 3000, endSec: null, enabled: true, media: { durationSec: 45 } },
    { id: "c4", mediaId: "a1", matchStatus: "EXTRA_TIME", triggerSec: 5500, endSec: null, enabled: true, media: { durationSec: 30 } },
    { id: "c5", mediaId: "a1", matchStatus: "FIRST_HALF", triggerSec: 100, endSec: null, enabled: false, media: { durationSec: 30 } },
  ]);

  it("leest tijdscues als fase, start, einde en duur", () => {
    expect(cues.map((c) => [c.id, c.phase, c.startSec, c.endSec, c.seconds])).toEqual([
      ["c1", "firstHalf", 660, null, 30],
      ["c2", "firstHalf", 1200, 1260, 60],
      ["c3", "secondHalf", 3000, null, 45],
      ["c5", "firstHalf", 100, null, 30],
    ]);
  });

  it("een tijdstip van een sponsor zit in zijn minuten, van clubmedia of een los bestand komt het erbij", () => {
    const eff = planEffectiveSeconds(rows, ctx, cues);
    expect(eff.byRow.get("a")!.firstHalf).toBe(60);
    expect(eff.cueByRow.get("a")!.firstHalf).toBe(30);
    expect(eff.byRow.get("club:pop")!.firstHalf).toBe(30 + 60);
    expect(eff.totals.firstHalf).toBe(60 + 90);
    expect(eff.totals.secondHalf).toBe(45);
  });

  it("een tijdstip van een sponsor zonder minuten in die fase telt wel", () => {
    const noMinutes = rows.map((r) => (r.key === "a" ? { ...r, seconds: { ...r.seconds, firstHalf: 0 } } : r));
    const eff = planEffectiveSeconds(noMinutes, ctx, cues);
    expect(eff.byRow.get("a")!.firstHalf).toBe(30);
  });

  it("leest klokwaarden", () => {
    expect(parseClockText("11:00")).toBe(660);
    expect(parseClockText("60")).toBe(3600);
    expect(parseClockText("1,5")).toBe(90);
    expect(parseClockText("12:75")).toBeNull();
    expect(parseClockText("")).toBeNull();
    expect(formatClock(3725)).toBe("62:05");
    expect(cueStatusForPlanPhase("secondHalf")).toBe("SECOND_HALF");
  });
});

describe("echte schermtijd", () => {
  const PHASES = [
    ["prematch", "prematch", "PREMATCH"],
    ["firstHalf", "match", "FIRST_HALF"],
    ["halftime", "halftime", "HALF_TIME"],
    ["secondHalf", "match", "SECOND_HALF"],
    ["postmatch", "postmatch", "POST_MATCH"],
  ] as const;

  const sponsors = [
    sponsor({
      id: "a",
      name: "Alpha",
      matchFirstHalfSeconds: 60,
      matchSecondHalfSeconds: 60,
      matchSeconds: 120,
      media: [media({ id: "a1", sponsorId: "a", durationSec: 45 })],
    }),
    sponsor({
      id: "b",
      name: "Beta",
      halftimeSeconds: 90,
      prematchSeconds: 60,
      media: [
        media({ id: "b1", sponsorId: "b", durationSec: 20 }),
        media({ id: "b2", sponsorId: "b", durationSec: 20, sponsorPhaseTagsJson: JSON.stringify(["halftime"]) }),
      ],
    }),
    sponsor({ id: "c", name: "Zonder bestand", halftimeSeconds: 120 }),
    sponsor({
      id: "d",
      name: "Uit",
      active: false,
      halftimeSeconds: 120,
      media: [media({ id: "d1", sponsorId: "d" })],
    }),
  ];
  const library = [
    media({
      id: "club1",
      title: "Free Your Seat",
      durationSec: 25,
      clubPhaseBudgetJson: JSON.stringify({ firstHalf: 60, halftime: 30 }),
    }),
  ];
  const ctx = {
    sponsorsById: new Map(sponsors.map((s) => [s.id, s])),
    mediaById: new Map(library.map((m) => [m.id, m])),
  };

  it("rondt af op hele clips, telt rijen zonder bestand of inactief niet mee, en volgt fase-tags", () => {
    const rows = planRowsFromDatabase(sponsors, library);
    const eff = planEffectiveSeconds(rows, ctx);
    expect(eff.byRow.get("a")!.firstHalf).toBe(90);
    expect(eff.byRow.get("b")!.halftime).toBe(100);
    expect(eff.byRow.get("b")!.prematch).toBe(60);
    expect(eff.byRow.get("c")!.halftime).toBe(0);
    expect(eff.byRow.get("d")!.halftime).toBe(0);
    expect(eff.byRow.get("club:club1")!.firstHalf).toBe(75);
    expect(eff.byRow.get("club:club1")!.halftime).toBe(50);
    expect(eff.totals.halftime).toBe(150);
    expect(eff.totals.firstHalf).toBe(165);
  });

  it("rekent precies wat de rotatie van het scherm rekent voor dezelfde sponsors en clubmedia", () => {
    const rows = planRowsFromDatabase(sponsors, library);
    const eff = planEffectiveSeconds(rows, ctx);
    const merged = mergeSponsorsWithClubMedia(sponsors, library);
    for (const [phase, section, status] of PHASES) {
      const engine = buildSponsorAppearancePlan(activeSponsorsForSection(merged, section, status), section, status);
      const engineTotal = engine.reduce((sum, p) => sum + p.appearanceSecs.reduce((a, b) => a + b, 0), 0);
      expect(eff.totals[phase]).toBe(engineTotal);
    }
  });

  it("gebruikt de minuten uit de tabel, ook voor een nieuwe clubrij met een gekozen bestand", () => {
    const rows = planRowsFromDatabase(sponsors, library);
    rows[0] = { ...rows[0], seconds: { ...rows[0].seconds, firstHalf: 150 } };
    rows.push({
      key: "new-1",
      kind: "club",
      id: null,
      name: "Pop-up",
      active: true,
      seconds: { prematch: 0, firstHalf: 0, halftime: 40, secondHalf: 0, postmatch: 0 },
      notes: "",
      guarantee: { kind: "seconds", catchUpIn: [] },
      mediaCount: 1,
      clips: [pendingClip({ path: "C:/pop.jpg", type: "IMAGE", durationSec: 10 })],
    });
    const eff = planEffectiveSeconds(rows, ctx);
    expect(eff.byRow.get("a")!.firstHalf).toBe(180);
    expect(eff.byRow.get("new-1")!.halftime).toBe(40);
  });

  it("de capaciteit volgt de wedstrijd; voor de match alleen met een vast venster", () => {
    expect(planCapacity(null)).toEqual({ firstHalf: 2700, secondHalf: 2700, halftime: 900 });
    expect(planCapacity({ halfDurationSec: 2400, halfBreakSec: 600, prematchSpreadWindowSec: 1800 })).toEqual({
      firstHalf: 2400,
      secondHalf: 2400,
      halftime: 600,
      prematch: 1800,
    });
  });
});

describe("fases per bestand", () => {
  it("leest fase-tags als planfases; geen tags of alle fases = overal", () => {
    expect(planPhasesFromTags(null)).toBeNull();
    expect(planPhasesFromTags(JSON.stringify(["firstHalf"]))).toEqual(["firstHalf"]);
    expect(planPhasesFromTags(JSON.stringify(["secondHalf", "extraTime", "halftime"]))).toEqual(["halftime", "secondHalf"]);
    expect(
      planPhasesFromTags(JSON.stringify(["prematch", "firstHalf", "halftime", "secondHalf", "extraTime", "postmatch"])),
    ).toBeNull();
  });

  it("schrijft de 2e helft samen met de verlenging, en bewaart een losse verlenging", () => {
    expect(tagsJsonFromPlanPhases(null, null)).toBeNull();
    expect(JSON.parse(tagsJsonFromPlanPhases(["firstHalf"], null)!)).toEqual(["firstHalf"]);
    expect(JSON.parse(tagsJsonFromPlanPhases(["secondHalf"], null)!)).toEqual(["secondHalf", "extraTime"]);
    expect(JSON.parse(tagsJsonFromPlanPhases(["halftime"], JSON.stringify(["extraTime"]))!)).toEqual([
      "halftime",
      "extraTime",
    ]);
    expect(tagsJsonFromPlanPhases(["prematch", "firstHalf", "halftime", "secondHalf", "postmatch"], null)).toBeNull();
  });

  it("geen enkele fase laat de tags zoals ze waren, want een lege lijst speelt overal", () => {
    const original = JSON.stringify(["firstHalf"]);
    expect(tagsJsonFromPlanPhases([], original)).toBe(original);
  });

  const alpha = sponsor({
    id: "a",
    name: "Alpha",
    matchFirstHalfSeconds: 60,
    matchSecondHalfSeconds: 60,
    matchSeconds: 120,
    media: [
      media({ id: "first", sponsorId: "a", durationSec: 30 }),
      media({ id: "second", sponsorId: "a", durationSec: 20, sponsorPhaseTagsJson: JSON.stringify(["secondHalf", "extraTime"]) }),
    ],
  });

  it("toont de bestanden van een sponsor met hun fases en ziet een wijziging", () => {
    const [row] = planRowsFromDatabase([alpha], []);
    expect(row.clips.map((c) => [c.id, c.phases])).toEqual([
      ["first", null],
      ["second", ["secondHalf"]],
    ]);
    const edited = { ...row, clips: row.clips.map((c) => (c.id === "first" ? { ...c, phases: ["firstHalf" as const] } : c)) };
    expect(planRowChanged(edited, row)).toBe(true);
    expect(changedClipTags(edited, row)).toEqual([{ id: "first", sponsorPhaseTagsJson: JSON.stringify(["firstHalf"]) }]);
    expect(changedClipTags(row, row)).toEqual([]);
  });

  it("de echte schermtijd volgt de fases uit de tabel", () => {
    const ctx = { sponsorsById: new Map([["a", alpha]]), mediaById: new Map<string, MediaItem>() };
    const [row] = planRowsFromDatabase([alpha], []);
    const before = planEffectiveSeconds([row], ctx).byRow.get("a")!;
    expect(before.firstHalf).toBe(60);
    /** 30 + 20 = 50 < 60, dus nog één clip van 30: een gestarte clip speelt uit. */
    expect(before.secondHalf).toBe(80);

    const onlySecond = {
      ...row,
      clips: row.clips.map((c) => (c.id === "first" ? { ...c, phases: ["halftime" as const] } : c)),
    };
    const after = planEffectiveSeconds([onlySecond], ctx).byRow.get("a")!;
    expect(after.firstHalf).toBe(0);
    expect(after.secondHalf).toBe(60);
  });

  it("nieuwe bestanden uit de database komen erbij zonder de gewijzigde fases te verliezen", () => {
    const [row] = planRowsFromDatabase([alpha], []);
    const edited = row.clips.map((c) => (c.id === "first" ? { ...c, phases: ["firstHalf" as const] } : c));
    const withNew = planRowsFromDatabase(
      [{ ...alpha, media: [...alpha.media!, media({ id: "third", sponsorId: "a" })] }],
      [],
    )[0].clips;
    expect(mergeFreshClips(edited, withNew).map((c) => [c.id, c.phases])).toEqual([
      ["first", ["firstHalf"]],
      ["second", ["secondHalf"]],
      ["third", null],
    ]);
  });
});

describe("hetzelfde nieuwe bestand bij twee rijen", () => {
  it("wordt gemeld, zodat opslaan het niet twee keer aanmaakt", () => {
    const file = { path: "C:/club/Opstelling 2e helft.png", type: "IMAGE" as const, durationSec: 10 };
    const a = { ...planRowsFromDatabase([], [media({ id: "op", title: "OPSTELLING", clubPhaseBudgetJson: JSON.stringify({ firstHalf: 60 }) })])[0] };
    const b = { ...planRowsFromDatabase([], [media({ id: "pop", title: "Pop-up", clubPhaseBudgetJson: JSON.stringify({ halftime: 60 }) })])[0] };
    const clip = pendingClip(file);
    expect(pendingClipConflicts([{ ...a, clips: [...a.clips, clip] }, b])).toEqual([]);
    expect(pendingClipConflicts([{ ...a, clips: [...a.clips, clip] }, { ...b, clips: [...b.clips, clip] }])).toEqual([
      { file: "Opstelling 2e helft.png", rows: ["OPSTELLING", "Pop-up"] },
    ]);
    const sameFileOtherClip = pendingClip(file);
    expect(
      pendingClipConflicts([{ ...a, clips: [...a.clips, clip] }, { ...b, clips: [...b.clips, sameFileOtherClip] }]),
    ).toHaveLength(1);
  });
});

describe("reeksen in het seizoensplan", () => {
  const kumho = sponsor({
    id: "kumho",
    name: "Kumho",
    matchFirstHalfSeconds: 120,
    matchSeconds: 120,
    media: [
      media({ id: "k1", sponsorId: "kumho", durationSec: 20 }),
      media({ id: "k2", sponsorId: "kumho", durationSec: 20 }),
    ],
  });
  const library = [
    ...kumho.media!,
    media({ id: "club1", title: "Na Kumho", durationSec: 10, clubPhaseBudgetJson: JSON.stringify({ firstHalf: 30 }) }),
  ];
  const ctx = {
    sponsorsById: new Map([[kumho.id, kumho]]),
    mediaById: new Map(library.map((m) => [m.id, m])),
  };
  const seq = {
    id: "s1",
    name: "Kumho + club",
    active: true,
    notes: "",
    mediaIds: ["k1", "club1"],
    budget: { prematch: 0, firstHalf: 60, secondHalf: 0, halftime: 0, postmatch: 0 },
  };

  it("geeft de reeks hele reeksen en haalt haar bestanden uit de rij van hun sponsor en clubmedia", () => {
    const rows = planRowsFromDatabase([kumho], library);
    const eff = planEffectiveSeconds(rows, ctx, [], [seq]);
    // Reeks van 30 s, 60 s gevraagd: twee keer.
    expect(eff.bySequence.get("s1")!.firstHalf).toBe(60);
    // Kumho speelt alleen nog k2 los: 120 s in clips van 20 s.
    expect(eff.byRow.get("kumho")!.firstHalf).toBe(120);
    // De clubmedia heeft geen los bestand meer.
    expect(eff.byRow.get("club:club1")!.firstHalf).toBe(0);
    expect(eff.totals.firstHalf).toBe(180);
  });

  it("verandert niets zonder reeks of met een reeks die uit staat", () => {
    const rows = planRowsFromDatabase([kumho], library);
    const without = planEffectiveSeconds(rows, ctx);
    const off = planEffectiveSeconds(rows, ctx, [], [{ ...seq, active: false }]);
    expect(off.totals).toEqual(without.totals);
    expect(off.byRow.get("kumho")).toEqual(without.byRow.get("kumho"));
  });
});
