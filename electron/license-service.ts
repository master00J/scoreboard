/**
 * ArenaCue-licentie (desktop ↔ arenacue.be API).
 *
 * Omgeving (optioneel):
 * - ARENACUE_LICENSE_API_BASE — basis-URL zonder slash (default https://arenacue.be).
 * - ARENACUE_SKIP_LICENSE_GATE=1 — geen gate (alleen voor interne test).
 *
 * Bestanden in userData: zie ARENACUE_MACHINE_ID_FILENAME / ARENACUE_LICENSE_FILENAME.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeStorage } from "electron";

/** Onder userData; geëxporteerd voor portable-migratie in `main.ts`. */
export const ARENACUE_MACHINE_ID_FILENAME = "arenacue-machine-id.txt";
export const ARENACUE_LICENSE_FILENAME = "arenacue-license.json";
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

export type StoredLicense = {
  licenseKey: string;
  /** ISO timestamp laatste geslaagde online check (activated=true). */
  lastVerifiedAt?: string;
  organizationLabel?: string | null;
  /** Genormaliseerde plan-code (trial | standard | club | enterprise). */
  plan?: string;
  planLabel?: string;
  /** Snapshot van server-featurevlaggen bij laatste geslaagde check. */
  features?: Record<string, boolean>;
  /** Auto-provisioned cloud-control config (licentie-activate/check). */
  controlCloudBaseUrl?: string;
  controlDesktopKey?: string;
  controlVenueId?: string;
  controlOperatorPairToken?: string;
};

type StoredLicenseFileV2 = {
  version: 2;
  encrypted: string;
};

function isV2File(value: unknown): value is StoredLicenseFileV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return rec.version === 2 && typeof rec.encrypted === "string" && rec.encrypted.length > 0;
}

function decryptStoredLicense(raw: string): StoredLicense | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isV2File(parsed)) {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const encBytes = Buffer.from(parsed.encrypted, "base64");
      const json = safeStorage.decryptString(encBytes);
      const lic = JSON.parse(json) as StoredLicense;
      if (typeof lic.licenseKey === "string" && lic.licenseKey.trim().length >= 8) {
        return { ...lic, licenseKey: lic.licenseKey.trim().toUpperCase() };
      }
      return null;
    }

    const j = parsed as StoredLicense;
    if (typeof j.licenseKey === "string" && j.licenseKey.trim().length >= 8) {
      return { ...j, licenseKey: j.licenseKey.trim().toUpperCase() };
    }
  } catch {
    /* invalid */
  }
  return null;
}

function serializeStoredLicense(data: StoredLicense): string {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(JSON.stringify(data)).toString("base64");
    const payload: StoredLicenseFileV2 = { version: 2, encrypted };
    return JSON.stringify(payload, null, 2);
  }
  return JSON.stringify(data, null, 2);
}

export function skipLicenseGateFromEnv(): boolean {
  return process.env.ARENACUE_SKIP_LICENSE_GATE === "1";
}

export function getLicenseApiBase(): string {
  const raw = process.env.ARENACUE_LICENSE_API_BASE?.trim();
  const base = raw && raw.length > 0 ? raw.replace(/\/+$/, "") : "https://arenacue.be";
  return base;
}

export function getOrCreateMachineId(userDataDir: string): string {
  const p = path.join(userDataDir, ARENACUE_MACHINE_ID_FILENAME);
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
  const p = path.join(userDataDir, ARENACUE_LICENSE_FILENAME);
  try {
    const raw = fs.readFileSync(p, "utf8");
    return decryptStoredLicense(raw);
  } catch {
    /* none */
  }
  return null;
}

export function writeStoredLicense(userDataDir: string, data: StoredLicense): void {
  const p = path.join(userDataDir, ARENACUE_LICENSE_FILENAME);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(p, serializeStoredLicense(data), "utf8");
}

export function machinePreview(machineId: string): string {
  if (machineId.length <= 12) return "•••";
  return `${machineId.slice(0, 6)}…${machineId.slice(-4)}`;
}

