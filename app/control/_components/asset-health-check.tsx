"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@/components/ui/button";
import type { MediaItem } from "@/lib/types";
import { mediaUrl } from "@/lib/media-url";
import { isDisplayPlaybackRisk } from "@/lib/media-playback-compat";

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

async function checkOne(item: MediaItem, t: TFunction): Promise<CheckRow> {
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
        message: t("setup.healthTimeout"),
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
              ? t("setup.healthSlowDecode", { ms: Math.round(ms) })
              : t("setup.healthMetaOk", { ms: Math.round(ms), sec: Math.round(v.duration) }),
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
          message: t("setup.healthCodecError"),
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
              ? t("setup.healthSlowLoad", { ms: Math.round(ms) })
              : t("setup.healthImageOk", { ms: Math.round(ms) }),
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
          message: t("setup.healthImageFail"),
        });
      };
      img.src = url;
    }
  });
}

export function AssetHealthCheck() {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [rows, setRows] = useState<CheckRow[]>([]);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [riskIds, setRiskIds] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [prepareProgress, setPrepareProgress] = useState({ done: 0, total: 0 });

  const run = useCallback(async () => {
    setRunning(true);
    setRows([]);
    setFinishedAt(null);
    setRiskIds([]);
    try {
      const res = await fetch("/api/media");
      const all = ((await res.json()) as MediaItem[]).filter((m) => m.active);
      setProgress({ done: 0, total: all.length });
      const results: CheckRow[] = [];
      // Sequentieel om browser-resources niet te overspoelen
      for (let i = 0; i < all.length; i++) {
        const item = all[i]!;
        const row = await checkOne(item, t);
        results.push(row);
        setRows([...results]);
        setProgress({ done: i + 1, total: all.length });
      }
      try {
        const compatRes = await fetch("/api/media/compat-report");
        if (compatRes.ok) {
          const report = (await compatRes.json()) as {
            id: string;
            reason: string;
            fps?: number | null;
            codec?: string | null;
          }[];
          const byId = new Map(report.map((r) => [r.id, r]));
          const foundRisk: string[] = [];
          for (const row of results) {
            const risk = byId.get(row.id);
            if (!risk || !isDisplayPlaybackRisk(risk.reason)) continue;
            foundRisk.push(row.id);
            row.status = "fail";
            row.message =
              risk.reason === "high_fps"
                ? t("setup.healthPlaybackRiskHighFps", { fps: Math.round(risk.fps ?? 60) })
                : risk.reason === "unsupported_codec"
                  ? t("setup.healthPlaybackRiskCodec", { codec: risk.codec || "?" })
                  : t("setup.healthPlaybackRiskPixel");
          }
          setRows([...results]);
          setRiskIds(foundRisk);
        }
      } catch {
        /* import-check blijft staan als ffmpeg-probe faalt */
      }
      setFinishedAt(Date.now());
    } catch (err) {
      console.error("[AssetHealthCheck]", err);
    } finally {
      setRunning(false);
    }
  }, [t]);

  const prepareRisks = useCallback(async () => {
    if (riskIds.length === 0) return;
    setPreparing(true);
    setPrepareProgress({ done: 0, total: riskIds.length });
    try {
      for (let i = 0; i < riskIds.length; i++) {
        const id = riskIds[i]!;
        await fetch(`/api/media/${id}/prepare`, { method: "POST" });
        setPrepareProgress({ done: i + 1, total: riskIds.length });
      }
      setRiskIds([]);
      await run();
    } finally {
      setPreparing(false);
    }
  }, [riskIds, run]);

  const failCount = rows.filter((r) => r.status === "fail").length;
  const slowCount = rows.filter((r) => r.status === "slow").length;
  const okCount = rows.filter((r) => r.status === "ok").length;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{t("setup.healthTitle")}</div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            {t("setup.healthBody")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button size="sm" disabled={running || preparing} onClick={() => void run()}>
            {running
              ? t("setup.healthRunning", { done: progress.done, total: progress.total })
              : t("setup.healthRun")}
          </Button>
          {riskIds.length > 0 && !running && (
            <Button size="sm" variant="outline" disabled={preparing} onClick={() => void prepareRisks()}>
              {preparing
                ? t("setup.healthPreparing", {
                    done: prepareProgress.done,
                    total: prepareProgress.total,
                  })
                : t("setup.healthPrepare")}
            </Button>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-emerald-600 dark:text-emerald-400">
              {t("setup.healthOk", { count: okCount })}
            </span>
            {slowCount > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                {t("setup.healthSlow", { count: slowCount })}
              </span>
            )}
            {failCount > 0 && (
              <span className="text-red-600 dark:text-red-400 font-semibold">
                {t("setup.healthFail", { count: failCount })}
              </span>
            )}
            {finishedAt && !running && failCount === 0 && slowCount === 0 && (
              <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
                {t("setup.healthAllReady")}
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
                    {r.type === "VIDEO" ? t("setup.healthTypeVideo") : t("setup.healthTypeImage")}
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
