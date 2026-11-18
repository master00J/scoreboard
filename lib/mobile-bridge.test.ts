import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startMobileBridge, type MobileBridgeHandle } from "../electron/mobile-bridge";

/** De LAN-bridge zelf: luistert op het gekozen adres en houdt sessies vast bij een netwerkwissel. */
describe("telefoonbediening op het lokale netwerk", () => {
  let bridge: MobileBridgeHandle | null = null;
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.MOBILE_BRIDGE_PORT = String(20000 + Math.floor(Math.random() * 20000));
    process.env.MOBILE_BRIDGE_PAIRING_CODE = "123456";
    process.env.MOBILE_BRIDGE_OPERATOR_PIN = "987654";
    delete process.env.MOBILE_BRIDGE_BIND;
  });

  afterEach(async () => {
    await bridge?.stop();
    bridge = null;
    process.env = { ...saved };
  });

  async function start(bindHost?: string) {
    bridge = await startMobileBridge({
      bindHost,
      log: () => {},
      runtime: {
        apiRequest: async () => ({ status: 200, json: { ok: true } }),
        getDisplaySnapshot: async () => ({ homeScore: 1 }),
        runCommand: async () => ({ ok: true }),
      },
    });
    return bridge;
  }

  const url = (host: string, path: string) => `http://${host}:${bridge!.port}${path}`;

  async function pair(host: string) {
    const response = await fetch(url(host, "/mobile/auth/session"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingCode: "123456", role: "operator", operatorPin: "987654" }),
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { sessionToken: string }).sessionToken;
  }

  it("luistert op het opgegeven adres", async () => {
    const handle = await start("127.0.0.1");
    expect(handle.bindHost).toBe("127.0.0.1");
    expect((await fetch(url("127.0.0.1", "/mobile/health"))).status).toBe(200);
  });

  it("vraagt de sessiesleutel voor alles behalve health en koppelen", async () => {
    await start("127.0.0.1");
    expect((await fetch(url("127.0.0.1", "/mobile/snapshot"))).status).toBe(401);
    expect((await fetch(url("127.0.0.1", "/mobile/api/matches"))).status).toBe(401);
    expect((await fetch(url("127.0.0.1", "/mobile/command"), { method: "POST", body: "{}" })).status).toBe(401);
    const token = await pair("127.0.0.1");
    const ok = await fetch(url("127.0.0.1", "/mobile/snapshot"), { headers: { Authorization: `Bearer ${token}` } });
    expect(ok.status).toBe(200);
  });

  it("houdt een gekoppelde telefoon verbonden als de bridge van netwerk wisselt", async () => {
    await start("0.0.0.0");
    const token = await pair("127.0.0.1");

    await bridge!.rebind("127.0.0.1");
    expect(bridge!.bindHost).toBe("127.0.0.1");

    const after = await fetch(url("127.0.0.1", "/mobile/snapshot"), { headers: { Authorization: `Bearer ${token}` } });
    expect(after.status).toBe(200);
  });

  it("blijft op het oude adres als het nieuwe niet kan", async () => {
    await start("127.0.0.1");
    // 192.0.2.1 (documentatieadres) zit op geen enkele kaart van deze pc.
    await expect(bridge!.rebind("192.0.2.1")).rejects.toThrow();
    expect(bridge!.bindHost).toBe("127.0.0.1");
    expect((await fetch(url("127.0.0.1", "/mobile/health"))).status).toBe(200);
  });

  it("MOBILE_BRIDGE_BIND gaat voor de keuze in het menu", async () => {
    process.env.MOBILE_BRIDGE_BIND = "127.0.0.1";
    const handle = await start("0.0.0.0");
    expect(handle.bindHost).toBe("127.0.0.1");
    expect(handle.bindFixedByEnv).toBe(true);
    await handle.rebind("0.0.0.0");
    expect(handle.bindHost).toBe("127.0.0.1");
  });
});
