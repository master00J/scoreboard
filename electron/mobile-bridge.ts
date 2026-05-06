import http from "http";
import { randomBytes } from "crypto";
import type { DesktopApiRequest } from "../lib/desktop-bridge";
import { computeElapsedSeconds } from "../lib/timer";

type BridgeRuntime = {
  apiRequest: (req: DesktopApiRequest) => Promise<{
    status: number;
    contentType?: string;
    json?: unknown;
    text?: string;
  }>;
  getDisplaySnapshot: () => Promise<unknown>;
  runCommand: (command: unknown) => Promise<unknown>;
};

type MobileBridgeOptions = {
  runtime: BridgeRuntime;
  log: (line: string) => void;
};

type SessionRole = "viewer" | "operator";

export type MobileBridgeHandle = {
  port: number;
  pairingCode: string;
  operatorPin: string;
  stop: () => Promise<void>;
};

function parseJsonBody(raw: string): unknown {
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function randomPairingCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function randomOperatorPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Scoreboard-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.end(JSON.stringify(payload));
}

function withTimerTelemetry(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  const state = snapshot as {
    timerRunning?: boolean;
    timerStartedAt?: string | null;
    timerBaseSec?: number;
  };
  return {
    ...state,
    timerElapsedSec: computeElapsedSeconds({
      timerRunning: !!state.timerRunning,
      timerStartedAt: state.timerStartedAt ?? null,
      timerBaseSec: Number(state.timerBaseSec ?? 0),
    }),
    timerElapsedAtMs: Date.now(),
  };
}

export async function startMobileBridge(
  options: MobileBridgeOptions,
): Promise<MobileBridgeHandle> {
  const preferredPort = Number(process.env.MOBILE_BRIDGE_PORT ?? "17890");
  const port = Number.isFinite(preferredPort) ? preferredPort : 17890;
  const pairingCode = process.env.MOBILE_BRIDGE_PAIRING_CODE?.trim() || randomPairingCode();
  const operatorPin = process.env.MOBILE_BRIDGE_OPERATOR_PIN?.trim() || randomOperatorPin();
  const sessionTtlMs = Number(process.env.MOBILE_BRIDGE_SESSION_TTL_MS ?? 1000 * 60 * 60 * 8);

  const sessions = new Map<string, { expiresAtMs: number; role: SessionRole }>();
  const failedAttemptsByIp = new Map<string, number[]>();

  function cleanupSessions() {
    const now = Date.now();
    for (const [token, session] of sessions.entries()) {
      if (session.expiresAtMs <= now) {
        sessions.delete(token);
      }
    }
  }

  function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const windowMs = 5 * 60 * 1000;
    const maxAttempts = 8;
    const arr = failedAttemptsByIp.get(ip) ?? [];
    const recent = arr.filter((t) => now - t < windowMs);
    failedAttemptsByIp.set(ip, recent);
    return recent.length >= maxAttempts;
  }

  function registerFailedAttempt(ip: string) {
    const arr = failedAttemptsByIp.get(ip) ?? [];
    arr.push(Date.now());
    failedAttemptsByIp.set(ip, arr);
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

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        writeJson(res, 400, { error: "Bad request" });
        return;
      }

      if (req.method === "OPTIONS") {
        writeJson(res, 200, { ok: true });
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
        const bodyText = await readBody(req);
        const body = parseJsonBody(bodyText) as {
          pairingCode?: string;
          role?: SessionRole;
          operatorPin?: string;
        };
        if ((body.pairingCode ?? "").trim() !== pairingCode) {
          registerFailedAttempt(remoteIp);
          writeJson(res, 401, { ok: false, error: "Onjuiste pairing code." });
          return;
        }
        const requestedRole: SessionRole = body.role === "operator" ? "operator" : "viewer";
        if (requestedRole === "operator") {
          if (!operatorPin) {
            registerFailedAttempt(remoteIp);
            writeJson(res, 403, {
              ok: false,
              error: "Operator mode is niet geconfigureerd op desktop (MOBILE_BRIDGE_OPERATOR_PIN).",
            });
            return;
          }
          if ((body.operatorPin ?? "").trim() !== operatorPin) {
            registerFailedAttempt(remoteIp);
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
        writeJson(res, 200, withTimerTelemetry(snapshot));
        return;
      }

      if (url.pathname === "/mobile/command" && req.method === "POST") {
        if (session.role !== "operator") {
          writeJson(res, 403, { error: "Operator rechten vereist." });
          return;
        }
        const bodyText = await readBody(req);
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
        const bodyText = req.method === "GET" ? "" : await readBody(req);
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
      writeJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  options.log(
    `[mobile-bridge] actief op poort ${port} (pairing-code=${pairingCode})`,
  );
  options.log(`[mobile-bridge] operator-pin=${operatorPin}`);

  return {
    port,
    pairingCode,
    operatorPin,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
