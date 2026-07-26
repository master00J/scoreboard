/**
 * Schrijft dist/SHA256SUMS.txt voor portable/installer-artifacts (na electron-builder).
 * Gebruik: npm run release:checksums
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");

try {
  statSync(dist);
} catch {
  console.error("[checksums] dist/ ontbreekt — voer eerst een build uit.");
  process.exit(1);
}

const lines = [];
for (const name of readdirSync(dist)) {
  if (!/\.(exe|zip|dmg|blockmap)$/i.test(name)) continue;
  const fp = join(dist, name);
  const buf = readFileSync(fp);
  const h = createHash("sha256").update(buf).digest("hex");
  lines.push(`${h}  ${name}`);
}

if (lines.length === 0) {
  console.warn("[checksums] geen .exe/.zip/.dmg/.blockmap in dist/ — niets geschreven.");
  process.exit(0);
}

const outFile = join(dist, "SHA256SUMS.txt");
writeFileSync(outFile, `${lines.sort().join("\n")}\n`, "utf8");
console.log(`[checksums] geschreven: ${outFile} (${lines.length} bestanden)`);
