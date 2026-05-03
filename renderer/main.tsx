import { createRoot } from "react-dom/client";
import ControlPage from "@/app/control/page";
import DisplayPage from "@/app/display/page";

function extractPathFromInput(input: RequestInfo | URL): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.pathname + input.search;
  if (input && typeof (input as Request).url === "string") {
    return (input as Request).url;
  }
  return null;
}

function isApiPath(rawPath: string): boolean {
  if (rawPath.startsWith("/api/")) return true;
  if (rawPath.includes("/api/")) {
    try {
      const dummy = new URL(rawPath, "http://localhost/");
      return dummy.pathname.startsWith("/api/");
    } catch {
      return false;
    }
  }
  return false;
}

function splitPath(rawPath: string): { pathname: string; search: string } {
  const base = rawPath.startsWith("/") ? rawPath : `/${rawPath.replace(/^[^/]*\/\/[^/]+/, "")}`;
  const cleaned = base.replace(/^file:\/\/[^/]*/i, "").replace(/^[a-z]:/i, "");
  const apiIndex = cleaned.indexOf("/api/");
  const apiPart = apiIndex >= 0 ? cleaned.slice(apiIndex) : cleaned;
  const [pathname, search = ""] = apiPart.split("?");
  return { pathname, search: search ? `?${search}` : "" };
}

async function readBodyText(init?: RequestInit, input?: RequestInfo | URL): Promise<string | undefined> {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method === "GET" || method === "HEAD") return undefined;

  if (init?.body !== undefined && init.body !== null) {
    const body = init.body;
    if (typeof body === "string") return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
    if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body as ArrayBufferView);
    if (body instanceof Blob) return await body.text();
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      console.warn("[fetch-shim] FormData is not supported in desktop build");
      return undefined;
    }
    return String(body);
  }

  if (input instanceof Request) {
    try {
      return await input.clone().text();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function headersToObject(init?: RequestInit, input?: RequestInfo | URL): Record<string, string> {
  const headers: Record<string, string> = {};
  const source = init?.headers ?? (input instanceof Request ? input.headers : undefined);
  if (!source) return headers;
  if (source instanceof Headers) {
    source.forEach((value, key) => {
      headers[key] = value;
    });
  } else if (Array.isArray(source)) {
    for (const [key, value] of source) headers[key] = value;
  } else {
    for (const [key, value] of Object.entries(source as Record<string, string>)) {
      headers[key] = value;
    }
  }
  return headers;
}

let unavailableWarned = false;

function installDesktopFetchShim() {
  if (typeof window === "undefined") return;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawPath = extractPathFromInput(input);
    if (!rawPath || !isApiPath(rawPath)) {
      return nativeFetch(input, init);
    }

    const api = await waitForElectronApi();
    if (!api) {
      if (!unavailableWarned) {
        unavailableWarned = true;
        console.warn("[fetch-shim] electronAPI unavailable (first warning only)");
      }
      return new Response(
        JSON.stringify({ error: "electronAPI not available" }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }

    const { pathname, search } = splitPath(rawPath);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

    try {
      const result = await api.apiRequest({
        method,
        path: pathname,
        search,
        headers: headersToObject(init, input),
        bodyText: await readBodyText(init, input),
      });

      const body =
        result.text ??
        (result.json !== undefined ? JSON.stringify(result.json) : "");

      return new Response(body, {
        status: result.status,
        headers: { "Content-Type": result.contentType },
      });
    } catch (err) {
      console.error("[fetch-shim] IPC error", err);
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}

async function waitForElectronApi(timeoutMs = 400) {
  if (window.electronAPI) return window.electronAPI;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.electronAPI) return window.electronAPI;
    await new Promise((r) => setTimeout(r, 25));
  }
  return window.electronAPI ?? null;
}

function AppRouter() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view") ?? "control";

  if (view === "display") {
    return <DisplayPage />;
  }

  return <ControlPage />;
}

installDesktopFetchShim();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Renderer root not found");
}

createRoot(root).render(<AppRouter />);
