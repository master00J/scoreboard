"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalCaptureVideo } from "@/components/external-capture-video";
import { NetworkCaptureVideo } from "@/components/network-capture-video";
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
import {
  DEFAULT_LIVESTREAM_SETTINGS,
  programLayer,
  programScene,
  type LivestreamSettings,
} from "@/lib/livestream";
import { StreamSceneLayers, type SceneLayerHandle } from "@/app/stream/stream-scene-layers";
import { StreamLayerFrame } from "@/components/stream-layer-frame";
import {
  matchPlayersById,
  resolveCardColor,
  resolveSubTeam,
  streamShowsEventGraphic,
} from "@/lib/stream-match-overlay";
import { resolveStreamOverlayClip, streamOverlayClipAllowed } from "@/lib/stream-program-clip";
import {
  resolveStreamProgramLayout,
  streamCustomSurface,
  type StreamProgramPhase,
} from "@/lib/stream-program-layout";
import { mergeScoreboardTheme } from "@/lib/scoreboard-theme";
import { useLiveShotClockSeconds } from "@/lib/use-timer";
import { CustomScoreboardLayout } from "@/app/display/_modes/custom-scoreboard-layout";
import { StreamSponsorMedia } from "@/app/stream/stream-sponsor-layer";
import type { Match, MediaItem } from "@/lib/types";

function cameraFromQuery(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("camera") ?? "";
}

/** Het streamvenster tekent een beeld-in-beeld-scène (alle lagen) in plaats van één bron. */
function sceneFromQuery(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("scene") === "1";
}

/** Beeld komt van de netwerkbron (RTSP/UDP/SRT/RTMP) in plaats van een capture-apparaat. */
function networkFromQuery(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("network") === "1";
}

