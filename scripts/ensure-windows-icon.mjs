/**
 * Bron `arenacue-icon.png` is vaak JPEG met verkeerde extensie (ffd8…).
 * electron-builder + Windows verwachten echte PNG / meerdere maten in .ico.
 * Schrijft `public/app-icon.png` (512) en `build/icon.ico` vóór electron-builder.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const toIco = require("to-ico");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const candidates = [
  path.join(root, "Website", "public", "assets", "arenacue-icon.png"),
  path.join(root, "public", "app-icon.png"),
];

function pickSource() {
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("[icon] Geen bron gevonden (Website/public/assets/arenacue-icon.png of public/app-icon.png).");
}

async function main() {
  const src = pickSource();
  const outPng = path.join(root, "public", "app-icon.png");
  const outDir = path.join(root, "build");
  const outIco = path.join(outDir, "icon.ico");

  /**
   * Eén 256×256-PNG; to-ico mag zelf alle vereiste maten afleiden (resize: true).
   * Los zeven losse sharp-schaalstappen vermeden: sommige .ico-combinaties geven in
   * Verkenners/Eigenschappen strepen/noise, terwijl de .exe wél een geldige PE is.
   */
  const buf256 = await sharp(src)
    .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .png()
    .toBuffer();

  fs.mkdirSync(outDir, { recursive: true });
  const ico = await toIco([buf256], {
    resize: true,
    sizes: [16, 24, 32, 48, 64, 128, 256],
  });
  fs.writeFileSync(outIco, ico);

  const appIconPng = await sharp(src)
    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  fs.writeFileSync(outPng, appIconPng);

  console.log("[icon] bron:", path.relative(root, src));
  console.log("[icon] geschreven:", path.relative(root, outIco), path.relative(root, outPng));
}

await main();
