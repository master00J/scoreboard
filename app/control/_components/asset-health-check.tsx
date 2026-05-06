"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import type { MediaItem } from "@/lib/types";
import { mediaUrl } from "@/lib/media-url";

type CheckRow = {
  id: string;
  title: string;
  type: "VIDEO" | "IMAGE";
  status: "ok" | "fail" | "slow";
  detailMs: number;
  message?: string;
};

const PER_ITEM_TIMEOUT_MS = 8000;
const SLOW_THRESHOLD_MS = 1500;

async function checkOne(item: MediaItem): Promise<CheckRow> {
  const url = mediaUrl(item.path);
  const start = performance.now();

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve({
        id: item.id,
        title: item.title,
        type: item.type,
        status: "fail",
        detailMs: PER_ITEM_TIMEOUT_MS,
        message: "Time-out: bestand reageert niet binnen 8s",
      });
    }, PER_ITEM_TIMEOUT_MS);

    let cleanup = () => {
      window.clearTimeout(timeout);
    };

    if (item.type === "VIDEO") {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.src = url;
      const onLoaded = () => {
        const ms = performance.now() - start;
        cleanup();
        resolve({
          id: item.id,
          title: item.title,
          type: item.type,
          status: ms > SLOW_THRESHOLD_MS ? "slow" : "ok",
          detailMs: ms,
          message:
            ms > SLOW_THRESHOLD_MS
              ? `Trage decode (${Math.round(ms)} ms)`
              : `Metadata OK (${Math.round(ms)} ms, ${Math.round(v.duration)}s)`,
        });
      };
      const onError = () => {
        cleanup();
        resolve({
          id: item.id,
          title: item.title,
          type: item.type,
          status: "fail",
          detailMs: performance.now() - start,
          message: "Codec/bestand-fout",
        });
      };
      v.addEventListener("loadedmetadata", onLoaded);
      v.addEventListener("error", onError);
      cleanup = () => {
        window.clearTimeout(timeout);
        v.removeEventListener("loadedmetadata", onLoaded);
        v.removeEventListener("error", onError);
        v.removeAttribute("src");
        try {
          v.load();
        } catch {
          /* ignore */
        }
      };
    } else {
      const img = new window.Image();
      img.onload = () => {
        const ms = performance.now() - start;
        cleanup();
        resolve({
          id: item.id,
          title: item.title,
          type: item.type,
          status: ms > SLOW_THRESHOLD_MS ? "slow" : "ok",
          detailMs: ms,
          message:
            ms > SLOW_THRESHOLD_MS
              ? `Traag geladen (${Math.round(ms)} ms)`
              : `OK (${Math.round(ms)} ms)`,
        });
      };
      img.onerror = () => {
        cleanup();
        resolve({
          id: item.id,
          title: item.title,
          type: item.type,
          status: "fail",
          detailMs: performance.now() - start,
          message: "Afbeelding kan niet geladen worden",
        });
      };
      img.src = url;
    }
  });
}

export function AssetHealthCheck() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [rows, setRows] = useState<CheckRow[]>([]);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setRows([]);
    setFinishedAt(null);
    try {
      const res = await fetch("/api/media");
      const all = ((await res.json()) as MediaItem[]).filter((m) => m.active);
      setProgress({ done: 0, total: all.length });
      const results: CheckRow[] = [];
      // Sequentieel om browser-resources niet te overspoelen
      for (let i = 0; i < all.length; i++) {
        const item = all[i]!;
        const row = await checkOne(item);
        results.push(row);
        setRows([...results]);
        setProgress({ done: i + 1, total: all.length });
      }
      setFinishedAt(Date.now());
    } catch (err) {
      console.error("[AssetHealthCheck]", err);
    } finally {
      setRunning(false);
    }
  }, []);

  const failCount = rows.filter((r) => r.status === "fail").length;
  const slowCount = rows.filter((r) => r.status === "slow").length;
  const okCount = rows.filter((r) => r.status === "ok").length;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">Media-check vóór de wedstrijd</div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Test alle actieve media in je bibliotheek. Sponsors, goal-video&apos;s en geplande cues
            worden geladen om codec-/leesfouten en trage clips op te sporen vóór kickoff.
          </p>
        </div>
        <Button size="sm" disabled={running} onClick={() => void run()}>
          {running ? `Bezig… ${progress.done}/${progress.total}` : "Check uitvoeren"}
        </Button>
      </div>

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-emerald-600 dark:text-emerald-400">
              ✓ {okCount} OK
            </span>
            {slowCount > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                ⚠ {slowCount} traag
              </span>
            )}
            {failCount > 0 && (
              <span className="text-red-600 dark:text-red-400 font-semibold">
                ✗ {failCount} fout
              </span>
            )}
            {finishedAt && !running && failCount === 0 && slowCount === 0 && (
              <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
                Alle media klaar voor de wedstrijd
              </span>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto rounded-md border border-input">
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-2 px-3 py-2 text-xs"
                  title={r.message}
                >
                  <span
                    className={
                      r.status === "ok"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : r.status === "slow"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-red-600 dark:text-red-400 font-semibold"
                    }
                    aria-hidden
                  >
                    {r.status === "ok" ? "✓" : r.status === "slow" ? "⚠" : "✗"}
                  </span>
                  <span className="text-muted-foreground w-12 shrink-0">
                    {r.type === "VIDEO" ? "Video" : "Beeld"}
                  </span>
                  <span className="flex-1 truncate" title={r.title}>
                    {r.title}
                  </span>
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {r.message ?? `${Math.round(r.detailMs)} ms`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
