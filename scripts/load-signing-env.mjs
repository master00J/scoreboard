import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Laadt `.env.signing` in process.env zonder bestaande vars te overschrijven. */
export function loadSigningEnv() {
  const file = path.join(root, ".env.signing");
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

export function azureSigningConfig() {
  loadSigningEnv();
  return {
    tenantId: process.env.AZURE_TENANT_ID?.trim() || "",
    clientId: process.env.AZURE_CLIENT_ID?.trim() || "",
    clientSecret: process.env.AZURE_CLIENT_SECRET?.trim() || "",
    endpoint: process.env.AZURE_SIGNING_ENDPOINT?.trim() || "https://neu.codesigning.azure.net/",
    account: process.env.AZURE_SIGNING_ACCOUNT?.trim() || "arenacue-signing-be",
    profile: process.env.AZURE_SIGNING_PROFILE?.trim() || "ArenaCuePublic",
    publisherName: process.env.AZURE_SIGNING_PUBLISHER_NAME?.trim() || "",
  };
}

export function azureSigningReady() {
  const c = azureSigningConfig();
  return Boolean(c.tenantId && c.clientId && c.clientSecret && c.endpoint && c.account && c.profile);
}
