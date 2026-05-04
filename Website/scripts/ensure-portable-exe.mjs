/**
 * Vult `public/downloads/Stadium-Scoreboard.exe` vóór `next build`.
 * 1) `PORTABLE_EXE_FETCH_URL` — directe HTTPS-URL (aanbevolen op Vercel; .exe >100 MB past niet in Git).
 * 2) Kopie uit monorepo (in volgorde): `../dist-latest/Stadium-Scoreboard.exe` (jullie “laatste build”),
 *    anders `../dist/Stadium-Scoreboard.exe`.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");
const portableName = "Stadium-Scoreboard.exe";
const localPortableCandidates = [
  path.join(repoRoot, "dist-latest", portableName),
  path.join(repoRoot, "dist", portableName),
];
const destDir = path.join(__dirname, "..", "public", "downloads");
const dest = path.join(destDir, portableName);

const MIN_BYTES = 50 * 1024 * 1024;

async function fetchToFile(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`PORTABLE_EXE_FETCH_URL HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < MIN_BYTES) {
    throw new Error(`Download te klein (${buf.length} bytes); controleer de URL.`);
  }
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(dest, buf);
  console.log(`[ensure-portable] gedownload (${Math.round(buf.length / 1024 / 1024)} MB) → public/downloads/`);
}

function copyIfExists() {
  for (const src of localPortableCandidates) {
    if (!fs.existsSync(src)) {
      continue;
    }
    const st = fs.statSync(src);
    if (st.size < MIN_BYTES) {
      console.warn(`[ensure-portable] ${src} lijkt te klein, volgende bron proberen.`);
      continue;
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
    const label = src.includes(`${path.sep}dist-latest${path.sep}`) ? "dist-latest" : "dist";
    console.log(`[ensure-portable] gekopieerd (${Math.round(st.size / 1024 / 1024)} MB) van ${label}/`);
    return true;
  }
  return false;
}

async function main() {
  if (fs.existsSync(dest)) {
    const st = fs.statSync(dest);
    if (st.size >= MIN_BYTES) {
      console.log("[ensure-portable] bestand bestaat al.");
      return;
    }
    try {
      fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
  }

  const fetchUrl = process.env.PORTABLE_EXE_FETCH_URL?.trim();
  if (fetchUrl) {
    await fetchToFile(fetchUrl);
    return;
  }

  if (copyIfExists()) {
    return;
  }

  console.warn(
    "[ensure-portable] Geen portable .exe: zet PORTABLE_EXE_FETCH_URL op Vercel, of zet Stadium-Scoreboard.exe in scoreboard/dist-latest/ (of dist/) en run `npm run build` opnieuw vanaf Website.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
