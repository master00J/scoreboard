import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import ExcelJS from "exceljs";

/** Rij uit GET /api/sponsor-plays — gelijk aan control panel. */
export type ProofOfPlayRow = {
  id: string;
  matchId: string | null;
  sponsorId: string | null;
  sponsorName: string;
  mediaTitle: string;
  segmentKey: string;
  matchStatus: string | null;
  expectedSec: number;
  actualSec: number;
  startedAt: string;
  endedAt: string;
  clipSessionId: string;
  match: {
    id: string;
    kickoffAt: string | null;
    homeTeam: { name: string; shortName: string };
    awayTeam: { name: string; shortName: string };
  } | null;
};

export type ProofOfPlaySummaryRow = {
  sponsorId: string | null;
  sponsorName: string;
  plays: number;
  actualSec: number;
  expectedSec: number;
};

export type ProofOfPlayExportMeta = {
  /** ISO-string van het moment van export. */
  generatedAtIso: string;
  filterLabel: string;
  totalPlays: number;
  totalActualSec: number;
  totalExpectedSec: number;
  avgFulfillmentPercent: number;
};

/** Vertalingen voor export-headers / segmentlabels — doorgeven vanuit UI via t(). */
export type ProofOfPlayExportLabels = {
  title: string;
  generated: string;
  filter: string;
  kpi: string;
  value: string;
  plays: string;
  totalActual: string;
  totalExpected: string;
  fulfillment: string;
  perSponsor: string;
  sheetReport: string;
  sheetDetail: string;
  colEnd: string;
  colSponsor: string;
  colMedia: string;
  colMatch: string;
  colKickoff: string;
  colMatchStatus: string;
  colPhase: string;
  colExpectedSec: string;
  colActualSec: string;
  colSessionId: string;
  totals: string;
  totalsLine: string;
  colTurns: string;
  colActualShort: string;
  colExpectedShort: string;
  noDetail: string;
  detailHeading: string;
  colExpectedSecShort: string;
  colActualSecShort: string;
  segmentPrematch: string;
  segmentHalftime: string;
  segmentFirstHalf: string;
  segmentSecondHalf: string;
  segmentExtraTime: string;
};

const BRAND_RGB: [number, number, number] = [37, 99, 235];

