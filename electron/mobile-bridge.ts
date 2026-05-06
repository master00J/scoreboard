import http from "http";
import { randomBytes } from "crypto";
import type { DesktopApiRequest } from "../lib/desktop-bridge";

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

export type MobileBridgeHandle = {
  port: number;
  token: string;
  stop: () => Promise<void>;
};

function parseJsonBody(raw: string): unknown {
  if (!raw.trim()) return {};
  return JSON.parse(raw);
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Scoreboard-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.end(JSON.stringify(payload));
}

export async function startMobileBridge(
  options: MobileBridgeOptions,
): Promise<MobileBridgeHandle> {
  const token = process.env.MOBILE_BRIDGE_TOKEN?.trim() || randomBytes(12).toString("hex");
  const preferredPort = Number(process.env.MOBILE_BRIDGE_PORT ?? "17890");
  const port = Number.isFinite(preferredPort) ? preferredPort : 17890;

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

      if (url.pathname === "/mobile/health" && req.method === "GET") {
        writeJson(res, 200, { ok: true, service: "scoreboard-mobile-bridge" });
        return;
      }

      const inboundToken =
        (req.headers["x-scoreboard-token"] as string | undefined)?.trim() ?? "";
      if (inboundToken !== token) {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }

      if (url.pathname === "/mobile/snapshot" && req.method === "GET") {
        const snapshot = await options.runtime.getDisplaySnapshot();
        writeJson(res, 200, snapshot);
        return;
      }

      if (url.pathname === "/mobile/command" && req.method === "POST") {
        const bodyText = await readBody(req);
        const body = parseJsonBody(bodyText) as { command?: unknown };
        const result = await options.runtime.runCommand(body.command);
        writeJson(res, 200, result);
        return;
      }

      if (url.pathname.startsWith("/mobile/api/")) {
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
    `[mobile-bridge] actief op poort ${port} (token=${token})`,
  );

  return {
    port,
    token,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
