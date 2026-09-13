"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useDisplayStore } from "@/lib/store";
import { sendCommand } from "@/lib/use-socket";
import { isElectron } from "@/lib/electron";
import type { DesktopCaptureSourceInfo } from "@/lib/desktop-bridge";
import { ExternalCaptureVideo } from "@/components/external-capture-video";
import { enumerateCameraCaptureOptions } from "@/lib/enumerate-camera-capture-options";
import {
  AlertTriangle,
  Camera,
  MonitorPlay,
  RefreshCw,
  Volume2,
  VolumeX,
} from "lucide-react";

type UnifiedCaptureSource = DesktopCaptureSourceInfo & {
  category: "desktop" | "camera";
};

/** Bronlijst ververst automatisch zolang het paneel open is — vensters komen en gaan. */
const SOURCE_REFRESH_MS = 5000;

function formatElapsed(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function ExternalCapturePanel() {
  const { t } = useTranslation();
  const state = useDisplayStore((s) => s.state);
  const sourceId = state?.externalCaptureSourceId ?? null;
  const toDisplay = state?.externalCaptureToDisplay ?? false;
  const audioOn = state?.externalCaptureAudio ?? false;
  const isBlackout = state?.mode === "BLACKOUT";

  const [sources, setSources] = useState<UnifiedCaptureSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [liveSince, setLiveSince] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const refreshSources = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!isElectron || !window.electronAPI?.getDesktopCaptureSources) {
        setError(t("external.electronOnly"));
        return;
      }
      if (!opts.silent) setLoadingSources(true);
      try {
        const [deskList, cameras] = await Promise.all([
          window.electronAPI.getDesktopCaptureSources(),
          enumerateCameraCaptureOptions(),
        ]);
        setSources([
          ...deskList.map<UnifiedCaptureSource>((s) => ({ ...s, category: "desktop" })),
          ...cameras.map<UnifiedCaptureSource>((c) => ({
            id: c.id,
            name: c.name,
            thumbnailDataUrl: null,
            category: "camera",
          })),
        ]);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!opts.silent) setLoadingSources(false);
        setLoadedOnce(true);
      }
    },
    [t],
  );

  // Eerste lading + stille auto-refresh: een gesloten venster verdwijnt vanzelf uit de lijst.
  useEffect(() => {
    if (!isElectron) return;
    void refreshSources();
    const id = window.setInterval(() => void refreshSources({ silent: true }), SOURCE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refreshSources]);

  // ON AIR-klok.
  useEffect(() => {
    if (!toDisplay) {
      setLiveSince(null);
      return;
    }
    setLiveSince((prev) => prev ?? Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [toDisplay]);

  useEffect(() => {
    setPreviewError(null);
  }, [sourceId]);

  const selected = useMemo(
    () => sources.find((s) => s.id === sourceId) ?? null,
    [sources, sourceId],
  );
  // Bron staat ingesteld maar zit niet meer in de (verse) lijst → waarschijnlijk weggevallen.
  const selectedMissing = Boolean(sourceId && loadedOnce && !selected && sources.length > 0);

  const desktopSources = sources.filter((s) => s.category === "desktop");
  const cameraSources = sources.filter((s) => s.category === "camera");

  const selectSource = useCallback((id: string | null) => {
    void sendCommand({ type: "display:setExternalCapture", sourceId: id });
  }, []);

  const goLive = useCallback(
    (enabled: boolean) => {
      void sendCommand({ type: "display:setExternalCaptureToDisplay", enabled });
    },
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">
            {t("external.title")}
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">{t("external.help")}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5"
          onClick={() => void refreshSources()}
          disabled={loadingSources || !isElectron}
        >
          <RefreshCw className={`size-3.5 ${loadingSources ? "animate-spin" : ""}`} />
          {t("external.refresh")}
        </Button>
      </div>

      {!isElectron && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600/90">
          {t("external.browserUnavailable")}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* ON AIR — onmiskenbaar, met bronnaam en looptijd. */}
      {toDisplay && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/50 bg-red-500/15 px-3 py-2.5">
          <span className="relative flex size-3 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-70" />
            <span className="relative inline-flex size-3 rounded-full bg-red-500" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black uppercase tracking-[0.18em] text-red-500">
              {t("external.onAir")}
            </div>
            <div className="truncate text-[11px] text-foreground/80">
              {selected?.name ?? t("external.unknownSource")}
            </div>
          </div>
          <span className="shrink-0 font-mono text-sm tabular-nums text-red-500">
            {formatElapsed(liveSince ? (nowMs - liveSince) / 1000 : 0)}
          </span>
        </div>
      )}

      {isBlackout && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600/90">
          {t("external.blackoutPaused")}
        </div>
      )}

      {selectedMissing && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{t("external.sourceGone")}</span>
        </div>
      )}

      {previewError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{t("external.captureFailed", { message: previewError })}</span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        {/* PREVIEW — wat de operator controleert. */}
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {t("external.preview")}
            </span>
            {sourceId && (
              <button
                type="button"
                onClick={() => selectSource(null)}
                className="text-[11px] text-muted-foreground underline hover:text-foreground"
              >
                {t("common.clear")}
              </button>
            )}
          </div>
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
            {sourceId && !previewError ? (
              <ExternalCaptureVideo
                key={sourceId}
                sourceId={sourceId}
                className="h-full w-full"
                audio={false}
                onError={(message) => setPreviewError(message)}
                onEnded={() => setPreviewError(t("external.sourceEnded"))}
                onActive={() => setPreviewError(null)}
              />
            ) : (
              <div className="grid h-full place-items-center px-4 text-center text-[11px] text-muted-foreground">
                {previewError ? t("external.previewUnavailable") : t("external.previewEmpty")}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={toDisplay ? "outline" : "default"}
              className={
                toDisplay
                  ? "gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                  : "gap-1.5"
              }
              disabled={!sourceId || (!toDisplay && !!previewError)}
              onClick={() => goLive(!toDisplay)}
            >
              <MonitorPlay className="size-3.5" />
              {toDisplay ? t("external.stop") : t("external.start")}
            </Button>
            <button
              type="button"
              onClick={() =>
                void sendCommand({
                  type: "display:setExternalCaptureAudio",
                  enabled: !audioOn,
                })
              }
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                audioOn
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary"
              }`}
              title={t("external.audioPassthroughHint")}
            >
              {audioOn ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
              {t("external.audioPassthrough")}
            </button>
          </div>
        </div>

        {/* Bronkiezer als thumbnail-grid: kiezen op beeld, niet op vensternaam. */}
        <div className="flex min-h-0 flex-col gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("external.pickSource")}
          </span>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-background/40 p-2">
            {sources.length === 0 ? (
              <div className="grid h-full min-h-[120px] place-items-center px-4 text-center text-[11px] text-muted-foreground">
                {loadingSources || !loadedOnce ? t("common.loading") : t("external.noSources")}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {desktopSources.length > 0 && (
                  <SourceGroup
                    label={t("external.groupDesktop")}
                    sources={desktopSources}
                    selectedId={sourceId}
                    onSelect={selectSource}
                    liveId={toDisplay ? sourceId : null}
                  />
                )}
                {cameraSources.length > 0 && (
                  <SourceGroup
                    label={t("external.groupCamera")}
                    sources={cameraSources}
                    selectedId={sourceId}
                    onSelect={selectSource}
                    liveId={toDisplay ? sourceId : null}
                  />
                )}
                {cameraSources.length === 0 && desktopSources.length > 0 && (
                  <p className="px-1 text-[10px] text-muted-foreground">
                    {t("external.noCameras")}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceGroup({
  label,
  sources,
  selectedId,
  onSelect,
  liveId,
}: {
  label: string;
  sources: UnifiedCaptureSource[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  liveId: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="grid grid-cols-2 gap-2">
        {sources.map((source) => {
          const isSelected = source.id === selectedId;
          const isLive = source.id === liveId;
          return (
            <button
              key={source.id}
              type="button"
              onClick={() => onSelect(source.id)}
              aria-pressed={isSelected}
              title={source.name}
              className={`group relative overflow-hidden rounded-lg border text-left transition-all ${
                isLive
                  ? "border-red-500 ring-2 ring-red-500/40"
                  : isSelected
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-primary/50"
              }`}
            >
              <div className="relative aspect-video w-full bg-black">
                {source.thumbnailDataUrl ? (
                  <img
                    src={source.thumbnailDataUrl}
                    alt={source.name}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-muted-foreground">
                    <Camera className="size-6" />
                  </div>
                )}
                {isLive && (
                  <span className="absolute left-1 top-1 rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                    {t("external.live")}
                  </span>
                )}
              </div>
              <div className="truncate px-2 py-1.5 text-[11px] text-foreground/90">
                {source.name}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
