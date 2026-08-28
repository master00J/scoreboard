/** LAN: proxied desktop REST via /mobile/api/… (zie electron/mobile-bridge.ts). */

export function createBridgeApi({ baseUrl, sessionToken, isCloud, callBridge }) {
  async function apiRequest(path, method = "GET", body) {
    if (isCloud) {
      return {
        ok: false,
        status: 501,
        data: { error: "Setup en media beheer vereist LAN-modus (directe bridge naar de desktop)." },
      };
    }
    const desktopPath = path.startsWith("/api/") ? path : `/api${path}`;
    return callBridge(baseUrl, sessionToken, `/mobile/api${desktopPath}`, method, body);
  }

  return {
    get: (path) => apiRequest(path, "GET"),
    post: (path, body) => apiRequest(path, "POST", body),
    patch: (path, body) => apiRequest(path, "PATCH", body),
    delete: (path) => apiRequest(path, "DELETE"),
  };
}
