import http from "http";
import fs from "fs";
import { randomBytes, randomInt, timingSafeEqual } from "crypto";
import type { DesktopApiRequest } from "../lib/desktop-bridge";
import { withClockTelemetry } from "../lib/clock-telemetry";

type BridgeRuntime = {
  apiRequest: (req: DesktopApiRequest) => Promise<{
    status: number;
    contentType?: string;
    json?: unknown;
    text?: string;
  }>;
  getDisplaySnapshot: () => Promise<unknown>;
  /** Optioneel: sponsor-ledger voor timing-tests (mobile snapshot). */
  getSponsorLedgerSnapshot?: () => unknown;
  runCommand: (command: unknown) => Promise<unknown>;
};

type MobileBridgeOptions = {
  runtime: BridgeRuntime;
  log: (line: string) => void;
  /** Blijft dezelfde pairing/PIN na een desktop-herstart, zodat de telefoon automatisch kan herkoppelen. */
  credentialsPath?: string;
  /**
   * Adres waarop de bridge luistert (één netwerkkaart, of `0.0.0.0` voor alle netwerken).
   * `MOBILE_BRIDGE_BIND` gaat voor; zonder beide: alle netwerken.
   */
  bindHost?: string;
};

type SessionRole = "viewer" | "operator";

export type MobileBridgeHandle = {
  port: number;
  pairingCode: string;
  operatorPin: string;
  /** Adres waarop de bridge nu luistert. */
  readonly bindHost: string;
  /** `MOBILE_BRIDGE_BIND` is gezet: de keuze in het menu doet dan niets. */
  bindFixedByEnv: boolean;
  /** Luistert voortaan op een ander adres; lopende sessies blijven geldig. */
  rebind: (host: string) => Promise<void>;
  stop: () => Promise<void>;
};

/** Auth/commando-body: klein. API-proxy (media-metadata, opstellingen): ruimer, maar begrensd. */
const MAX_BODY_BYTES_SMALL = 64 * 1024;
const MAX_BODY_BYTES_API = 8 * 1024 * 1024;

class BodyTooLargeError extends Error {
  constructor() {
    super("Request body te groot.");
    this.name = "BodyTooLargeError";
  }
}

function parseJsonBody(raw: string): unknown {
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

/** Cryptografisch veilige 6-cijferige code (Math.random is voorspelbaar). */
function randomPairingCode(): string {
  return String(randomInt(100000, 1000000));
}

/** Minimaal 6 cijfers (operator); pairing blijft 6 cijfers. */
function randomOperatorPin(): string {
  return String(randomInt(100000, 1000000));
}

/** Vergelijking in constante tijd zodat de responstijd niets verraadt over het aantal juiste tekens. */
function secretsEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Toch een vergelijking uitvoeren zodat lengteverschil geen snellere afwijzing oplevert.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function normalizeOperatorPinFromEnv(raw: string | undefined, log: (line: string) => void): string {
  const t = raw?.trim() ?? "";
  if (/^\d{6,12}$/.test(t)) return t;
  if (t.length > 0) {
    log(`[mobile-bridge] MOBILE_BRIDGE_OPERATOR_PIN genegeerd (verwacht 6–12 cijfers); willekeurige PIN gegenereerd.`);
  }
  return randomOperatorPin();
}

function readPersistedCredentials(filePath: string | undefined): { pairingCode?: string; operatorPin?: string } {
  if (!filePath) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      pairingCode?: unknown;
      operatorPin?: unknown;
    };
    const pairingCode = typeof parsed.pairingCode === "string" && /^\d{6,12}$/.test(parsed.pairingCode)
      ? parsed.pairingCode
      : undefined;
    const operatorPin = typeof parsed.operatorPin === "string" && /^\d{6,12}$/.test(parsed.operatorPin)
      ? parsed.operatorPin
      : undefined;
    return { pairingCode, operatorPin };
  } catch {
    return {};
  }
}

