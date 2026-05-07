import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { XlsxWriteOnly } from "./xlsx-write-only";

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

const BRAND_RGB: [number, number, number] = [37, 99, 235];

export function formatSecForExport(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return "0s";
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function formatDateTimeNl(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  return d.toLocaleString("nl-BE", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function formatSegmentNl(key: string): string {
  if (key.includes(":prematch")) return "Voor wedstrijd";
  if (key.includes(":halftime")) return "Rust";
  if (key.includes(":FIRST_HALF")) return "1e helft";
  if (key.includes(":SECOND_HALF")) return "2e helft";
  if (key.includes(":EXTRA_TIME")) return "Verlenging";
  return key;
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

export function buildProofOfPlayXlsx(
  rows: ProofOfPlayRow[],
  summary: ProofOfPlaySummaryRow[],
  meta: ProofOfPlayExportMeta,
): Uint8Array {
  const wb = XlsxWriteOnly.utils.book_new();

  const overview: (string | number)[][] = [
    ["ArenaCue · Proof-of-play"],
    ["Gegenereerd", formatDateTimeNl(meta.generatedAtIso)],
    ["Filter", meta.filterLabel],
    [],
    ["KPI", "Waarde"],
    ["Aantal afspeelbeurten", meta.totalPlays],
    ["Totale schermtijd (werkelijk)", formatSecForExport(meta.totalActualSec)],
    ["Totale verwachte schermtijd", formatSecForExport(meta.totalExpectedSec)],
    ["Realisatiegraad", `${meta.avgFulfillmentPercent}%`],
    [],
    ["Per sponsor"],
    ["Sponsor", "Afspeelbeurten", "Werkelijke tijd", "Verwachte tijd", "Realisatie"],
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
  const wsRapport = XlsxWriteOnly.utils.aoa_to_sheet(overview);
  wsRapport["!cols"] = [
    { wch: 32 },
    { wch: 22 },
    { wch: 18 },
    { wch: 14 },
    { wch: 12 },
  ];
  XlsxWriteOnly.utils.book_append_sheet(wb, wsRapport, "Rapport");

  const detailHead = [
    "Einde",
    "Sponsor",
    "Media",
    "Wedstrijd",
    "Kickoff",
    "Matchstatus",
    "Fase",
    "Verwacht (s)",
    "Werkelijk (s)",
    "Sessie-id",
  ];
  const detailBody = rows.map((r) => [
    formatDateTimeNl(r.endedAt),
    r.sponsorName,
    r.mediaTitle,
    matchLabel(r),
    r.match?.kickoffAt ? formatDateTimeNl(r.match.kickoffAt) : "—",
    r.matchStatus ?? "—",
    formatSegmentNl(r.segmentKey),
    r.expectedSec,
    r.actualSec,
    r.clipSessionId,
  ]);
  const wsDetail = XlsxWriteOnly.utils.aoa_to_sheet([detailHead, ...detailBody]);
  wsDetail["!cols"] = [
    { wch: 18 },
    { wch: 24 },
    { wch: 36 },
    { wch: 22 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 38 },
  ];
  XlsxWriteOnly.utils.book_append_sheet(wb, wsDetail, "Detail");

  const buf = XlsxWriteOnly.writeArrayBuffer(wb);
  return new Uint8Array(buf);
}

type DocWithAutoTable = jsPDF & {
  lastAutoTable?: { finalY: number };
};

export function buildProofOfPlayPdf(
  rows: ProofOfPlayRow[],
  summary: ProofOfPlaySummaryRow[],
  meta: ProofOfPlayExportMeta,
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
  doc.text("ArenaCue · Proof-of-play", 10, 8.5);
  doc.setFontSize(8.5);
  doc.text(formatDateTimeNl(meta.generatedAtIso), pageW - 10, 8.5, { align: "right" });

  doc.setTextColor(33, 37, 41);
  doc.setFontSize(9);
  let y = 18;
  const filterShort =
    meta.filterLabel.length > 160
      ? `${meta.filterLabel.slice(0, 157)}…`
      : meta.filterLabel;
  doc.text(`Filter: ${filterShort}`, 10, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.text("Totalen", 10, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.text(
    `Afspeelbeurten: ${meta.totalPlays}   ·   Werkelijk: ${formatSecForExport(meta.totalActualSec)}   ·   Verwacht: ${formatSecForExport(meta.totalExpectedSec)}   ·   Realisatie: ${meta.avgFulfillmentPercent}%`,
    10,
    y,
  );
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [["Sponsor", "Beurten", "Werkelijk", "Verwacht", "Realisatie"]],
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
    doc.text("Geen detailrijen voor deze filter.", 10, afterSummary + 8);
  } else {
    doc.addPage();
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(33, 37, 41);
    doc.text("Detail — alle gelogde afspeelbeurten in deze export", 10, 14);
    doc.setFont("helvetica", "normal");

    autoTable(doc, {
      startY: 20,
      head: [
        [
          "Einde",
          "Sponsor",
          "Media",
          "Wedstrijd",
          "Fase",
          "Verw. (s)",
          "Werk. (s)",
        ],
      ],
      body: rows.map((r) => {
        const media =
          r.mediaTitle.length > 48 ? `${r.mediaTitle.slice(0, 45)}…` : r.mediaTitle;
        return [
          formatDateTimeNl(r.endedAt),
          r.sponsorName,
          media,
          matchLabel(r),
          formatSegmentNl(r.segmentKey),
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
