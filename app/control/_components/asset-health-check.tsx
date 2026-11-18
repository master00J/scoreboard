"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { MediaItem } from "@/lib/types";
import { mediaUrl } from "@/lib/media-url";
import { isDisplayPlaybackRisk } from "@/lib/media-playback-compat";
import { isElectron, selectFilesViaDialog } from "@/lib/electron";
import type { MediaHealth, MediaHealthReason } from "@/lib/media-health";

type RowStatus = "ok" | "slow" | "warn" | "pending" | "fail";

type CheckRow = {
  id: string;
  title: string;
  type: "VIDEO" | "IMAGE";
  fileName: string;
  status: RowStatus;
  detailMs: number;
  message?: string;
  /** Technische foutregel van FFmpeg, als tooltip. */
  detail?: string | null;
  /** Kapot of verdacht bestand: toon "Vervang bestand". */
  replaceable?: boolean;
};

type ItemHealth = MediaHealth & { id: string; fileName: string };

const PER_ITEM_TIMEOUT_MS = 8000;
const SLOW_THRESHOLD_MS = 1500;
const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "avi"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp"];

function fileNameOf(stored: string): string {
  return stored.split(/[\\/]/).filter(Boolean).pop() ?? stored;
}

/** Snelle controle in de browser: laadt de kop van de video of de afbeelding. */
async function checkOne(item: MediaItem, t: TFunction): Promise<CheckRow> {
  const url = mediaUrl(item.path);
  const start = performance.now();
  const base = { id: item.id, title: item.title, type: item.type, fileName: fileNameOf(item.path) };

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve({
        ...base,
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
          ...base,
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
          ...base,
          status: "fail",
          detailMs: performance.now() - start,
          message: t("setup.healthCodecError"),
          replaceable: true,
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
          ...base,
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
          ...base,
          status: "fail",
          detailMs: performance.now() - start,
          message: t("setup.healthImageFail"),
          replaceable: true,
        });
      };
      img.src = url;
    }
  });
}

function secondsLabel(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "?";
  return sec >= 10 ? String(Math.round(sec)) : sec.toFixed(1);
}

const REASON_KEYS: Partial<Record<MediaHealthReason, string>> = {
  missing_file: "setup.healthReasonMissingFile",
  unreadable: "setup.healthReasonUnreadable",
  truncated: "setup.healthReasonTruncated",
  duration_mismatch: "setup.healthReasonDurationMismatch",
  decode_errors: "setup.healthReasonDecodeErrors",
  probe_failed: "setup.healthReasonProbeFailed",
  ffmpeg_missing: "setup.healthReasonFfmpegMissing",
  timeout: "setup.healthReasonTimeout",
  deferred_live_match: "setup.healthReasonDeferredLiveMatch",
  not_checked: "setup.healthReasonNotChecked",
};

function healthMessage(t: TFunction, health: MediaHealth): string {
  if (health.reason === "truncated" && (health.decodedSec == null || health.expectedSec == null)) {
    return t("setup.healthReasonTruncatedNoTime");
  }
  const key = REASON_KEYS[health.reason];
  if (!key) return t("setup.healthReasonNotChecked");
  return t(key, {
    decoded: secondsLabel(health.decodedSec),
    expected: secondsLabel(health.expectedSec),
  });
}

/** Voegt de volledige decode (hoofdproces) toe aan de snelle browsercontrole. */
function mergeHealth(row: CheckRow, health: ItemHealth | null, t: TFunction): CheckRow {
  if (!health) return row;
  const next: CheckRow = { ...row, fileName: health.fileName || row.fileName };
  if (health.status === "broken") {
    return {
      ...next,
      status: "fail",
      message: healthMessage(t, health),
      detail: health.detail,
      replaceable: true,
    };
  }
  if (health.status === "warning") {
    if (row.status === "fail") return next;
    return {
      ...next,
      status: "warn",
      message: healthMessage(t, health),
      detail: health.detail,
      replaceable: health.reason !== "ffmpeg_missing" && health.reason !== "timeout",
    };
  }
  if (health.status === "pending") {
    if (row.status !== "ok") return next;
    return { ...next, status: "pending", message: healthMessage(t, health) };
  }
  if (row.status === "ok" && row.type === "VIDEO" && health.decodedSec != null) {
    return { ...next, message: t("setup.healthFullOk", { sec: secondsLabel(health.decodedSec) }) };
  }
  return next;
}

