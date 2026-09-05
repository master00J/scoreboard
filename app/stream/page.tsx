"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalCaptureVideo, type ExternalCaptureVideoHandle } from "@/components/external-capture-video";
import { CardMode } from "@/app/display/_modes/card";
import { SubstitutionMode } from "@/app/display/_modes/substitution";
import { StreamScoreWidget } from "@/app/stream/stream-score-widget";
import { StreamBreakSponsorOverlay } from "@/app/stream/stream-break-sponsor";
import { StreamClipLayer } from "@/app/stream/stream-clip-layer";
import { StreamSponsorLayer } from "@/app/stream/stream-sponsor-layer";
import { useSocketSync } from "@/lib/use-socket";
import { useDisplayStore } from "@/lib/store";
import { useLiveTimerSeconds } from "@/lib/use-timer";
import { useStreamSponsorSlot } from "@/lib/use-stream-sponsor-slot";
import { useApi } from "@/lib/use-api";
import { useTranslation } from "react-i18next";
import { sportClockSeconds } from "@/lib/sports";
import { tMatchPeriod } from "@/lib/i18n/t-phase";
import {
  streamWidgetClearancePx,
  widgetScoreEdge,
} from "@/lib/stream-score-widget";
import { DEFAULT_LIVESTREAM_SETTINGS, type LivestreamSettings } from "@/lib/livestream";
import {
  matchPlayersById,
  resolveCardColor,
  resolveSubTeam,
  streamShowsEventGraphic,
} from "@/lib/stream-match-overlay";
import { resolveStreamOverlayClip, streamOverlayClipAllowed } from "@/lib/stream-program-clip";
import { resolveStreamProgramLayout } from "@/lib/stream-program-layout";
import type { Match, MediaItem } from "@/lib/types";

function cameraFromQuery(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("camera") ?? "";
}