function writePersistedCredentials(
  filePath: string | undefined,
  pairingCode: string,
  operatorPin: string,
  log: (line: string) => void,
) {
  if (!filePath) return;
  try {
    fs.writeFileSync(filePath, JSON.stringify({ pairingCode, operatorPin }, null, 2), { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    log(`[mobile-bridge] kon pairinggegevens niet bewaren: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseBindHost(raw: string | undefined, log: (line: string) => void): string {
  const t = (raw ?? "0.0.0.0").trim();
  if (t === "0.0.0.0" || t === "127.0.0.1" || t === "localhost") {
    return t === "localhost" ? "127.0.0.1" : t;
  }
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(t)) return t;
  log(`[mobile-bridge] MOBILE_BRIDGE_BIND ongeldig (${t}), val terug op 0.0.0.0`);
  return "0.0.0.0";
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function writeJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function withActiveMatch(snapshot: unknown, runtime: BridgeRuntime) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  const state = snapshot as { matchId?: unknown; activeMatch?: unknown };
  const matchId = typeof state.matchId === "string" && state.matchId.trim() ? state.matchId : null;
  if (!matchId) return snapshot;
  try {
    const response = await runtime.apiRequest({
      method: "GET",
      path: `/api/matches/${encodeURIComponent(matchId)}`,
    });
    if (
      response.status >= 200 &&
      response.status < 300 &&
      response.json &&
      typeof response.json === "object" &&
      !Array.isArray(response.json)
    ) {
      return { ...state, activeMatch: response.json };
    }
  } catch {
    /* live klok/score blijven beschikbaar */
  }
  return snapshot;
}

export async function startMobileBridge(
  options: MobileBridgeOptions,
): Promise<MobileBridgeHandle> {
  const preferredPort = Number(process.env.MOBILE_BRIDGE_PORT ?? "17890");
  const port = Number.isFinite(preferredPort) ? preferredPort : 17890;
  const persisted = readPersistedCredentials(options.credentialsPath);
  const pairingCode = process.env.MOBILE_BRIDGE_PAIRING_CODE?.trim() || persisted.pairingCode || randomPairingCode();
  const operatorPin = process.env.MOBILE_BRIDGE_OPERATOR_PIN?.trim()
    ? normalizeOperatorPinFromEnv(process.env.MOBILE_BRIDGE_OPERATOR_PIN, options.log)
    : persisted.operatorPin || randomOperatorPin();
  writePersistedCredentials(options.credentialsPath, pairingCode, operatorPin, options.log);
  const bindFixedByEnv = Boolean(process.env.MOBILE_BRIDGE_BIND?.trim());
  let bindHost = parseBindHost(
    bindFixedByEnv ? process.env.MOBILE_BRIDGE_BIND : (options.bindHost ?? "0.0.0.0"),
    options.log,
  );
  const sessionTtlMs = Number(process.env.MOBILE_BRIDGE_SESSION_TTL_MS ?? 1000 * 60 * 60 * 8);

  const sessions = new Map<string, { expiresAtMs: number; role: SessionRole }>();
  const failedAttemptsByIp = new Map<string, number[]>();
  const failedOperatorPinByIp = new Map<string, number[]>();
  const PAIRING_WINDOW_MS = 5 * 60 * 1000;
  const OPERATOR_PIN_WINDOW_MS = 15 * 60 * 1000;

  function cleanupSessions() {
    const now = Date.now();
    for (const [token, session] of sessions.entries()) {
      if (session.expiresAtMs <= now) {
        sessions.delete(token);
      }
    }
    // IP-tellers buiten hun venster opruimen zodat de maps niet onbeperkt groeien.
    for (const [ip, arr] of failedAttemptsByIp.entries()) {
      const recent = arr.filter((t) => now - t < PAIRING_WINDOW_MS);
      if (recent.length === 0) failedAttemptsByIp.delete(ip);
      else failedAttemptsByIp.set(ip, recent);
    }
    for (const [ip, arr] of failedOperatorPinByIp.entries()) {
      const recent = arr.filter((t) => now - t < OPERATOR_PIN_WINDOW_MS);
      if (recent.length === 0) failedOperatorPinByIp.delete(ip);
      else failedOperatorPinByIp.set(ip, recent);
    }
  }

  function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const maxAttempts = 8;
    const arr = failedAttemptsByIp.get(ip) ?? [];
    const recent = arr.filter((t) => now - t < PAIRING_WINDOW_MS);
    failedAttemptsByIp.set(ip, recent);
    return recent.length >= maxAttempts;
  }

  function registerFailedAttempt(ip: string) {
    const arr = failedAttemptsByIp.get(ip) ?? [];
    arr.push(Date.now());
    failedAttemptsByIp.set(ip, arr);
  }

  function registerOperatorPinFailedAttempt(ip: string) {
    const arr = failedOperatorPinByIp.get(ip) ?? [];
    arr.push(Date.now());
    failedOperatorPinByIp.set(ip, arr);
  }

  /** Strengere lockout na herhaald foute operator-PIN (pairing was wél correct). */
  function isOperatorPinLocked(ip: string): boolean {
    const now = Date.now();
    const maxAttempts = 5;
    const arr = failedOperatorPinByIp.get(ip) ?? [];
    const recent = arr.filter((t) => now - t < OPERATOR_PIN_WINDOW_MS);
    failedOperatorPinByIp.set(ip, recent);
    return recent.length >= maxAttempts;
  }

  function issueSessionToken(role: SessionRole) {
    const token = randomBytes(24).toString("hex");
    const expiresAtMs = Date.now() + sessionTtlMs;
    sessions.set(token, { expiresAtMs, role });
    return { token, expiresAtMs };
  }

  function readAuthBearer(req: http.IncomingMessage): string | null {
    const auth = (req.headers.authorization as string | undefined) ?? "";
    if (!auth.toLowerCase().startsWith("bearer ")) return null;
    return auth.slice(7).trim() || null;
  }

  function getSession(req: http.IncomingMessage): { expiresAtMs: number; role: SessionRole } | null {
    cleanupSessions();
    const bearer = readAuthBearer(req);
    if (!bearer) return null;
    const session = sessions.get(bearer);
    if (!session) return null;
    if (session.expiresAtMs <= Date.now()) {
      sessions.delete(bearer);
      return null;
    }
    return session;
  }

  const handleRequest: http.RequestListener = async (req, res) => {
    try {
      if (!req.url || !req.method) {
        writeJson(res, 400, { error: "Bad request" });
        return;
      }

      const url = new URL(req.url, "http://localhost");
      const remoteIp = (req.socket.remoteAddress ?? "unknown").trim();

      if (url.pathname === "/mobile/health" && req.method === "GET") {
        writeJson(res, 200, {
          ok: true,
          service: "scoreboard-mobile-bridge",
          auth: "pairing-code + short-lived session",
        });
        return;
      }

      if (url.pathname === "/mobile/auth/session" && req.method === "POST") {
        if (isRateLimited(remoteIp)) {
          writeJson(res, 429, { ok: false, error: "Te veel foute pogingen, probeer later opnieuw." });
          return;
        }
        const bodyText = await readBody(req, MAX_BODY_BYTES_SMALL);
        const body = parseJsonBody(bodyText) as {
          pairingCode?: string;
          role?: SessionRole;
          operatorPin?: string;
        };
        if (!secretsEqual((body.pairingCode ?? "").trim(), pairingCode)) {
          registerFailedAttempt(remoteIp);
          writeJson(res, 401, { ok: false, error: "Onjuiste pairing code." });
          return;
        }
        const requestedRole: SessionRole = body.role === "operator" ? "operator" : "viewer";
        if (requestedRole === "operator") {
          if (isOperatorPinLocked(remoteIp)) {
            writeJson(res, 429, {
              ok: false,
              error: "Te veel foute operator-PIN-pogingen. Probeer over ca. 15 minuten opnieuw of herstart de desktop-app.",
            });
            return;
          }
          if (!secretsEqual((body.operatorPin ?? "").trim(), operatorPin)) {
            registerOperatorPinFailedAttempt(remoteIp);
            writeJson(res, 401, { ok: false, error: "Onjuiste operator PIN." });
            return;
          }
        }
        const session = issueSessionToken(requestedRole);
        writeJson(res, 200, {
          ok: true,
          sessionToken: session.token,
          expiresAt: new Date(session.expiresAtMs).toISOString(),
          role: requestedRole,
        });
        return;
      }

      const session = getSession(req);
      if (!session) {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }

      if (url.pathname === "/mobile/snapshot" && req.method === "GET") {
        const snapshot = await options.runtime.getDisplaySnapshot();
        const ledger = options.runtime.getSponsorLedgerSnapshot?.() ?? null;
        writeJson(
          res,
          200,
          await withActiveMatch(
            withClockTelemetry(
              snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
                ? { ...snapshot, sponsorLedger: ledger }
                : snapshot,
            ),
            options.runtime,
          ),
        );
        return;
      }

      if (url.pathname === "/mobile/command" && req.method === "POST") {
        if (session.role !== "operator") {
          writeJson(res, 403, { error: "Operator rechten vereist." });
          return;
        }
        const bodyText = await readBody(req, MAX_BODY_BYTES_SMALL);
        const body = parseJsonBody(bodyText) as { command?: unknown };
        const result = await options.runtime.runCommand(body.command);
        writeJson(res, 200, result);
        return;
      }

      if (url.pathname.startsWith("/mobile/api/")) {
        if (req.method !== "GET" && session.role !== "operator") {
          writeJson(res, 403, { error: "Operator rechten vereist voor mutaties." });
          return;
        }
        const bodyText = req.method === "GET" ? "" : await readBody(req, MAX_BODY_BYTES_API);
        const desktopPath = url.pathname.replace("/mobile", "");
        const response = await options.runtime.apiRequest({
          method: req.method,
          path: desktopPath,
          search: url.search || "",
          bodyText,
        });
        const payload = response.json ?? response.text ?? null;
        writeJson(res, response.status, payload);
        return;
      }

      writeJson(res, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        if (!res.headersSent) writeJson(res, 413, { error: error.message });
        return;
      }
      if (!res.headersSent) {
        writeJson(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  function listen(host: string): Promise<http.Server> {
    const server = http.createServer(handleRequest);
    return new Promise<http.Server>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve(server);
      });
    });
  }

  /** Stopt met luisteren; lopende verzoeken krijgen nog even de tijd. */
  function close(target: http.Server): Promise<void> {
    return new Promise<void>((resolve) => {
      const force = setTimeout(() => target.closeAllConnections(), 2000);
      target.close(() => {
        clearTimeout(force);
        resolve();
      });
      target.closeIdleConnections();
    });
  }

  let server = await listen(bindHost);
  let rebinding: Promise<void> = Promise.resolve();

  options.log(`[mobile-bridge] actief op ${bindHost}:${port}`);
  options.log("[mobile-bridge] pairing actief (code/pin afgeschermd)");

  return {
    port,
    pairingCode,
    operatorPin,
    get bindHost() {
      return bindHost;
    },
    bindFixedByEnv,
    rebind: (host: string) => {
      const task = rebinding.catch(() => {}).then(async () => {
        const next = parseBindHost(host, options.log);
        if (bindFixedByEnv || next === bindHost) return;
        const previous = bindHost;
        // Dezelfde poort kan niet tegelijk op beide adressen open zijn als het oude 0.0.0.0 is.
        await close(server);
        try {
          server = await listen(next);
          bindHost = next;
          options.log(`[mobile-bridge] luistert nu op ${next}:${port}`);
        } catch (error) {
          server = await listen(previous);
          options.log(
            `[mobile-bridge] kon niet luisteren op ${next}:${port}, blijft op ${previous}: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw error;
        }
      });
      rebinding = task;
      return task;
    },
    stop: () => rebinding.catch(() => {}).then(() => close(server)),
  };
}
