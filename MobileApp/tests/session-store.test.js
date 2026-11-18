import test from "node:test";
import assert from "node:assert/strict";
import { createSessionStore, STORAGE_KEYS } from "../lib/session-store-core.js";

function memoryStore(initial = {}, { failWrites = false, failReads = false } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (key) => {
      if (failReads) throw new Error("keystore unavailable");
      return data.has(key) ? data.get(key) : null;
    },
    setItem: async (key, value) => {
      if (failWrites) throw new Error("keystore unavailable");
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
}

const operator = {
  baseUrl: "http://192.168.1.20:17890",
  connectionMode: "local",
  venueId: "",
  pairingCode: "123456",
  cloudPairToken: "",
  operatorPin: "987654",
  role: "operator",
  sessionToken: "abc123",
  sessionExpiresAt: "2030-01-01T00:00:00.000Z",
};

const settingsOf = (v) => JSON.stringify({ baseUrl: v.baseUrl, connectionMode: v.connectionMode, venueId: v.venueId });
const secretsOf = (v) => JSON.stringify({
  pairingCode: v.pairingCode, cloudPairToken: v.cloudPairToken, operatorPin: v.operatorPin,
  role: v.role, sessionToken: v.sessionToken, sessionExpiresAt: v.sessionExpiresAt,
});

test("saving keeps PIN and session token out of plain storage", async () => {
  const storage = memoryStore();
  const secure = memoryStore();
  await createSessionStore({ storage, secure }).saveSession(operator);

  const plain = [...storage.data.values()].join("\n");
  assert.ok(!plain.includes("987654"), "PIN must not be in plain storage");
  assert.ok(!plain.includes("abc123"), "session token must not be in plain storage");
  assert.ok(!plain.includes("123456"), "pairing code must not be in plain storage");
  assert.deepEqual(JSON.parse(storage.data.get(STORAGE_KEYS.settings)), { baseUrl: operator.baseUrl, connectionMode: "local", venueId: "" });
  assert.equal(JSON.parse(secure.data.get(STORAGE_KEYS.secret)).operatorPin, "987654");
  assert.equal(JSON.parse(secure.data.get(STORAGE_KEYS.secret)).sessionToken, "abc123");
});

test("a saved session loads back unchanged", async () => {
  const store = createSessionStore({ storage: memoryStore(), secure: memoryStore() });
  await store.saveSession(operator);
  assert.deepEqual(await store.loadSession(), operator);
});

test("first start migrates the unencrypted v2 secrets and deletes them", async () => {
  const storage = memoryStore({
    [STORAGE_KEYS.settings]: settingsOf(operator),
    [STORAGE_KEYS.plainSecret]: secretsOf(operator),
  });
  const secure = memoryStore();
  const store = createSessionStore({ storage, secure });

  assert.deepEqual(await store.loadSession(), operator);
  assert.equal(storage.data.has(STORAGE_KEYS.plainSecret), false);
  assert.equal(JSON.parse(secure.data.get(STORAGE_KEYS.secret)).operatorPin, "987654");
  assert.equal(JSON.parse(secure.data.get(STORAGE_KEYS.secret)).sessionToken, "abc123");
  assert.equal(JSON.parse(storage.data.get(STORAGE_KEYS.settings)).baseUrl, operator.baseUrl);

  // Tweede start: niets meer te verhuizen, zelfde koppeling.
  assert.deepEqual(await createSessionStore({ storage, secure }).loadSession(), operator);
});

test("first start migrates the oldest single-key session and deletes it", async () => {
  const storage = memoryStore({ [STORAGE_KEYS.legacySession]: JSON.stringify(operator) });
  const secure = memoryStore();

  assert.deepEqual(await createSessionStore({ storage, secure }).loadSession(), operator);
  assert.equal(storage.data.has(STORAGE_KEYS.legacySession), false);
  assert.ok(!JSON.stringify([...storage.data.values()]).includes("987654"));
  assert.equal(JSON.parse(secure.data.get(STORAGE_KEYS.secret)).operatorPin, "987654");
});

test("leftover plain secrets are deleted when secure storage already holds them", async () => {
  const newer = { ...operator, sessionToken: "newer-token" };
  const storage = memoryStore({
    [STORAGE_KEYS.settings]: settingsOf(operator),
    [STORAGE_KEYS.plainSecret]: secretsOf(operator),
  });
  const secure = memoryStore({ [STORAGE_KEYS.secret]: secretsOf(newer) });

  assert.deepEqual(await createSessionStore({ storage, secure }).loadSession(), newer);
  assert.equal(storage.data.has(STORAGE_KEYS.plainSecret), false);
});

test("when secure storage refuses writes the operator stays connected and nothing is deleted", async () => {
  const storage = memoryStore({
    [STORAGE_KEYS.settings]: settingsOf(operator),
    [STORAGE_KEYS.plainSecret]: secretsOf(operator),
  });
  const secure = memoryStore({}, { failWrites: true });

  assert.deepEqual(await createSessionStore({ storage, secure }).loadSession(), operator);
  assert.equal(storage.data.has(STORAGE_KEYS.plainSecret), true, "keep the only copy until it is stored securely");
});

test("an unreadable secure key does not block the start", async () => {
  const storage = memoryStore({ [STORAGE_KEYS.settings]: settingsOf(operator) });
  const secure = memoryStore({}, { failReads: true });

  const loaded = await createSessionStore({ storage, secure }).loadSession();
  assert.equal(loaded.baseUrl, operator.baseUrl);
  assert.equal(loaded.sessionToken, "");
  assert.equal(loaded.operatorPin, "");
});

test("nothing stored means no session", async () => {
  assert.equal(await createSessionStore({ storage: memoryStore(), secure: memoryStore() }).loadSession(), null);
});

test("saves run in order so the last state wins", async () => {
  const storage = memoryStore();
  const secure = memoryStore();
  const store = createSessionStore({ storage, secure });
  void store.saveSession({ ...operator, sessionToken: "first" });
  await store.saveSession({ ...operator, sessionToken: "second" });
  assert.equal((await store.loadSession()).sessionToken, "second");
});
