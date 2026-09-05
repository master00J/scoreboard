import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAuthenticodeSigned } from "./azure-trusted-sign.mjs";

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const files = (await readdir(dist)).filter((name) => name.toLowerCase().endsWith(".exe"));
if (!files.length) {
  console.error("Geen .exe in dist/");
  process.exit(1);
}

let failed = 0;
for (const name of files) {
  const file = path.join(dist, name);
  const ok = await isAuthenticodeSigned(file);
  console.log(`${ok ? "OK   " : "FAIL "} ${name}`);
  if (!ok) failed += 1;
}
process.exit(failed ? 1 : 0);
