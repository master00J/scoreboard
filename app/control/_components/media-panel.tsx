"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/form";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useApi } from "@/lib/use-api";
import type { Match, MediaItem, ScheduledMediaCue, Sponsor } from "@/lib/types";
import { useDisplayStore } from "@/lib/store";
import { effectiveMatchPlayRosterSeconds } from "@/lib/sponsor-roster-effective-timeline";
import { isLivePlayingMatchStatus } from "@/lib/live-cycle-settings";
import { useLiveTimerSeconds } from "@/lib/use-timer";
import { useWallClockMs } from "@/lib/use-wall-clock-tick";
import { sponsorSectionBudgetSeconds } from "@/lib/sponsor-distribution";
import {
  sponsorTelemetryConsumedSec,
  sponsorTelemetrySegmentKey,
} from "@/lib/sponsor-telemetry";
import {
  applyRosterBudgetCarry,
  sponsorLiveProgressFromRosterRaw,
  type RosterCarry,
} from "@/lib/sponsor-live-roster";
import { useHalftimeSponsorTimelineT } from "@/lib/use-halftime-sponsor-timeline";
import { toast } from "@/components/ui/toast";
import { sendCommand } from "@/lib/use-socket";
import { isElectron, selectFilesViaDialog } from "@/lib/electron";
import { mediaUrl } from "@/lib/media-url";
import {
  parseSponsorMediaPhaseTags,
  serializeSponsorMediaPhaseTags,
  SPONSOR_MEDIA_PHASES,
  type SponsorMediaPhase,
} from "@/lib/sponsor-media-phases";
import {
  applySponsorPlaybackOrder,
  clampRepeat,
  parseSponsorPlaybackOrderJson,
  parseSponsorPlaybackRepeatsJson,
} from "@/lib/sponsor-playback-order";
import { isDisplayPlaybackRisk } from "@/lib/media-playback-compat";
import { cueRundownPhaseKey, nextRundownWindow, restackRundownWindows } from "@/lib/scheduled-media-cue";
import type { TFunction } from "i18next";

type PlaybackInspect = {
  reason?: string;
  fps?: number;
  codec?: string;
};

function playbackRiskDetail(t: TFunction, inspect: PlaybackInspect): string {
  if (inspect.reason === "high_fps") {
    return t("media.playbackWarnHighFps", { fps: Math.round(inspect.fps ?? 60) });
  }
  if (inspect.reason === "unsupported_codec") {
    return t("media.playbackWarnCodec", { codec: inspect.codec || "?" });
  }
  return t("media.playbackWarnPixel");
}

function notifyPlaybackRisk(t: TFunction, inspect: PlaybackInspect | null | undefined, fileName: string) {
  if (!inspect?.reason || !isDisplayPlaybackRisk(inspect.reason)) return;
  toast({
    title: t("media.playbackWarnTitle"),
    description: `${fileName} — ${playbackRiskDetail(t, inspect)}`,
    variant: "error",
  });
}

async function prepareMediaPlayback(t: TFunction, mediaId: string): Promise<boolean> {
  const res = await fetch(`/api/media/${mediaId}/prepare`, { method: "POST" });
  if (!res.ok) {
    toast({ title: t("media.playbackFixFailed"), variant: "error" });
    return false;
  }
  toast({ title: t("media.playbackFixed"), description: t("media.playbackFixHint") });
  return true;
}

const SCHEDULED_CUE_PHASES = ["PREMATCH", "FIRST_HALF", "SECOND_HALF", "EXTRA_TIME", "POST_MATCH"] as const;

const MEDIA_PHASE_I18N: Record<string, string> = {
  prematch: "media.phasePrematch",
  firstHalf: "media.phaseFirstHalf",
  secondHalf: "media.phaseSecondHalf",
  halftime: "media.phaseHalftime",
  extraTime: "media.phaseExtraTime",
  postmatch: "media.phasePostmatch",
};

async function patchMediaJson(
  mediaId: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const res = await fetch(`/api/media/${mediaId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

/** Nieuwe sponsor-media achteraan in de rotatievolgorde (JSON-array); leeg = alle actieve clips. */
async function appendSponsorPlaybackOrderRow(sponsorId: string, mediaId: string): Promise<void> {
  try {
    const g = await fetch(`/api/sponsors/${sponsorId}`);
    if (!g.ok) return;
    const sp = (await g.json()) as { sponsorPlaybackOrderJson?: string | null };
    const ids = parseSponsorPlaybackOrderJson(sp.sponsorPlaybackOrderJson);
    if (ids.includes(mediaId)) return;
    await fetch(`/api/sponsors/${sponsorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sponsorPlaybackOrderJson: JSON.stringify([...ids, mediaId]) }),
    });
  } catch {
    /* ignore */
  }
}