export default function StreamProgramPage({
  cameraOverride,
  embedded = false,
  settingsOverride,
  onScoreWidgetChange,
}: {
  cameraOverride?: string;
  embedded?: boolean;
  settingsOverride?: LivestreamSettings;
  onScoreWidgetChange?: (partial: Partial<LivestreamSettings["scoreWidget"]>, commit: boolean) => void;
} = {}) {
  const { t } = useTranslation();
  useSocketSync();
  const state = useDisplayStore((s) => s.state);
  const elapsedRaw = useLiveTimerSeconds();
  const [camera, setCamera] = useState(() => cameraOverride ?? cameraFromQuery());
  const [streamSettings, setStreamSettings] = useState<LivestreamSettings>(
    settingsOverride ?? DEFAULT_LIVESTREAM_SETTINGS,
  );
  const { data: match, reload: reloadMatch } = useApi<Match>(
    state?.matchId ? `/api/matches/${state.matchId}` : null,
  );

  useEffect(() => {
    if (embedded) return;
    document.body.classList.add("display-page");
    return () => document.body.classList.remove("display-page");
  }, [embedded]);

  useEffect(() => {
    setCamera(cameraOverride ?? cameraFromQuery());
  }, [cameraOverride]);

  useEffect(() => {
    if (settingsOverride) {
      setStreamSettings(settingsOverride);
      return;
    }
    let cancelled = false;
    void window.electronAPI?.getLivestreamSettings?.().then((next) => {
      if (!cancelled) setStreamSettings(next);
    });
    const off = window.electronAPI?.onLivestreamSettings?.((next) => {
      if (!cancelled) setStreamSettings(next);
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [settingsOverride]);

  const captureRef = useRef<ExternalCaptureVideoHandle>(null);

  const notifyProgramReady = () => {
    if (embedded) return;
    window.electronAPI?.reportStreamProgramReady?.();
  };

  useEffect(() => {
    if (!camera) notifyProgramReady();
  }, [camera]);

  useEffect(() => {
    return window.electronAPI?.onLivestreamReadyRequest?.(() => {
      if (!camera || captureRef.current?.isPlaying()) notifyProgramReady();
    });
  }, [camera]);

  useEffect(() => {
    void reloadMatch();
  }, [state?.updatedAt, reloadMatch]);

  const sponsorSlot = useStreamSponsorSlot(match ?? null);
  const [displayMedia, setDisplayMedia] = useState<MediaItem | null>(null);
  useEffect(() => {
    if (!state?.activeMediaId) {
      setDisplayMedia(null);
      return;
    }
    let cancelled = false;
    void fetch("/api/media")
      .then((res) => (res.ok ? res.json() : []))
      .then((list: MediaItem[]) => {
        if (cancelled) return;
        const found = Array.isArray(list) ? list.find((item) => item.id === state.activeMediaId) : null;
        setDisplayMedia(found ?? null);
      })
      .catch(() => {
        if (!cancelled) setDisplayMedia(null);
      });
    return () => {
      cancelled = true;
    };
  }, [state?.activeMediaId]);

  const players = useMemo(() => matchPlayersById(match ?? null), [match]);
  const cardPlayer = state?.activePlayerId ? players[state.activePlayerId] ?? null : null;
  const subIn = state?.activeSubInId ? players[state.activeSubInId] ?? null : null;
  const subOut = state?.activeSubOutId ? players[state.activeSubOutId] ?? null : null;
  const eventGraphic = streamShowsEventGraphic(state?.mode);
  const currentMinute = Math.floor(elapsedRaw / 60);
  const overlayClip = useMemo(
    () =>
      resolveStreamOverlayClip({
        scheduled: sponsorSlot.activeScheduledCue?.media,
        displayMode: state?.mode,
        displayMedia,
      }),
    [sponsorSlot.activeScheduledCue?.media, state?.mode, displayMedia],
  );
  const layout = useMemo(
    () => resolveStreamProgramLayout(streamSettings, match?.status),
    [streamSettings, match?.status],
  );
  const showOverlayClip =
    overlayClip != null &&
    !eventGraphic &&
    streamOverlayClipAllowed({
      phase: layout.phase,
      layoutMode: streamSettings.layoutMode,
      displayMode: state?.mode,
      fromScheduledCue: Boolean(sponsorSlot.activeScheduledCue),
    });
  const period = tMatchPeriod(t, match ?? null);
  const scoreboardClock = match
    ? sportClockSeconds(match.sport, elapsedRaw, match.periodDurationSec)
    : elapsedRaw;
  const scoreEdge = widgetScoreEdge(streamSettings.scoreWidget);
  const widgetClearance = streamWidgetClearancePx(streamSettings.scoreWidget);
  const scoreVisible = layout.showScore && Boolean(match) && state?.mode !== "SUBSTITUTION";

  return (
    <div
      className={`${embedded ? "absolute inset-0" : "fixed inset-0"} grid place-items-center bg-black overflow-hidden`}
      data-stream-program
      data-stream-phase={layout.phase}
    >
      <div
        className="relative aspect-video h-full max-h-full w-full max-w-[177.78vh] overflow-hidden bg-black"
        data-stream-canvas
      >
      {camera ? (
        <ExternalCaptureVideo
          ref={captureRef}
          sourceId={camera}
          className="absolute inset-0 h-full w-full"
          onReady={notifyProgramReady}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-white/40 text-2xl">
          Geen camera
        </div>
      )}
      {state?.mode === "CARD" && match ? (
        <div className="absolute inset-0 z-30">
          <CardMode
            player={cardPlayer}
            color={resolveCardColor(match.events, state.activePlayerId)}
            minute={currentMinute}
          />
        </div>
      ) : null}
      {state?.mode === "SUBSTITUTION" && match ? (
        <div className="absolute inset-0 z-30">
          <SubstitutionMode
            team={resolveSubTeam(match, subIn, subOut)}
            playerIn={subIn}
            playerOut={subOut}
            minute={currentMinute}
          />
        </div>
      ) : null}
      {showOverlayClip && overlayClip ? (
        <StreamClipLayer
          clip={overlayClip}
          variant={layout.phase === "break" ? "fullscreen" : "pip"}
          sponsorPosition={layout.sponsorPosition}
          scorePosition={scoreEdge}
          scoreVisible={scoreVisible}
          stripHeightPx={widgetClearance}
          onEnded={
            sponsorSlot.activeScheduledCue ? () => sponsorSlot.dismissActiveScheduledCue() : undefined
          }
        />
      ) : null}
      {layout.showSponsorBreak && !showOverlayClip && !eventGraphic ? (
        <StreamBreakSponsorOverlay slot={sponsorSlot} match={match ?? null} />
      ) : null}
      {layout.showSponsorStrip && !showOverlayClip && !eventGraphic ? (
        <StreamSponsorLayer
          slot={sponsorSlot}
          match={match ?? null}
          style={layout.sponsorStripStyle}
          sponsorPosition={layout.sponsorPosition}
          scorePosition={scoreEdge}
          scoreVisible={scoreVisible}
          stripHeightPx={widgetClearance}
        />
      ) : null}
      {scoreVisible && match ? (
        <StreamScoreWidget
          match={match}
          elapsed={scoreboardClock}
          running={Boolean(state?.timerRunning)}
          period={period}
          addedTime={state?.addedTimeMinutes ?? 0}
          widget={streamSettings.scoreWidget}
          interactive={embedded}
          onTransformChange={(next, commit) => onScoreWidgetChange?.(next, commit)}
        />
      ) : null}
      </div>
    </div>
  );
}
