/**
 * Release-stappen tegen arenacue.be, gebruikt door .github/workflows/release-win.yml.
 *
 *   node scripts/release/publish-release.mjs preflight   mag deze versie uit? (vóór de build)
 *   node scripts/release/publish-release.mjs upload      zet dist/Stadium-Scoreboard.exe achter de downloadknop
 *   node scripts/release/publish-release.mjs announce    meld de versie: updatebanner in de app + updatemail
 *
 * De versie komt uit package.json. De site geeft eenmalige upload-URL's terug, zodat hier geen
 * Supabase-sleutel nodig is.
 *
 * Env: ARENACUE_CI_TOKEN (verplicht), ARENACUE_SITE_URL (default https://arenacue.be),
 *      RELEASE_TITLE, RELEASE_NOTES, RELEASE_BUILT_SHA, RELEASE_RUN_URL (announce).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXE = path.join(root, "dist", "Stadium-Scoreboard.exe");
const MIN_EXE_BYTES = 50 * 1024 * 1024;
const UPLOAD_ATTEMPTS = 3;

const site = (process.env.ARENACUE_SITE_URL?.trim() || "https://arenacue.be").replace(/\/+$/, "");
const token = process.env.ARENACUE_CI_TOKEN?.trim() ?? "";
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;

function fail(message) {
  console.error(`[release] ${message}`);
  process.exit(1);
}

async function sitePost(pathname, body) {
  const res = await fetch(`${site}${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok !== true) {
    fail(`${pathname} gaf ${res.status}: ${json.message ?? "geen uitleg"}`);
  }
  return json;
}

/** Grootte van een publiek bestand, zonder het te downloaden; null als de server het niet zegt. */
async function remoteSize(url) {
  const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
  await res.arrayBuffer().catch(() => null);
  if (!res.ok) return null;
  const total = res.headers.get("content-range")?.split("/")[1];
  const size = Number(total ?? res.headers.get("content-length"));
  return Number.isFinite(size) && size > 0 ? size : null;
}

async function putFile(target, bytes) {
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(target.url, {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          "cache-control": "max-age=3600",
          "x-upsert": "true",
        },
        body: bytes,
      });
      if (res.ok) return;
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.error(`[release] upload ${target.path} poging ${attempt}: ${res.status} ${detail}`);
    } catch (err) {
      console.error(`[release] upload ${target.path} poging ${attempt}: ${err?.message ?? err}`);
    }
  }
  fail(`upload van ${target.path} mislukt na ${UPLOAD_ATTEMPTS} pogingen.`);
}

async function preflight() {
  await sitePost("/api/scoreboard-ci/upload-url", { version });
  console.log(`[release] ${version} mag uit: nieuwer dan wat arenacue.be nu aankondigt.`);
}

async function upload() {
  let size;
  try {
    size = statSync(EXE).size;
  } catch {
    fail(`${EXE} ontbreekt. Bouw eerst met npm run electron:build:win.`);
  }
  if (size < MIN_EXE_BYTES) {
    fail(`${EXE} is maar ${size} bytes; dat is geen volledige build.`);
  }

  const { uploads, publicUrl } = await sitePost("/api/scoreboard-ci/upload-url", { version });
  const archive = uploads.find((item) => item.name === "archive");
  const stable = uploads.find((item) => item.name === "stable");
  if (!archive || !stable) fail("de site gaf geen upload-URL's voor archive en stable terug.");

  const bytes = readFileSync(EXE);
  const mb = Math.round(size / 1024 / 1024);

  // Eerst de versiekopie: mislukt die, dan is de downloadknop nog onaangeroerd.
  await putFile(archive, bytes);
  const archiveUrl = publicUrl.replace(/[^/]+$/, archive.path);
  const archived = await remoteSize(archiveUrl);
  if (archived !== size) {
    fail(`versiekopie ${archive.path} is ${archived ?? "onleesbaar"} bytes, verwacht ${size}.`);
  }
  console.log(`[release] versiekopie staat klaar: ${archive.path} (${mb} MB)`);

  await putFile(stable, bytes);
  console.log(`[release] ${stable.path} vervangen door ${version} (${mb} MB)`);

  // De CDN kan het oude bestand nog even teruggeven; daarom alleen waarschuwen.
  const live = await remoteSize(`${publicUrl}?v=${encodeURIComponent(version)}`);
  if (live !== size) {
    console.log(`::warning::${publicUrl} meldt ${live ?? "geen"} bytes, verwacht ${size}. Controleer de download.`);
  }
}

async function announce() {
  const builtSha = process.env.RELEASE_BUILT_SHA?.trim() || "HEAD";
  const commits = execFileSync("git", ["rev-list", "--max-count=1000", builtSha], { cwd: root, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
  const result = await sitePost("/api/scoreboard-ci/release", {
    version,
    title: process.env.RELEASE_TITLE?.trim().slice(0, 120) || null,
    notes: process.env.RELEASE_NOTES?.trim().slice(0, 1000) || null,
    commitSha: commits[0] ?? null,
    commits,
    runUrl: process.env.RELEASE_RUN_URL?.trim() || null,
  });
  console.log(`[release] ${version} aangemeld bij arenacue.be (${result.released} feature(s) uitgebracht).`);
}

const steps = { preflight, upload, announce };
const step = steps[process.argv[2]];
if (!step) fail(`gebruik: publish-release.mjs ${Object.keys(steps).join(" | ")}`);
if (token.length < 24) fail("ARENACUE_CI_TOKEN ontbreekt of is te kort.");
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`package.json version "${version}" is geen x.y.z.`);

await step();
