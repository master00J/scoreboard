"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDisplayStore } from "@/lib/store";
import { sendCommand } from "@/lib/use-socket";
import { useApi } from "@/lib/use-api";
import { isElectron } from "@/lib/electron";
import { useLicenseFeatures } from "@/lib/use-license-features";
import type { Match, MatchEvent, Player, MediaItem } from "@/lib/types";
import type { MatchStatusT } from "@/lib/validation/commands";
import { isLivePlayingMatchStatus, programmedDisplayMode } from "@/lib/live-cycle-settings";
import { getSportProfile } from "@/lib/sports";

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
  useEffect(() => {
    reloadMedia();
  }, [state?.updatedAt, reloadMedia]);
  const mediaList = useMemo(
    () =>
      (mediaRaw ?? [])
        .filter((m) => m.active && !m.hideFromLibrary)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [mediaRaw],
  );
  const [mediaPickId, setMediaPickId] = useState("");
  const [mediaSearch, setMediaSearch] = useState("");
  const quickLaunchMedia = useMemo(
    () => mediaList.filter((m) => Boolean(m.quickLaunch)),
    [mediaList],
  );

  const filteredMediaList = useMemo(() => {
    const q = mediaSearch.trim().toLowerCase();
    if (!q) return mediaList;
    return mediaList.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        (m.type === "VIDEO" ? "video" : "beeld").includes(q) ||
        String(m.durationSec).includes(q),
    );
  }, [mediaList, mediaSearch]);

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

  async function playMediaId(mediaId: string) {
    if (!mediaId) return;
    await sendCommand({
      type: "display:setMode",
      mode: "SPONSOR",
      meta: { activeMediaId: mediaId },
    });
  }

  async function playMediaOnce() {
    await playMediaId(mediaPickId);
  }

  async function resumeProgrammedDisplay() {
    await sendCommand({
      type: "display:setMode",
      mode: programmedDisplayMode({
        matchStatus: activeMatch?.status,
        automaticSponsorsAllowed,
      }),
      meta: { activeMediaId: null },
    });
  }

  async function backToLiveProgram() {
    if (!automaticSponsorsAllowed) return;
    await resumeProgrammedDisplay();
  }

  const primaryLive = mode === "SPONSOR_ROTATION";
  const onlyBoard = mode === "MATCH";
  const oneOffMedia = mode === "SPONSOR" && !!state?.activeMediaId;

  return (
    <div className="bg-card border border-border rounded-xl p-6 flex flex-col gap-4">
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

      {isElectron && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="text-[11px] h-8"
            title={t("display.restartDisplay")}
            onClick={() => void reloadDisplay()}
          >
            {t("display.restartDisplay")}
          </Button>
        </div>
      )}

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

      <section className="space-y-2">
        <div className="text-xs font-medium text-foreground/90">{t("display.phaseTitle")}</div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          {t("display.phaseHint")}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {sportProfile.id === "FOOTBALL" ? PHASES.map((p) => (
            <Button
              key={p.status}
              size="sm"
              variant={phaseButtonActive(p.status, activeMatch?.status) ? "default" : "outline"}
              disabled={!activeMatch}
              className="h-auto min-h-10 py-2 whitespace-normal text-center leading-tight"
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

      <section className="space-y-2 border-t border-border pt-4">
        <div className="text-xs font-medium text-foreground/90">{t("display.boardVsSponsors")}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button
            size="lg"
            variant={primaryLive ? "default" : "outline"}
            className="h-auto min-h-[4.75rem] flex-col items-center justify-center gap-1 px-3 py-3 whitespace-normal text-center leading-snug"
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
            className="h-auto min-h-[4.75rem] flex-col items-center justify-center gap-1 px-3 py-3 whitespace-normal text-center leading-snug"
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

      <section className="space-y-2 border-t border-border pt-4">
        <div className="text-xs font-medium text-foreground/90">{t("display.quickLaunchTitle")}</div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          {t("display.quickLaunchHint")}
        </p>
        {quickLaunchMedia.length === 0 ? (
          <p className="text-[11px] text-muted-foreground rounded-md border border-dashed border-border px-3 py-2">
            {t("display.quickLaunchEmpty")}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {quickLaunchMedia.map((m) => {
              const playing = oneOffMedia && state?.activeMediaId === m.id;
              return (
                <Button
                  key={m.id}
                  type="button"
                  size="lg"
                  variant={playing ? "default" : "outline"}
                  className="h-auto min-h-14 flex-col items-stretch justify-center gap-0.5 px-2 py-2 whitespace-normal text-left leading-tight border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20"
                  onClick={() => void playMediaId(m.id)}
                >
                  <span className="text-[10px] uppercase tracking-wide text-amber-800 dark:text-amber-300">
                    {m.type === "VIDEO" ? t("media.typeVideo") : t("media.typeImage")}
                    {playing ? ` · ${t("display.oneOffPlayingShort")}` : ""}
                  </span>
                  <span className="text-sm font-semibold break-words text-foreground">{m.title}</span>
                </Button>
              );
            })}
          </div>
        )}
        {oneOffMedia ? (
          <Button
            type="button"
            variant="destructive"
            className="w-full"
            onClick={() => void resumeProgrammedDisplay()}
          >
            {t("display.oneOffStop")}
          </Button>
        ) : null}
      </section>

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
        {oneOffMedia ? (
          <p className="text-[11px] text-amber-700/90 dark:text-amber-400/90 leading-snug">
            {t("display.oneOffPlaying")}
          </p>
        ) : null}
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
          <Button
            type="button"
            variant="destructive"
            className="sm:flex-1"
            disabled={!oneOffMedia}
            onClick={() => void resumeProgrammedDisplay()}
          >
            {t("display.oneOffStop")}
          </Button>
        </div>
      </section>

      <Button
        size="lg"
        variant="destructive"
        className="font-black tracking-wider"
        onClick={() => void sendCommand({ type: "display:blackout" })}
      >
        BLACKOUT
      </Button>
    </div>
  );
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
