import { describe, expect, it } from "vitest";
import {
  brandFromHomeTeam,
  contrastingTextHex,
  DEFAULT_PROOF_ACCENT_HEX,
  hexToRgb,
  normalizeHexColor,
  parseProofOfPlayBrand,
  pdfHeaderTitle,
  serializeProofOfPlayBrand,
} from "./proof-of-play-brand";
import { buildProofOfPlayPdf, type ProofOfPlayExportLabels } from "./proof-of-play-export";

const labels: ProofOfPlayExportLabels = {
  title: "ArenaCue · Proof-of-play",
  generated: "Gegenereerd",
  filter: "Filter",
  kpi: "KPI",
  value: "Waarde",
  plays: "Aantal",
  totalActual: "Werkelijk",
  totalExpected: "Verwacht",
  fulfillment: "Realisatie",
  perSponsor: "Per sponsor",
  sheetReport: "Rapport",
  sheetDetail: "Detail",
  colEnd: "Einde",
  colSponsor: "Sponsor",
  colMedia: "Media",
  colMatch: "Wedstrijd",
  colKickoff: "Kickoff",
  colMatchStatus: "Status",
  colPhase: "Fase",
  colExpectedSec: "Verw.",
  colActualSec: "Werk.",
  colSessionId: "Sessie",
  totals: "Totalen",
  totalsLine: "{{plays}} / {{actual}} / {{expected}} / {{pct}}%",
  colTurns: "Beurten",
  colActualShort: "Werkelijk",
  colExpectedShort: "Verwacht",
  noDetail: "Geen detail",
  detailHeading: "Detail",
  colExpectedSecShort: "Verw.",
  colActualSecShort: "Werk.",
  segmentPrematch: "Voor",
  segmentHalftime: "Rust",
  segmentFirstHalf: "1e",
  segmentSecondHalf: "2e",
  segmentExtraTime: "Verlenging",
};

describe("proof-of-play brand", () => {
  it("valt terug op ArenaCue-blauw bij lege JSON", () => {
    const brand = parseProofOfPlayBrand(null);
    expect(brand.accentHex).toBe(DEFAULT_PROOF_ACCENT_HEX);
    expect(brand.logoPath).toBeNull();
    expect(brand.clubName).toBe("");
  });

  it("normaliseert hex en knipt teksten", () => {
    const brand = parseProofOfPlayBrand(
      JSON.stringify({
        clubName: "  KV  Mechelen  ",
        reportTitle: " Sponsorrapport ",
        accentHex: "#0A3",
        headerTextHex: "#fff",
        logoPath: "  /uploads/crest.png  ",
        footer: "Vertrouwelijk — alleen voor sponsors",
      }),
    );
    expect(brand.clubName).toBe("KV Mechelen");
    expect(brand.reportTitle).toBe("Sponsorrapport");
    expect(brand.accentHex).toBe("#00aa33");
    expect(brand.headerTextHex).toBe("#ffffff");
    expect(brand.logoPath).toBe("/uploads/crest.png");
    expect(hexToRgb(brand.accentHex)).toEqual([0, 170, 51]);
  });

  it("kiest donkere tekst op een lichte kopkleur", () => {
    expect(contrastingTextHex("#f8fafc")).toBe("#111827");
    expect(contrastingTextHex("#1d4ed8")).toBe("#ffffff");
    expect(normalizeHexColor("niet-hex", "#2563eb")).toBe("#2563eb");
  });

  it("neemt home-teamkleuren over", () => {
    const brand = brandFromHomeTeam({
      name: "KRC Genk",
      logoPath: "C:\\crest.png",
      primaryColor: "#0057B8",
      secondaryColor: "#FFFFFF",
    });
    expect(brand.clubName).toBe("KRC Genk");
    expect(brand.accentHex).toBe("#0057b8");
    expect(brand.headerTextHex).toBe("#ffffff");
    expect(brand.logoPath).toBe("C:\\crest.png");
  });

  it("serialiseert round-trip", () => {
    const json = serializeProofOfPlayBrand({
      clubName: "Club",
      reportTitle: "",
      accentHex: "#112233",
      headerTextHex: "#eeeeee",
      logoPath: null,
      logoDataUrl: "data:image/png;base64,abc",
      footer: "Voet",
    });
    const again = parseProofOfPlayBrand(json);
    expect(again.accentHex).toBe("#112233");
    expect(again.logoDataUrl).toBe("data:image/png;base64,abc");
    expect(pdfHeaderTitle(again, "ArenaCue · Proof-of-play")).toBe("ArenaCue · Proof-of-play");
  });

  it("bouwt een PDF met clubnaam en eigen kleur", () => {
    const brand = parseProofOfPlayBrand(
      JSON.stringify({
        clubName: "Test Club",
        reportTitle: "Sponsorrapport",
        accentHex: "#7c2d12",
        headerTextHex: "#fff7ed",
        footer: "Vertrouwelijk",
      }),
    );
    const pdf = buildProofOfPlayPdf(
      [],
      [{ sponsorId: "1", sponsorName: "Bakkerij", plays: 2, actualSec: 40, expectedSec: 60 }],
      {
        generatedAtIso: "2026-08-20T15:00:00.000Z",
        filterLabel: "Alle wedstrijden",
        totalPlays: 2,
        totalActualSec: 40,
        totalExpectedSec: 60,
        avgFulfillmentPercent: 67,
      },
      labels,
      "nl-BE",
      { brand },
    );
    expect(pdf.byteLength).toBeGreaterThan(500);
    const asText = Buffer.from(pdf).toString("latin1");
    expect(asText).toContain("Sponsorrapport");
    expect(asText).toContain("Test Club");
  });
});
