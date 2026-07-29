import { app } from "electron";
import { readStoredLicense } from "./license-service";
import { computeElapsedSeconds, computeShotClockSeconds } from "../lib/timer";

type CloudRuntime = {
  apiRequest?: (request: {
    method: string;
    path: string;
    search?: string;
    headers?: Record<string, string>;
    bodyText?: string;
  }) => Promise<{ status: number; json?: unknown; text?: string }>;
  getDisplaySnapshot: () => Promise<unknown>;
  runCommand: (command: unknown) => Promise<unknown>;
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

function withTimerTelemetry(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  const state = snapshot as {
    timerRunning?: boolean;
    timerStartedAt?: string | null;
    timerBaseSec?: number;
    shotClockRunning?: boolean;
    shotClockStartedAt?: string | null;
    shotClockBaseSec?: number;
  };
  return {
    ...state,
    timerElapsedSec: computeElapsedSeconds({
      timerRunning: !!state.timerRunning,
      timerStartedAt: state.timerStartedAt ?? null,
      timerBaseSec: Number(state.timerBaseSec ?? 0),
    }),
    shotClockRemainingSec: computeShotClockSeconds({
      shotClockRunning: !!state.shotClockRunning,
      shotClockStartedAt: state.shotClockStartedAt ?? null,
      shotClockBaseSec: Number(state.shotClockBaseSec ?? 0),
    }),
    timerElapsedAtMs: Date.now(),
  };
}

async function withMobileMatchData(snapshot: unknown, runtime: CloudRuntime) {
  const state = withTimerTelemetry(snapshot);
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
  const cloudDesktopKey = desktopKey;
  const cloudVenueId = venueId;

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
    if (!res.ok) return [];
    const payload = (await res.json()) as { commands?: PendingCommand[] };
    return Array.isArray(payload.commands) ? payload.commands : [];
  }

  async function ackCommand(commandId: string, result: { ok: boolean; error?: string; result?: unknown }) {
    await fetchWithTimeout(`${cloudBaseUrl}/api/control/desktop/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-desktop-key": cloudDesktopKey,
      },
      body: JSON.stringify({
        commandId,
        ok: result.ok,
        error: result.error,
        result: result.result ?? null,
      }),
    });
  }

  async function tick() {
    if (disposed || busy) return;
    busy = true;
    try {
      await postState();
      const commands = await pullCommands();
      for (const item of commands) {
        try {
          const runResult = (await options.runtime.runCommand(item.command)) as {
            ok?: boolean;
            error?: string;
            result?: unknown;
          };
          await ackCommand(item.id, {
            ok: !!runResult?.ok,
            error: runResult?.error,
            result: runResult?.result,
          });
        } catch (err) {
          await ackCommand(item.id, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
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