export default function StreamProgramPage({
  cameraOverride,
  embedded = false,
  settingsOverride,
  onScoreWidgetChange,
  phaseOverride,
  layoutCanvas = false,
  sceneMode,
  liveCameras = true,
}: {
  cameraOverride?: string;
  embedded?: boolean;
  settingsOverride?: LivestreamSettings;
  onScoreWidgetChange?: (partial: Partial<LivestreamSettings["scoreWidget"]>, commit: boolean) => void;
  /** Toon deze fase in plaats van die van de lopende wedstrijd (voor de indeling-editor). */
  phaseOverride?: StreamProgramPhase;
  /**
   * Gebruikt als tekenvlak om de indeling in te stellen: geen camerabeeld en geen "Geen camera",
   * maar een rustige achtergrond waarop de lagen te zien en te verslepen zijn.
   */
  layoutCanvas?: boolean;
  /**
   * Teken alle lagen van de live scène (beeld-in-beeld) in plaats van één camera. In het
   * streamvenster komt dit uit `?scene=1`.
   */
  sceneMode?: boolean;
  /** Uit = camera's in de scène als vlak met hun naam (de stream heeft ze al open). */
  liveCameras?: boolean;
} = {}) {
  const { t } = useTranslation();
  useSocketSync();
  const state = useDisplayStore((s) => s.state);
  const elapsedRaw = useLiveTimerSeconds();
  const [camera, setCamera] = useState(() => cameraOverride ?? cameraFromQuery());
  const [network, setNetwork] = useState(() => (cameraOverride ? false : networkFromQuery()));
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
    setNetwork(cameraOverride ? false : networkFromQuery());
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

  // Beide spelers melden op dezelfde manier of ze beeld geven.
  const captureRef = useRef<{ isPlaying: () => boolean }>(null);
  const composite = sceneMode ?? sceneFromQuery();
  const scene = useMemo(() => (composite ? programScene(streamSettings) : null), [composite, streamSettings]);
  /** Bij beeld-in-beeld: één speler per camera- of netwerklaag. */
  const layerHandles = useRef(new Map<string, { isPlaying: () => boolean }>());
  const registerLayerHandle = useCallback((layerId: string, handle: SceneLayerHandle) => {
    if (handle) layerHandles.current.set(layerId, handle);
    else layerHandles.current.delete(layerId);
  }, []);
  const sceneHasLiveSource = Boolean(
    scene?.layers.some((layer) => {
      const kind = streamSettings.videoInputs.find((input) => input.id === layer.inputId)?.kind;
      return kind === "camera" || kind === "network";
    }),
  );
  /** Er is een bron die eerst beeld moet leveren voor de opname mag starten. */
  const hasLiveSource = composite ? sceneHasLiveSource : Boolean(camera) || network;
  const sourcePlaying = () =>
    composite
      ? [...layerHandles.current.values()].some((handle) => handle.isPlaying())
      : Boolean(captureRef.current?.isPlaying());

  const notifyProgramReady = () => {
    if (embedded) return;
    window.electronAPI?.reportStreamProgramReady?.();
  };

  useEffect(() => {
    if (!hasLiveSource) notifyProgramReady();
  }, [hasLiveSource]);

  useEffect(() => {
    return window.electronAPI?.onLivestreamReadyRequest?.(() => {
      if (!hasLiveSource || sourcePlaying()) notifyProgramReady();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLiveSource, composite]);

  useEffect(() => {
    void reloadMatch();
  }, [state?.updatedAt, reloadMatch]);

  // De eigen overlay staat in het scorebordthema (Scherm indelen → Livestream). Zoals het
  // stadionscherm opnieuw lezen bij elke statuswijziging, zodat opslaan in de editor meteen telt.
  const [themeJson, setThemeJson] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((s: { scoreboardThemeJson?: string | null } | null) => {
        if (!cancelled && s) setThemeJson(s.scoreboardThemeJson ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [state?.updatedAt]);
  const scoreboardTheme = useMemo(() => mergeScoreboardTheme(themeJson), [themeJson]);
  const shotClockSeconds = useLiveShotClockSeconds();

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
    () => resolveStreamProgramLayout(streamSettings, match?.status, phaseOverride),
    [streamSettings, match?.status, phaseOverride],
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
  /** Eigen indeling uit Scherm indelen in plaats van de vaste lagen, als de club dat koos. */
  const customSurface = streamCustomSurface(streamSettings, layout.phase);
  const scoreVisible =
    !customSurface && layout.showScore && Boolean(match) && state?.mode !== "SUBSTITUTION";
  /** Kader van de live scène voor de camera of netwerkbron; de score en sponsors blijven staan. */
  const sourceLayer = useMemo(() => programLayer(streamSettings), [streamSettings]);

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
      {composite ? (
        scene ? (
          <StreamSceneLayers
            scene={scene}
            inputs={streamSettings.videoInputs}
            liveCameras={liveCameras}
            liveNetwork={!embedded}
            registerHandle={registerLayerHandle}
            onActive={notifyProgramReady}
          />
        ) : null
      ) : camera ? (
        <StreamLayerFrame layer={sourceLayer}>
          {(className) => (
            <ExternalCaptureVideo
              ref={captureRef}
              sourceId={camera}
              className={className}
              onActive={notifyProgramReady}
            />
          )}
        </StreamLayerFrame>
      ) : network ? (
        <StreamLayerFrame layer={sourceLayer}>
          {(className) => (
            <NetworkCaptureVideo ref={captureRef} className={className} onActive={notifyProgramReady} />
          )}
        </StreamLayerFrame>
      ) : layoutCanvas ? (
        // Rustige achtergrond: de lagen moeten opvallen, niet het vlak eronder.
        <div
          className="absolute inset-0"
          style={{
            background:
              "repeating-conic-gradient(#1c222b 0% 25%, #161b22 0% 50%) 50% / 48px 48px",
          }}
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
      {customSurface && match && !showOverlayClip && !eventGraphic ? (
        <div className="pointer-events-none absolute inset-0 z-20">
          <CustomScoreboardLayout
            match={match}
            elapsed={scoreboardClock}
            running={Boolean(state?.timerRunning)}
            period={period}
            addedTime={state?.addedTimeMinutes ?? 0}
            shotClock={shotClockSeconds}
            theme={scoreboardTheme}
            elements={scoreboardTheme.elements[customSurface]}
            transparent
          >
            <StreamSponsorMedia slot={sponsorSlot} match={match} placeholder={layoutCanvas} />
          </CustomScoreboardLayout>
        </div>
      ) : null}
      {!customSurface && layout.showSponsorBreak && !showOverlayClip && !eventGraphic ? (
        <StreamBreakSponsorOverlay slot={sponsorSlot} match={match ?? null} placeholder={layoutCanvas} />
      ) : null}
      {!customSurface && layout.showSponsorStrip && !showOverlayClip && !eventGraphic ? (
        <StreamSponsorLayer
          slot={sponsorSlot}
          match={match ?? null}
          style={layout.sponsorStripStyle}
          sponsorPosition={layout.sponsorPosition}
          scorePosition={scoreEdge}
          scoreVisible={scoreVisible}
          stripHeightPx={widgetClearance}
          placeholder={layoutCanvas}
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
