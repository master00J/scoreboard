import fs from "fs";
import path from "path";

function flatten(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...flatten(v, key));
    else out.push(key);
  }
  return out.sort();
}

const root = path.resolve("lib/i18n/locales");
const nl = flatten(JSON.parse(fs.readFileSync(path.join(root, "nl.json"), "utf8")));
const en = flatten(JSON.parse(fs.readFileSync(path.join(root, "en.json"), "utf8")));
const fr = flatten(JSON.parse(fs.readFileSync(path.join(root, "fr.json"), "utf8")));
const it = flatten(JSON.parse(fs.readFileSync(path.join(root, "it.json"), "utf8")));

const onlyNl = nl.filter((k) => !en.includes(k) || !fr.includes(k) || !it.includes(k));
const onlyEn = en.filter((k) => !nl.includes(k));
const onlyFr = fr.filter((k) => !nl.includes(k));
const onlyIt = it.filter((k) => !nl.includes(k));

console.log(JSON.stringify({
  counts: { nl: nl.length, en: en.length, fr: fr.length, it: it.length },
  setupKeys: nl.filter((k) => k.startsWith("setup.")).length,
  parityOk: onlyNl.length === 0 && onlyEn.length === 0 && onlyFr.length === 0 && onlyIt.length === 0,
  onlyNl,
  onlyEn,
  onlyFr,
  onlyIt,
}, null, 2));

if (onlyNl.length || onlyEn.length || onlyFr.length || onlyIt.length) process.exit(1);
