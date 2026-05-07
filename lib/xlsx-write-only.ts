import * as XLSX from "xlsx";

/**
 * Write-only wrapper rond SheetJS.
 *
 * Security: CVE-2023-30533 (prototype pollution) treft voornamelijk "read" paden
 * bij het inlezen/parsen van kwaadaardige spreadsheets. In ArenaCue gebruiken we
 * SheetJS enkel voor het GENEREREN van Excel exports (proof-of-play), niet voor import.
 *
 * Bewuste keuze: exporteer enkel de subset die we nodig hebben zodat niemand later
 * per ongeluk `XLSX.read*` toevoegt zonder eerst de dependency te upgraden.
 */
export const XlsxWriteOnly = {
  utils: {
    book_new: XLSX.utils.book_new,
    aoa_to_sheet: XLSX.utils.aoa_to_sheet,
    book_append_sheet: XLSX.utils.book_append_sheet,
  },
  writeArrayBuffer(wb: XLSX.WorkBook): ArrayBuffer {
    // NB: expliciet type=array zodat callers altijd bytes krijgen.
    return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  },
} as const;

