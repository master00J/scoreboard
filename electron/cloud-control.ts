import { app } from "electron";
import { readStoredLicense } from "./license-service";
import { withClockTelemetry } from "../lib/clock-telemetry";
import { checkAckResponse, CloudAckError, isRetryableAckStatus, relayCloudCommands, type CloudAck } from "../lib/cloud-command-relay";

type CloudRuntime = {
  apiRequest?: (request: {
    method: string;
    path: string;
    search?: string;
    headers?: Record<string, string>;
    bodyText?: string;
  }) => Promise<{ status: number; json?: unknown; text?: string }>;
  getDisplaySnapshot: () => Promise<unknown>;
  /** Voert een cloud-commando hoogstens één keer per id uit (zie `runtime.runCloudCommand`). */
  runCloudCommand: (
    commandId: string,
    command: unknown,
  ) => Promise<{ ack: { ok: boolean; error?: string; result?: unknown }; duplicate: boolean }>;
  markCloudCommandAcked: (commandId: string) => Promise<void>;
  pruneCloudCommandLedger: () => Promise<number>;
};

type CloudAgentOptions = {
  runtime: CloudRuntime;
  log: (line: string) => void;
};

type PendingCommand = {
  id: string;
  command: unknown;
};

export type CloudAgentHandle = {
  baseUrl: string;
  venueId: string;
  customerPairCode: string;
  stop: () => void;
};

const FETCH_TIMEOUT_MS = 5000;
/** Oude uitgevoerde cloud-ids opruimen: bij de start en daarna elk uur. */
const LEDGER_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
/** Na een 401 hoogstens zo vaak de sleutel opnieuw uit het licentiebestand lezen. */
const KEY_RELOAD_MIN_INTERVAL_MS = 60 * 1000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...(init ?? {}), signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function normalizeCloudBaseUrl(rawBaseUrl: string): string {
  const normalized = rawBaseUrl.trim().replace(/\/+$/, "");
  if (/^https:\/\/(www\.)?arenacue\.com$/i.test(normalized)) {
    return "https://arenacue.be";
  }
  return normalized;
}

async function withMobileMatchData(snapshot: unknown, runtime: CloudRuntime) {
  const state = withClockTelemetry(snapshot);
  if (!runtime.apiRequest || !state || typeof state !== "object" || Array.isArray(state)) {
    return state;
  }

  const enriched = { ...state } as Record<string, unknown>;
  const matchesResponse = await runtime.apiRequest({ method: "GET", path: "/api/matches" });
  if (matchesResponse.status >= 200 && matchesResponse.status < 300 && Array.isArray(matchesResponse.json)) {
    enriched.matches = matchesResponse.json;
  }

  const matchId = typeof enriched.matchId === "string" ? enriched.matchId : null;
  if (matchId) {
    const activeMatchResponse = await runtime.apiRequest({
      method: "GET",
      path: `/api/matches/${encodeURIComponent(matchId)}`,
    });
    if (
      activeMatchResponse.status >= 200 &&
      activeMatchResponse.status < 300 &&
      activeMatchResponse.json &&
      typeof activeMatchResponse.json === "object"
    ) {
      enriched.activeMatch = activeMatchResponse.json;
    }
  }

  return enriched;
}

