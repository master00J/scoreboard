/**
 * Schrijft legal-dist/ voor electron-builder extraResources:
 * - THIRD_PARTY_NPM.md (productie npm-boom)
 * - OPEN_SOURCE_NOTICES.txt (MIT Electron/Node + verwijzing Chromium)
 * - LICENSES.chromium.html (uit electron npm-pakket, indien aanwezig)
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProductionLicenseMarkdown } from "./npm-production-license-inventory.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "legal-dist");

const MIT_LICENSE_TEXT = `MIT License

Copyright (c) Electron contributors
Copyright (c) OpenJS Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

function copyChromiumLicensesHtml() {
  let chromiumSrc = "";
  try {
    const require = createRequire(import.meta.url);
    const electronMain = require.resolve("electron");
    const electronRoot = path.join(path.dirname(electronMain), "..");
    const cand = path.join(electronRoot, "dist", "LICENSES.chromium.html");
    if (fs.existsSync(cand)) chromiumSrc = cand;
  } catch {
    /* electron niet geïnstalleerd */
  }
  const dest = path.join(outDir, "LICENSES.chromium.html");
  if (chromiumSrc) {
    fs.copyFileSync(chromiumSrc, dest);
    console.log("[legal-bundle] LICENSES.chromium.html gekopieerd");
    return true;
  }
  const stub = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Chromium-licenties</title></head><body>
<h1>LICENSES.chromium.html niet gevonden</h1>
<p>Voer <code>npm install</code> uit zodat het <code>electron</code>-pakket de Chromium-licenties downloadt, en bouw daarna opnieuw.</p>
<p>Zie ook: <a href="https://electronjs.org/">electronjs.org</a> — Electron bundelt Chromium; volledige upstream-notices horen bij een release-build.</p>
</body></html>`;
  fs.writeFileSync(dest, stub, "utf8");
  console.warn("[legal-bundle] Chromium-licenties ontbreken — stub geschreven (npm install electron)");
  return false;
}

function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const lockPath = path.join(root, "package-lock.json");
  const { markdown } = buildProductionLicenseMarkdown({
    lockPath,
    title: "ArenaCue desktop — third-party npm-packages (productie)",
  });
  fs.writeFileSync(path.join(outDir, "THIRD_PARTY_NPM.md"), markdown, "utf8");
  console.log("[legal-bundle] THIRD_PARTY_NPM.md geschreven");

  const notices = [
    "OPEN SOURCE / THIRD-PARTY NOTICES — Stadium Scoreboard / ArenaCue desktop (Electron)",
    "",
    "Deze applicatie bevat open-source software en componenten met eigen licenties.",
    "",
    "=== Electron / runtime ===",
    "Electron wordt uitgebracht onder de MIT License (zie onder).",
    "Node.js (ingebouwd in Electron) wordt eveneens onder permissieve voorwaarden beschikbaar gesteld;",
    "_volledige upstream-vermeldingen staan in LICENSES.chromium.html (Chromium en afgeleiden)._",
    "",
    MIT_LICENSE_TEXT,
    "",
    "=== Bundled npm-packages ===",
    "Zie THIRD_PARTY_NPM.md voor een inventaris van npm-dependencies (productie-boom) uit package-lock.json.",
    "",
    "=== Chromium / embedded browsers ===",
    "Zie LICENSES.chromium.html voor gecombineerde licenties van Chromium en gerelateerde componenten.",
    "",
    "=== Database ===",
    "SQLite wordt veelal als publiek domein beschouwd; Prisma Client staat vermeld in THIRD_PARTY_NPM.md waar van toepassing.",
    "",
    "=== Disclaimer ===",
    "Dit document is bedoeld als praktische licentie-attributie voor distributie.",
    "Het vervangt geen juridisch advies.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "OPEN_SOURCE_NOTICES.txt"), notices, "utf8");

  copyChromiumLicensesHtml();

  fs.writeFileSync(
    path.join(outDir, "README.txt"),
    [
      "Licenties en open-source vermeldingen (ArenaCue desktop)",
      "",
      "OPEN_SOURCE_NOTICES.txt — samenvatting + MIT Electron",
      "LICENSES.chromium.html — Chromium / upstream componenten",
      "THIRD_PARTY_NPM.md — npm-packages (productie)",
      "",
      "Open deze map via Help → Licenties en open source in de applicatie.",
      "",
    ].join("\r\n"),
    "utf8",
  );

  console.log("[legal-bundle] klaar:", outDir);
}

main();
