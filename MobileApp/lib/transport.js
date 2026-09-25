import { commandErrorCodes } from "./commandErrors.js";

const DEFAULT_TIMEOUT_MS = 10_000;

function transportError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

export function normalizeBaseUrl(raw, mode = "local") {
  const input = typeof raw === "string" ? raw.trim() : "";
  if (!/^https?:\/\//i.test(input)) {
    throw transportError("invalidUrl", "Gebruik een volledig http://- of https://-adres.");
  }
  let url;
  try {
    url = new URL(input);
  } catch (cause) {
    throw transportError("invalidUrl", "Het serveradres is ongeldig.", cause);
  }
  if (
    !url.hostname || url.username || url.password ||
    !/^\/*$/.test(url.pathname) || /[?#]/.test(input)
  ) {
    throw transportError("invalidUrl", "Gebruik alleen het serveradres en eventueel de poort, zonder pad of inloggegevens.");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (mode === "cloud" && url.protocol !== "https:" && !loopback) {
    throw transportError("insecureCloud", "Gebruik https:// voor de cloudverbinding.");
  }
  if (mode === "cloud" && url.protocol === "https:" && !url.port && /^(www\.)?arenacue\.com$/i.test(url.hostname)) {
    return "https://arenacue.be";
  }
  return url.origin;
}

export function parsePairCode(raw) {
  const input = typeof raw === "string" ? raw.trim() : "";
  if (!input.startsWith("ACPAIR:")) {
    throw transportError("invalidPairCode", "Dit is geen geldige ArenaCue-koppelcode.");
  }
  let parts;
  try {
    parts = input.slice(7).split("|").map((part) => decodeURIComponent(part).trim());
  } catch (cause) {
    throw transportError("invalidPairCode", "De koppelcode is beschadigd. Scan of kopieer de code opnieuw.", cause);
  }
  if (parts[0] === "local") {
    if (parts.length < 3 || parts.length > 4 || !parts[1] || !parts[2]) {
      throw transportError("invalidPairCode", "De LAN-koppelcode mist het serveradres of de pairingcode.");
    }
    const operatorPin = parts[3] || "";
    return {
      connectionMode: "local",
      baseUrl: normalizeBaseUrl(parts[1], "local"),
      pairingCode: parts[2],
      operatorPin,
      role: operatorPin ? "operator" : "viewer",
    };
  }
  const explicitCloud = parts[0] === "cloud";
  const values = explicitCloud ? parts.slice(1) : parts;
  if (
    (explicitCloud ? values.length < 2 || values.length > 3 : values.length !== 2) ||
    !values[0] || !/^[a-zA-Z0-9_-]{2,64}$/.test(values[1] || "")
  ) {
    throw transportError("invalidPairCode", "De cloud-koppelcode mist een geldig serveradres of Venue ID.");
  }
  const cloudPairToken = values[2] || "";
  return {
    connectionMode: "cloud",
    baseUrl: normalizeBaseUrl(values[0], "cloud"),
    venueId: values[1],
    cloudPairToken,
    role: cloudPairToken ? "operator" : "viewer",
  };
}

export async function callBridge(baseUrl, sessionToken, path, method = "GET", body, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const root = normalizeBaseUrl(baseUrl);
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
    throw transportError("invalidUrl", "Het API-pad is ongeldig.");
  }
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, duration);
  try {
    if (controller.signal.aborted) {
      const error = new Error("De aanvraag is geannuleerd.");
      error.name = "AbortError";
      throw error;
    }
    const response = await fetch(`${root}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data;
    try {
      data = raw.trim() ? JSON.parse(raw) : response.status === 204 ? null : JSON.parse(raw);
    } catch (cause) {
      throw transportError("invalidResponse", "De server geeft geen geldig JSON-antwoord. Controleer het serveradres en de verbindingsmodus.", cause);
    }
    return { ok: response.ok && data?.ok !== false, status: response.status, data };
  } catch (cause) {
    if (cause?.code === "invalidResponse") throw cause;
    if (timedOut) throw transportError("timeout", "De server reageert niet op tijd. Controleer de verbinding voordat je de actie opnieuw uitvoert.", cause);
    const error = transportError("network", signal?.aborted ? "De aanvraag is geannuleerd." : "De server is niet bereikbaar. Controleer de verbinding.", cause);
    if (signal?.aborted) error.name = "AbortError";
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

/** Geweigerde desktopactie ({ ok: false, code, params }): bekende foutcode → vertaalsleutel, anders de ruwe tekst. */
export function describeCommandError(data) {
  const record = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const code = [record.code, record.error].find((value) => typeof value === "string" && commandErrorCodes.includes(value));
  if (code) {
    const params = record.params && typeof record.params === "object" && !Array.isArray(record.params) ? record.params : {};
    return { key: `cmd.${code}`, values: { ...params } };
  }
  const details = [record.error, record.message].find((value) => typeof value === "string" && value.trim());
  return { key: null, details: details ?? null };
}