async function fetchHealth(id: string): Promise<ItemHealth | null> {
  try {
    const res = await fetch(`/api/media/${id}/check`, { method: "POST" });
    if (!res.ok) return null;
    return (await res.json()) as ItemHealth;
  } catch {
    return null;
  }
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
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = useRef<CheckRow | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setRows([]);
    setFinishedAt(null);
    setRiskIds([]);
    try {
      const res = await fetch("/api/media");
      const payload = await res.json().catch(() => null);
      const all = (res.ok && Array.isArray(payload) ? (payload as MediaItem[]) : []).filter(
        (m) => m.active,
      );
      setProgress({ done: 0, total: all.length });
      const results: CheckRow[] = [];
      // Sequentieel: de browser en FFmpeg niet overspoelen, en het scherm blijft vloeiend.
      for (let i = 0; i < all.length; i++) {
        const item = all[i]!;
        const quick = await checkOne(item, t);
        const health = await fetchHealth(item.id);
        results.push(mergeHealth(quick, health, t));
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
            if (!risk) continue;
            if (risk.reason === "probe_failed") {
              // De kop van de video is niet leesbaar: blijft een waarschuwing, ook na import.
              if (row.status === "ok" || row.status === "slow" || row.status === "pending") {
                row.status = "warn";
                row.message = t("setup.healthReasonProbeFailed");
                row.replaceable = true;
              }
              continue;
            }
            if (!isDisplayPlaybackRisk(risk.reason) || row.status === "fail") continue;
            foundRisk.push(row.id);
            row.status = "fail";
            row.message =
              risk.reason === "high_fps"
                ? t("setup.healthPlaybackRiskHighFps", { fps: Math.round(risk.fps ?? 60) })
                : risk.reason === "unsupported_codec"
                  ? t("setup.healthPlaybackRiskCodec", { codec: risk.codec || "?" })
                  : risk.reason === "unsafe_encoder" || risk.reason === "playback_fault"
                    ? t("setup.healthPlaybackRiskEncoder")
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

  /** Zet het nieuwe bestand op hetzelfde media-item en controleert het meteen opnieuw. */
  const applyReplacement = useCallback(
    async (row: CheckRow, newPath: string) => {
      setReplacingId(row.id);
      try {
        const res = await fetch(`/api/media/${row.id}/replace`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: newPath }),
        });
        if (!res.ok) {
          toast({ title: t("setup.healthReplaceFailed"), description: row.title, variant: "error" });
          return;
        }
        const payload = (await res.json()) as { media: MediaItem; health: ItemHealth };
        const quick = await checkOne(payload.media, t);
        const merged = mergeHealth(quick, payload.health, t);
        setRows((prev) => prev.map((r) => (r.id === row.id ? merged : r)));
        setRiskIds((prev) => prev.filter((id) => id !== row.id));
        toast({ title: t("setup.healthReplaced"), description: `${row.title} → ${merged.fileName}` });
      } catch {
        toast({ title: t("setup.healthReplaceFailed"), description: row.title, variant: "error" });
      } finally {
        setReplacingId(null);
      }
    },
    [t],
  );

  const replaceFile = useCallback(
    async (row: CheckRow) => {
      if (!isElectron) {
        uploadTargetRef.current = row;
        if (uploadRef.current) {
          uploadRef.current.accept = row.type === "VIDEO" ? "video/*" : "image/*";
          uploadRef.current.click();
        }
        return;
      }
      const paths = await selectFilesViaDialog({
        title: t("setup.healthReplaceTitle", { name: row.title }),
        filters: [
          row.type === "VIDEO"
            ? { name: t("media.filterVideo"), extensions: VIDEO_EXTENSIONS }
            : { name: t("media.filterImage"), extensions: IMAGE_EXTENSIONS },
        ],
        multiSelections: false,
      });
      if (paths[0]) await applyReplacement(row, paths[0]);
    },
    [applyReplacement, t],
  );

  /** Zonder Electron (bediening in de browser): eerst uploaden, dan vervangen. */
  const onUploadReplacement = useCallback(
    async (files: FileList | null) => {
      const row = uploadTargetRef.current;
      uploadTargetRef.current = null;
      const file = files?.[0];
      if (uploadRef.current) uploadRef.current.value = "";
      if (!row || !file) return;
      setReplacingId(row.id);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const up = await fetch("/api/upload", { method: "POST", body: fd });
        if (!up.ok) {
          toast({ title: t("setup.healthReplaceFailed"), description: file.name, variant: "error" });
          return;
        }
        const uploaded = (await up.json()) as { path?: string };
        if (uploaded.path) await applyReplacement(row, uploaded.path);
      } finally {
        setReplacingId(null);
      }
    },
    [applyReplacement, t],
  );

  const failCount = rows.filter((r) => r.status === "fail").length;
  const slowCount = rows.filter((r) => r.status === "slow").length;
  const warnCount = rows.filter((r) => r.status === "warn").length;
  const pendingCount = rows.filter((r) => r.status === "pending").length;
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

      <input
        ref={uploadRef}
        type="file"
        className="hidden"
        onChange={(e) => void onUploadReplacement(e.target.files)}
      />

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
            {warnCount > 0 && (
              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                {t("setup.healthWarn", { count: warnCount })}
              </span>
            )}
            {pendingCount > 0 && (
              <span className="text-muted-foreground">
                {t("setup.healthPending", { count: pendingCount })}
              </span>
            )}
            {failCount > 0 && (
              <span className="text-red-600 dark:text-red-400 font-semibold">
                {t("setup.healthFail", { count: failCount })}
              </span>
            )}
            {finishedAt &&
              !running &&
              failCount === 0 &&
              slowCount === 0 &&
              warnCount === 0 &&
              pendingCount === 0 && (
                <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
                  {t("setup.healthAllReady")}
                </span>
              )}
          </div>
          {failCount > 0 && (
            <p className="text-[11px] text-red-700 dark:text-red-300 leading-snug">
              {t("setup.healthBrokenHint")}
            </p>
          )}

          <div className="max-h-72 overflow-y-auto rounded-md border border-input">
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span
                    className={
                      r.status === "ok"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : r.status === "fail"
                          ? "text-red-600 dark:text-red-400 font-semibold"
                          : r.status === "pending"
                            ? "text-muted-foreground"
                            : "text-amber-600 dark:text-amber-400"
                    }
                    aria-hidden
                  >
                    {r.status === "ok" ? "✓" : r.status === "fail" ? "✗" : r.status === "pending" ? "…" : "⚠"}
                  </span>
                  <span className="text-muted-foreground w-12 shrink-0">
                    {r.type === "VIDEO" ? t("setup.healthTypeVideo") : t("setup.healthTypeImage")}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate" title={r.title}>
                      {r.title}
                    </span>
                    {r.fileName && r.fileName !== r.title && (
                      <span className="truncate text-[10px] text-muted-foreground" title={r.fileName}>
                        {r.fileName}
                      </span>
                    )}
                  </span>
                  <span
                    className={
                      r.status === "fail"
                        ? "text-red-700 dark:text-red-300 text-right shrink-0 max-w-[45%]"
                        : "text-muted-foreground tabular-nums text-right shrink-0 max-w-[45%]"
                    }
                    title={r.detail ?? r.message}
                  >
                    {r.message ?? `${Math.round(r.detailMs)} ms`}
                  </span>
                  {r.replaceable && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 text-[10px]"
                      type="button"
                      disabled={running || replacingId !== null}
                      onClick={() => void replaceFile(r)}
                    >
                      {replacingId === r.id ? t("setup.healthReplacing") : t("setup.healthReplace")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
