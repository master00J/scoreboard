/** Huisstijl voor proof-of-play PDF — opgeslagen in AppSettings.proofOfPlayBrandJson. */

export const DEFAULT_PROOF_ACCENT_HEX = "#2563eb";
export const DEFAULT_PROOF_HEADER_TEXT_HEX = "#ffffff";

export type ProofOfPlayBrand = {
  clubName: string;
  reportTitle: string;
  accentHex: string;
  headerTextHex: string;
  logoPath: string | null;
  /** Verkleinde PNG data-URL zodat de PDF het logo altijd kan inbedden. */
  logoDataUrl: string | null;
  footer: string;
};

export const DEFAULT_PROOF_OF_PLAY_BRAND: ProofOfPlayBrand = {
  clubName: "",
  reportTitle: "",
  accentHex: DEFAULT_PROOF_ACCENT_HEX,
  headerTextHex: DEFAULT_PROOF_HEADER_TEXT_HEX,
  logoPath: null,
  logoDataUrl: null,
  footer: "",
};

const HEX6 = /^#([0-9a-fA-F]{6})$/;
const HEX3 = /^#([0-9a-fA-F]{3})$/;

export function normalizeHexColor(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  const six = HEX6.exec(value);
  if (six) return `#${six[1].toLowerCase()}`;
  const three = HEX3.exec(value);
  if (three) {
    const [r, g, b] = three[1].toLowerCase().split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

export function hexToRgb(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex, DEFAULT_PROOF_ACCENT_HEX);
  const n = Number.parseInt(normalized.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Lichtheid 0–1 (perceptueel genoeg voor koptekst). */
export function hexLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function contrastingTextHex(backgroundHex: string): string {
  return hexLuminance(backgroundHex) > 0.55 ? "#111827" : "#ffffff";
}

function cleanText(raw: unknown, max = 160): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanNullablePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

function cleanDataUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value.startsWith("data:image/")) return null;
  if (value.length > 1_200_000) return null;
  return value;
}

export function parseProofOfPlayBrand(raw: string | null | undefined): ProofOfPlayBrand {
  if (!raw || !raw.trim()) return { ...DEFAULT_PROOF_OF_PLAY_BRAND };
  try {
    const parsed = JSON.parse(raw) as Partial<ProofOfPlayBrand>;
    const accentHex = normalizeHexColor(parsed.accentHex, DEFAULT_PROOF_ACCENT_HEX);
    const headerExplicit =
      typeof parsed.headerTextHex === "string" &&
      (HEX6.test(parsed.headerTextHex.trim()) || HEX3.test(parsed.headerTextHex.trim()));
    return {
      clubName: cleanText(parsed.clubName, 80),
      reportTitle: cleanText(parsed.reportTitle, 80),
      accentHex,
      headerTextHex: headerExplicit
        ? normalizeHexColor(parsed.headerTextHex, contrastingTextHex(accentHex))
        : contrastingTextHex(accentHex),
      logoPath: cleanNullablePath(parsed.logoPath),
      logoDataUrl: cleanDataUrl(parsed.logoDataUrl),
      footer: cleanText(parsed.footer, 160),
    };
  } catch {
    return { ...DEFAULT_PROOF_OF_PLAY_BRAND };
  }
}

export function serializeProofOfPlayBrand(brand: ProofOfPlayBrand): string {
  return JSON.stringify(parseProofOfPlayBrand(JSON.stringify(brand)));
}

export function brandFromHomeTeam(team: {
  name?: string | null;
  logoPath?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
}): ProofOfPlayBrand {
  const accentHex = normalizeHexColor(team.primaryColor, DEFAULT_PROOF_ACCENT_HEX);
  const secondary = normalizeHexColor(team.secondaryColor ?? "", contrastingTextHex(accentHex));
  const headerTextHex =
    team.secondaryColor && HEX6.test(String(team.secondaryColor).trim())
      ? secondary
      : contrastingTextHex(accentHex);
  return {
    ...DEFAULT_PROOF_OF_PLAY_BRAND,
    clubName: cleanText(team.name, 80),
    accentHex,
    headerTextHex,
    logoPath: cleanNullablePath(team.logoPath),
  };
}

export function pdfHeaderTitle(brand: ProofOfPlayBrand, fallbackTitle: string): string {
  return brand.reportTitle.trim() || fallbackTitle;
}
