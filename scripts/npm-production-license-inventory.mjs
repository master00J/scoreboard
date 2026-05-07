/**
 * Bouwt een markdown-overzicht van npm-packages die in de productie-boom zitten
 * (dependencies + optionalDependencies, transitief), obv package-lock.json v2/v3.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string} parentPath lockfile-pad, bv. "node_modules/react-dom" of ""
 * @param {string} depName package-naam bv. "scheduler"
 * @param {Record<string, unknown>} packages packages-object uit package-lock
 */
function resolvePkgPath(parentPath, depName, packages) {
  const candidates = [];
  let cur = parentPath;
  while (true) {
    const cand = cur ? `${cur}/node_modules/${depName}` : `node_modules/${depName}`;
    candidates.push(cand);
    const idx = cur.lastIndexOf("/node_modules/");
    if (idx === -1) {
      candidates.push(`node_modules/${depName}`);
      break;
    }
    cur = cur.slice(0, idx);
  }
  for (const c of candidates) {
    if (packages[c]) return c;
  }
  return null;
}

/**
 * @param {string} pkgPath
 * @param {Record<string, unknown>} packages
 */
function collectReachable(pkgPath, packages) {
  const reachable = new Set();
  const queue = [pkgPath];

  while (queue.length) {
    const p = queue.shift();
    if (!p || reachable.has(p)) continue;
    if (!packages[p]) continue;
    reachable.add(p);
    const entry = packages[p];
    const deps = {
      ...(typeof entry.dependencies === "object" && entry.dependencies ? entry.dependencies : {}),
      ...(typeof entry.optionalDependencies === "object" && entry.optionalDependencies
        ? entry.optionalDependencies
        : {}),
    };
    for (const depName of Object.keys(deps)) {
      const child = resolvePkgPath(p, depName, packages);
      if (child && !reachable.has(child)) queue.push(child);
    }
  }
  return reachable;
}

function normalizeLicense(raw) {
  if (raw == null) return "(niet opgegeven in lockfile)";
  if (typeof raw === "string") return raw.trim() || "(niet opgegeven in lockfile)";
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === "object" && x && x.type ? String(x.type) : String(x)))
      .join(" OR ");
  }
  return String(raw);
}

/**
 * @param {{ packageJsonPath: string; lockPath: string; title?: string }} opts
 * @returns {{ markdown: string; packageCount: number }}
 */
export function buildProductionLicenseMarkdown(opts) {
  const lockRaw = fs.readFileSync(opts.lockPath, "utf8");
  const lock = JSON.parse(lockRaw);
  const packages = lock.packages;
  if (!packages || typeof packages !== "object") {
    throw new Error(`Geen packages-blok in lockfile: ${opts.lockPath}`);
  }

  const root = packages[""];
  if (!root || typeof root.dependencies !== "object") {
    throw new Error(`Lockfile mist root dependencies: ${opts.lockPath}`);
  }

  const reachable = new Set();
  for (const depName of Object.keys(root.dependencies)) {
    const start = `node_modules/${depName}`;
    if (!packages[start]) continue;
    for (const p of collectReachable(start, packages)) reachable.add(p);
  }

  /** @type {Array<{ name: string; version: string; license: string; lockPath: string }>} */
  const rows = [];
  for (const lockPath of reachable) {
    const entry = packages[lockPath];
    const name =
      typeof entry.name === "string"
        ? entry.name
        : lockPath.replace(/^node_modules\//, "").replace(/\/node_modules\//g, "/");
    const version = typeof entry.version === "string" ? entry.version : "?";
    rows.push({
      name,
      version,
      license: normalizeLicense(entry.license),
      lockPath,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name, "en"));

  const title = opts.title ?? "Third-party npm-packages (productie-boom)";
  const lines = [
    `# ${title}`,
    "",
    "Automatisch gegenereerd uit `package-lock.json` (alleen runtime-dependencies, transitief).",
    "SPDX-licentie-identifiers waar bekend; vul ontbrekende velden aan bij upgrades.",
    "",
    "| Package | Versie | Licentie |",
    "| --- | --- | --- |",
  ];
  for (const r of rows) {
    const safeLic = r.license.replace(/\|/g, "\\|");
    lines.push(`| \`${r.name}\` | ${r.version} | ${safeLic} |`);
  }
  lines.push("", `_Totaal: ${rows.length} packages._`, "");

  return { markdown: lines.join("\n"), packageCount: rows.length };
}

function parseArgs(argv) {
  let packageJsonPath = "";
  let lockPath = "";
  let outPath = "";
  let title = "";
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--package-json") packageJsonPath = argv[++i];
    else if (a === "--lock") lockPath = argv[++i];
    else if (a === "--out") outPath = argv[++i];
    else if (a === "--title") title = argv[++i];
  }
  return { packageJsonPath, lockPath, outPath, title };
}

function main() {
  const { packageJsonPath, lockPath, outPath, title } = parseArgs(process.argv);
  if (!lockPath || !outPath) {
    console.error(
      "Gebruik: node npm-production-license-inventory.mjs --lock <package-lock.json> --out <bestand.md> [--title \"...\"] [--package-json pad]",
    );
    process.exit(1);
  }
  const pj = packageJsonPath || path.join(path.dirname(lockPath), "package.json");
  if (!fs.existsSync(pj)) console.warn("[license-inventory] package.json niet gevonden:", pj);

  const { markdown } = buildProductionLicenseMarkdown({
    packageJsonPath: pj,
    lockPath,
    title: title || undefined,
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, markdown, "utf8");
  console.log("[license-inventory] geschreven:", outPath);
}

const __filename = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && path.resolve(__filename) === invokedPath) main();
