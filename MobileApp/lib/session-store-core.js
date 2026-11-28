// Waar de telefoon haar koppeling bewaart. Adres en modus zijn geen geheim en blijven in gewone
// opslag; pairing code, PIN, cloudtoken en sessietoken gaan naar de versleutelde opslag van het
// toestel (Keychain / Android Keystore). Oudere versies bewaarden die geheimen onversleuteld: die
// worden bij de eerste start verhuisd en daarna uit de gewone opslag gewist.
export const STORAGE_KEYS = Object.freeze({
  settings: 'arenacue_mobile_settings_v2',
  secret: 'arenacue_mobile_secret_v3',
  plainSecret: 'arenacue_mobile_secret_v2',
  legacySession: 'scoreboard_mobile_session_v1',
});

const text = value => typeof value === 'string' ? value : value == null ? '' : String(value);

export const publicFields = value => ({
  baseUrl: text(value.baseUrl),
  connectionMode: value.connectionMode === 'cloud' ? 'cloud' : 'local',
  venueId: text(value.venueId),
});

export const privateFields = value => ({
  pairingCode: text(value.pairingCode),
  cloudPairToken: text(value.cloudPairToken),
  operatorPin: text(value.operatorPin),
  role: value.role === 'viewer' ? 'viewer' : 'operator',
  sessionToken: text(value.sessionToken),
  sessionExpiresAt: value.sessionExpiresAt || null,
});

function readJson(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * @param {{ getItem(key: string): Promise<string|null>, setItem(key: string, value: string): Promise<void>, removeItem(key: string): Promise<void> }} storage
 *   Gewone opslag (AsyncStorage).
 * @param {{ getItem(key: string): Promise<string|null>, setItem(key: string, value: string): Promise<void>, removeItem(key: string): Promise<void> }} secure
 *   Versleutelde opslag van het toestel.
 */
export function createSessionStore({ storage, secure }) {
  let writes = Promise.resolve();

  async function store(value) {
    // Eerst het geheim: lukt dat niet, dan blijft de vorige koppeling intact en meldt de app het.
    await secure.setItem(STORAGE_KEYS.secret, JSON.stringify(privateFields(value)));
    await storage.setItem(STORAGE_KEYS.settings, JSON.stringify(publicFields(value)));
  }

  function saveSession(value) {
    const task = writes.catch(() => {}).then(() => store(value));
    writes = task;
    return task;
  }

  /** Een kapotte sleutel (app hersteld uit back-up, nieuwe vingerafdruk) mag de start niet blokkeren. */
  async function readSecure() {
    try {
      return await secure.getItem(STORAGE_KEYS.secret);
    } catch {
      return null;
    }
  }

  async function forgetPlainSecrets() {
    await Promise.all([
      storage.removeItem(STORAGE_KEYS.plainSecret),
      storage.removeItem(STORAGE_KEYS.legacySession),
    ]);
  }

  async function loadSession() {
    const [settings, secretRaw, plainSecret, legacy] = await Promise.all([
      storage.getItem(STORAGE_KEYS.settings),
      readSecure(),
      storage.getItem(STORAGE_KEYS.plainSecret),
      storage.getItem(STORAGE_KEYS.legacySession),
    ]);
    const hasPlainSecrets = Boolean(plainSecret || legacy);

    let stored;
    if (secretRaw) stored = { ...readJson(settings), ...readJson(secretRaw) };
    else if (settings) stored = { ...readJson(settings), ...readJson(plainSecret) };
    else if (legacy) stored = readJson(legacy);
    else stored = null;

    if (hasPlainSecrets && stored) {
      if (!secretRaw) {
        try {
          await saveSession(stored);
        } catch {
          // Versleutelde opslag faalt: laat de oude gegevens staan zodat de operator verbonden blijft,
          // en probeer het bij de volgende start opnieuw.
          return usable(stored);
        }
      }
      await forgetPlainSecrets();
    } else if (hasPlainSecrets) {
      await forgetPlainSecrets();
    }
    return usable(stored);
  }

  function usable(stored) {
    if (!stored || (!stored.baseUrl && !stored.sessionToken && !stored.pairingCode)) return null;
    return { ...publicFields(stored), ...privateFields(stored) };
  }

  return { saveSession, loadSession };
}
