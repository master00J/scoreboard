/**
 * Vult `public/downloads/*.exe` vóór `next build`.
 * Per artefact: eerst env-FETCH_URL (HTTPS), anders kopie uit monorepo-paden.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");
const destDir = path.join(__dirname, "..", "public", "downloads");

const MIN_BYTES_SCOREBOARD = 50 * 1024 * 1024;
const MIN_BYTES_LEDBOARDING = 20 * 1024 * 1024;

/** @type {{ fileName: string; localCandidates: string[]; fetchEnv: string; minBytes: number; label: string }[]} */
const artifacts = [
  {
    fileName: "Stadium-Scoreboard.exe",
    localCandidates: [
      path.join(repoRoot, "dist-latest", "Stadium-Scoreboard.exe"),
      path.join(repoRoot, "dist", "Stadium-Scoreboard.exe"),
    ],
    fetchEnv: "PORTABLE_EXE_FETCH_URL",
    minBytes: MIN_BYTES_SCOREBOARD,
    label: "scoreboard",
  },
  {
    fileName: "ArenaCue-Ledboarding.exe",
    localCandidates: [
      path.join(repoRoot, "ledboarding", "dist-latest", "ArenaCue-Ledboarding.exe"),
      path.join(repoRoot, "ledboarding", "dist", "ArenaCue-Ledboarding.exe"),
    ],
    fetchEnv: "PORTABLE_LEDBOARDING_FETCH_URL",
    minBytes: MIN_BYTES_LEDBOARDING,
    label: "LED boarding",
  },
];

async function fetchToFile(url, dest, minBytes) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < minBytes) {
    throw new Error(`Download te klein (${buf.length} bytes); controleer de URL.`);
  }
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(dest, buf);
  console.log(`[ensure-portable:${path.basename(dest)}] gedownload (${Math.round(buf.length / 1024 / 1024)} MB)`);
}

function copyIfExists(localCandidates, dest, minBytes, tag) {
  for (const src of localCandidates) {
    if (!fs.existsSync(src)) {
      continue;
    }
    const st = fs.statSync(src);
    if (st.size < minBytes) {
      console.warn(`[ensure-portable:${tag}] ${src} lijkt te klein, volgende bron proberen.`);
      continue;
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
    const label = src.includes(`${path.sep}dist-latest${path.sep}`) ? "dist-latest" : "dist";
    console.log(`[ensure-portable:${tag}] gekopieerd (${Math.round(st.size / 1024 / 1024)} MB) van ${label}/`);
    return true;
  }
  return false;
}

/**
 * @param {{ fileName: string; localCandidates: string[]; fetchEnv: string; minBytes: number; label: string }} art
 */
async function ensureOne(art) {
  const dest = path.join(destDir, art.fileName);

  if (fs.existsSync(dest)) {
    const st = fs.statSync(dest);
    if (st.size >= art.minBytes) {
      console.log(`[ensure-portable:${art.label}] ${art.fileName} bestaat al.`);
      return;
    }
    try {
      fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
  }

  const fetchUrl = process.env[art.fetchEnv]?.trim();
  if (fetchUrl) {
    try {
      await fetchToFile(fetchUrl, dest, art.minBytes);
      return;
    } catch (e) {
      console.error(`[ensure-portable:${art.label}] ${art.fetchEnv}:`, e?.message ?? e);
      throw e;
    }
  }

  if (copyIfExists(art.localCandidates, dest, art.minBytes, art.label)) {
    return;
  }

  console.warn(
    `[ensure-portable:${art.label}] Geen portable ${art.fileName}: zet ${art.fetchEnv} op Vercel, of plaats de build in een van: ${art.localCandidates.join(", ")}`,
  );
}

async function main() {
  for (const art of artifacts) {
    await ensureOne(art);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