function parseLicenseFeaturesJson(v: unknown): Record<string, boolean> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const rec = v as Record<string, unknown>;
  const out: Record<string, boolean> = {};
  for (const [key, val] of Object.entries(rec)) {
    if (typeof val === "boolean") out[key] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parsePublicLicenseBundle(lic: Record<string, unknown>): {
  organizationLabel: string | null;
  validUntil: string | null;
  plan?: string;
  planLabel?: string;
  features?: Record<string, boolean>;
} {
  const organizationLabel = typeof lic.organizationLabel === "string" ? lic.organizationLabel : null;
  const validUntil =
    lic.validUntil === null ? null : typeof lic.validUntil === "string" ? lic.validUntil : null;
  const plan = typeof lic.plan === "string" ? lic.plan : undefined;
  const planLabel = typeof lic.planLabel === "string" ? lic.planLabel : undefined;
  const features = parseLicenseFeaturesJson(lic.features);
  return { organizationLabel, validUntil, plan, planLabel, features };
}

function parseControlBundle(v: unknown): {
  controlCloudBaseUrl?: string;
  controlDesktopKey?: string;
  controlVenueId?: string;
  controlOperatorPairToken?: string;
} {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const rec = v as Record<string, unknown>;
  const cloudBaseUrl = typeof rec.cloudBaseUrl === "string" ? rec.cloudBaseUrl.trim() : "";
  const normalizedCloudBaseUrl = /^https:\/\/(www\.)?arenacue\.com\/?$/i.test(cloudBaseUrl)
    ? "https://arenacue.be"
    : cloudBaseUrl.replace(/\/+$/, "");
  const desktopKey = typeof rec.desktopKey === "string" ? rec.desktopKey.trim() : "";
  const venueId = typeof rec.venueId === "string" ? rec.venueId.trim() : "";
  const operatorPairToken = typeof rec.operatorPairToken === "string" ? rec.operatorPairToken.trim() : "";
  return {
    ...(normalizedCloudBaseUrl ? { controlCloudBaseUrl: normalizedCloudBaseUrl } : {}),
    ...(desktopKey ? { controlDesktopKey: desktopKey } : {}),
    ...(venueId ? { controlVenueId: venueId } : {}),
    ...(operatorPairToken ? { controlOperatorPairToken: operatorPairToken } : {}),
  };
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
  | {
      kind: "ok";
      activated: boolean;
      organizationLabel: string | null;
      validUntil: string | null;
      plan?: string;
      planLabel?: string;
      features?: Record<string, boolean>;
      controlCloudBaseUrl?: string;
      controlDesktopKey?: string;
      controlVenueId?: string;
      controlOperatorPairToken?: string;
    }
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
    const snap = parsePublicLicenseBundle(lic);
    return {
      kind: "ok",
      activated: Boolean(o.activated),
      organizationLabel: snap.organizationLabel,
      validUntil: snap.validUntil,
      ...(snap.plan !== undefined ? { plan: snap.plan } : {}),
      ...(snap.planLabel !== undefined ? { planLabel: snap.planLabel } : {}),
      ...(snap.features !== undefined ? { features: snap.features } : {}),
      ...parseControlBundle(o.control),
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
  | {
      kind: "ok";
      status: "activated" | "already_activated";
      organizationLabel: string | null;
      validUntil: string | null;
      plan?: string;
      planLabel?: string;
      features?: Record<string, boolean>;
      controlCloudBaseUrl?: string;
      controlDesktopKey?: string;
      controlVenueId?: string;
      controlOperatorPairToken?: string;
    }
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
    const snap = parsePublicLicenseBundle(lic);
    return {
      kind: "ok",
      status: o.status === "already_activated" ? "already_activated" : "activated",
      organizationLabel: snap.organizationLabel,
      validUntil: snap.validUntil,
      ...(snap.plan !== undefined ? { plan: snap.plan } : {}),
      ...(snap.planLabel !== undefined ? { planLabel: snap.planLabel } : {}),
      ...(snap.features !== undefined ? { features: snap.features } : {}),
      ...parseControlBundle(o.control),
    };
  } catch {
    return { kind: "network" };
  }
}

export function defaultDeviceLabel(): string {
  const h = os.hostname();
  return h && h.length > 0 ? h.slice(0, 120) : "Desktop";
}

export function withinGrace(lastVerifiedAtIso: string | undefined): boolean {
  if (!lastVerifiedAtIso) return false;
  const t = Date.parse(lastVerifiedAtIso);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < GRACE_MS;
}
