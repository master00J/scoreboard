"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDisplayStore } from "@/lib/store";
import { sendCommand } from "@/lib/use-socket";
import { useApi } from "@/lib/use-api";
import { isElectron, selectFilesViaDialog } from "@/lib/electron";
import { mediaUrl } from "@/lib/media-url";
import { useLicenseFeatures } from "@/lib/use-license-features";
import { toast } from "@/components/ui/toast";
import type { Match, MatchEvent, Player, MediaItem } from "@/lib/types";
import type { DisplayModeT, MatchStatusT } from "@/lib/validation/commands";
import { isLivePlayingMatchStatus } from "@/lib/live-cycle-settings";
import { getSportProfile } from "@/lib/sports";
import {
  MAX_QUICK_MEDIA_BUTTON_LABEL_LENGTH,
  normalizeQuickMediaButtonLabel,
  quickMediaButtonLabel,
} from "@/lib/quick-media-button";
import {
  ChevronDown,
  FolderOpen,
  Pencil,
  Play,
  Settings2,
  Star,
  Square,
  Trash2,
} from "lucide-react";

const QUICK_MEDIA_FAVORITES_KEY = "stadium-quick-media-favorites-v1";
let quickMediaResumeMode: DisplayModeT = "MATCH";
let quickMediaAutoReturnTimer: ReturnType<typeof setTimeout> | null = null;

const PHASES: { status: MatchStatusT; hint?: string }[] = [
  { status: "PREMATCH", hint: "SETUP of PREMATCH" },
  { status: "FIRST_HALF" },
  { status: "HALF_TIME" },
  { status: "SECOND_HALF" },
  { status: "EXTRA_TIME" },
  { status: "FULL_TIME", hint: "na afloop / full time" },
];

function phaseButtonActive(phaseStatus: MatchStatusT, current?: string): boolean {
  if (!current) return false;
  if (phaseStatus === "PREMATCH") {
    return current === "SETUP" || current === "PREMATCH";
  }
  if (phaseStatus === "FULL_TIME") {
    return current === "FULL_TIME" || current === "POST_MATCH";
  }
  return current === phaseStatus;
}

