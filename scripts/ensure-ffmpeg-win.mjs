import { createWriteStream } from "node:fs";
import { access, mkdir, readdir, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const destDir = path.join(root, "vendor", "ffmpeg");
const destExe = path.join(destDir, "ffmpeg.exe");
const ZIP_URL =
  "https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip";

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function findFile(dir, name) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name) return full;
    if (entry.isDirectory()) {
      const nested = await findFile(full, name);
      if (nested) return nested;
    }
  }
  return null;
}

async function main() {
  if (await exists(destExe)) {
    console.log(`[ffmpeg] al aanwezig: ${destExe}`);
    return;
  }
  await mkdir(destDir, { recursive: true });
  const zipPath = path.join(destDir, "ffmpeg-essentials.zip");
  const extractDir = path.join(destDir, "_extract");
  console.log("[ffmpeg] download essentials build…");
  const res = await fetch(ZIP_URL, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Download mislukt (${res.status}): ${ZIP_URL}`);
  }
  await pipeline(res.body, createWriteStream(zipPath));
  await mkdir(extractDir, { recursive: true });
  await execFileAsync("tar", ["-xf", zipPath, "-C", extractDir], { windowsHide: true });
  const found = await findFile(extractDir, "ffmpeg.exe");
  if (!found) throw new Error("ffmpeg.exe niet in het zip-archief");
  await copyFile(found, destExe);
  await rm(extractDir, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  console.log(`[ffmpeg] klaar: ${destExe}`);
}

main().catch((err) => {
  console.error("[ffmpeg]", err);
  process.exit(1);
});
