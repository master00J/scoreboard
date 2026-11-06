"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { isElectron } from "@/lib/electron";
import {
  applyVideoInputSelection,
  audioDeviceLabel,
  DEFAULT_LIVESTREAM_HEALTH,
  DEFAULT_LIVESTREAM_SETTINGS,
  DEFAULT_LIVESTREAM_STATUS,
  mergeLivestreamSettings,
  sourceAudioDevices,
  type LivestreamAudioDevice,
  type LivestreamSettings,
  type LivestreamStatus,
  type LivestreamVideoInput,
} from "@/lib/livestream";
import { streamFallingBehind } from "@/lib/livestream-bitrate";
import { enumerateAudioCaptureOptions, mergeAudioDeviceLists } from "@/lib/enumerate-audio-capture-options";
import { useWallClockMs } from "@/lib/use-wall-clock-tick";
import { videoInputReady, videoKindLabel } from "@/app/control/_components/livestream-studio";
import { LivestreamAudioMixer } from "@/app/control/_components/livestream-audio-mixer";

/** Hoe lang de stopknop na de eerste klik op "Echt stoppen?" blijft staan. */
const STOP_CONFIRM_MS = 3000;

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * De livestream bedienen vanuit het Live-tabblad, naast score en scorebord.
 *
 * Alleen wat je tijdens een wedstrijd nodig hebt: wat er nu op de stream staat, een bron live zetten
 * (met de overgang uit de studio), live gaan of stoppen, en of de verbinding het bijhoudt. Alles wat
 * je één keer instelt, blijft in de studio. Dit paneel gebruikt dezelfde instellingen en dezelfde
 * aansturing als de studio, dus wat je hier doet staat daar meteen ook zo.
 */
