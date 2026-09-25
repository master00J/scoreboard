import test from "node:test";
import assert from "node:assert/strict";
import { callBridge, describeCommandError, normalizeBaseUrl, parsePairCode } from "../lib/transport.js";
import { commandErrorMessages } from "../lib/commandErrors.js";
import { createBridgeApi } from "../lib/bridgeApi.js";

test("normalizes LAN addresses and cloud legacy domains", () => {
  assert.equal(normalizeBaseUrl(" HTTP://192.168.1.20:17890/// "), "http://192.168.1.20:17890");
  assert.equal(normalizeBaseUrl("https://www.arenacue.com/", "cloud"), "https://arenacue.be");
  assert.equal(normalizeBaseUrl("http://localhost:3000", "cloud"), "http://localhost:3000");
  assert.equal(normalizeBaseUrl("http://127.0.0.1:3000", "cloud"), "http://127.0.0.1:3000");
  assert.equal(normalizeBaseUrl("http://[::1]:3000", "cloud"), "http://[::1]:3000");
});

test("rejects unsafe or ambiguous base addresses", () => {
  for (const value of ["192.168.1.20:17890", "ftp://example.com", "https://user:pass@example.com", "https://example.com/api", "https://example.com?token=x", "https://example.com#", "http://localhost:99999", ""]) {
    assert.throws(() => normalizeBaseUrl(value), { code: "invalidUrl" });
  }
  assert.throws(() => normalizeBaseUrl("http://arenacue.be", "cloud"), { code: "insecureCloud" });
  assert.throws(() => normalizeBaseUrl("http://localhost.evil.example", "cloud"), { code: "insecureCloud" });
});

test("parses viewer and operator LAN QR codes", () => {
  assert.deepEqual(parsePairCode("ACPAIR:local|http%3A%2F%2F192.168.1.20%3A17890|123456"), {
    connectionMode: "local", baseUrl: "http://192.168.1.20:17890", pairingCode: "123456", operatorPin: "", role: "viewer",
  });
  const operator = parsePairCode(" ACPAIR:local|http%3A%2F%2F192.168.1.20%3A17890|123456|987654 ");
  assert.equal(operator.operatorPin, "987654");
  assert.equal(operator.role, "operator");
});

test("parses explicit and legacy cloud QR codes", () => {
  assert.deepEqual(parsePairCode("ACPAIR:cloud|https%3A%2F%2Farenacue.be|genk-a|venue-token"), {
    connectionMode: "cloud", baseUrl: "https://arenacue.be", venueId: "genk-a", cloudPairToken: "venue-token", role: "operator",
  });
  assert.deepEqual(parsePairCode("ACPAIR:https%3A%2F%2Farenacue.com|genk-a"), {
    connectionMode: "cloud", baseUrl: "https://arenacue.be", venueId: "genk-a", cloudPairToken: "", role: "viewer",
  });
});

test("invalid and damaged pairing codes have stable error codes", () => {
  for (const value of ["hello", "ACPAIR:local|http://localhost|", "ACPAIR:cloud|https://arenacue.be|a", "ACPAIR:local|%E0%A4%A|123456", "ACPAIR:cloud|https://arenacue.be|venue|token|extra"]) {
    assert.throws(() => parsePairCode(value), { code: "invalidPairCode" });
  }
  assert.throws(() => parsePairCode("ACPAIR:cloud|http://arenacue.be|venue|token"), { code: "insecureCloud" });
});

test("desktop API prefix occurs exactly once for reads and mutations", async () => {
  const calls = [];
  const api = createBridgeApi({ baseUrl: "http://localhost:17890", sessionToken: "session", isCloud: false, callBridge: async (...args) => { calls.push(args); return { ok: true }; } });
  await api.get("/teams");
  await api.get("/api/matches?closed=false");
  await api.patch("teams/encoded%20id", { name: "Club" });
  await api.delete("/players/player-id");
  assert.deepEqual(calls.map((call) => call[2]), ["/mobile/api/teams", "/mobile/api/matches?closed=false", "/mobile/api/teams/encoded%20id", "/mobile/api/players/player-id"]);
  assert.equal(calls[2][3], "PATCH");
  assert.deepEqual(calls[2][4], { name: "Club" });
  const cloud = createBridgeApi({ isCloud: true, callBridge: () => assert.fail("Cloud setup must not call the LAN API") });
  assert.equal((await cloud.get("/teams")).status, 501);
});

