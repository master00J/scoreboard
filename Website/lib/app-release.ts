import fs from "fs";
import path from "path";

export type AppReleasePayload = {
  version: string;
  downloadUrl: string;
  title: string | null;
  body: string | null;
};

const defaults: AppReleasePayload = {
  version: "0.1.0",
  downloadUrl: "https://arenacue.be/downloads/Stadium-Scoreboard.exe",
  title: null,
  body: null,
};

function readJsonFile(): Partial<AppReleasePayload> | null {
  try {
    const p = path.join(process.cwd(), "data", "app-release.json");
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw) as Partial<AppReleasePayload>;
  } catch {
    return null;
  }
}

/** Release-info voor de desktopapp (versiecheck). Env overschrijft losse velden. */
export function getAppReleasePayload(): AppReleasePayload {
  const fromFile = readJsonFile() ?? {};
  const merged: AppReleasePayload = {
    version: (fromFile.version ?? defaults.version).trim() || defaults.version,
    downloadUrl: (fromFile.downloadUrl ?? defaults.downloadUrl).trim() || defaults.downloadUrl,
    title: fromFile.title != null ? String(fromFile.title).trim() || null : null,
    body: fromFile.body != null ? String(fromFile.body).trim() || null : null,
  };

  const v = process.env.APP_RELEASE_VERSION?.trim();
  const u = process.env.APP_RELEASE_DOWNLOAD_URL?.trim();
  const t = process.env.APP_RELEASE_TITLE?.trim();
  const b = process.env.APP_RELEASE_NOTES?.trim();
  if (v) merged.version = v;
  if (u) merged.downloadUrl = u;
  if (t !== undefined) merged.title = t || null;
  if (b !== undefined) merged.body = b || null;

  return merged;
}