export function DisplayControlPanel({ activeMatch }: { activeMatch: Match | null }) {
  const { t } = useTranslation();
  const state = useDisplayStore((s) => s.state);
  const tick = useDisplayStore((s) => s.tick);
  const mode = state?.mode ?? "IDLE";
  const livePlay = isLivePlayingMatchStatus(activeMatch?.status);
  const sportProfile = getSportProfile(activeMatch?.sport);
  const { isFeatureAllowed, planLabel } = useLicenseFeatures();
  const automaticSponsorsAllowed = isFeatureAllowed("automatic_sponsor_rotation");

  // Heartbeat: detecteer of het display al lang geen tick meer stuurt terwijl
  // de timer wél zou moeten lopen. In dat geval is het waarschijnlijk vastgelopen.
  const [now, setNow] = useState(() => Date.now());
  const [lastTickAt, setLastTickAt] = useState<number>(0);
  useEffect(() => {
    if (tick) setLastTickAt(Date.now());
  }, [tick]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(id);
  }, []);
  const heartbeatStaleMs =
    state?.timerRunning && lastTickAt > 0 ? now - lastTickAt : 0;
  const displayLikelyStuck = heartbeatStaleMs > 8000;

  const reloadDisplay = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.reloadDisplayWindow) return;
    await window.electronAPI.reloadDisplayWindow();
  }, []);

  const { data: mediaRaw, reload: reloadMedia } = useApi<MediaItem[]>("/api/media");
  const mediaList = useMemo(
    () =>
      (mediaRaw ?? [])
        .filter((m) => m.active && !m.hideFromLibrary)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [mediaRaw],
  );
  const [mediaPickId, setMediaPickId] = useState("");
  const [mediaSearch, setMediaSearch] = useState("");
  const [favoriteMediaIds, setFavoriteMediaIds] = useState<string[]>([]);
  const [quickLabelMediaId, setQuickLabelMediaId] = useState<string | null>(null);
  const [quickLabelDraft, setQuickLabelDraft] = useState("");
  const [savingQuickLabel, setSavingQuickLabel] = useState(false);
  const [removeQuickMediaId, setRemoveQuickMediaId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pickingLocalMedia, setPickingLocalMedia] = useState(false);
  const [quickImageDurationSec, setQuickImageDurationSec] = useState(10);

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(QUICK_MEDIA_FAVORITES_KEY) ?? "[]");
      if (Array.isArray(parsed)) {
        setFavoriteMediaIds(parsed.filter((id): id is string => typeof id === "string"));
      }
    } catch {
      setFavoriteMediaIds([]);
    }
  }, []);

  const filteredMediaList = useMemo(() => {
    const q = mediaSearch.trim().toLowerCase();
    if (!q) return mediaList;
    return mediaList.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        (m.quickButtonLabel ?? "").toLowerCase().includes(q) ||
        (m.type === "VIDEO" ? "video" : "beeld").includes(q) ||
        String(m.durationSec).includes(q),
    );
  }, [mediaList, mediaSearch]);

  const quickMediaList = useMemo(() => {
    const favorites = new Set(favoriteMediaIds);
    return [...filteredMediaList]
      .filter((media) => mediaSearch.trim() || !favorites.has(media.id))
      .sort((a, b) => {
        const favoriteDelta = Number(favorites.has(b.id)) - Number(favorites.has(a.id));
        return favoriteDelta || quickMediaButtonLabel(a).localeCompare(quickMediaButtonLabel(b));
      })
      .slice(0, mediaSearch.trim() ? 10 : 6);
  }, [favoriteMediaIds, filteredMediaList, mediaSearch]);

  const favoriteMediaList = useMemo(() => {
    const byId = new Map(mediaList.map((media) => [media.id, media]));
    return favoriteMediaIds
      .map((id) => byId.get(id))
      .filter((media): media is MediaItem => media != null);
  }, [favoriteMediaIds, mediaList]);

  const quickLabelMedia = useMemo(
    () => mediaList.find((media) => media.id === quickLabelMediaId) ?? null,
    [mediaList, quickLabelMediaId],
  );

  const removeQuickMedia = useMemo(
    () => mediaList.find((media) => media.id === removeQuickMediaId) ?? null,
    [mediaList, removeQuickMediaId],
  );

  function toggleFavorite(mediaId: string) {
    setFavoriteMediaIds((current) => {
      const next = current.includes(mediaId)
        ? current.filter((id) => id !== mediaId)
        : [...current, mediaId];
      try {
        window.localStorage.setItem(QUICK_MEDIA_FAVORITES_KEY, JSON.stringify(next));
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  }

  function pinFavorite(mediaId: string) {
    setFavoriteMediaIds((current) => {
      if (current.includes(mediaId)) return current;
      const next = [...current, mediaId];
      try {
        window.localStorage.setItem(QUICK_MEDIA_FAVORITES_KEY, JSON.stringify(next));
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  }

  function requestQuickButtonRemoval(media: MediaItem) {
    setRemoveQuickMediaId(media.id);
  }

  function closeQuickButtonRemoval() {
    setRemoveQuickMediaId(null);
  }

  function removeQuickButton(mediaId: string) {
    setFavoriteMediaIds((current) => {
      const next = current.filter((id) => id !== mediaId);
      try {
        window.localStorage.setItem(QUICK_MEDIA_FAVORITES_KEY, JSON.stringify(next));
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
    closeQuickButtonRemoval();
    toast({ title: t("display.quickMediaButtonRemoved") });
  }

  function openQuickLabelEditor(media: MediaItem) {
    setQuickLabelMediaId(media.id);
    setQuickLabelDraft(media.quickButtonLabel ?? "");
  }

  async function saveQuickButtonLabel(value = quickLabelDraft) {
    if (!quickLabelMedia || savingQuickLabel) return;
    const label = normalizeQuickMediaButtonLabel(value);
    setSavingQuickLabel(true);
    try {
      const res = await fetch(`/api/media/${quickLabelMedia.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quickButtonLabel: label }),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      if (label) pinFavorite(quickLabelMedia.id);
      reloadMedia();
      setQuickLabelMediaId(null);
      setQuickLabelDraft("");
      toast({
        title: label
          ? t("display.quickMediaRenameSaved", { name: label })
          : t("display.quickMediaRenameResetDone"),
        variant: "success",
      });
    } catch (error) {
      toast({
        title: t("display.quickMediaRenameFailed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "error",
      });
    } finally {
      setSavingQuickLabel(false);
    }
  }

  const applyPhase = useCallback(
    async (status: MatchStatusT) => {
      await sendCommand({ type: "match:setStatus", status });
      /**
       * Speelhelften: automatisch «Scorebord + sponsors» (naast-layout).
       * Andere fases: alleen scorebord — operator kan sponsors manueel aanzetten.
       */
      const liveHalfWithSponsors =
        automaticSponsorsAllowed &&
        (status === "FIRST_HALF" || status === "SECOND_HALF" || status === "EXTRA_TIME");
      await sendCommand({
        type: "display:setMode",
        mode: liveHalfWithSponsors ? "SPONSOR_ROTATION" : "MATCH",
      });
    },
    [automaticSponsorsAllowed],
  );

  async function playMediaItem(item: MediaItem) {
    setMediaPickId(item.id);
    if (mode !== "SPONSOR") {
      quickMediaResumeMode =
        mode === "MATCH" || mode === "SPONSOR_ROTATION" || mode === "IDLE"
          ? mode
          : livePlay && automaticSponsorsAllowed
            ? "SPONSOR_ROTATION"
            : "MATCH";
    }
    if (quickMediaAutoReturnTimer) clearTimeout(quickMediaAutoReturnTimer);
    await sendCommand({
      type: "display:setMode",
      mode: "SPONSOR",
      meta: { activeMediaId: item.id },
    });
    quickMediaAutoReturnTimer = setTimeout(() => {
      quickMediaAutoReturnTimer = null;
      const current = useDisplayStore.getState().state;
      if (current?.mode !== "SPONSOR" || current.activeMediaId !== item.id) return;
      void sendCommand({
        type: "display:setMode",
        mode: quickMediaResumeMode,
      });
    }, Math.max(1500, Math.max(1, item.durationSec) * 1000 + 250));
  }

  async function playMediaOnce(requestedMediaId = mediaPickId) {
    const item = mediaList.find((media) => media.id === requestedMediaId);
    if (!item) return;
    await playMediaItem(item);
  }

  async function chooseLocalMedia() {
    if (!isElectron || pickingLocalMedia) return;
    const paths = await selectFilesViaDialog({
      title: t("display.quickMediaChooseFile"),
      filters: [
        {
          name: t("media.filterMedia"),
          extensions: ["mp4", "webm", "mov", "avi", "jpg", "jpeg", "png", "gif", "webp"],
        },
        { name: t("media.filterVideo"), extensions: ["mp4", "webm", "mov", "avi"] },
        { name: t("media.filterImage"), extensions: ["jpg", "jpeg", "png", "gif", "webp"] },
      ],
      multiSelections: false,
    });
    const filePath = paths[0];
    if (!filePath) return;

    setPickingLocalMedia(true);
    const fileName = filePath.replace(/.*[/\\]/, "");
    try {
      const canonicalPath = filePath.replace(/\\/g, "/").toLowerCase();
      const existing = (mediaRaw ?? []).find(
        (media) => media.path.replace(/\\/g, "/").toLowerCase() === canonicalPath,
      );
      let item: MediaItem;
      if (existing) {
        const requestedImageDuration = clampQuickMediaDuration(quickImageDurationSec);
        const shouldUpdate =
          !existing.active ||
          !!existing.hideFromLibrary ||
          (existing.type === "IMAGE" && existing.durationSec !== requestedImageDuration);
        if (shouldUpdate) {
          const res = await fetch(`/api/media/${existing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              active: true,
              hideFromLibrary: false,
              ...(existing.type === "IMAGE" ? { durationSec: requestedImageDuration } : {}),
            }),
          });
          if (!res.ok) throw new Error(await readApiError(res));
          item = (await res.json()) as MediaItem;
        } else {
          item = existing;
        }
      } else {
        const type: MediaItem["type"] = /\.(mp4|webm|mov|avi)$/i.test(fileName)
          ? "VIDEO"
          : "IMAGE";
        let durationSec = clampQuickMediaDuration(quickImageDurationSec);
        if (type === "VIDEO") {
          try {
            durationSec = await readQuickVideoDuration(mediaUrl(filePath));
          } catch {
            toast({
              title: t("media.videoDurationUnread"),
              description: fileName,
              variant: "error",
            });
            return;
          }
        }
        const res = await fetch("/api/media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            path: filePath,
            title: fileName,
            durationSec,
          }),
        });
        if (!res.ok) throw new Error(await readApiError(res));
        item = (await res.json()) as MediaItem;
      }

      reloadMedia();
      setMediaPickId(item.id);
      setMediaSearch(fileName);
      toast({
        title: t("display.quickMediaFileAdded", { name: fileName }),
        variant: "success",
      });
    } catch (error) {
      toast({
        title: t("display.quickMediaFileAddFailed"),
        description: error instanceof Error ? error.message : fileName,
        variant: "error",
      });
    } finally {
      setPickingLocalMedia(false);
    }
  }

  async function stopManualMedia() {
    if (quickMediaAutoReturnTimer) {
      clearTimeout(quickMediaAutoReturnTimer);
      quickMediaAutoReturnTimer = null;
    }
    await sendCommand({
      type: "display:setMode",
      mode: quickMediaResumeMode,
    });
  }

  async function backToLiveProgram() {
    if (!automaticSponsorsAllowed) return;
    await sendCommand({ type: "display:setMode", mode: "SPONSOR_ROTATION" });
  }

  const primaryLive = mode === "SPONSOR_ROTATION";
  const onlyBoard = mode === "MATCH";
  const oneOffMedia = mode === "SPONSOR" && !!state?.activeMediaId;

  return (
    <div data-display-control-panel className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <Dialog
        open={quickLabelMedia != null}
        onOpenChange={(open) => {
          if (!open && !savingQuickLabel) {
            setQuickLabelMediaId(null);
            setQuickLabelDraft("");
          }
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("display.quickMediaRenameTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("display.quickMediaRenameHelp", { file: quickLabelMedia?.title ?? "" })}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="quick-media-button-label">
                {t("display.quickMediaRenameLabel")}
              </Label>
              <Input
                id="quick-media-button-label"
                autoFocus
                maxLength={MAX_QUICK_MEDIA_BUTTON_LABEL_LENGTH}
                value={quickLabelDraft}
                placeholder={quickLabelMedia?.title ?? t("display.quickMediaRenamePlaceholder")}
                onChange={(event) => setQuickLabelDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveQuickButtonLabel();
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                {quickLabelDraft.length}/{MAX_QUICK_MEDIA_BUTTON_LABEL_LENGTH}
              </p>
            </div>
          </div>
          <DialogFooter className="justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={savingQuickLabel || !quickLabelMedia?.quickButtonLabel}
              onClick={() => void saveQuickButtonLabel("")}
            >
              {t("display.quickMediaRenameReset")}
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={savingQuickLabel}
                onClick={() => setQuickLabelMediaId(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                disabled={savingQuickLabel || !quickLabelDraft.trim()}
                onClick={() => void saveQuickButtonLabel()}
              >
                {savingQuickLabel ? t("common.loading") : t("common.save")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={removeQuickMedia != null}
        onOpenChange={(open) => {
          if (!open) closeQuickButtonRemoval();
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("display.quickMediaRemoveTitle")}</DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm leading-relaxed">
            {t("display.quickMediaRemoveFirstHelp", {
              name: removeQuickMedia ? quickMediaButtonLabel(removeQuickMedia) : "",
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeQuickButtonRemoval}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!removeQuickMedia}
              onClick={() => {
                if (removeQuickMedia) removeQuickButton(removeQuickMedia.id);
              }}
            >
              <Trash2 className="mr-2 size-4" />
              {t("display.quickMediaRemoveFinalAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          {t("display.title")}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse-dot" />
          <span className="font-mono text-[10px] sm:text-xs bg-secondary px-2 py-1 rounded max-w-[140px] truncate">
            {mode}
          </span>
        </div>
      </div>

      {displayLikelyStuck && (
        <div className="rounded-md border border-amber-500/60 bg-amber-500/10 p-3 text-xs leading-snug">
          <p className="font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
            {t("display.stuckTitle")}
          </p>
          <p className="mt-1 text-foreground/90">
            {t("display.stuckBody", { seconds: Math.round(heartbeatStaleMs / 1000) })}
          </p>
          {isElectron && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-amber-500/60"
                onClick={() => void reloadDisplay()}
              >
                {t("display.restartDisplay")}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="order-2 flex flex-col gap-2">
      <section className="space-y-1.5">
        <div className="text-xs font-medium text-foreground/90">{t("display.phaseTitle")}</div>
        <p className="hidden text-[11px] text-muted-foreground leading-snug">
          {t("display.phaseHint")}
        </p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {sportProfile.id === "FOOTBALL" ? PHASES.map((p) => (
            <Button
              key={p.status}
              size="sm"
              variant={phaseButtonActive(p.status, activeMatch?.status) ? "default" : "outline"}
              disabled={!activeMatch}
              className="h-auto min-h-8 whitespace-normal px-2 py-1.5 text-center leading-tight"
              title={p.hint}
              onClick={() => void applyPhase(p.status)}
            >
              {t(`phases.${p.status}`)}
            </Button>
          )) : (
            <>
              {Array.from({ length: sportProfile.periodCount }, (_, index) => index + 1).map((period) => (
                <Button
                  key={period}
                  size="sm"
                  variant={activeMatch?.currentPeriod === period && livePlay ? "default" : "outline"}
                  disabled={!activeMatch}
                  onClick={() => void sendCommand({ type: "sport:setPeriod", period })}
                >
                  {sportProfile.periodLabel} {period}
                </Button>
              ))}
              <Button
                size="sm"
                variant={activeMatch?.status === "HALF_TIME" ? "default" : "outline"}
                disabled={!activeMatch}
                onClick={() => void applyPhase("HALF_TIME")}
              >
                {t("display.pause")}
              </Button>
              <Button
                size="sm"
                variant={activeMatch?.status === "FULL_TIME" ? "default" : "outline"}
                disabled={!activeMatch}
                onClick={() => void applyPhase("FULL_TIME")}
              >
                {t("phases.FULL_TIME")}
              </Button>
            </>
          )}
        </div>
        {!activeMatch && (
          <p className="text-[11px] text-amber-600/90 dark:text-amber-400/90">
            {t("display.noActiveMatch")}
          </p>
        )}
      </section>

      <section className="space-y-1.5 border-t border-border pt-2.5">
        <div className="text-xs font-medium text-foreground/90">{t("display.boardVsSponsors")}</div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <Button
            size="lg"
            variant={primaryLive ? "default" : "outline"}
            className="h-auto min-h-11 flex-col items-center justify-center gap-0.5 whitespace-normal px-2 py-1.5 text-center leading-snug"
            disabled={!automaticSponsorsAllowed}
            title={
              automaticSponsorsAllowed
                ? undefined
                : t("display.sponsorsLicenseOff", { plan: "" })
            }
            onClick={() => void backToLiveProgram()}
          >
            <span className="text-pretty">{t("display.boardPlusSponsors")}</span>
            <span className="text-[10px] font-normal leading-snug opacity-80">
              {t("display.boardPlusSponsorsHint")}
            </span>
          </Button>
          <Button
            size="lg"
            variant={onlyBoard ? "default" : "outline"}
            className="h-auto min-h-11 flex-col items-center justify-center gap-0.5 whitespace-normal px-2 py-1.5 text-center leading-snug"
            onClick={() => void sendCommand({ type: "display:setMode", mode: "MATCH" })}
          >
            <span className="text-pretty">{t("display.boardOnly")}</span>
            <span className="text-[10px] font-normal leading-snug opacity-80">
              {t("display.boardOnlyHint")}
            </span>
          </Button>
        </div>
        {!automaticSponsorsAllowed && (
          <p className="text-[11px] text-amber-700/90 dark:text-amber-400/90 leading-snug rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            {t("display.sponsorsLicenseOff", {
              plan: planLabel ? ` (${planLabel})` : "",
            })}
          </p>
        )}
      </section>
      </div>

      <section className="order-1 space-y-2 border-t border-border pt-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-foreground/90">
              {t("display.quickMediaTitle")}
            </div>
            <p className="mt-0.5 hidden text-[11px] leading-snug text-muted-foreground 2xl:block">
              {t("display.quickMediaHint")}
            </p>
          </div>
          {oneOffMedia && (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-8 gap-1.5"
              onClick={() => void stopManualMedia()}
            >
              <Square className="size-3.5 fill-current" />
              {t("display.quickMediaStop")}
            </Button>
          )}
        </div>

        {isElectron && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/60 p-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 min-w-0 flex-1 gap-1.5 px-3 sm:flex-none"
              disabled={pickingLocalMedia}
              onClick={() => void chooseLocalMedia()}
            >
              <FolderOpen className="size-3.5" />
              {pickingLocalMedia
                ? t("display.quickMediaChoosingFile")
                : t("display.quickMediaChooseFile")}
            </Button>
            <label className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {t("display.quickMediaImageDuration")}
              <Input
                type="number"
                min={1}
                max={600}
                value={quickImageDurationSec}
                onChange={(event) =>
                  setQuickImageDurationSec(clampQuickMediaDuration(Number(event.target.value)))
                }
                className="h-8 w-16 px-2 text-center text-xs tabular-nums text-foreground"
                aria-label={t("display.quickMediaImageDuration")}
              />
              s
            </label>
            <p className="w-full text-[10px] leading-snug text-muted-foreground">
              {t("display.quickMediaFileHint")}
            </p>
          </div>
        )}

        {oneOffMedia && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
            <span className="min-w-0 flex-1 truncate font-semibold">
              {(() => {
                const playing = mediaList.find((media) => media.id === state?.activeMediaId);
                return playing ? quickMediaButtonLabel(playing) : t("display.quickMediaPlaying");
              })()}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {t("display.quickMediaAutoReturn")}
            </span>
          </div>
        )}

        <div className="rounded-xl border border-primary/35 bg-primary/5 p-2.5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-foreground">
                {t("display.quickMediaButtonsTitle")}
              </div>
              <p className="text-[10px] leading-snug text-muted-foreground">
                {t("display.quickMediaButtonsHint")}
              </p>
            </div>
            <span className="rounded-full bg-primary/15 px-2 py-1 text-[10px] font-bold text-primary">
              {favoriteMediaList.length}
            </span>
          </div>
          {favoriteMediaList.length === 0 ? (
            <div className="rounded-lg border border-dashed border-primary/30 px-3 py-3 text-center text-[11px] text-muted-foreground">
              {t("display.quickMediaButtonsEmpty")}
            </div>
          ) : (
            <div className="grid max-h-44 grid-cols-1 gap-1.5 overflow-y-auto pr-0.5 sm:grid-cols-2">
              {favoriteMediaList.map((media) => {
                const active = oneOffMedia && state?.activeMediaId === media.id;
                return (
                  <div
                    key={media.id}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] grid-rows-2 gap-1"
                  >
                    <Button
                      type="button"
                      variant={active ? "default" : "outline"}
                      className={`row-span-2 h-auto min-h-12 min-w-0 justify-start gap-2 px-3 text-left ${
                        active
                          ? "shadow-[0_0_0_2px_hsl(var(--primary)/0.2)]"
                          : "border-primary/45 bg-background hover:bg-primary/10"
                      }`}
                      title={`${quickMediaButtonLabel(media)} — ${media.title}`}
                      onClick={() => void playMediaOnce(media.id)}
                    >
                      <Play className="size-4 shrink-0 fill-current" />
                      <span className="min-w-0 break-words text-sm font-black leading-tight">
                        {quickMediaButtonLabel(media)}
                      </span>
                    </Button>
                    <button
                      type="button"
                      className="grid size-8 place-items-center rounded-md border border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-primary"
                      aria-label={t("display.quickMediaRename")}
                      title={t("display.quickMediaRename")}
                      onClick={() => openQuickLabelEditor(media)}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="grid size-8 place-items-center rounded-md border border-border bg-background text-destructive hover:border-destructive/50 hover:bg-destructive/10"
                      aria-label={t("display.quickMediaRemoveButton")}
                      title={t("display.quickMediaRemoveButton")}
                      onClick={() => requestQuickButtonRemoval(media)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Input
          type="search"
          placeholder={t("display.oneOffSearch")}
          value={mediaSearch}
          onChange={(event) => setMediaSearch(event.target.value)}
          className="h-8"
          aria-label={t("display.oneOffSearch")}
        />

        <div className="max-h-44 overflow-y-auto rounded-lg border border-input bg-background">
          {quickMediaList.length === 0 ? (
            <div className="px-3 py-5 text-center text-xs text-muted-foreground">
              {mediaList.length === 0
                ? t("display.quickMediaEmpty")
                : mediaSearch.trim()
                  ? t("display.quickMediaNoResults")
                  : t("display.quickMediaAllPinned")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {quickMediaList.map((media) => {
                const favorite = favoriteMediaIds.includes(media.id);
                return (
                  <li key={media.id} className="flex min-w-0 items-center gap-2 px-2 py-1.5">
                    <button
                      type="button"
                      className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-amber-500"
                      onClick={() => toggleFavorite(media.id)}
                      aria-label={
                        favorite
                          ? t("display.quickMediaUnfavorite")
                          : t("display.quickMediaFavorite")
                      }
                      title={
                        favorite
                          ? t("display.quickMediaUnfavorite")
                          : t("display.quickMediaFavorite")
                      }
                    >
                      <Star className={`size-4 ${favorite ? "fill-amber-400 text-amber-400" : ""}`} />
                    </button>
                    <button
                      type="button"
                      className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-primary"
                      onClick={() => openQuickLabelEditor(media)}
                      aria-label={t("display.quickMediaRename")}
                      title={t("display.quickMediaRename")}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-md px-1 py-1 text-left hover:bg-secondary/60"
                      onClick={() => setMediaPickId(media.id)}
                    >
                      <span className="block truncate text-xs font-semibold">
                        {quickMediaButtonLabel(media)}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {media.quickButtonLabel ? `${media.title} · ` : ""}
                        {media.sponsorName ?? t("display.quickMediaGeneral")} · {media.type === "VIDEO" ? t("media.typeVideo") : t("media.typeImage")} · {media.durationSec}s
                      </span>
                    </button>
                    <Button
                      type="button"
                      size="sm"
                      variant={state?.activeMediaId === media.id && oneOffMedia ? "default" : "secondary"}
                      className="h-8 shrink-0 gap-1.5 px-3"
                      onClick={() => void playMediaOnce(media.id)}
                    >
                      <Play className="size-3.5 fill-current" />
                      {t("display.quickMediaShow")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {!mediaSearch.trim() && mediaList.length > quickMediaList.length && (
          <p className="text-[10px] text-muted-foreground">
            {t("display.quickMediaSearchMore", { count: mediaList.length })}
          </p>
        )}
      </section>

      <button
        type="button"
        onClick={() => setAdvancedOpen((value) => !value)}
        className="order-3 flex h-8 items-center justify-between gap-3 rounded-lg border border-border bg-background/60 px-3 text-xs font-semibold text-foreground hover:bg-muted"
        aria-expanded={advancedOpen}
      >
        <span className="inline-flex items-center gap-2">
          <Settings2 className="size-4 text-muted-foreground" />
          {t("display.advancedControls")}
        </span>
        <ChevronDown className={`size-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
      </button>

      {false && advancedOpen && (
      <section className="space-y-2 border-t border-border pt-4">
        <div className="text-xs font-medium text-foreground/90">{t("display.oneOffTitle")}</div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          {t("display.oneOffPick")}
        </p>
        <div className="space-y-2">
          <Input
            type="search"
            placeholder={t("display.oneOffSearch")}
            value={mediaSearch}
            onChange={(e) => setMediaSearch(e.target.value)}
            className="h-10"
            aria-label={t("display.oneOffSearch")}
          />
          <div className="max-h-44 overflow-y-auto rounded-md border border-input bg-background">
            {filteredMediaList.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                {mediaList.length === 0
                  ? "Nog geen media."
                  : "Geen resultaten."}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {filteredMediaList.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className={`w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-secondary/80 ${
                        mediaPickId === m.id ? "bg-secondary font-medium" : ""
                      }`}
                      onClick={() => setMediaPickId(m.id)}
                    >
                      <span className="text-muted-foreground text-xs mr-2">
                        {m.type === "VIDEO" ? "Video" : "Beeld"}
                      </span>
                      <span className="break-words">{m.title}</span>
                      <span className="text-muted-foreground text-xs ml-1">· {m.durationSec}s</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {mediaPickId && (
            <p className="text-[11px] text-muted-foreground">
              <strong className="text-foreground">
                {mediaList.find((m) => m.id === mediaPickId)?.title ?? "—"}
              </strong>
              <button
                type="button"
                className="ml-2 underline text-foreground/80 hover:text-foreground"
                onClick={() => setMediaPickId("")}
              >
                {t("common.clear")}
              </button>
            </p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            type="button"
            className="sm:flex-1"
            disabled={!mediaPickId}
            variant={oneOffMedia ? "default" : "secondary"}
            onClick={() => void playMediaOnce()}
          >
            {t("display.oneOffShow")}
          </Button>
          <Button type="button" variant="outline" className="sm:flex-1" onClick={() => void backToLiveProgram()}>
            {t("display.boardPlusSponsors")}
          </Button>
        </div>
      </section>
      )}

      {advancedOpen && isElectron && (
        <Button
          size="sm"
          variant="outline"
          className="order-3 h-8 self-start text-[11px]"
          title={t("display.restartDisplay")}
          onClick={() => void reloadDisplay()}
        >
          {t("display.restartDisplay")}
        </Button>
      )}

      <Button
        size="default"
        variant="destructive"
        className="order-3 h-9 font-black tracking-wider"
        onClick={() => void sendCommand({ type: "display:blackout" })}
      >
        BLACKOUT
      </Button>
    </div>
  );
}

function clampQuickMediaDuration(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(600, Math.max(1, Math.round(value)));
}

async function readApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string"
    ? body.error
    : response.statusText || `HTTP ${response.status}`;
}

function readQuickVideoDuration(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    let settled = false;
    const timeout = window.setTimeout(() => finishError(new Error("timeout")), 15000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      try {
        video.removeAttribute("src");
        video.load();
      } catch {
        /* ignore cleanup errors */
      }
    };
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const finishSuccess = (seconds: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(clampQuickMediaDuration(seconds));
    };

    video.onloadedmetadata = () => {
      const seconds = video.duration;
      if (Number.isFinite(seconds) && seconds > 0) finishSuccess(seconds);
      else finishError(new Error("invalid duration"));
    };
    video.onerror = () => finishError(new Error("video error"));
    video.src = src;
  });
}

export function EventLog({ match }: { match: Match | null }) {
  const { t } = useTranslation();
  const { data: fresh, reload } = useApi<Match>(match ? `/api/matches/${match.id}` : null);
  const state = useDisplayStore((s) => s.state);

  useEffect(() => {
    reload();
  }, [state?.updatedAt, reload]);

  const events = fresh?.events ?? [];
  const playerMap: Record<string, Player> = {};
  for (const p of fresh?.homeTeam.players ?? []) playerMap[p.id] = p;
  for (const p of fresh?.awayTeam.players ?? []) playerMap[p.id] = p;

  return (
    <div className="bg-card border border-border rounded-xl p-6 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("display.eventLog")}</h2>
      <div className="flex flex-col gap-1 max-h-80 overflow-auto">
        {events.length === 0 && (
          <div className="text-sm text-muted-foreground">{t("display.noEvents")}</div>
        )}
        {events.map((e) => (
          <EventRow
            key={e.id}
            event={e}
            playerMap={playerMap}
            onUndo={async () => {
              await sendCommand({ type: "event:undo", eventId: e.id });
              reload();
            }}
          />
        ))}
      </div>
    </div>
  );
}

function EventRow({
  event,
  playerMap,
  onUndo,
}: {
  event: MatchEvent;
  playerMap: Record<string, Player>;
  onUndo: () => void;
}) {
  const { t } = useTranslation();
  const p = event.playerInId ? playerMap[event.playerInId] : null;
  const out = event.playerOutId ? playerMap[event.playerOutId] : null;

  const icon =
    event.type === "GOAL"
      ? "⚽"
      : event.type === "SUB"
        ? "🔁"
        : event.type === "CARD_YELLOW"
          ? "🟨"
          : event.type === "CARD_RED"
            ? "🟥"
            : event.type === "TIMER_ADJUST"
              ? "⏱"
              : "·";

  return (
    <div className="flex items-center gap-3 rounded border border-border p-2 text-sm">
      <span className="text-xs text-muted-foreground w-10 text-right">
        {event.minute}'
      </span>
      <span className="text-lg">{icon}</span>
      <span className="flex-1 truncate">
        {event.type === "GOAL" && p && `Goal — ${p.firstName} ${p.lastName} (#${p.number})`}
        {event.type === "SUB" && (
          <>
            {t("matchLive.sub")}: {out ? `${out.lastName}` : "?"} → {p ? `${p.lastName}` : "?"}
          </>
        )}
        {event.type === "CARD_YELLOW" && p && `${t("display.yellow")} ${p.lastName}`}
        {event.type === "CARD_RED" && p && `${t("display.red")} ${p.lastName}`}
        {event.type === "TIMER_ADJUST" && <span className="text-muted-foreground">{event.note}</span>}
      </span>
      <Button size="sm" variant="ghost" onClick={onUndo}>
        Undo
      </Button>
    </div>
  );
}

export function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}
