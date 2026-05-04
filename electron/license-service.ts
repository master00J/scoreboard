/**
 * ArenaCue-licentie (desktop ↔ arenacue.be API).
 *
 * Omgeving (optioneel):
 * - ARENACUE_LICENSE_API_BASE — basis-URL zonder slash (default https://arenacue.be).
 * - ARENACUE_SKIP_LICENSE_GATE=1 — geen gate (alleen voor interne test).
 *
 * Bestanden in userData: arenacue-machine-id.txt, arenacue-license.json
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MACHINE_FILE = "arenacue-machine-id.txt";
const LICENSE_FILE = "arenacue-license.json";
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

export type StoredLicense = {
  licenseKey: string;
  /** ISO timestamp laatste geslaagde online check (activated=true). */
  lastVerifiedAt?: string;
  organizationLabel?: string | null;
};

export function skipLicenseGateFromEnv(): boolean {
  return process.env.ARENACUE_SKIP_LICENSE_GATE === "1";
}

export function getLicenseApiBase(): string {
  const raw = process.env.ARENACUE_LICENSE_API_BASE?.trim();
  const base = raw && raw.length > 0 ? raw.replace(/\/+$/, "") : "https://arenacue.be";
  return base;
}

export function getOrCreateMachineId(userDataDir: string): string {
  const p = path.join(userDataDir, MACHINE_FILE);
  try {
    const s = fs.readFileSync(p, "utf8").trim();
    if (s.length >= 8 && s.length <= 256) {
      return s;
    }
  } catch {
    /* new */
  }
  const id = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(p, id, "utf8");
  return id;
}

export function readStoredLicense(userDataDir: string): StoredLicense | null {
  const p = path.join(userDataDir, LICENSE_FILE);
  try {
    const raw = fs.readFileSync(p, "utf8");
    const j = JSON.parse(raw) as StoredLicense;
    if (typeof j.licenseKey === "string" && j.licenseKey.trim().length >= 8) {
      return { ...j, licenseKey: j.licenseKey.trim().toUpperCase() };
    }
  } catch {
    /* none */
  }
  return null;
}

export function writeStoredLicense(userDataDir: string, data: StoredLicense): void {
  const p = path.join(userDataDir, LICENSE_FILE);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

export function machinePreview(machineId: string): string {
  if (machineId.length <= 12) return "•••";
  return `${machineId.slice(0, 6)}…${machineId.slice(-4)}`;
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as unknown;
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

export async function remoteLicenseCheck(
  apiBase: string,
  licenseKey: string,
  machineId: string,
): Promise<
  | { kind: "ok"; activated: boolean; organizationLabel: string | null; validUntil: string | null }
  | { kind: "error"; message: string; reason?: string }
  | { kind: "network" }
> {
  const url = `${apiBase}/api/license/check`;
  try {
    const { ok, json } = await postJson(url, { licenseKey, machineId });
    const o = json as Record<string, unknown>;
    if (!ok) {
      return { kind: "error", message: typeof o.message === "string" ? o.message : "Serverfout." };
    }
    if (o.ok !== true) {
      return {
        kind: "error",
        message: typeof o.message === "string" ? o.message : "Licentie ongeldig.",
        reason: typeof o.reason === "string" ? o.reason : undefined,
      };
    }
    const lic = (o.license ?? {}) as Record<string, unknown>;
    const organizationLabel = typeof lic.organizationLabel === "string" ? lic.organizationLabel : null;
    const validUntil =
      lic.validUntil === null ? null : typeof lic.validUntil === "string" ? lic.validUntil : null;
    return {
      kind: "ok",
      activated: Boolean(o.activated),
      organizationLabel,
      validUntil,
    };
  } catch {
    return { kind: "network" };
  }
}

export async function remoteLicenseActivate(
  apiBase: string,
  licenseKey: string,
  machineId: string,
  deviceLabel: string,
): Promise<
  | { kind: "ok"; status: "activated" | "already_activated"; organizationLabel: string | null; validUntil: string | null }
  | { kind: "error"; message: string; reason?: string }
  | { kind: "network" }
> {
  const url = `${apiBase}/api/license/activate`;
  try {
    const { ok, json } = await postJson(url, { licenseKey, machineId, deviceLabel });
    const o = json as Record<string, unknown>;
    if (!ok) {
      return { kind: "error", message: typeof o.message === "string" ? o.message : "Serverfout." };
    }
    if (o.ok !== true) {
      return {
        kind: "error",
        message: typeof o.message === "string" ? o.message : "Activeren mislukt.",
        reason: typeof o.reason === "string" ? o.reason : undefined,
      };
    }
    const lic = (o.license ?? {}) as Record<string, unknown>;
    return {
      kind: "ok",
      status: o.status === "already_activated" ? "already_activated" : "activated",
      organizationLabel: typeof lic.organizationLabel === "string" ? lic.organizationLabel : null,
      validUntil: typeof lic.validUntil === "string" ? lic.validUntil : lic.validUntil === null ? null : null,
    };
  } catch {
    return { kind: "network" };
  }
}

export function defaultDeviceLabel(): string {
  const h = os.hostname();
  return h && h.length > 0 ? h.slice(0, 120) : "Windows-pc";
}

export function withinGrace(lastVerifiedAtIso: string | undefined): boolean {
  if (!lastVerifiedAtIso) return false;
  const t = Date.parse(lastVerifiedAtIso);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < GRACE_MS;
}
