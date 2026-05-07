/**
 * Schrijft public/legal/third-party-npm.md voor de Next-site (productie npm-boom).
 * Zelfstandig (geen import uit monorepo-root), zodat deze repo apart gekloond kan worden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function buildProductionLicenseMarkdown(opts) {
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

  const rows = [];
  for (const lockPathKey of reachable) {
    const entry = packages[lockPathKey];
    const name =
      typeof entry.name === "string"
        ? entry.name
        : lockPathKey.replace(/^node_modules\//, "").replace(/\/node_modules\//g, "/");
    const version = typeof entry.version === "string" ? entry.version : "?";
    rows.push({
      name,
      version,
      license: normalizeLicense(entry.license),
      lockPath: lockPathKey,
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.join(__dirname, "..");
const lockPath = path.join(websiteRoot, "package-lock.json");
const outPath = path.join(websiteRoot, "public", "legal", "third-party-npm.md");

const { markdown } = buildProductionLicenseMarkdown({
  lockPath,
  title: "arenacue.be — third-party npm-packages (productie)",
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, markdown, "utf8");
console.log("[website-legal] geschreven:", outPath);