export function MediaPanel() {
  const { t } = useTranslation();
  const displayState = useDisplayStore((s) => s.state);
  const matchPollUrl =
    displayState?.matchId != null
      ? `/api/matches/${displayState.matchId}?_=${encodeURIComponent(displayState.updatedAt ?? "")}`
      : null;
  const { data: activeMatch } = useApi<Match>(matchPollUrl);
  const sponsorBudgetsDriveLive = isLivePlayingMatchStatus(activeMatch?.status);

  const { data: mediaRaw, reload: reloadMedia } = useApi<MediaItem[]>("/api/media");
  const { data: scheduledCuesRaw, reload: reloadScheduledCues } =
    useApi<ScheduledMediaCue[]>("/api/scheduled-media-cues");
  const [uploading, setUploading] = useState(false);
  const [libraryImageDurationSec, setLibraryImageDurationSec] = useState(10);
  const [mediaSearch, setMediaSearch] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const media = mediaRaw ?? [];
  const scheduledCues = scheduledCuesRaw ?? [];
  const libraryMedia = useMemo(
    () => media.filter((m) => !m.hideFromLibrary),
    [media],
  );
  const visibleMedia = libraryMedia.filter((m) => {
    const q = mediaSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      m.title.toLowerCase().includes(q) ||
      m.type.toLowerCase().includes(q) ||
      (m.sponsorName ?? "").toLowerCase().includes(q)
    );
  });

  const libraryBySponsor = useMemo(() => {
    const loose = visibleMedia.filter((m) => !m.sponsorId);
    const map = new Map<string, { name: string; items: MediaItem[] }>();
    for (const m of visibleMedia) {
      if (!m.sponsorId) continue;
      const sid = m.sponsorId;
      if (!map.has(sid)) {
        map.set(sid, { name: m.sponsorName ?? t("sponsors.colSponsor"), items: [] });
      }
      map.get(sid)!.items.push(m);
    }
    const groups = [...map.entries()]
      .map(([sponsorId, g]) => ({
        sponsorId,
        name: g.name,
        items: [...g.items].sort((a, b) => a.title.localeCompare(b.title, "nl")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "nl"));
    return { loose, groups };
  }, [visibleMedia, t]);

  /** Register a local file (Electron) — no copying, just store the path. */
  async function registerLocalFile(filePath: string) {
    const fileName = filePath.replace(/.*[/\\]/, "");
    const isVideo = /\.(mp4|webm|mov|avi)$/i.test(fileName);
    const type = isVideo ? "VIDEO" : "IMAGE";
    let durationSec = clampMediaDurationSec(libraryImageDurationSec);
    if (isVideo) {
      try {
        durationSec = await readVideoDuration(mediaUrl(filePath));
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
        durationSec: Math.round(durationSec),
      }),
    });
    if (res.ok) {
      const created = (await res.json()) as { playbackInspect?: PlaybackInspect };
      notifyPlaybackRisk(t, created.playbackInspect, fileName);
    }
  }

  /** Pick files via Electron's native dialog (no upload needed). */
  async function onSelectLocal() {
    const paths = await selectFilesViaDialog({
      title: t("media.selectFilesTitle"),
      filters: [
        { name: t("media.filterMedia"), extensions: ["mp4", "webm", "mov", "avi", "jpg", "jpeg", "png", "gif", "webp"] },
        { name: t("media.filterVideo"), extensions: ["mp4", "webm", "mov", "avi"] },
        { name: t("media.filterImage"), extensions: ["jpg", "jpeg", "png", "gif", "webp"] },
      ],
      multiSelections: true,
    });
    if (paths.length === 0) return;
    setUploading(true);
    for (const p of paths) await registerLocalFile(p);
    setUploading(false);
    reloadMedia();
  }

  /** Upload via browser file input (fallback when not in Electron). */
  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      if (!up.ok) {
        toast({ title: t("media.uploadFailed", { name: file.name }), variant: "error" });
        continue;
      }
      const uploaded = await up.json();
      const type = file.type.startsWith("video/") ? "VIDEO" : "IMAGE";
      let durationSec = clampMediaDurationSec(libraryImageDurationSec);
      if (type === "VIDEO") {
        try {
          durationSec = await readVideoDuration(uploaded.path);
        } catch {
          toast({
            title: t("media.videoDurationUnread"),
            description: file.name,
            variant: "error",
          });
          continue;
        }
      }
      await fetch("/api/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          path: uploaded.path,
          title: file.name,
          durationSec: Math.round(durationSec),
        }),
      });
    }
    setUploading(false);
    reloadMedia();
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">{t("media.title")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t("media.introBody")}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border bg-background/60 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-foreground">1. {t("media.tabSponsors")}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("media.stepSponsorsHint")}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/60 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-foreground">2. {t("media.tabLibrary")}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("media.stepLibraryHint")}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/60 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-foreground">3. {t("media.tabCues")}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("media.stepCuesHint")}
            </p>
          </div>
        </div>
      </section>

      <Tabs defaultValue="sponsors" className="space-y-4">
        <TabsList className="h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="sponsors" className="min-w-36">
            {t("media.tabSponsors")}
          </TabsTrigger>
          <TabsTrigger value="library" className="min-w-36">
            {t("media.tabLibrary")}
          </TabsTrigger>
          <TabsTrigger value="scheduled" className="min-w-36">
            {t("media.tabCues")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sponsors" className="mt-0">
          <SponsorsSection
            allMedia={media}
            reloadMedia={reloadMedia}
            activeMatch={activeMatch ?? null}
          />
        </TabsContent>

        <TabsContent value="library" className="mt-0">
      <section className="bg-card border border-border rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold">{t("media.tabLibrary")}</h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              {t("media.libraryHelp")}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Label className="text-xs whitespace-nowrap">{t("media.imageDurationLabel")}</Label>
            <Input
              type="number"
              min={1}
              max={600}
              value={libraryImageDurationSec}
              onChange={(e) =>
                setLibraryImageDurationSec(clampMediaDurationSec(Number(e.target.value)))
              }
              className="w-20 h-9"
            />
          </div>
        </div>
        <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <Input
            type="search"
            placeholder={t("media.searchPlaceholder")}
            value={mediaSearch}
            onChange={(e) => setMediaSearch(e.target.value)}
            className="h-10"
          />
          {isElectron ? (
            <Button onClick={onSelectLocal} disabled={uploading}>
              {uploading ? t("common.busy") : t("media.selectFiles")}
            </Button>
          ) : (
            <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground cursor-pointer text-sm font-semibold hover:opacity-90">
              {uploading ? t("media.uploading") : t("media.uploadMedia")}
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,video/*"
                className="hidden"
                onChange={(e) => onUpload(e.target.files)}
              />
            </label>
          )}
        </div>
        <div className="mb-3 text-xs text-muted-foreground space-y-1">
          <p>
            {t("media.visibleCount", { visible: visibleMedia.length, total: libraryMedia.length })}
            {media.length > libraryMedia.length ? (
              <>
                {" "}
                · {t("media.hiddenTechnical", { count: media.length - libraryMedia.length })}
              </>
            ) : null}
            .
          </p>
          <p>{t("media.groupHint")}</p>
        </div>
        {libraryMedia.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t("media.libraryEmpty")}
          </div>
        ) : visibleMedia.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t("media.searchEmpty")}</div>
        ) : (
          <div className="space-y-8">
            {libraryBySponsor.loose.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3 pb-1 border-b border-border">
                  {t("media.groupLooseCount", { count: libraryBySponsor.loose.length })}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {libraryBySponsor.loose.map((m) => (
                    <MediaCard
                      key={m.id}
                      item={m}
                      onChange={reloadMedia}
                      lockManualSponsorInterrupt={sponsorBudgetsDriveLive}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            {libraryBySponsor.groups.map((g) => (
              <div key={g.sponsorId}>
                <h3 className="text-sm font-semibold text-foreground mb-3 pb-1 border-b border-border">
                  {g.name} · {g.items.length}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {g.items.map((m) => (
                    <MediaCard
                      key={m.id}
                      item={m}
                      onChange={reloadMedia}
                      lockManualSponsorInterrupt={sponsorBudgetsDriveLive}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
        </TabsContent>

        <TabsContent value="scheduled" className="mt-0">
          <ScheduledCuesSection
            media={libraryMedia}
            cues={scheduledCues}
            onChange={reloadScheduledCues}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ScheduledCuesSection({
  media,
  cues,
  onChange,
}: {
  media: MediaItem[];
  cues: ScheduledMediaCue[];
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const activeMedia = media.filter((m) => m.active).sort((a, b) => a.title.localeCompare(b.title));
  const [pickedIds, setPickedIds] = useState<string[]>(activeMedia[0] ? [activeMedia[0].id] : []);
  const [matchStatus, setMatchStatus] = useState<(typeof SCHEDULED_CUE_PHASES)[number]>("POST_MATCH");
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(15);
  const [saving, setSaving] = useState(false);
  const [loopRundown, setLoopRundown] = useState(false);
  const [mediaQuery, setMediaQuery] = useState("");

  useEffect(() => {
    if (pickedIds.length === 0 && activeMedia[0]) setPickedIds([activeMedia[0].id]);
  }, [activeMedia, pickedIds.length]);

  useEffect(() => {
    const list = cues.filter((c) => cueRundownPhaseKey(c.matchStatus) === matchStatus);
    setLoopRundown(list.some((c) => c.loop));
  }, [cues, matchStatus]);

  const filteredMedia = useMemo(() => {
    const q = mediaQuery.trim().toLowerCase();
    if (!q) return activeMedia;
    return activeMedia.filter((m) => m.title.toLowerCase().includes(q));
  }, [activeMedia, mediaQuery]);

  const phaseCues = useMemo(() => {
    const groups = new Map<string, ScheduledMediaCue[]>();
    for (const key of SCHEDULED_CUE_PHASES) groups.set(key, []);
    for (const cue of cues) {
      const key = cueRundownPhaseKey(cue.matchStatus);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(cue);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.triggerSec - b.triggerSec || a.createdAt.localeCompare(b.createdAt));
    }
    return groups;
  }, [cues]);

  async function postCue(mediaId: string, triggerSec: number, end: number | null) {
    const res = await fetch("/api/scheduled-media-cues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaId,
        matchStatus,
        triggerSec,
        endSec: end != null && end > triggerSec ? end : null,
        enabled: true,
        loop: loopRundown,
      }),
    });
    return res.ok;
  }

  async function addAtTime() {
    const mediaId = pickedIds[0];
    const item = activeMedia.find((m) => m.id === mediaId) ?? null;
    const triggerSec = Math.max(0, Math.round(startSec));
    const end = Math.max(0, Math.round(endSec));
    if (!mediaId) {
      toast({ title: t("media.cueInvalidInput"), variant: "error" });
      return;
    }
    if (item?.type === "IMAGE" && end <= triggerSec) {
      toast({ title: t("media.cueInvalidRange"), variant: "error" });
      return;
    }
    if (end > 0 && end <= triggerSec) {
      toast({ title: t("media.cueInvalidRange"), variant: "error" });
      return;
    }
    setSaving(true);
    const ok = await postCue(mediaId, triggerSec, end > triggerSec ? end : null);
    setSaving(false);
    if (!ok) {
      toast({ title: t("media.cueSaveFailed"), variant: "error" });
      return;
    }
    onChange();
    toast({
      title: t("media.cueAdded", {
        time:
          end > triggerSec
            ? `${formatCueClock(triggerSec)} – ${formatCueClock(end)}`
            : formatCueClock(triggerSec),
      }),
    });
  }

  async function appendRundown() {
    const items = pickedIds
      .map((id) => activeMedia.find((m) => m.id === id))
      .filter((m): m is MediaItem => Boolean(m));
    if (items.length === 0) {
      toast({ title: t("media.cueInvalidInput"), variant: "error" });
      return;
    }
    setSaving(true);
    let existing = [...(phaseCues.get(matchStatus) ?? [])];
    let ok = true;
    for (const item of items) {
      const window = nextRundownWindow(existing, item.durationSec);
      ok = await postCue(item.id, window.triggerSec, window.endSec);
      if (!ok) break;
      existing.push({
        ...({} as ScheduledMediaCue),
        triggerSec: window.triggerSec,
        endSec: window.endSec,
        media: item,
      });
    }
    setSaving(false);
    if (!ok) {
      toast({ title: t("media.cueSaveFailed"), variant: "error" });
      onChange();
      return;
    }
    onChange();
    toast({ title: t("media.cueRundownAdded", { count: items.length }) });
  }

  async function patchCue(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/scheduled-media-cues/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast({ title: t("media.cuePatchFailed"), variant: "error" });
      return;
    }
    onChange();
  }

  async function setPhaseLoop(phase: string, loop: boolean) {
    if (phase === matchStatus) setLoopRundown(loop);
    const list = phaseCues.get(phase) ?? [];
    if (list.length === 0) return;
    setSaving(true);
    for (const cue of list) {
      const res = await fetch(`/api/scheduled-media-cues/${cue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loop }),
      });
      if (!res.ok) {
        toast({ title: t("media.cuePatchFailed"), variant: "error" });
        setSaving(false);
        onChange();
        return;
      }
    }
    setSaving(false);
    onChange();
  }

  async function applyRestack(list: ScheduledMediaCue[]) {
    const stacked = restackRundownWindows(list);
    for (const row of stacked) {
      const res = await fetch(`/api/scheduled-media-cues/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerSec: row.triggerSec, endSec: row.endSec }),
      });
      if (!res.ok) {
        toast({ title: t("media.cuePatchFailed"), variant: "error" });
        onChange();
        return;
      }
    }
    onChange();
  }

  async function moveCue(phase: string, id: string, delta: number) {
    const list = [...(phaseCues.get(phase) ?? [])];
    const idx = list.findIndex((c) => c.id === id);
    const next = idx + delta;
    if (idx < 0 || next < 0 || next >= list.length) return;
    const copy = [...list];
    const [item] = copy.splice(idx, 1);
    copy.splice(next, 0, item!);
    setSaving(true);
    await applyRestack(copy);
    setSaving(false);
  }

  async function deleteCue(id: string) {
    if (!confirm(t("media.cueDeleteConfirm"))) return;
    await fetch(`/api/scheduled-media-cues/${id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <section className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("media.tabCues")}</h2>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          {t("media.cuesHelp")}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px] lg:items-start">
        <div className="space-y-1 text-xs">
          <span className="text-muted-foreground">{t("media.cueMediaMulti")}</span>
          <Input
            type="search"
            placeholder={t("media.cueSearchPlaceholder")}
            value={mediaQuery}
            onChange={(e) => setMediaQuery(e.target.value)}
            className="h-9"
          />
          <select
            multiple
            value={pickedIds.filter((id) => filteredMedia.some((m) => m.id === id))}
            onChange={(e) => {
              const visible = new Set(filteredMedia.map((m) => m.id));
              const selectedVisible = Array.from(e.target.selectedOptions, (opt) => opt.value);
              setPickedIds((prev) => [
                ...prev.filter((id) => !visible.has(id)),
                ...selectedVisible,
              ]);
            }}
            className="h-36 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {filteredMedia.length === 0 ? (
              <option disabled value="">
                {t("media.searchEmpty")}
              </option>
            ) : (
              filteredMedia.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} ({m.type === "VIDEO" ? t("media.typeVideo") : t("media.typeImage")} · {m.durationSec}s)
                </option>
              ))
            )}
          </select>
        </div>
        <div className="space-y-3">
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">{t("media.cuePhase")}</span>
            <select
              value={matchStatus}
              onChange={(e) => setMatchStatus(e.target.value as typeof matchStatus)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {SCHEDULED_CUE_PHASES.map((p) => (
                <option key={p} value={p}>{t(`phases.${p}`)}</option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            className="w-full"
            onClick={() => void appendRundown()}
            disabled={saving || pickedIds.length === 0}
          >
            {t("media.cueAppendRundown")}
          </Button>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={loopRundown}
              onChange={(e) => void setPhaseLoop(matchStatus, e.target.checked)}
              disabled={saving}
            />
            <span>
              <span className="font-medium">{t("media.cueLoop")}</span>
              <span className="mt-0.5 block text-muted-foreground">{t("media.cueLoopHint")}</span>
            </span>
          </label>
        </div>
      </div>

      <details className="rounded-lg border border-border bg-background/50 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium">{t("media.cueExactTime")}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-[auto_auto_auto] sm:items-end">
          <ClockMmSsField
            label={t("media.cueStart")}
            sec={startSec}
            onChange={setStartSec}
          />
          <ClockMmSsField
            label={t("media.cueEnd")}
            sec={endSec}
            onChange={setEndSec}
          />
          <Button type="button" variant="outline" onClick={() => void addAtTime()} disabled={saving || pickedIds.length === 0}>
            {t("media.cueAddAtTime")}
          </Button>
        </div>
      </details>

      <div className="space-y-3">
        {cues.length === 0 ? (
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            {t("media.cuesEmpty")}
          </div>
        ) : (
          SCHEDULED_CUE_PHASES.map((phase) => {
            const list = phaseCues.get(phase) ?? [];
            if (list.length === 0) return null;
            return (
              <div key={phase} className="overflow-hidden rounded-lg border border-border">
                <div className="space-y-1 bg-secondary/50 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
                    <span>
                      {t(`phases.${phase}`)} · {t("media.cueRundownCount", { count: list.length })}
                    </span>
                    <label className="flex items-center gap-1.5 font-normal">
                      <input
                        type="checkbox"
                        checked={list.some((c) => c.loop)}
                        onChange={(e) => void setPhaseLoop(phase, e.target.checked)}
                        disabled={saving}
                      />
                      {t("media.cueLoop")}
                    </label>
                  </div>
                  {phase === "PREMATCH" ? (
                    <p className="text-[11px] font-normal text-muted-foreground">
                      {t("media.cuePrematchKickoffHint")}
                    </p>
                  ) : null}
                </div>
                <div className="divide-y divide-border">
                  {list.map((cue, idx) => (
                    <div key={cue.id} className="grid gap-2 p-3 md:grid-cols-[90px_88px_1fr_auto] md:items-center">
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={cue.enabled}
                          onChange={(e) => void patchCue(cue.id, { enabled: e.target.checked })}
                        />
                        {t("common.active")}
                      </label>
                      <div className="text-xs font-mono">
                        {cue.endSec != null && cue.endSec > cue.triggerSec
                          ? t("media.cueWindow", {
                              start: formatCueClock(cue.triggerSec),
                              end: formatCueClock(cue.endSec),
                            })
                          : formatCueClock(cue.triggerSec)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{cue.media.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {cue.media.type === "VIDEO" ? t("media.typeVideo") : t("media.typeImage")}
                          {cue.endSec != null && cue.endSec > cue.triggerSec
                            ? ` · ${cue.endSec - cue.triggerSec}s`
                            : ` · ${cue.media.durationSec}s`}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2"
                          disabled={saving || idx === 0}
                          onClick={() => void moveCue(phase, cue.id, -1)}
                        >
                          ↑
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2"
                          disabled={saving || idx === list.length - 1}
                          onClick={() => void moveCue(phase, cue.id, 1)}
                        >
                          ↓
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => void deleteCue(cue.id)}>
                          {t("common.delete")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function MediaCard({
  item,
  onChange,
  lockManualSponsorInterrupt,
}: {
  item: MediaItem;
  onChange: () => void;
  lockManualSponsorInterrupt?: boolean;
}) {
  const { t } = useTranslation();
  const [durDraft, setDurDraft] = useState(String(item.durationSec));
  const [fixing, setFixing] = useState(false);

  useEffect(() => {
    setDurDraft(String(item.durationSec));
  }, [item.id, item.durationSec]);

  async function saveImageDuration() {
    const n = parseInt(durDraft, 10);
    if (!Number.isFinite(n)) {
      toast({ title: t("media.invalidNumber"), variant: "error" });
      return;
    }
    const sec = clampMediaDurationSec(n);
    const ok = await patchMediaJson(item.id, { durationSec: sec });
    if (ok) {
      onChange();
      toast({ title: t("media.durationSaved", { sec }) });
    } else toast({ title: t("media.saveFailed"), variant: "error" });
  }

  async function rescanVideoDuration() {
    try {
      const sec = await readVideoDuration(mediaUrl(item.path));
      const ok = await patchMediaJson(item.id, { durationSec: sec });
      if (ok) {
        onChange();
        toast({ title: t("media.videoDuration", { sec }) });
      } else toast({ title: t("media.saveFailed"), variant: "error" });
    } catch {
      toast({
        title: t("media.videoDurationUnread"),
        description: t("media.videoDurationUnreadHint"),
        variant: "error",
      });
    }
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-background">
      <div className="aspect-video bg-black flex items-center justify-center overflow-hidden">
        {item.type === "VIDEO" ? (
          <video src={mediaUrl(item.path)} muted className="w-full h-full object-cover" />
        ) : (
          <img src={mediaUrl(item.path)} alt="" className="w-full h-full object-cover" />
        )}
      </div>
      <div className="p-2 text-xs flex flex-col gap-1">
        <div className="truncate font-semibold">{item.title}</div>
        {isDisplayPlaybackRisk(item.playbackWarning) ? (
          <div className="flex flex-col gap-1">
            <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 leading-snug">
              {t("media.playbackWarnBadge")}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px]"
              type="button"
              disabled={fixing}
              onClick={() => {
                setFixing(true);
                void prepareMediaPlayback(t, item.id)
                  .then((ok) => {
                    if (ok) onChange();
                  })
                  .finally(() => setFixing(false));
              }}
            >
              {fixing ? t("media.playbackFixing") : t("media.playbackFix")}
            </Button>
          </div>
        ) : null}
        {item.type === "VIDEO" ? (
          <div className="flex flex-col gap-1">
            <div className="text-muted-foreground">{t("media.videoDurationSet", { sec: item.durationSec })}</div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px]"
              type="button"
              onClick={() => void rescanVideoDuration()}
            >
              {t("media.rescanDuration")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] text-muted-foreground">{t("media.showSeconds")}</Label>
            <div className="flex gap-1">
              <Input
                type="number"
                min={1}
                max={600}
                value={durDraft}
                onChange={(e) => setDurDraft(e.target.value)}
                className="h-7 text-[11px] flex-1 min-w-0"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[10px] shrink-0"
                type="button"
                onClick={() => void saveImageDuration()}
              >
                {t("common.save")}
              </Button>
            </div>
          </div>
        )}
        {item.type === "VIDEO" && (
          <label className="flex items-center gap-1.5 text-[10px] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={item.playAudio ?? false}
              onChange={async (e) => {
                const ok = await patchMediaJson(item.id, { playAudio: e.target.checked });
                if (ok) onChange();
                else toast({ title: t("media.audioSaveFailed"), variant: "error" });
              }}
            />
            {t("media.playAudio")}
          </label>
        )}
        <label className="flex items-start gap-1.5 text-[10px] cursor-pointer select-none">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={item.quickLaunch ?? false}
            onChange={async (e) => {
              const ok = await patchMediaJson(item.id, { quickLaunch: e.target.checked });
              if (ok) onChange();
              else toast({ title: t("media.saveFailed"), variant: "error" });
            }}
          />
          <span>
            <span className="font-medium">{t("media.quickLaunch")}</span>
            <span className="block text-muted-foreground">{t("media.quickLaunchHint")}</span>
          </span>
        </label>
        <SponsorMediaPhasePicker media={item} onChange={onChange} />
        <div className="flex gap-1">
          {lockManualSponsorInterrupt ? (
            <div className="flex-1 text-[9px] text-muted-foreground leading-snug px-1 py-1.5 border border-dashed border-border rounded-md">
              {t("media.playNowLockedHint")}
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-[10px]"
              onClick={() =>
                sendCommand({
                  type: "display:setMode",
                  mode: "SPONSOR",
                  meta: { activeMediaId: item.id },
                })
              }
            >
              {t("media.playNow")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (!confirm(t("media.deleteMediaConfirm"))) return;
              await fetch(`/api/media/${item.id}`, { method: "DELETE" });
              onChange();
            }}
          >
            ✕
          </Button>
        </div>
      </div>
    </div>
  );
}

function SponsorsSection({
  allMedia,
  reloadMedia,
  activeMatch,
}: {
  allMedia: MediaItem[];
  reloadMedia: () => void;
  activeMatch: Match | null;
}) {
  const { t } = useTranslation();
  const { data: sponsorsRaw, reload: reloadSponsors } = useApi<Sponsor[]>("/api/sponsors");
  const sponsors = sponsorsRaw ?? [];
  const elapsedSec = useLiveTimerSeconds();
  const wallMs = useWallClockMs(250);
  const displayMode = useDisplayStore((s) => s.state?.mode);
  const matchRosterFreezeRef = useRef(0);
  const halftimeT = useHalftimeSponsorTimelineT(
    activeMatch?.status,
    activeMatch?.halfBreakSec ?? 900,
  );
  const [newName, setNewName] = useState("");
  const sponsorLedger = useDisplayStore((s) => s.sponsorLedger);

  useEffect(() => {
    matchRosterFreezeRef.current = 0;
  }, [activeMatch?.id, activeMatch?.status]);

  /** Bij server-side ledger-reset ook de bevroren rooster-tijd loslaten. */
  useEffect(() => {
    if (sponsorLedger === null) {
      matchRosterFreezeRef.current = 0;
    }
  }, [sponsorLedger]);

  const matchPlayRosterSeconds =
    activeMatch != null
      ? effectiveMatchPlayRosterSeconds(
          elapsedSec,
          activeMatch.status,
          activeMatch.halfDurationSec,
          displayMode,
          matchRosterFreezeRef,
        )
      : 0;
  const [adding, setAdding] = useState(false);

  async function addSponsor() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const res = await fetch("/api/sponsors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        toast({ title: t("media.sponsorCreateFailed"), variant: "error" });
        return;
      }
      setNewName("");
      reloadSponsors();
    } finally {
      setAdding(false);
    }
  }

  async function removeSponsor(id: string) {
    if (!confirm(t("media.deleteSponsorConfirm"))) return;
    await fetch(`/api/sponsors/${id}`, { method: "DELETE" });
    reloadSponsors();
    reloadMedia();
  }

  return (
    <section className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold">{t("media.title")}</h2>
          <div className="mt-3 grid max-w-4xl gap-2 text-xs md:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted/25 p-3">
              <div className="font-semibold text-foreground">{t("media.sponsorStep1Title")}</div>
              <p className="mt-1 text-muted-foreground">{t("media.sponsorStep1Body")}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/25 p-3">
              <div className="font-semibold text-foreground">{t("media.sponsorStep2Title")}</div>
              <p className="mt-1 text-muted-foreground">{t("media.sponsorStep2Body")}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/25 p-3">
              <div className="font-semibold text-foreground">{t("media.sponsorStep3Title")}</div>
              <p className="mt-1 text-muted-foreground">{t("media.sponsorStep3Body")}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 relative z-10">
          <Input
            placeholder={t("media.newSponsorName")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addSponsor();
            }}
            className="w-56"
          />
          <Button onClick={addSponsor} disabled={adding || !newName.trim()}>
            {adding ? t("common.loading") : t("media.addSponsor")}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 mt-6">
        {sponsors.length === 0 && (
          <div className="text-sm text-muted-foreground">
            {t("media.sponsorsEmpty")}
          </div>
        )}
        {sponsors.map((s) => (
          <SponsorCard
            key={s.id}
            sponsor={s}
            allSponsors={sponsors}
            allMedia={allMedia}
            activeMatch={activeMatch}
            matchPlayRosterSeconds={matchPlayRosterSeconds}
            prematchTimelineSec={elapsedSec}
            halftimeTSec={halftimeT}
            wallMs={wallMs}
            onChange={() => {
              reloadSponsors();
              reloadMedia();
            }}
            onRemove={() => removeSponsor(s.id)}
          />
        ))}
      </div>
    </section>
  );
}