export function formatSecForExport(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return "0s";
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function formatDateTimeLocale(iso: string, locale = "nl-BE"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  return d.toLocaleString(locale, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/** @deprecated Gebruik formatDateTimeLocale */
export function formatDateTimeNl(iso: string): string {
  return formatDateTimeLocale(iso, "nl-BE");
}

export function formatSegmentKey(key: string, labels: ProofOfPlayExportLabels): string {
  if (key.includes(":prematch")) return labels.segmentPrematch;
  if (key.includes(":halftime")) return labels.segmentHalftime;
  if (key.includes(":FIRST_HALF")) return labels.segmentFirstHalf;
  if (key.includes(":SECOND_HALF")) return labels.segmentSecondHalf;
  if (key.includes(":EXTRA_TIME")) return labels.segmentExtraTime;
  return key;
}

/** @deprecated Gebruik formatSegmentKey met labels */
export function formatSegmentNl(key: string): string {
  return formatSegmentKey(key, {
    title: "ArenaCue · Proof-of-play",
    generated: "Gegenereerd",
    filter: "Filter",
    kpi: "KPI",
    value: "Waarde",
    plays: "Aantal afspeelbeurten",
    totalActual: "Totale schermtijd (werkelijk)",
    totalExpected: "Totale verwachte schermtijd",
    fulfillment: "Realisatiegraad",
    perSponsor: "Per sponsor",
    sheetReport: "Rapport",
    sheetDetail: "Detail",
    colEnd: "Einde",
    colSponsor: "Sponsor",
    colMedia: "Media",
    colMatch: "Wedstrijd",
    colKickoff: "Kickoff",
    colMatchStatus: "Matchstatus",
    colPhase: "Fase",
    colExpectedSec: "Verwacht (s)",
    colActualSec: "Werkelijk (s)",
    colSessionId: "Sessie-id",
    totals: "Totalen",
    totalsLine: "",
    colTurns: "Beurten",
    colActualShort: "Werkelijk",
    colExpectedShort: "Verwacht",
    noDetail: "Geen detailrijen voor deze filter.",
    detailHeading: "Detail — alle gelogde afspeelbeurten in deze export",
    colExpectedSecShort: "Verw. (s)",
    colActualSecShort: "Werk. (s)",
    segmentPrematch: "Voor wedstrijd",
    segmentHalftime: "Rust",
    segmentFirstHalf: "1e helft",
    segmentSecondHalf: "2e helft",
    segmentExtraTime: "Verlenging",
  });
}

function matchLabel(r: ProofOfPlayRow): string {
  if (!r.match) return "—";
  const h = r.match.homeTeam.shortName || r.match.homeTeam.name;
  const a = r.match.awayTeam.shortName || r.match.awayTeam.name;
  return `${h} – ${a}`;
}

function fulfillmentPct(actual: number, expected: number): string {
  if (expected <= 0) return "—";
  return `${Math.round((actual / expected) * 100)}%`;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ""));
}

export async function buildProofOfPlayXlsx(
  rows: ProofOfPlayRow[],
  summary: ProofOfPlaySummaryRow[],
  meta: ProofOfPlayExportMeta,
  labels: ProofOfPlayExportLabels,
  dateLocale = "nl-BE",
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ArenaCue";

  const overview: (string | number)[][] = [
    [labels.title],
    [labels.generated, formatDateTimeLocale(meta.generatedAtIso, dateLocale)],
    [labels.filter, meta.filterLabel],
    [],
    [labels.kpi, labels.value],
    [labels.plays, meta.totalPlays],
    [labels.totalActual, formatSecForExport(meta.totalActualSec)],
    [labels.totalExpected, formatSecForExport(meta.totalExpectedSec)],
    [labels.fulfillment, `${meta.avgFulfillmentPercent}%`],
    [],
    [labels.perSponsor],
    [
      labels.colSponsor,
      labels.colTurns,
      labels.colActualShort,
      labels.colExpectedShort,
      labels.fulfillment,
    ],
  ];
  for (const s of summary) {
    overview.push([
      s.sponsorName,
      s.plays,
      formatSecForExport(s.actualSec),
      formatSecForExport(s.expectedSec),
      fulfillmentPct(s.actualSec, s.expectedSec),
    ]);
  }

  const wsRapport = wb.addWorksheet(labels.sheetReport);
  overview.forEach((row) => wsRapport.addRow(row));
  wsRapport.getColumn(1).width = 32;
  wsRapport.getColumn(2).width = 22;
  wsRapport.getColumn(3).width = 18;
  wsRapport.getColumn(4).width = 14;
  wsRapport.getColumn(5).width = 12;

  const detailHead = [
    labels.colEnd,
    labels.colSponsor,
    labels.colMedia,
    labels.colMatch,
    labels.colKickoff,
    labels.colMatchStatus,
    labels.colPhase,
    labels.colExpectedSec,
    labels.colActualSec,
    labels.colSessionId,
  ];
  const detailBody = rows.map((r) => [
    formatDateTimeLocale(r.endedAt, dateLocale),
    r.sponsorName,
    r.mediaTitle,
    matchLabel(r),
    r.match?.kickoffAt ? formatDateTimeLocale(r.match.kickoffAt, dateLocale) : "—",
    r.matchStatus ?? "—",
    formatSegmentKey(r.segmentKey, labels),
    r.expectedSec,
    r.actualSec,
    r.clipSessionId,
  ]);

  const wsDetail = wb.addWorksheet(labels.sheetDetail);
  wsDetail.addRow(detailHead);
  detailBody.forEach((r) => wsDetail.addRow(r));
  wsDetail.getColumn(1).width = 18;
  wsDetail.getColumn(2).width = 24;
  wsDetail.getColumn(3).width = 36;
  wsDetail.getColumn(4).width = 22;
  wsDetail.getColumn(5).width = 18;
  wsDetail.getColumn(6).width = 14;
  wsDetail.getColumn(7).width = 14;
  wsDetail.getColumn(8).width = 12;
  wsDetail.getColumn(9).width = 12;
  wsDetail.getColumn(10).width = 38;

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

type DocWithAutoTable = jsPDF & {
  lastAutoTable?: { finalY: number };
};

export function buildProofOfPlayPdf(
  rows: ProofOfPlayRow[],
  summary: ProofOfPlaySummaryRow[],
  meta: ProofOfPlayExportMeta,
  labels: ProofOfPlayExportLabels,
  dateLocale = "nl-BE",
): Uint8Array {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFillColor(BRAND_RGB[0], BRAND_RGB[1], BRAND_RGB[2]);
  doc.rect(0, 0, pageW, 13, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text(labels.title, 10, 8.5);
  doc.setFontSize(8.5);
  doc.text(formatDateTimeLocale(meta.generatedAtIso, dateLocale), pageW - 10, 8.5, {
    align: "right",
  });

  doc.setTextColor(33, 37, 41);
  doc.setFontSize(9);
  let y = 18;
  const filterShort =
    meta.filterLabel.length > 160
      ? `${meta.filterLabel.slice(0, 157)}…`
      : meta.filterLabel;
  doc.text(`${labels.filter}: ${filterShort}`, 10, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.text(labels.totals, 10, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.text(
    interpolate(labels.totalsLine, {
      plays: meta.totalPlays,
      actual: formatSecForExport(meta.totalActualSec),
      expected: formatSecForExport(meta.totalExpectedSec),
      pct: meta.avgFulfillmentPercent,
    }),
    10,
    y,
  );
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [
      [
        labels.colSponsor,
        labels.colTurns,
        labels.colActualShort,
        labels.colExpectedShort,
        labels.fulfillment,
      ],
    ],
    body: summary.map((s) => [
      s.sponsorName,
      String(s.plays),
      formatSecForExport(s.actualSec),
      formatSecForExport(s.expectedSec),
      fulfillmentPct(s.actualSec, s.expectedSec),
    ]),
    theme: "striped",
    headStyles: {
      fillColor: BRAND_RGB,
      textColor: 255,
      fontStyle: "bold",
    },
    styles: { fontSize: 8, cellPadding: 1.8 },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
    },
    margin: { left: 10, right: 10 },
  });

  const d = doc as DocWithAutoTable;
  const afterSummary = d.lastAutoTable?.finalY ?? y + 24;

  if (rows.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(labels.noDetail, 10, afterSummary + 8);
  } else {
    doc.addPage();
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(33, 37, 41);
    doc.text(labels.detailHeading, 10, 14);
    doc.setFont("helvetica", "normal");

    autoTable(doc, {
      startY: 20,
      head: [
        [
          labels.colEnd,
          labels.colSponsor,
          labels.colMedia,
          labels.colMatch,
          labels.colPhase,
          labels.colExpectedSecShort,
          labels.colActualSecShort,
        ],
      ],
      body: rows.map((r) => {
        const media =
          r.mediaTitle.length > 48 ? `${r.mediaTitle.slice(0, 45)}…` : r.mediaTitle;
        return [
          formatDateTimeLocale(r.endedAt, dateLocale),
          r.sponsorName,
          media,
          matchLabel(r),
          formatSegmentKey(r.segmentKey, labels),
          String(r.expectedSec),
          String(r.actualSec),
        ];
      }),
      theme: "grid",
      headStyles: {
        fillColor: BRAND_RGB,
        textColor: 255,
        fontStyle: "bold",
      },
      styles: { fontSize: 7, cellPadding: 1.2 },
      columnStyles: {
        5: { halign: "right" },
        6: { halign: "right" },
      },
      margin: { left: 10, right: 10 },
    });
  }

  const out = doc.output("arraybuffer");
  return new Uint8Array(out as ArrayBuffer);
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunk = 0x4000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    for (let j = 0; j < sub.length; j++) {
      binary += String.fromCharCode(sub[j]);
    }
  }
  return btoa(binary);
}

export function downloadProofOfPlayFile(
  bytes: Uint8Array,
  mime: string,
  fileName: string,
): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function proofOfPlayLabelsFromT(t: (key: string) => string): ProofOfPlayExportLabels {
  const k = (key: string) => t(`reports.export.${key}`);
  return {
    title: k("title"),
    generated: k("generated"),
    filter: k("filter"),
    kpi: k("kpi"),
    value: k("value"),
    plays: k("plays"),
    totalActual: k("totalActual"),
    totalExpected: k("totalExpected"),
    fulfillment: k("fulfillment"),
    perSponsor: k("perSponsor"),
    sheetReport: k("sheetReport"),
    sheetDetail: k("sheetDetail"),
    colEnd: k("colEnd"),
    colSponsor: k("colSponsor"),
    colMedia: k("colMedia"),
    colMatch: k("colMatch"),
    colKickoff: k("colKickoff"),
    colMatchStatus: k("colMatchStatus"),
    colPhase: k("colPhase"),
    colExpectedSec: k("colExpectedSec"),
    colActualSec: k("colActualSec"),
    colSessionId: k("colSessionId"),
    totals: k("totals"),
    totalsLine: k("totalsLine"),
    colTurns: k("colTurns"),
    colActualShort: k("colActualShort"),
    colExpectedShort: k("colExpectedShort"),
    noDetail: k("noDetail"),
    detailHeading: k("detailHeading"),
    colExpectedSecShort: k("colExpectedSecShort"),
    colActualSecShort: k("colActualSecShort"),
    segmentPrematch: k("segmentPrematch"),
    segmentHalftime: k("segmentHalftime"),
    segmentFirstHalf: k("segmentFirstHalf"),
    segmentSecondHalf: k("segmentSecondHalf"),
    segmentExtraTime: k("segmentExtraTime"),
  };
}