test("HTTP 200 runtime rejection remains a failed command and POST is sent once", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls += 1;
    assert.equal(url, "http://localhost:17890/mobile/command");
    assert.equal(init.headers.Authorization, "Bearer session");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), { command: { type: "goal:trigger", side: "home" } });
    return new Response(JSON.stringify({ ok: false, error: "No active match" }), { status: 200 });
  });
  const result = await callBridge("http://localhost:17890", "session", "/mobile/command", "POST", { command: { type: "goal:trigger", side: "home" } });
  assert.deepEqual(result, { ok: false, status: 200, data: { ok: false, error: "No active match" } });
  assert.equal(calls, 1);
});

test("cloud queue acceptance preserves its command id", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ ok: true, commandId: "queued-id" }), { status: 200 }));
  assert.deepEqual(await callBridge("https://arenacue.be", "session", "/api/control/commands", "POST", {}), {
    ok: true, status: 200, data: { ok: true, commandId: "queued-id" },
  });
});

test("HTTP authentication errors retain the server message", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 }));
  assert.deepEqual(await callBridge("http://localhost", "expired", "/mobile/snapshot"), { ok: false, status: 401, data: { message: "Unauthorized" } });
});

test("HTML and empty successful responses cannot masquerade as snapshots", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Login page</html>", { status: 200 }));
  await assert.rejects(callBridge("http://localhost", "", "/mobile/snapshot"), { code: "invalidResponse" });
  globalThis.fetch = async () => new Response("", { status: 200 });
  await assert.rejects(callBridge("http://localhost", "", "/mobile/snapshot"), { code: "invalidResponse" });
  globalThis.fetch = async () => new Response(null, { status: 204 });
  assert.deepEqual(await callBridge("http://localhost", "", "/mobile/api/item", "DELETE"), { ok: true, status: 204, data: null });
});

test("timeouts abort the request without retrying a mutation", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
    calls += 1;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  });
  await assert.rejects(callBridge("http://localhost", "", "/mobile/command", "POST", {}, { timeoutMs: 5 }), { code: "timeout" });
  assert.equal(calls, 1);
});

test("setup-style abort options reach fetch and cancel the request", async (t) => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(globalThis, "fetch", async () => { throw new Error("should not fetch"); });
  const api = createBridgeApi({
    baseUrl: "http://192.168.1.20:17890",
    sessionToken: "session",
    isCloud: false,
    callBridge: (...args) => callBridge(...args, { signal: controller.signal }),
  });
  await assert.rejects(api.get("/teams"), { name: "AbortError", code: "network" });
});

test("caller cancellation and network failure are distinguishable from timeout", async (t) => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  await assert.rejects(callBridge("http://localhost", "", "/mobile/snapshot", "GET", undefined, { signal: controller.signal }), { code: "network", name: "AbortError" });
  await assert.rejects(callBridge("http://localhost", "", "/mobile/snapshot"), { code: "network" });
});

test("rejected desktop commands map known error codes to translated messages", () => {
  const limit = describeCommandError({ ok: false, error: "timeoutLimit", code: "timeoutLimit", params: { limit: 2 } });
  assert.deepEqual(limit, { key: "cmd.timeoutLimit", values: { limit: 2 } });
  assert.equal(commandErrorMessages.nl.cmd.timeoutLimit, "Time-outlimiet bereikt ({limit}) voor deze periode.");
  assert.equal(commandErrorMessages.en.cmd.periodOver, "The period is over (00:00). Choose the next period or set the time.");
  for (const locale of ["nl", "en", "fr", "it"]) assert.equal(Object.keys(commandErrorMessages[locale].cmd).length, Object.keys(commandErrorMessages.nl.cmd).length);
  assert.deepEqual(describeCommandError({ ok: false, error: "Iets onverwachts" }), { key: null, details: "Iets onverwachts" });
  assert.deepEqual(describeCommandError({ message: "Ongeldig command formaat." }), { key: null, details: "Ongeldig command formaat." });
  assert.deepEqual(describeCommandError(null), { key: null, details: null });
  assert.deepEqual(describeCommandError({ error: "timeoutLateLimit", params: [1] }), { key: "cmd.timeoutLateLimit", values: {} });
});