function sponsorMatchBudgetTotal(s: Sponsor): number {
  const m1 = s.matchFirstHalfSeconds ?? 0;
  const m2 = s.matchSecondHalfSeconds ?? 0;
  if (m1 > 0 || m2 > 0) return m1 + m2;
  return s.matchSeconds ?? 0;
}

function matchHalfMinutesFromSponsor(s: Sponsor): { first: string; second: string } {
  const m1 = s.matchFirstHalfSeconds ?? 0;
  const m2 = s.matchSecondHalfSeconds ?? 0;
  if (m1 > 0 || m2 > 0) {
    return { first: secondsToMinutesStr(m1), second: secondsToMinutesStr(m2) };
  }
  return {
    first: secondsToMinutesStr(s.matchSeconds),
    second: secondsToMinutesStr(0),
  };
}

function SponsorCard({
  sponsor,
  allSponsors,
  allMedia,
  activeMatch,
  matchPlayRosterSeconds,
  prematchTimelineSec,
  halftimeTSec,
  wallMs,
  onChange,
  onRemove,
}: {
  sponsor: Sponsor;
  allSponsors: Sponsor[];
  allMedia: MediaItem[];
  activeMatch: Match | null;
  matchPlayRosterSeconds: number;
  prematchTimelineSec: number;
  halftimeTSec: number;
  /** Muurklok voor telemetry (los van gepauzeerde wedstrijdtimer). */
  wallMs: number;
  onChange: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const halves = matchHalfMinutesFromSponsor(sponsor);
  const [name, setName] = useState(sponsor.name);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [active, setActive] = useState(sponsor.active);
  const [prematchMin, setPrematchMin] = useState(secondsToMinutesStr(sponsor.prematchSeconds));
  const [matchFirstMin, setMatchFirstMin] = useState(halves.first);
  const [matchSecondMin, setMatchSecondMin] = useState(halves.second);
  const [halftimeMin, setHalftimeMin] = useState(secondsToMinutesStr(sponsor.halftimeSeconds));
  const [postmatchMin, setPostmatchMin] = useState(
    secondsToMinutesStr(sponsor.postmatchSeconds ?? 0),
  );
  const [imageSec, setImageSec] = useState(sponsor.imageDefaultSec);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const rosterCarryRef = useRef<RosterCarry | null>(null);
  const sponsorLedger = useDisplayStore((s) => s.sponsorLedger);

  useEffect(() => {
    rosterCarryRef.current = null;
  }, [activeMatch?.id, sponsor.id]);

  /**
   * Server reset de telemetry-ledger bij fase-/timer-resets — dan ook hier de
   * monotone roster-carry leegmaken zodat "schermtijd verbruikt" weer op 0 begint.
   */
  useEffect(() => {
    if (sponsorLedger === null) {
      rosterCarryRef.current = null;
    }
  }, [sponsorLedger]);

  useEffect(() => {
    const h = matchHalfMinutesFromSponsor(sponsor);
    setName(sponsor.name);
    setActive(sponsor.active);
    setPrematchMin(secondsToMinutesStr(sponsor.prematchSeconds));
    setMatchFirstMin(h.first);
    setMatchSecondMin(h.second);
    setHalftimeMin(secondsToMinutesStr(sponsor.halftimeSeconds));
    setPostmatchMin(secondsToMinutesStr(sponsor.postmatchSeconds ?? 0));
    setImageSec(sponsor.imageDefaultSec);
  }, [
    sponsor.id,
    sponsor.name,
    sponsor.active,
    sponsor.prematchSeconds,
    sponsor.matchSeconds,
    sponsor.matchFirstHalfSeconds,
    sponsor.matchSecondHalfSeconds,
    sponsor.halftimeSeconds,
    sponsor.postmatchSeconds,
    sponsor.imageDefaultSec,
  ]);

  const sponsorMedia = allMedia.filter((m) => m.sponsorId === sponsor.id);
  const orderedSponsorMedia = useMemo(
    () => applySponsorPlaybackOrder(sponsorMedia, sponsor.sponsorPlaybackOrderJson),
    [sponsorMedia, sponsor.sponsorPlaybackOrderJson],
  );
  const repeatMap = useMemo(
    () => parseSponsorPlaybackRepeatsJson(sponsor.sponsorPlaybackRepeatsJson),
    [sponsor.sponsorPlaybackRepeatsJson],
  );
  const [dragMediaId, setDragMediaId] = useState<string | null>(null);
  const [dropTargetMediaId, setDropTargetMediaId] = useState<string | null>(null);

  async function persistPlaybackOrderIds(ids: string[]) {
    const res = await fetch(`/api/sponsors/${sponsor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sponsorPlaybackOrderJson: JSON.stringify(ids) }),
    });
    if (!res.ok) {
      toast({ title: t("media.orderSaveFailed"), variant: "error" });
      return;
    }
    onChange();
  }

  async function persistPlaybackRepeatsForMedia(mediaId: string, rawRepeat: number) {
    const merged = {
      ...parseSponsorPlaybackRepeatsJson(sponsor.sponsorPlaybackRepeatsJson),
    };
    merged[mediaId] = clampRepeat(rawRepeat);
    const out: Record<string, number> = {};
    for (const om of orderedSponsorMedia) {
      const v = clampRepeat(merged[om.id] ?? 1);
      if (v > 1) out[om.id] = v;
    }
    const res = await fetch(`/api/sponsors/${sponsor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sponsorPlaybackRepeatsJson:
          Object.keys(out).length > 0 ? JSON.stringify(out) : null,
      }),
    });
    if (!res.ok) {
      toast({ title: t("media.repeatsSaveFailed"), variant: "error" });
      return;
    }
    onChange();
  }

  function reorderIds(ids: string[], fromId: string, toId: string): string[] {
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0 || from === to) return [...ids];
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    return next;
  }

  async function reorderDropped(fromId: string, toId: string) {
    const ids = orderedSponsorMedia.map((m) => m.id);
    await persistPlaybackOrderIds(reorderIds(ids, fromId, toId));
  }

  async function moveSponsorMediaOrder(mediaId: string, dir: -1 | 1) {
    const ids = orderedSponsorMedia.map((m) => m.id);
    const i = ids.indexOf(mediaId);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    const t = next[i]!;
    next[i] = next[j]!;
    next[j] = t;
    await persistPlaybackOrderIds(next);
  }

  async function clearSponsorPlaybackOrder() {
    const res = await fetch(`/api/sponsors/${sponsor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sponsorPlaybackOrderJson: null,
        sponsorPlaybackRepeatsJson: null,
      }),
    });
    if (!res.ok) {
      toast({ title: t("media.orderResetFailed"), variant: "error" });
      return;
    }
    onChange();
  }

  async function save() {
    setSaving(true);
    try {
      const m1s = minutesStrToSeconds(matchFirstMin);
      const m2s = minutesStrToSeconds(matchSecondMin);
      await fetch(`/api/sponsors/${sponsor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          active,
          prematchSeconds: minutesStrToSeconds(prematchMin),
          matchFirstHalfSeconds: m1s,
          matchSecondHalfSeconds: m2s,
          matchSeconds: m1s + m2s,
          halftimeSeconds: minutesStrToSeconds(halftimeMin),
          postmatchSeconds: minutesStrToSeconds(postmatchMin),
          imageDefaultSec: Math.max(1, Math.round(imageSec)),
        }),
      });
      onChange();
      toast({ title: t("media.sponsorSaved") });
    } finally {
      setSaving(false);
    }
  }

  async function registerFile(filePath: string) {
    const fileName = filePath.replace(/.*[/\\]/, "");
    const isVideo = /\.(mp4|webm|mov|avi)$/i.test(fileName);
    const type = isVideo ? "VIDEO" : "IMAGE";
    let durationSec = clampMediaDurationSec(sponsor.imageDefaultSec);
    if (isVideo) {
      try {
        durationSec = await readVideoDuration(mediaUrl(filePath));
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
        durationSec: Math.round(durationSec),
        sponsorId: sponsor.id,
        sponsorName: sponsor.name,
      }),
    });
    if (!res.ok) return;
    const created = (await res.json()) as { id?: string; playbackInspect?: PlaybackInspect };
    notifyPlaybackRisk(t, created.playbackInspect, fileName);
    if (created.id) await appendSponsorPlaybackOrderRow(sponsor.id, created.id);
  }

  async function onUploadSponsorFiles() {
    const paths = await selectFilesViaDialog({
      title: t("media.filesForSponsor", { name: sponsor.name }),
      filters: [
        { name: t("media.filterMedia"), extensions: ["mp4", "webm", "mov", "avi", "jpg", "jpeg", "png", "gif", "webp"] },
      ],
      multiSelections: true,
    });
    if (paths.length === 0) return;
    setUploading(true);
    for (const p of paths) await registerFile(p);
    setUploading(false);
    onChange();
  }

  async function attachExisting(mediaId: string) {
    const res = await fetch(`/api/media/${mediaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sponsorId: sponsor.id, sponsorName: sponsor.name }),
    });
    if (!res.ok) return;
    await appendSponsorPlaybackOrderRow(sponsor.id, mediaId);
    onChange();
  }

  async function detach(mediaId: string) {
    await fetch(`/api/media/${mediaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sponsorId: null }),
    });
    onChange();
  }

  async function deleteMedia(mediaId: string) {
    if (!confirm(t("media.deleteMediaConfirm"))) return;
    await fetch(`/api/media/${mediaId}`, { method: "DELETE" });
    onChange();
  }

  const unassignedMedia = allMedia.filter((m) => !m.sponsorId && !m.hideFromLibrary);

  const rawRoster =
    activeMatch != null
      ? sponsorLiveProgressFromRosterRaw(
          sponsor,
          allSponsors,
          activeMatch,
          matchPlayRosterSeconds,
          halftimeTSec,
          prematchTimelineSec,
        )
      : null;

  if (!rawRoster) {
    rosterCarryRef.current = null;
  }

  let liveRoster: {
    label: string;
    consumed: number;
    budget: number;
    remaining: number;
  } | null = null;
  if (rawRoster && activeMatch) {
    const st = activeMatch.status;
    let tClock = prematchTimelineSec;
    if (st === "FIRST_HALF" || st === "SECOND_HALF" || st === "EXTRA_TIME") {
      tClock = matchPlayRosterSeconds;
    } else if (st === "HALF_TIME") {
      const Hh = Math.max(60, activeMatch.halfBreakSec);
      tClock = halftimeTSec % Hh;
    }
    let telemetryKey: string | null = null;
    if (st === "FIRST_HALF" || st === "SECOND_HALF" || st === "EXTRA_TIME") {
      telemetryKey = sponsorTelemetrySegmentKey(activeMatch.id, st, "match");
    } else if (st === "HALF_TIME") {
      telemetryKey = sponsorTelemetrySegmentKey(activeMatch.id, st, "halftime");
    } else if (st === "PREMATCH" || st === "SETUP") {
      telemetryKey = sponsorTelemetrySegmentKey(activeMatch.id, st, "prematch");
    }
    const ledgerMatches =
      telemetryKey != null &&
      sponsorLedger != null &&
      sponsorLedger.matchId === activeMatch.id &&
      sponsorLedger.segmentKey === telemetryKey;
    let rawForCarry: typeof rawRoster & { matchId: string } = { ...rawRoster, matchId: activeMatch.id };
    if (ledgerMatches) {
      rawForCarry = {
        ...rawForCarry,
        slotsUsed: Math.round(sponsorTelemetryConsumedSec(sponsorLedger, sponsor.id, wallMs)),
        carryKey: `${rawRoster.carryKey}|ledger`,
      };
    }
    const { consumed, budget } = applyRosterBudgetCarry(rosterCarryRef, rawForCarry, tClock);
    liveRoster = {
      label: rawRoster.label,
      consumed,
      budget,
      remaining: Math.max(0, budget - consumed),
    };
  }

  return (
    <div className="rounded-lg border border-border p-4 bg-background flex flex-col gap-4">
      {liveRoster != null && (
        <div className="rounded-md border border-border/80 bg-muted/40 px-3 py-2 text-xs">
          <span className="font-medium text-foreground">{liveRoster.label}</span>
          <span className="text-muted-foreground">
            {" "}
            · {t("media.liveConsumed", { time: formatMin(liveRoster.consumed) })} · {t("media.liveRest", { time: formatMin(liveRoster.remaining) })} · {t("media.liveBudget", { time: formatMin(liveRoster.budget) })}
          </span>
        </div>
      )}
      <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
        <div className="text-xs font-semibold text-foreground">{t("media.budgetPerSegment")}</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
              {t("media.budgetPrematch")}
            </Label>
            <Input
              type="number"
              min={0}
              step="0.5"
              value={prematchMin}
              onChange={(e) => setPrematchMin(e.target.value)}
              className="mt-1 w-full"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
              {t("media.budgetFirstHalf")}
            </Label>
            <Input
              type="number"
              min={0}
              step="0.5"
              value={matchFirstMin}
              onChange={(e) => setMatchFirstMin(e.target.value)}
              className="mt-1 w-full"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
              {t("media.budgetSecondHalf")}
            </Label>
            <Input
              type="number"
              min={0}
              step="0.5"
              value={matchSecondMin}
              onChange={(e) => setMatchSecondMin(e.target.value)}
              className="mt-1 w-full"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
              {t("media.budgetHalftime")}
            </Label>
            <Input
              type="number"
              min={0}
              step="0.5"
              value={halftimeMin}
              onChange={(e) => setHalftimeMin(e.target.value)}
              className="mt-1 w-full"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
              {t("media.budgetPostmatch")}
            </Label>
            <Input
              type="number"
              min={0}
              step="0.5"
              value={postmatchMin}
              onChange={(e) => setPostmatchMin(e.target.value)}
              className="mt-1 w-full"
            />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground leading-snug">
          {t("media.budgetHelp")}
        </p>
      </div>

      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <Label className="text-xs">{t("media.sponsorName")}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">
            {t("media.defaultImageDuration")}
            <span className="block font-normal text-muted-foreground normal-case">
              {t("media.defaultImageDurationHint")}
            </span>
          </Label>
          <Input
            type="number"
            min={1}
            value={imageSec}
            onChange={(e) => setImageSec(Number(e.target.value) || 10)}
            className="w-20"
          />
        </div>
        <div className="flex items-end gap-2">
          <label className="inline-flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            {t("common.active")}
          </label>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onRemove}>
            ✕
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {t("media.filesLinked", {
            count: sponsorMedia.length,
            time: formatMin(
              sponsor.prematchSeconds +
                sponsorMatchBudgetTotal(sponsor) +
                sponsor.halftimeSeconds
            ),
          })}
        </div>
        <div className="flex items-center gap-2">
          {isElectron && (
            <Button size="sm" variant="outline" onClick={onUploadSponsorFiles} disabled={uploading}>
              {uploading ? t("common.busy") : t("media.addFiles")}
            </Button>
          )}
          {unassignedMedia.length > 0 && (
            <AttachExistingDropdown media={unassignedMedia} onPick={attachExisting} />
          )}
        </div>
      </div>

      {orderedSponsorMedia.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-2 text-[11px] text-muted-foreground">
          <span>
            {orderedSponsorMedia.length > 1
              ? t("media.rotationHelpMulti")
              : t("media.rotationHelpSingle")}
          </span>
          {(sponsor.sponsorPlaybackOrderJson || sponsor.sponsorPlaybackRepeatsJson) && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 shrink-0 text-[11px]"
              onClick={() => void clearSponsorPlaybackOrder()}
            >
              {t("media.resetOrderRepeats")}
            </Button>
          )}
        </div>
      )}

      {orderedSponsorMedia.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {orderedSponsorMedia.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg border overflow-hidden bg-card ${
                dropTargetMediaId === m.id && dragMediaId && dragMediaId !== m.id
                  ? "border-primary ring-2 ring-primary/40"
                  : "border-border"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragMediaId && dragMediaId !== m.id) setDropTargetMediaId(m.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setDropTargetMediaId((t) => (t === m.id ? null : t));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = e.dataTransfer.getData("application/x-sponsor-media-id");
                setDropTargetMediaId(null);
                if (from && from !== m.id) void reorderDropped(from, m.id);
              }}
            >
              <div
                className={`aspect-video bg-black flex items-center justify-center select-none ${
                  orderedSponsorMedia.length > 1
                    ? "cursor-grab active:cursor-grabbing"
                    : ""
                }${dragMediaId === m.id ? " opacity-50" : ""}`}
                draggable={orderedSponsorMedia.length > 1}
                onDragStart={(e) => {
                  if (orderedSponsorMedia.length <= 1) return;
                  e.dataTransfer.setData("application/x-sponsor-media-id", m.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDragMediaId(m.id);
                }}
                onDragEnd={() => {
                  setDragMediaId(null);
                  setDropTargetMediaId(null);
                }}
              >
                {m.type === "VIDEO" ? (
                  <video src={mediaUrl(m.path)} muted className="w-full h-full object-cover pointer-events-none" />
                ) : (
                  <img src={mediaUrl(m.path)} alt="" className="w-full h-full object-cover pointer-events-none" />
                )}
              </div>
              <div className="p-2 text-xs flex flex-col gap-1">
                <div className="truncate font-semibold">{m.title}</div>
                {isDisplayPlaybackRisk(m.playbackWarning) ? (
                  <div className="flex flex-col gap-1">
                    <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 leading-snug">
                      {t("media.playbackWarnBadge")}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[10px]"
                      type="button"
                      disabled={fixingId === m.id}
                      onClick={() => {
                        setFixingId(m.id);
                        void prepareMediaPlayback(t, m.id)
                          .then((ok) => {
                            if (ok) onChange();
                          })
                          .finally(() => setFixingId(null));
                      }}
                    >
                      {fixingId === m.id ? t("media.playbackFixing") : t("media.playbackFix")}
                    </Button>
                  </div>
                ) : null}
                <div className="text-muted-foreground">
                  {m.type} · {m.durationSec}s
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground shrink-0">×</span>
                  <SponsorClipRepeatField
                    mediaId={m.id}
                    serverRepeat={repeatMap[m.id] ?? 1}
                    onCommit={persistPlaybackRepeatsForMedia}
                  />
                </div>
                {orderedSponsorMedia.length > 1 && (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 flex-1 px-1 text-[10px]"
                      disabled={orderedSponsorMedia[0]?.id === m.id}
                      onClick={() => void moveSponsorMediaOrder(m.id, -1)}
                      title={t("media.moveEarlier")}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 flex-1 px-1 text-[10px]"
                      disabled={orderedSponsorMedia[orderedSponsorMedia.length - 1]?.id === m.id}
                      onClick={() => void moveSponsorMediaOrder(m.id, 1)}
                      title={t("media.moveLater")}
                    >
                      ↓
                    </Button>
                  </div>
                )}
                {m.type === "VIDEO" && (
                  <label className="flex items-center gap-1.5 text-[10px] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={m.playAudio ?? false}
                      onChange={async (e) => {
                        const ok = await patchMediaJson(m.id, { playAudio: e.target.checked });
                        if (ok) onChange();
                        else toast({ title: t("media.audioSaveFailed"), variant: "error" });
                      }}
                    />
                    {t("media.playAudio")}
                  </label>
                )}
                <SponsorMediaPhasePicker media={m} onChange={onChange} />
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="flex-1 text-[10px]" onClick={() => detach(m.id)}>
                    {t("media.detach")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteMedia(m.id)}>
                    ✕
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SponsorClipRepeatField({
  mediaId,
  serverRepeat,
  onCommit,
}: {
  mediaId: string;
  serverRepeat: number;
  onCommit: (mediaId: string, raw: number) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [local, setLocal] = useState(() => String(serverRepeat));
  useEffect(() => {
    setLocal(String(serverRepeat));
  }, [serverRepeat, mediaId]);
  return (
    <Input
      type="number"
      min={1}
      max={20}
      className="h-6 w-14 px-1 text-[10px]"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const n = Number(local);
        if (!Number.isFinite(n)) {
          setLocal(String(serverRepeat));
          return;
        }
        void Promise.resolve(onCommit(mediaId, n));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      title={t("media.repeatTitle")}
    />
  );
}

function AttachExistingDropdown({
  media,
  onPick,
}: {
  media: MediaItem[];
  onPick: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
        {open ? t("common.close") : t("media.attachExisting")}
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 w-72 max-h-72 overflow-auto rounded-lg border border-border bg-popover shadow-xl p-2">
          {media.map((m) => (
            <button
              key={m.id}
              className="w-full text-left text-xs px-2 py-1 hover:bg-secondary rounded flex items-center gap-2"
              onClick={() => {
                onPick(m.id);
                setOpen(false);
              }}
            >
              <span className="truncate flex-1">{m.title}</span>
              <span className="text-muted-foreground">{m.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SponsorMediaPhasePicker({
  media,
  onChange,
}: {
  media: MediaItem;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const tags = parseSponsorMediaPhaseTags(media.sponsorPhaseTagsJson);
  const allPhases = tags.length === 0;

  function phaseName(id: string): string {
    const key = MEDIA_PHASE_I18N[id];
    return key ? t(key) : id;
  }

  function phasesSummary(): string {
    if (tags.length === 0) return t("media.allPhasesLabel");
    return tags.map(phaseName).join(", ");
  }

  async function save(next: SponsorMediaPhase[]) {
    const ok = await patchMediaJson(media.id, {
      sponsorPhaseTagsJson: serializeSponsorMediaPhaseTags(next),
    });
    if (ok) onChange();
    else toast({ title: t("media.phasesSaveFailed"), variant: "error" });
  }

  async function toggle(tag: SponsorMediaPhase, checked: boolean) {
    const base = allPhases ? SPONSOR_MEDIA_PHASES.map((p) => p.id) : tags;
    const current = new Set(base);
    if (checked) current.add(tag);
    else current.delete(tag);
    await save([...current]);
  }

  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-medium text-foreground">{t("media.sponsorPhases")}</div>
          <div className="text-[9px] text-muted-foreground">
            {phasesSummary()}
          </div>
        </div>
        <Button
          size="sm"
          variant={allPhases ? "default" : "outline"}
          className="h-6 px-2 text-[9px] shrink-0"
          type="button"
          onClick={() => void save([])}
        >
          {t("media.allPhases")}
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1">
        {SPONSOR_MEDIA_PHASES.map((phase) => (
          <label key={phase.id} className="flex items-center gap-1 text-[9px] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allPhases || tags.includes(phase.id)}
              onChange={(e) => void toggle(phase.id, e.target.checked)}
            />
            {phaseName(phase.id)}
          </label>
        ))}
      </div>
      {allPhases && (
        <div className="mt-1 text-[9px] text-muted-foreground">
          {t("media.allPhasesHint")}
        </div>
      )}
    </div>
  );
}

function secondsToMinutesStr(sec: number): string {
  if (!sec) return "0";
  const m = sec / 60;
  return Number.isInteger(m) ? String(m) : m.toFixed(2).replace(/\.?0+$/, "");
}

function minutesStrToSeconds(value: string): number {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 60);
}

function formatMin(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0m";
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return s === 0 ? `${m}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}

function ClockMmSsField({
  label,
  sec,
  onChange,
}: {
  label: string;
  sec: number;
  onChange: (next: number) => void;
}) {
  const safe = Math.max(0, Math.round(sec));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return (
    <label className="space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex h-10 items-center gap-1 rounded-lg border border-input bg-background px-2">
        <input
          type="number"
          min={0}
          max={199}
          inputMode="numeric"
          className="h-8 w-14 bg-transparent text-center text-sm tabular-nums outline-none"
          value={minutes}
          onChange={(e) => {
            const m = Number(e.target.value);
            if (!Number.isFinite(m)) return;
            onChange(Math.max(0, Math.round(m)) * 60 + seconds);
          }}
        />
        <span className="text-muted-foreground">:</span>
        <input
          type="number"
          min={0}
          max={59}
          inputMode="numeric"
          className="h-8 w-12 bg-transparent text-center text-sm tabular-nums outline-none"
          value={seconds}
          onChange={(e) => {
            const s = Number(e.target.value);
            if (!Number.isFinite(s)) return;
            onChange(minutes * 60 + Math.min(59, Math.max(0, Math.round(s))));
          }}
        />
      </div>
    </label>
  );
}

function formatCueClock(sec: number): string {
  const safe = Math.max(0, Math.round(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Afbeelding / afgeronde videoseconds voor opslag (1 … 600). */
function clampMediaDurationSec(n: number): number {
  if (!Number.isFinite(n)) return 10;
  return Math.min(600, Math.max(1, Math.round(n)));
}

/**
 * Leest werkelijke mediaduur uit het videobestand (metadata). Geen fallback:
 * bij falen reject zodat we geen verkeerde duur opslaan.
 */
function readVideoDuration(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    let settled = false;
    const cleanup = () => {
      try {
        v.removeAttribute("src");
        v.load();
      } catch {
        /* ignore */
      }
    };
    const finishErr = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const finishOk = (sec: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(sec);
    };

    const to = window.setTimeout(() => finishErr(new Error("timeout")), 15000);

    v.onloadedmetadata = () => {
      window.clearTimeout(to);
      const d = v.duration;
      if (Number.isFinite(d) && d > 0) {
        finishOk(clampMediaDurationSec(d));
      } else {
        finishErr(new Error("invalid duration"));
      }
    };
    v.onerror = () => {
      window.clearTimeout(to);
      finishErr(new Error("video error"));
    };

    v.src = src;
  });
}