export function startCloudControlAgent(options: CloudAgentOptions): CloudAgentHandle | null {
  const stored = readStoredLicense(app.getPath("userData"));
  const baseUrl = (
    process.env.CONTROL_CLOUD_BASE_URL?.trim() ||
    stored?.controlCloudBaseUrl ||
    ""
  );
  const desktopKey = process.env.CONTROL_DESKTOP_KEY?.trim() || stored?.controlDesktopKey;
  const venueId = process.env.CONTROL_VENUE_ID?.trim() || stored?.controlVenueId;
  const operatorPairToken = stored?.controlOperatorPairToken ?? "";
  if (!baseUrl || !desktopKey || !venueId) {
    options.log("[cloud-control] uitgeschakeld (CONTROL_CLOUD_BASE_URL/CONTROL_DESKTOP_KEY/CONTROL_VENUE_ID ontbreekt).");
    return null;
  }
  const cloudBaseUrl = normalizeCloudBaseUrl(baseUrl);
  let cloudDesktopKey = desktopKey;
  const cloudVenueId = venueId;
  const desktopKeyFromEnv = !!process.env.CONTROL_DESKTOP_KEY?.trim();
  let lastKeyReloadAt = 0;

  /**
   * De licentiecheck kan een nieuwe sleutel uitdelen (bv. na intrekken of vernieuwen op de site).
   * Weigert de cloud de huidige, dan de sleutel uit het licentiebestand opnieuw lezen in plaats van
   * tot de volgende herstart met een ingetrokken sleutel te blijven aankloppen.
   */
  function reloadDesktopKeyAfterUnauthorized() {
    if (desktopKeyFromEnv) return;
    const now = Date.now();
    if (now - lastKeyReloadAt < KEY_RELOAD_MIN_INTERVAL_MS) return;
    lastKeyReloadAt = now;
    const fresh = readStoredLicense(app.getPath("userData"));
    if (fresh?.controlVenueId && fresh.controlVenueId !== cloudVenueId) return;
    const nextKey = fresh?.controlDesktopKey?.trim();
    if (nextKey && nextKey !== cloudDesktopKey) {
      cloudDesktopKey = nextKey;
      options.log("[cloud-control] nieuwe desktop-sleutel uit de licentie in gebruik");
    }
  }

  const customerPairCode = operatorPairToken
    ? `ACPAIR:cloud|${encodeURIComponent(cloudBaseUrl)}|${encodeURIComponent(cloudVenueId)}|${encodeURIComponent(operatorPairToken)}`
    : `ACPAIR:${encodeURIComponent(cloudBaseUrl)}|${encodeURIComponent(cloudVenueId)}`;

  let disposed = false;
  let busy = false;
  let lastStatePostErrorLogAt = 0;

  async function postState() {
    const state = await withMobileMatchData(await options.runtime.getDisplaySnapshot(), options.runtime);
    const res = await fetchWithTimeout(`${cloudBaseUrl}/api/control/desktop/state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-desktop-key": cloudDesktopKey,
      },
      body: JSON.stringify({ venueId: cloudVenueId, state }),
    });
    if (res.status === 401) reloadDesktopKeyAfterUnauthorized();
    if (!res.ok) {
      const now = Date.now();
      if (now - lastStatePostErrorLogAt > 30_000) {
        lastStatePostErrorLogAt = now;
        let detail = res.statusText;
        try {
          const body = (await res.json()) as { message?: string };
          if (body?.message) detail = body.message;
        } catch {
          /* ignore */
        }
        options.log(
          `[cloud-control] state upload mislukt (${res.status}): ${detail} — controleer CONTROL_DESKTOP_KEY + Supabase control_state op ${cloudBaseUrl}`,
        );
      }
    }
  }

  async function pullCommands(): Promise<PendingCommand[]> {
    const res = await fetchWithTimeout(
      `${cloudBaseUrl}/api/control/desktop/commands?venueId=${encodeURIComponent(cloudVenueId)}`,
      {
        headers: { "x-desktop-key": cloudDesktopKey },
      },
    );
    if (res.status === 401) reloadDesktopKeyAfterUnauthorized();
    if (!res.ok) return [];
    const payload = (await res.json()) as { commands?: PendingCommand[] };
    return Array.isArray(payload.commands) ? payload.commands : [];
  }

  async function postAck(commandId: string, ack: CloudAck) {
    const res = await fetchWithTimeout(`${cloudBaseUrl}/api/control/desktop/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-desktop-key": cloudDesktopKey,
      },
      body: JSON.stringify({
        commandId,
        ok: ack.ok,
        error: ack.error,
        result: ack.result ?? null,
      }),
    });
    if (res.status === 401) reloadDesktopKeyAfterUnauthorized();
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      if (res.ok) throw new CloudAckError(`bevestiging zonder geldig antwoord (${res.status})`, true);
      throw new CloudAckError(`bevestiging geweigerd (${res.status})`, isRetryableAckStatus(res.status));
    }
    checkAckResponse(res.status, body);
  }

  let lastPruneAt = 0;
  async function pruneLedgerIfDue() {
    const now = Date.now();
    if (now - lastPruneAt < LEDGER_PRUNE_INTERVAL_MS) return;
    lastPruneAt = now;
    try {
      const removed = await options.runtime.pruneCloudCommandLedger();
      if (removed > 0) options.log(`[cloud-control] ${removed} oude commando-ids opgeruimd`);
    } catch (err) {
      options.log(`[cloud-control] opruimen commando-ids mislukt: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function tick() {
    if (disposed || busy) return;
    busy = true;
    try {
      await pruneLedgerIfDue();
      await postState();
      const commands = await pullCommands();
      await relayCloudCommands(commands, {
        apply: (commandId, command) => options.runtime.runCloudCommand(commandId, command),
        postAck,
        markAcked: (commandId) => options.runtime.markCloudCommandAcked(commandId),
        log: options.log,
      });
    } catch (err) {
      options.log(`[cloud-control] sync fout: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busy = false;
    }
  }

  const interval = setInterval(() => {
    void tick();
  }, 1500);
  void tick();
  options.log(`[cloud-control] actief voor venue=${cloudVenueId}`);
  const safePairPreview = `${customerPairCode.slice(0, 24)}…`;
  options.log(`[cloud-control] klant-koppelcode preview: ${safePairPreview}`);

  return {
    baseUrl: cloudBaseUrl,
    venueId: cloudVenueId,
    customerPairCode,
    stop: () => {
      disposed = true;
      clearInterval(interval);
    },
  };
}
