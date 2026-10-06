import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nl from "./locales/nl.json";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import itLocale from "./locales/it.json";
import de from "./locales/de.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[full] = value;
    else Object.assign(out, flatten(value, full));
  }
  return out;
}

const locales: Record<string, Record<string, string>> = {
  nl: flatten(nl as Tree),
  en: flatten(en as Tree),
  fr: flatten(fr as Tree),
  it: flatten(itLocale as Tree),
  de: flatten(de as Tree),
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

describe("taalbestanden", () => {
  it("hebben in elke taal dezelfde sleutels", () => {
    const base = Object.keys(locales.nl);
    for (const code of ["en", "fr", "it", "de"]) {
      const keys = new Set(Object.keys(locales[code]));
      const missing = base.filter((key) => !keys.has(key));
      const extra = [...keys].filter((key) => !(key in locales.nl));
      expect({ code, missing, extra }).toEqual({ code, missing: [], extra: [] });
    }
  });

  // Een sleutel die de code gebruikt maar die in geen taalbestand staat, verschijnt letterlijk in beeld.
  it("bevatten elke sleutel die de code letterlijk aan t() geeft", () => {
    const root = process.cwd();
    const files = ["app", "components", "lib", "renderer", "electron"].flatMap((dir) => sourceFiles(path.join(root, dir)));
    const call = /\bt\(\s*["']([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)["']/g;
    const missing = new Set<string>();
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(call)) {
        const key = match[1];
        // i18next-meervoud: de code vraagt `x`, het bestand heeft `x_one` / `x_other`.
        if (!(key in locales.nl) && !(`${key}_one` in locales.nl) && !(`${key}_other` in locales.nl)) {
          missing.add(`${key} (${path.relative(root, file).replace(/\\/g, "/")})`);
        }
      }
    }
    expect([...missing]).toEqual([]);
  });
});