export function LivestreamLivePanel({
  onOpenStudio,
  active,
}: {
  onOpenStudio: () => void;
  /**
   * Staat het Live-tabblad open? Het blok blijft gemount op andere tabbladen; de mixer dan niet,
   * anders meet hij dezelfde apparaten dubbel naast de mixer van de studio.
   */
  active: boolean;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<LivestreamSettings>(DEFAULT_LIVESTREAM_SETTINGS);
  const [status, setStatus] = useState<LivestreamStatus>(DEFAULT_LIVESTREAM_STATUS);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [audioDevices, setAudioDevices] = useState<LivestreamAudioDevice[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<LivestreamAudioDevice[]>([]);
  const devicesLoaded = useRef(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const now = useWallClockMs(1000);

  /** Zoals `persist` in de studio: meteen tonen, dan opslaan en de opgeslagen versie overnemen. */
  const persist = useCallback(
    async (partial: Partial<LivestreamSettings>) => {
      setSettings((current) => mergeLivestreamSettings({ ...current, ...partial }));
      const saved = await window.electronAPI?.saveLivestreamSettings?.(partial);
      if (saved) setSettings(saved);
    },
    [],
  );

  // Apparatenlijst pas laden als het Live-tabblad open is: dat vraagt Windows om alle geluidskaarten.
  useEffect(() => {
    if (!active || devicesLoaded.current || !window.electronAPI) return;
    devicesLoaded.current = true;
    void (async () => {
      const fromChrome = await enumerateAudioCaptureOptions().catch(() => []);
      const fromHost = await window.electronAPI?.listLivestreamAudioDevices?.().catch(() => []);
      setAudioDevices(mergeAudioDeviceLists(fromHost ?? [], fromChrome));
      const outputs = await window.electronAPI?.listLivestreamAudioOutputs?.().catch(() => []);
      setAudioOutputs(outputs ?? []);
    })();
  }, [active]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    void api.getLivestreamSettings?.().then((next) => next && setSettings(next));
    void api.getLivestreamStatus?.().then((next) => next && setStatus(next));
    const offStatus = api.onLivestreamStatus?.((next) => setStatus(next));
    const offSettings = api.onLivestreamSettings?.((next) => setSettings(next));
    const offPreview = api.onLivestreamPreview?.((frame) => {
      setPreview(`data:image/jpeg;base64,${typeof frame === "string" ? frame : frame.jpeg}`);
    });
    return () => {
      offStatus?.();
      offSettings?.();
      offPreview?.();
    };
  }, []);

  useEffect(() => {
    if (!status.running) setPreview(null);
  }, [status.running]);

  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    [],
  );

  if (!isElectron) {
    return <p className="text-xs text-muted-foreground">{t("livestream.electronOnly")}</p>;
  }

  const health = status.health ?? DEFAULT_LIVESTREAM_HEALTH;
  const destinationReady =
    settings.platform === "custom"
      ? Boolean(settings.customUrl.trim() && settings.streamKey.trim())
      : Boolean(settings.streamKey.trim());
  const fallingBehind = status.running && streamFallingBehind(health);
  const fpsLow = status.running && health.fps != null && health.targetFps > 0 && health.fps < health.targetFps * 0.85;
  const startedMs = status.startedAt ? Date.parse(status.startedAt) : NaN;

  const take = (input: LivestreamVideoInput) => {
    if (busy || input.id === settings.activeVideoInputId) return;
    if (!videoInputReady(input)) {
      onOpenStudio();
      return;
    }
    // Zoals in de studio: de vorige bron wordt de volgende in de wachtrij (preview).
    const nextPreview =
      settings.videoInputs.find((item) => item.id !== input.id && videoInputReady(item))?.id ?? input.id;
    void window.electronAPI?.saveLivestreamSettings?.({
      ...applyVideoInputSelection(settings, input.id),
      previewVideoInputId: nextPreview,
    });
  };

  const start = async () => {
    if (!destinationReady) {
      onOpenStudio();
      return;
    }
    if (!window.electronAPI?.startLivestream) return;
    setBusy(true);
    try {
      setStatus(await window.electronAPI.startLivestream());
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!confirmStop) {
      // Twee klikken: een misklik naast de scoreknoppen mag de stream niet stoppen.
      setConfirmStop(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmStop(false), STOP_CONFIRM_MS);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmStop(false);
    if (!window.electronAPI?.stopLivestream) return;
    setBusy(true);
    try {
      setStatus(await window.electronAPI.stopLivestream());
    } finally {
      setBusy(false);
    }
  };

  const badge = status.reconnecting
    ? { text: t("livestream.livePanelReconnecting"), tone: "bg-amber-500 text-black" }
    : status.running
      ? { text: t("livestream.livePanelLive"), tone: "bg-red-600 text-white" }
      : { text: t("livestream.livePanelOff"), tone: "bg-zinc-700 text-zinc-200" };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge.tone}`}>
          {badge.text}
        </span>
        {status.running && Number.isFinite(startedMs) ? (
          <span className="font-mono text-xs tabular-nums">{formatDuration(now - startedMs)}</span>
        ) : null}
        {status.running ? (
          <span className={`text-[11px] tabular-nums ${fpsLow ? "text-amber-400" : "text-muted-foreground"}`}>
            {health.fps != null ? health.fps.toFixed(0) : "—"}/{health.targetFps} fps
            {health.bitrateKbps != null ? ` · ${Math.round(health.bitrateKbps)}k` : ""}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          {status.running ? (
            <Button
              size="sm"
              variant={confirmStop ? "destructive" : "outline"}
              disabled={busy}
              onClick={() => void stop()}
            >
              {confirmStop ? t("livestream.livePanelStopConfirm") : t("livestream.stop")}
            </Button>
          ) : (
            <Button
              size="sm"
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={busy || !status.ffmpegFound}
              onClick={() => void start()}
            >
              {t("livestream.start")}
            </Button>
          )}
        </div>
      </div>

      <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded-md bg-black ring-1 ring-white/10">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="absolute inset-0 h-full w-full object-contain" />
        ) : (
          <div className="absolute inset-0 grid place-items-center px-3 text-center text-[11px] text-white/45">
            {status.running ? t("livestream.livePanelNoPicture") : t("livestream.livePanelNotLive")}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1" role="group" aria-label={t("livestream.livePanelSources")}>
        {settings.videoInputs.map((input, index) => {
          const on = input.id === settings.activeVideoInputId;
          const ready = videoInputReady(input);
          const label = input.name.trim() || videoKindLabel(input.kind, t, true, input.cameraDevice);
          return (
            <button
              key={input.id}
              type="button"
              aria-pressed={on}
              disabled={busy}
              title={ready ? t("livestream.livePanelTake", { name: label }) : t("livestream.switcherNeedsSetup")}
              onClick={() => take(input)}
              className={`h-9 min-w-[3rem] max-w-[9rem] truncate rounded-md px-2.5 text-[11px] font-bold ${
                on
                  ? status.running
                    ? "bg-red-600 text-white"
                    : "bg-emerald-600 text-white"
                  : ready
                    ? "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    : "bg-zinc-900 text-zinc-500"
              }`}
            >
              {index + 1}. {label}
            </button>
          );
        })}
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        {settings.transition === "cut"
          ? t("livestream.livePanelTransitionCut")
          : t("livestream.livePanelTransition", {
              kind: t(`livestream.transitionShort_${settings.transition}`),
              ms: settings.transitionMs,
            })}
      </p>

      <div className="flex flex-col gap-1.5 border-t border-border pt-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("livestream.audioSection")}
        </span>
        {!active ? null : settings.audioEnabled ? (
          <div className="overflow-x-auto rounded-md border border-border bg-zinc-950/50 p-1.5">
            <LivestreamAudioMixer
              channels={settings.audioChannels}
              masterVolume={settings.audioMasterVolume}
              devices={mergeAudioDeviceLists(audioDevices, sourceAudioDevices(settings.videoInputs))}
              deviceLabel={(name) => audioDeviceLabel(name, settings.videoInputs, t("livestream.sourceBrowser"))}
              outputs={audioOutputs}
              monitorDevice={settings.audioMonitorDevice}
              monitorCueIds={settings.audioMonitorCueIds}
              locked={status.running}
              live={status.running}
              t={t}
              onMaster={(audioMasterVolume) => void persist({ audioMasterVolume })}
              onChannels={(audioChannels) => void persist({ audioChannels })}
              onMonitorDevice={(audioMonitorDevice) => void persist({ audioMonitorDevice })}
              onMonitorCueIds={(audioMonitorCueIds) => void persist({ audioMonitorCueIds })}
            />
          </div>
        ) : (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={false}
              disabled={status.running}
              onChange={(e) => void persist({ audioEnabled: e.target.checked })}
            />
            {t("livestream.audioEnabled")}
          </label>
        )}
      </div>

      {!destinationReady && !status.running ? (
        <p className="text-[11px] text-amber-600/90">{t("livestream.needsStreamKey")}</p>
      ) : null}
      {fallingBehind ? (
        <p className="text-[11px] leading-snug text-amber-600/90">
          {t("livestream.uploadBehind", { speed: (health.speed ?? 0).toFixed(2) })}
        </p>
      ) : null}
      {status.error && !/^(Beeld opnieuw|Bronwissel)/.test(status.error) ? (
        <p className="text-[11px] text-destructive">{status.error}</p>
      ) : null}

      <button
        type="button"
        className="self-start text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        onClick={onOpenStudio}
      >
        {t("livestream.livePanelOpenStudio")}
      </button>
    </div>
  );
}
