"use client";

import { useCallback, useEffect, useState } from "react";

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg =
        typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : r.statusText || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return body;
  });

export function useApi<T = unknown>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    fetcher(url)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e);
          setData(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url, reloadKey]);

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  return { data, error, reload, setData };
}
