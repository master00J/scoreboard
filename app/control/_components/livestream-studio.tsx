"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Select } from "@/components/ui/form";
import { isElectron } from "@/lib/electron";
import { useApi } from "@/lib/use-api";
import { useDisplayStore } from "@/lib/store";
import { streamProgramPhase } from "@/lib/stream-program-layout";
import type { Match, MediaItem } from "@/lib/types";
import StreamProgramPage from "@/app/stream/page";
import DisplayPage from "@/app/display/page";
import { enumerateCameraCaptureOptions, type CameraCaptureOption } from "@/lib/enumerate-camera-capture-options";
import {
  isInternalArenaCueCaptureName,
  isScreenCaptureSourceId,
  isWindowCaptureSourceId,
} from "@/lib/get-desktop-capture-stream";
import type { DesktopCaptureSourceInfo } from "@/lib/desktop-bridge";
import { enumerateAudioCaptureOptions, mergeAudioDeviceLists } from "@/lib/enumerate-audio-capture-options";
import { selectFilesViaDialog, selectFolderViaDialog } from "@/lib/electron";
import {
  DEFAULT_LIVESTREAM_HEALTH,
  DEFAULT_LIVESTREAM_SETTINGS,
  DEFAULT_LIVESTREAM_STATUS,
  guessDshowAudioForCameraLabel,
  applyVideoInputSelection,
  createVideoInput,
  mergeLivestreamSettings,
  resolveActiveVideoInput,
  sanitizeBrowserUrl,
  sanitizeMediaPath,
  mediaPathFileName,
  MEDIA_FILE_EXTENSIONS,
  sourceAudioDevices,
  audioDeviceLabel,
  mergeStreamScoreWidget,
  type LivestreamAudioChannel,
  type LivestreamAudioFollowAction,
  type LivestreamVideoInput,
  type LivestreamAudioDevice,
  type LivestreamEncoderPref,
  type LivestreamPlatform,
  type LivestreamResolution,
  type LivestreamSettings,
  type LivestreamSource,
  type LivestreamStatus,
  type StreamLayerLayout,
} from "@/lib/livestream";
import {
  bitrateAdvice,
  bitrateOptionsKbps,
  bitrateVerdict,
} from "@/lib/livestream-bitrate";
import {
  armedFollowChannels,
  channelLabel,
  encoderSummary,
  summarizeAudioFollow,
} from "@/lib/livestream-input-summary";
import {
  StudioDisclosure,
  StudioField,
  StudioMonitor,
  StudioMonitorEmpty,
  StudioSection,
  StudioStat,
} from "@/app/control/_components/livestream-ui";
import { LivestreamLayoutEditor } from "@/app/control/_components/livestream-layout-editor";
import { StreamScoreWidgetEditor } from "@/app/control/_components/stream-score-widget-editor";
import { LivestreamAudioMixer } from "@/app/control/_components/livestream-audio-mixer";
import { syncLegacyFromManualLayout } from "@/lib/stream-layer-layout";
import { sendCommand } from "@/lib/use-socket";
import {
  STREAM_DECK_HTTP_PORT,
  STREAM_DECK_KINDS,
  STREAM_DECK_MAX_SLOTS,
  STREAM_DECK_SLOT_ACCELERATORS,
  actionFromKind,
  createStreamDeckSlot,
  runScoreDeckAction,
  streamDeckSlotLabel,
  type StreamDeckAction,
  type StreamDeckInfo,
  type StreamDeckKind,
  type StreamDeckSlot,
} from "@/lib/stream-deck";

const idleStatus: LivestreamStatus = { ...DEFAULT_LIVESTREAM_STATUS };

function videoKindLabel(
  kind: LivestreamSource,
  t: (key: string, opts?: Record<string, string | number>) => string,
  short = false,
  cameraDevice = "",
) {
  if (kind === "display") return short ? t("livestream.sourceDisplayShort") : t("livestream.sourceDisplay");
  if (kind === "browser") return short ? t("livestream.sourceBrowserShort") : t("livestream.sourceBrowser");
  if (kind === "media") return short ? t("livestream.sourceMediaShort") : t("livestream.sourceMedia");
  if (isWindowCaptureSourceId(cameraDevice)) {
    return short ? t("livestream.sourceWindowShort") : t("livestream.sourceWindow");
  }
  if (isScreenCaptureSourceId(cameraDevice)) {
    return short ? t("livestream.sourceScreenShort") : t("livestream.sourceScreen");
  }
  return short ? t("livestream.sourceCameraShort") : t("livestream.sourceCamera");
}

function videoInputReady(input: LivestreamVideoInput): boolean {
  if (input.kind === "camera") return Boolean(input.cameraDevice.trim());
  if (input.kind === "browser") return Boolean(input.browserUrl.trim());
  if (input.kind === "media") return Boolean(input.mediaPath.trim());
  return true;
}

function CaptureDeviceOptions({
  cameras,
  windows,
  screens,
  usedIds,
  currentId,
  t,
}: {
  cameras: CameraCaptureOption[];
  windows: DesktopCaptureSourceInfo[];
  screens: DesktopCaptureSourceInfo[];
  usedIds: Set<string>;
  currentId: string;
  t: (key: string) => string;
}) {
  return (
    <>
      {cameras.length > 0 ? (
        <optgroup label={t("livestream.sourceCamera")}>
          {cameras.map((cam) => (
            <option key={cam.id} value={cam.id} disabled={usedIds.has(cam.id) && currentId !== cam.id}>
              {cam.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {windows.length > 0 ? (
        <optgroup label={t("livestream.sourceWindow")}>
          {windows.map((item) => (
            <option key={item.id} value={item.id} disabled={usedIds.has(item.id) && currentId !== item.id}>
              {item.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {screens.length > 0 ? (
        <optgroup label={t("livestream.sourceScreen")}>
          {screens.map((item) => (
            <option key={item.id} value={item.id} disabled={usedIds.has(item.id) && currentId !== item.id}>
              {item.name}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  );
}

function DestinationFields({
  prefix,
  platform,
  customUrl,
  streamKey,
  disabled,
  showKey,
  onToggleKey,
  onPlatform,
  onUrlChange,
  onUrlBlur,
  onKeyChange,
  onKeyBlur,
  t,
}: {
  prefix: string;
  platform: LivestreamPlatform;
  customUrl: string;
  streamKey: string;
  disabled: boolean;
  showKey: boolean;
  onToggleKey: () => void;
  onPlatform: (value: LivestreamPlatform) => void;
  onUrlChange: (value: string) => void;
  onUrlBlur: () => void;
  onKeyChange: (value: string) => void;
  onKeyBlur: () => void;
  t: (key: string) => string;
}) {
  return (
    <>
      <Label htmlFor={`${prefix}-platform`}>{t("livestream.platform")}</Label>
      <Select
        id={`${prefix}-platform`}
        value={platform}
        disabled={disabled}
        onChange={(e) => onPlatform(e.target.value as LivestreamPlatform)}
      >
        <option value="youtube">{t("livestream.youtube")}</option>
        <option value="twitch">{t("livestream.twitch")}</option>
        <option value="custom">{t("livestream.custom")}</option>
      </Select>
      {platform === "custom" && (
        <>
          <Label htmlFor={`${prefix}-url`}>{t("livestream.customUrl")}</Label>
          <Input
            id={`${prefix}-url`}
            value={customUrl}
            disabled={disabled}
            placeholder="rtmp://live.restream.io/live"
            onChange={(e) => onUrlChange(e.target.value)}
            onBlur={onUrlBlur}
          />
        </>
      )}
      <Label htmlFor={`${prefix}-key`}>{t("livestream.streamKey")}</Label>
      <Input
        id={`${prefix}-key`}
        type={showKey ? "text" : "password"}
        autoComplete="off"
        value={streamKey}
        disabled={disabled}
        onChange={(e) => onKeyChange(e.target.value)}
        onBlur={onKeyBlur}
      />
      <button
        type="button"
        className="text-[11px] text-muted-foreground text-left underline-offset-2 hover:underline"
        onClick={onToggleKey}
      >
        {showKey ? t("livestream.hideKey") : t("livestream.showKey")}
      </button>
    </>
  );
}

export function LivestreamStudio({ active = true }: { active?: boolean }) {
  const { t } = useTranslation();
  const matchId = useDisplayStore((s) => s.state?.matchId);
  const timerRunning = useDisplayStore((s) => Boolean(s.state?.timerRunning));
  const { data: match } = useApi<Match>(matchId ? `/api/matches/${matchId}` : null);
  const { data: libraryMedia } = useApi<MediaItem[]>("/api/media");
  const programPhase = streamProgramPhase(match?.status);
  const [settings, setSettings] = useState<LivestreamSettings>(DEFAULT_LIVESTREAM_SETTINGS);
  const [status, setStatus] = useState<LivestreamStatus>(idleStatus);
  const [cameras, setCameras] = useState<CameraCaptureOption[]>([]);
  const [desktopSources, setDesktopSources] = useState<DesktopCaptureSourceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<LivestreamAudioDevice[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<LivestreamAudioDevice[]>([]);
  const [browserUrlDrafts, setBrowserUrlDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showKey2, setShowKey2] = useState(false);
  const [editPhase, setEditPhase] = useState(programPhase);
  /** Live = wat je tijdens de wedstrijd bedient; Setup = wat je één keer instelt. */
  const [studioTab, setStudioTab] = useState<"live" | "setup">("live");
  const [holdPreview, setHoldPreview] = useState(false);
  const [livePreview, setLivePreview] = useState<string | null>(null);
  const [livePreviewInputId, setLivePreviewInputId] = useState<string | null>(null);
  /** Bron die klaarstaat om in beeld te komen (oranje), los van wat nu program is. */
  const [previewInputId, setPreviewInputId] = useState<string | null>(null);
  const [sourceThumbs, setSourceThumbs] = useState<Record<string, string>>({});
  const [deckInfo, setDeckInfo] = useState<StreamDeckInfo | null>(null);
  const [addPick, setAddPick] = useState<null | "camera" | "browser" | "media" | "window" | "screen">(null);
  const [addBrowserUrl, setAddBrowserUrl] = useState("");
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const programBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEditPhase(programPhase);
  }, [programPhase]);

  const previewWanted = settings.studioPreview && active;
  const activeVideo = resolveActiveVideoInput(settings);

  const booted = useRef(false);
  const refresh = useCallback(async () => {
    if (!window.electronAPI?.getLivestreamStatus) return;
    const [nextSettings, nextStatus] = await Promise.all([
      window.electronAPI.getLivestreamSettings(),
      window.electronAPI.getLivestreamStatus(),
    ]);
    setSettings(nextSettings);
    setStatus(nextStatus);
    if (!booted.current) {
      booted.current = true;
      if (!nextSettings.streamKey.trim() && !nextSettings.customUrl.trim()) setStudioTab("setup");
    }
  }, []);

  const loadCameras = useCallback(async () => {
    const list = await enumerateCameraCaptureOptions();
    setCameras(list);
  }, []);

  const loadDesktopSources = useCallback(async () => {
    if (!window.electronAPI?.getDesktopCaptureSources) {
      setDesktopSources([]);
      return;
    }
    try {
      const list = await window.electronAPI.getDesktopCaptureSources();
      setDesktopSources(list.filter((item) => !isInternalArenaCueCaptureName(item.name)));
    } catch {
      setDesktopSources([]);
    }
  }, []);

  const pickLocalMedia = useCallback(async () => {
    const paths = await selectFilesViaDialog({
      title: t("livestream.mediaPickTitle"),
      filters: [{ name: t("livestream.mediaFilter"), extensions: [...MEDIA_FILE_EXTENSIONS] }],
    });
    return sanitizeMediaPath(paths[0] ?? "");
  }, [t]);

  const loadAudioDevices = useCallback(async () => {
    const fromChrome = await enumerateAudioCaptureOptions().catch(() => []);
    let fromHost: LivestreamAudioDevice[] = [];
    try {
      fromHost = window.electronAPI?.listLivestreamAudioDevices
        ? await window.electronAPI.listLivestreamAudioDevices()
        : [];
    } catch {
      fromHost = [];
    }
    setAudioDevices(mergeAudioDeviceLists(fromHost, fromChrome));
    try {
      const outputs = window.electronAPI?.listLivestreamAudioOutputs
        ? await window.electronAPI.listLivestreamAudioOutputs()
        : [];
      setAudioOutputs(outputs);
    } catch {
      setAudioOutputs([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void loadCameras();
    void loadDesktopSources();
    void loadAudioDevices();
    void window.electronAPI?.getStreamDeckInfo?.().then((info) => {
      if (info) setDeckInfo(info);
    });
    const offStatus = window.electronAPI?.onLivestreamStatus?.((next) => setStatus(next));
    const offSettings = window.electronAPI?.onLivestreamSettings?.((next) => setSettings(next));
    const offPreview = window.electronAPI?.onLivestreamPreview?.((frame) => {
      if (typeof frame === "string") {
        setLivePreview(`data:image/jpeg;base64,${frame}`);
        setLivePreviewInputId(null);
        return;
      }
      setLivePreview(`data:image/jpeg;base64,${frame.jpeg}`);
      setLivePreviewInputId(frame.inputId ?? null);
    });
    return () => {
      offStatus?.();
      offSettings?.();
      offPreview?.();
    };
  }, [refresh, loadCameras, loadDesktopSources, loadAudioDevices]);

  useEffect(() => {
    if (!previewWanted) {
      setLivePreview(null);
      setLivePreviewInputId(null);
    }
  }, [previewWanted]);

  useEffect(() => {
    if (settings.previewVideoInputId && settings.previewVideoInputId !== previewInputId) {
      setPreviewInputId(settings.previewVideoInputId);
    }
  }, [settings.previewVideoInputId, previewInputId]);

  useEffect(() => {
    const ids = new Set(settings.videoInputs.map((input) => input.id));
    if (previewInputId && ids.has(previewInputId) && previewInputId !== settings.activeVideoInputId) return;
    if (previewInputId && ids.has(previewInputId) && previewInputId === settings.activeVideoInputId) {
      const other = settings.videoInputs.find(
        (input) => input.id !== settings.activeVideoInputId && videoInputReady(input),
      )?.id;
      setPreviewInputId(other ?? null);
      return;
    }
    const next = settings.videoInputs.find(
      (input) => input.id !== settings.activeVideoInputId && videoInputReady(input),
    )?.id;
    setPreviewInputId(next ?? null);
  }, [settings.videoInputs, settings.activeVideoInputId, previewInputId]);

  const persist = async (partial: Partial<LivestreamSettings>) => {
    const next = mergeLivestreamSettings({ ...settings, ...partial });
    setSettings(next);
    if (!window.electronAPI?.saveLivestreamSettings) return;
    setSettings(await window.electronAPI.saveLivestreamSettings(partial));
  };

  const persistLayout = async (
    target: "unified" | "play" | "break",
    partial: Partial<StreamLayerLayout>,
  ) => {
    if (target === "unified") {
      const manualLayout = { ...settings.manualLayout, ...partial };
      await persist({ manualLayout, ...syncLegacyFromManualLayout(manualLayout) });
      return;
    }
    const key = target === "play" ? "manualPlayLayout" : "manualBreakLayout";
    await persist({ [key]: { ...settings[key], ...partial } });
  };

  const saveVideoInputs = async (videoInputs: LivestreamVideoInput[], selectId?: string) => {
    const selectedId = selectId ?? settings.activeVideoInputId;
    const switching = selectedId !== settings.activeVideoInputId;
    await persist({
      videoInputs,
      activeVideoInputId: selectedId,
      ...(switching
        ? applyVideoInputSelection({ ...settings, videoInputs }, selectedId)
        : {}),
    });
  };

  const patchVideoInput = async (id: string, partial: Partial<LivestreamVideoInput>) => {
    await persist({
      videoInputs: settings.videoInputs.map((input) => (input.id === id ? { ...input, ...partial } : input)),
    });
  };

  const usedCameraIds = new Set(settings.videoInputs.map((input) => input.cameraDevice).filter(Boolean));
  const windowSources = desktopSources.filter((item) => isWindowCaptureSourceId(item.id));
  const screenSources = desktopSources.filter((item) => isScreenCaptureSourceId(item.id));

  const assignCameraDevice = (inputId: string, cameraDevice: string) => {
    const cam = cameras.find((item) => item.id === cameraDevice);
    const empty = settings.audioChannels.find((channel) => !channel.device);
    const guessed =
      cam && settings.audioEnabled && empty
        ? guessDshowAudioForCameraLabel(cam.name, audioDevices)
        : null;
    const audioChannels =
      guessed && empty
        ? settings.audioChannels.map((channel) =>
            channel.id === empty.id ? { ...channel, device: guessed } : channel,
          )
        : settings.audioChannels;
    const videoInputs = settings.videoInputs.map((item) =>
      item.id === inputId ? { ...item, cameraDevice } : item,
    );
    void persist({
      videoInputs,
      audioChannels,
      ...applyVideoInputSelection(
        { ...settings, videoInputs, audioChannels },
        settings.activeVideoInputId,
      ),
    });
  };

  const addVideoSource = (kind: LivestreamSource, extra?: Partial<LivestreamVideoInput>) => {
    if (busy || settings.videoInputs.length >= 8) return;
    if (kind === "display" && settings.videoInputs.some((item) => item.kind === "display")) return;
    const n = settings.videoInputs.filter((item) => item.kind === kind).length + 1;
    const name =
      extra?.name?.trim() ||
      (kind === "camera"
        ? t("livestream.videoInputCameraName", { n })
        : kind === "browser"
          ? t("livestream.videoInputBrowserName", { n })
          : kind === "media"
            ? t("livestream.videoInputMediaName", { n })
            : t("livestream.sourceDisplayShort"));
    const input = createVideoInput({
      name,
      kind,
      ...extra,
    });
    void saveVideoInputs([...settings.videoInputs, input]);
    setPreviewInputId(input.id);
    void persist({ previewVideoInputId: input.id });
  };

  const addCaptureSource = (cameraDevice: string) => {
    const named =
      cameras.find((item) => item.id === cameraDevice)?.name ??
      desktopSources.find((item) => item.id === cameraDevice)?.name;
    addVideoSource("camera", {
      cameraDevice,
      name: named?.trim().slice(0, 40) || undefined,
    });
    setAddPick(null);
  };

  const addBrowserSource = () => {
    const browserUrl = sanitizeBrowserUrl(addBrowserUrl);
    if (!browserUrl) return;
    addVideoSource("browser", { browserUrl });
    setAddBrowserUrl("");
    setAddPick(null);
  };

  const addLibraryMedia = (mediaPath: string, title?: string) => {
    const path = sanitizeMediaPath(mediaPath);
    if (!path) return;
    addVideoSource("media", {
      mediaPath: path,
      name: (title ?? mediaPathFileName(path)).slice(0, 40) || undefined,
    });
    setAddPick(null);
  };

  const startAddPick = (kind: "camera" | "browser" | "media" | "window" | "screen") => {
    setAddPick(kind);
    setAddBrowserUrl("");
    if (kind === "camera") void loadCameras();
    if (kind === "window" || kind === "screen") void loadDesktopSources();
  };

  const addMediaSource = () => {
    void (async () => {
      const mediaPath = await pickLocalMedia();
      if (!mediaPath) return;
      addVideoSource("media", {
        mediaPath,
        name: mediaPathFileName(mediaPath) || undefined,
      });
    })();
  };

  const removeVideoSource = (id: string) => {
    if (busy || settings.videoInputs.length <= 1) return;
    const videoInputs = settings.videoInputs.filter((item) => item.id !== id);
    const nextActive =
      settings.activeVideoInputId === id ? videoInputs[0]?.id : settings.activeVideoInputId;
    const nextPreview =
      settings.previewVideoInputId === id || previewInputId === id
        ? videoInputs.find((item) => item.id !== nextActive && item.id !== id)?.id ?? ""
        : settings.previewVideoInputId;
    setPreviewInputId(nextPreview || null);
    if (livePreviewInputId === id) {
      setLivePreview(null);
      setLivePreviewInputId(null);
    }
    void persist({
      videoInputs,
      activeVideoInputId: nextActive,
      previewVideoInputId: nextPreview,
      ...(nextActive !== settings.activeVideoInputId
        ? applyVideoInputSelection({ ...settings, videoInputs }, nextActive ?? videoInputs[0]!.id)
        : {}),
    });
  };

  const start = async () => {
    if (!window.electronAPI?.startLivestream) return;
    setBusy(true);
    setHoldPreview(true);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    try {
      await persist(settings);
      setStatus(await window.electronAPI.startLivestream());
    } catch {
      setHoldPreview(false);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!window.electronAPI?.stopLivestream) return;
    setBusy(true);
    try {
      setStatus(await window.electronAPI.stopLivestream());
    } finally {
      setHoldPreview(false);
      setBusy(false);
    }
  };

  const locked = status.running;
  const destinationReady =
    settings.platform === "custom"
      ? Boolean(settings.customUrl.trim() && settings.streamKey.trim())
      : Boolean(settings.streamKey.trim());
  const advice = bitrateAdvice(settings.resolution, settings.fps, settings.platform);
  const bitrateOptions = bitrateOptionsKbps(settings.resolution, settings.fps, settings.platform);
  const verdict = bitrateVerdict(
    settings.bitrateKbps,
    settings.resolution,
    settings.fps,
    settings.platform,
  );
  const sourceLocked = busy;
  const health = status.health ?? DEFAULT_LIVESTREAM_HEALTH;
  const healthWarn =
    status.running &&
    (health.stale ||
      health.dropFrames > 0 ||
      health.paintDrops > 2 ||
      health.packetLossHints > 0 ||
      (health.fps != null && health.targetFps > 0 && health.fps < health.targetFps * 0.85));

  const previewVideo =
    (previewInputId &&
    previewInputId !== settings.activeVideoInputId
      ? settings.videoInputs.find((input) => input.id === previewInputId)
      : undefined) ??
    settings.videoInputs.find((input) => input.id !== settings.activeVideoInputId && videoInputReady(input)) ??
    null;

  const inputLabel = (input: LivestreamVideoInput) =>
    input.name.trim() || videoKindLabel(input.kind, t, true, input.cameraDevice);

  const takeInput = (input: LivestreamVideoInput) => {
    if (!videoInputReady(input)) {
      setStudioTab("setup");
      return;
    }
    if (input.id === settings.activeVideoInputId) return;
    const next = settings.videoInputs.find((item) => item.id !== input.id && videoInputReady(item));
    setPreviewInputId(next?.id ?? input.id);
    void persist({
      ...applyVideoInputSelection(settings, input.id),
      previewVideoInputId: next?.id ?? input.id,
    });
  };

  const renderPicture = (input: LivestreamVideoInput, role: "program" | "preview") => {
    if (!settings.studioPreview) {
      return <StudioMonitorEmpty>{t("livestream.studioPreviewDisabled")}</StudioMonitorEmpty>;
    }
    if (!active) {
      return <StudioMonitorEmpty>{t("livestream.previewPaused")}</StudioMonitorEmpty>;
    }
    if (!videoInputReady(input)) {
      return <StudioMonitorEmpty>{t("livestream.switcherNeedsSetup")}</StudioMonitorEmpty>;
    }
    if (role === "preview" && input.id === settings.activeVideoInputId) {
      return <StudioMonitorEmpty>{t("livestream.monitorSame")}</StudioMonitorEmpty>;
    }
    const isProgram = input.id === settings.activeVideoInputId;
    const jpegForInput =
      Boolean(livePreview) &&
      (livePreviewInputId ? livePreviewInputId === input.id : isProgram);
    const showJpeg =
      jpegForInput &&
      (input.kind === "browser" ||
        input.kind === "media" ||
        (input.kind === "camera" && status.running));
    if (showJpeg) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={livePreview ?? undefined} alt="" className="absolute inset-0 h-full w-full object-contain" />
      );
    }
    if (input.kind === "display") {
      return <DisplayPage embedInControl />;
    }
    if (input.kind === "camera" && !status.running && !holdPreview) {
      return (
        <StreamProgramPage
          embedded
          cameraOverride={input.cameraDevice}
          settingsOverride={{
            ...settings,
            ...applyVideoInputSelection(settings, input.id),
          }}
          onScoreWidgetChange={
            role === "program"
              ? (partial, commit) => {
                  const scoreWidget = mergeStreamScoreWidget({ ...settings.scoreWidget, ...partial });
                  setSettings((s) => ({ ...s, scoreWidget }));
                  if (commit) void persist({ scoreWidget });
                }
              : undefined
          }
        />
      );
    }
    if (input.kind === "browser") {
      return (
        <StudioMonitorEmpty>
          {input.browserUrl ? t("livestream.previewBrowserLoading") : t("livestream.previewBrowser")}
        </StudioMonitorEmpty>
      );
    }
    if (input.kind === "media") {
      return (
        <StudioMonitorEmpty>
          {input.mediaPath ? t("livestream.previewMediaLoading") : t("livestream.previewMedia")}
        </StudioMonitorEmpty>
      );
    }
    if (status.running) {
      return <StudioMonitorEmpty>{t("livestream.previewLive")}</StudioMonitorEmpty>;
    }
    return <StudioMonitorEmpty>{t("livestream.previewEmpty")}</StudioMonitorEmpty>;
  };

  useEffect(() => {
    if (!settings.studioPreview || !active) return;
    const canvas = document.createElement("canvas");
    const grab = (id: string, box: HTMLElement | null) => {
      if (!box) return;
      const video = box.querySelector("video");
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      const w = 320;
      const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      const jpeg = canvas.toDataURL("image/jpeg", 0.62);
      setSourceThumbs((prev) => (prev[id] === jpeg ? prev : { ...prev, [id]: jpeg }));
    };
    const tick = () => {
      if (previewVideo) grab(previewVideo.id, previewBoxRef.current);
      grab(activeVideo.id, programBoxRef.current);
    };
    const timer = window.setInterval(tick, 140);
    return () => window.clearInterval(timer);
  }, [settings.studioPreview, active, previewVideo?.id, activeVideo.id]);

  const renderTilePicture = (input: LivestreamVideoInput) => {
    if (!videoInputReady(input)) {
      return (
        <div className="absolute inset-0 grid place-items-center px-1 text-center text-[9px] text-white/40">
          {t("livestream.switcherNeedsSetup")}
        </div>
      );
    }
    if (input.kind === "display") {
      return (
        <div className="absolute inset-0 overflow-hidden">
          <DisplayPage embedInControl />
        </div>
      );
    }
    if (
      livePreview &&
      (livePreviewInputId ? livePreviewInputId === input.id : input.id === settings.activeVideoInputId) &&
      (input.kind === "browser" || input.kind === "media")
    ) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={livePreview} alt="" className="absolute inset-0 h-full w-full object-contain" />
      );
    }
    const thumb = sourceThumbs[input.id];
    if (thumb) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-contain" />
      );
    }
    const isProgram = input.id === settings.activeVideoInputId;
    if (isProgram && livePreview && livePreviewInputId === input.id) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={livePreview} alt="" className="absolute inset-0 h-full w-full object-contain" />
      );
    }
    const usedByMonitor = isProgram || input.id === previewVideo?.id;
    if (input.kind === "camera" && !status.running && !holdPreview && !usedByMonitor) {
      return (
        <div className="absolute inset-0 overflow-hidden">
          <StreamProgramPage
            embedded
            cameraOverride={input.cameraDevice}
            settingsOverride={{
              ...settings,
              ...applyVideoInputSelection(settings, input.id),
            }}
          />
        </div>
      );
    }
    return (
      <div className="absolute inset-0 grid place-items-center px-1 text-center text-[9px] text-white/40">
        {videoKindLabel(input.kind, t, true, input.cameraDevice)}
      </div>
    );
  };

  const mixer = settings.audioEnabled ? (
    <LivestreamAudioMixer
      channels={settings.audioChannels}
      masterVolume={settings.audioMasterVolume}
      devices={mergeAudioDeviceLists(audioDevices, sourceAudioDevices(settings.videoInputs))}
      deviceLabel={(name) => audioDeviceLabel(name, settings.videoInputs, t("livestream.sourceBrowser"))}
      outputs={audioOutputs}
      monitorDevice={settings.audioMonitorDevice}
      monitorCueIds={settings.audioMonitorCueIds}
      locked={locked}
      live={status.running}
      t={t}
      onMaster={(audioMasterVolume) => void persist({ audioMasterVolume })}
      onChannels={(audioChannels: LivestreamAudioChannel[]) => void persist({ audioChannels })}
      onMonitorDevice={(audioMonitorDevice) => void persist({ audioMonitorDevice })}
      onMonitorCueIds={(audioMonitorCueIds) => void persist({ audioMonitorCueIds })}
    />
  ) : (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={false}
        disabled={locked}
        onChange={(e) => void persist({ audioEnabled: e.target.checked })}
      />
      {t("livestream.audioEnabled")}
    </label>
  );

  const runDeckAction = (action: StreamDeckAction) => {
    if (action.id === "key") {
      const nested = settings.streamDeckSlots[action.index - 1];
      if (nested) runDeckAction(nested.action);
      return;
    }
    if (action.id === "input") {
      const input = settings.videoInputs[action.index - 1];
      if (input) takeInput(input);
      return;
    }
    if (action.id === "preview") {
      const input = settings.videoInputs[action.index - 1];
      if (!input || !videoInputReady(input)) return;
      setPreviewInputId(input.id);
      void persist({ previewVideoInputId: input.id });
      return;
    }
    if (action.id === "cut") {
      if (previewVideo) takeInput(previewVideo);
      return;
    }
    if (action.id === "stream") {
      if (status.running) {
        void stop();
        return;
      }
      if (!destinationReady) {
        setStudioTab("setup");
        return;
      }
      void start();
      return;
    }
    if (action.id === "record") {
      if (status.recording) void stopRecord();
      else void startRecord();
      return;
    }
    if (action.id === "timer") {
      void sendCommand({ type: timerRunning ? "timer:pause" : "timer:start" });
      return;
    }
    if (action.id === "score") {
      void runScoreDeckAction(action, sendCommand);
      return;
    }
    void sendCommand({ type: "display:blackout" });
  };

  const patchDeckSlots = (streamDeckSlots: StreamDeckSlot[]) => {
    void persist({ streamDeckSlots });
  };

  const startRecord = async () => {
    if (!window.electronAPI?.startLivestreamRecord) return;
    setBusy(true);
    try {
      setStatus(await window.electronAPI.startLivestreamRecord());
    } finally {
      setBusy(false);
    }
  };

  const stopRecord = async () => {
    if (!window.electronAPI?.stopLivestreamRecord) return;
    setStatus((prev) => ({ ...prev, recording: false, error: null }));
    try {
      setStatus(await window.electronAPI.stopLivestreamRecord());
    } catch {
      setStatus((prev) => ({ ...prev, recording: false }));
    }
  };

  const pickRecordDir = async () => {
    const { folderPath } = await selectFolderViaDialog({ title: t("livestream.recordFolderPick") });
    if (folderPath) void persist({ recordDir: folderPath });
  };

  const streamBar = (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {status.running ? (
        <Button
          className="min-w-[7rem] bg-zinc-900 text-white hover:bg-zinc-800"
          onClick={() => void stop()}
          disabled={!isElectron || busy}
        >
          {t("livestream.stop")}
        </Button>
      ) : (
        <Button
          className="min-w-[7rem] bg-red-600 text-white hover:bg-red-700"
          onClick={() => {
            if (!destinationReady) {
              setStudioTab("setup");
              return;
            }
            void start();
          }}
          disabled={!isElectron || busy}
        >
          {t("livestream.start")}
        </Button>
      )}
      {status.recording ? (
        <Button
          className="min-w-[7rem] bg-red-800 text-white hover:bg-red-900"
          onClick={() => void stopRecord()}
          disabled={!isElectron}
        >
          {t("livestream.recordStop")}
        </Button>
      ) : (
        <Button
          className="min-w-[7rem]"
          variant="outline"
          onClick={() => void startRecord()}
          disabled={!isElectron || busy}
        >
          {t("livestream.record")}
        </Button>
      )}
      <button
        type="button"
        className="max-w-[18rem] truncate text-left text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        title={settings.recordDir.trim() || t("livestream.recordFolderDefault")}
        disabled={status.recording}
        onClick={() => void pickRecordDir()}
      >
        {status.recordPath
          ? status.recordPath.replace(/^.*[\\/]/, "")
          : settings.recordDir.trim() || t("livestream.recordFolderPick")}
      </button>
      {status.running ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <StudioStat
            label={t("livestream.fps")}
            value={`${health.fps != null ? health.fps.toFixed(1) : "—"}/${health.targetFps}`}
            tone={
              health.fps != null && health.targetFps > 0 && health.fps < health.targetFps * 0.85 ? "warn" : "normal"
            }
          />
          {health.bitrateKbps != null ? (
            <StudioStat label={t("livestream.bitrate")} value={`${Math.round(health.bitrateKbps)}k`} />
          ) : null}
          <StudioStat
            label={t("livestream.healthDropsShort")}
            value={String(health.dropFrames + health.paintDrops)}
            tone={health.dropFrames + health.paintDrops > 2 ? "warn" : "normal"}
          />
          {health.packetLossHints > 0 ? (
            <StudioStat
              label={t("livestream.healthPacketShort")}
              value={String(health.packetLossHints)}
              tone="warn"
            />
          ) : null}
          <StudioStat
            label={t("livestream.healthLabel")}
            value={health.stale ? t("livestream.healthStale") : t("livestream.healthOk")}
            tone={healthWarn ? "warn" : "normal"}
          />
        </div>
      ) : null}
      {!destinationReady && !status.running ? (
        <p className="text-[11px] text-amber-600/90">{t("livestream.needsStreamKey")}</p>
      ) : null}
      {!isElectron && <div className="text-xs text-amber-600/90">{t("livestream.electronOnly")}</div>}
      {!status.ffmpegFound && !status.running && (
        <div className="text-xs text-amber-600/90">{t("livestream.ffmpegMissing")}</div>
      )}
      {status.error &&
      !/^(Beeld opnieuw|Bronwissel)/.test(status.error) ? (
        <div className="text-xs text-destructive">{status.error}</div>
      ) : null}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t("livestream.title")}</h2>
          <div
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              status.reconnecting
                ? "bg-amber-500 text-black"
                : status.running
                  ? "bg-red-600 text-white"
                  : "bg-secondary text-muted-foreground"
            }`}
          >
            {status.reconnecting
              ? t("livestream.reconnecting")
              : status.running
                ? t("livestream.liveShort")
                : t("livestream.idle")}
          </div>
          {status.recording ? (
            <div className="rounded-full bg-red-700 px-2.5 py-0.5 text-[11px] font-bold text-white">
              {t("livestream.recording")}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`rounded-md px-2.5 py-1.5 text-[11px] ${
              settings.studioPreview ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary"
            }`}
            onClick={() => void persist({ studioPreview: !settings.studioPreview })}
          >
            {settings.studioPreview ? t("livestream.studioPreviewOn") : t("livestream.studioPreviewOff")}
          </button>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary/40 p-1">
            {(["live", "setup"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`rounded-md px-2.5 py-1.5 text-xs ${
                  studioTab === tab ? "bg-background font-semibold shadow-sm" : "text-muted-foreground"
                }`}
                onClick={() => setStudioTab(tab)}
              >
                {tab === "live" ? t("livestream.tabLive") : t("livestream.tabSetup")}
              </button>
            ))}
          </div>
        </div>
      </div>

      {studioTab === "live" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center gap-2">
            <div
              ref={previewBoxRef}
              className="aspect-video h-full min-h-0 w-auto min-w-0 max-w-[calc((100%-3.5rem)/2)]"
            >
              <StudioMonitor
                label={t("livestream.monitorNext")}
                name={previewVideo ? inputLabel(previewVideo) : "—"}
                tone="preview"
              >
                {previewVideo ? (
                  renderPicture(previewVideo, "preview")
                ) : (
                  <StudioMonitorEmpty>{t("livestream.monitorSame")}</StudioMonitorEmpty>
                )}
              </StudioMonitor>
            </div>
            <button
              type="button"
              disabled={busy || !previewVideo || previewVideo.id === settings.activeVideoInputId}
              onClick={() => {
                if (previewVideo) takeInput(previewVideo);
              }}
              className="h-10 min-w-[3.5rem] shrink-0 rounded-md bg-zinc-200 text-xs font-black tracking-wide text-zinc-900 hover:bg-white disabled:opacity-40"
            >
              {t("livestream.switcherCut")}
            </button>
            <div
              ref={programBoxRef}
              className="aspect-video h-full min-h-0 w-auto min-w-0 max-w-[calc((100%-3.5rem)/2)]"
            >
              <StudioMonitor
                label={t("livestream.monitorNow")}
                name={inputLabel(activeVideo)}
                tone={status.running ? "live" : "program"}
              >
                {renderPicture(activeVideo, "program")}
              </StudioMonitor>
            </div>
          </div>

          <div className="grid shrink-0 grid-cols-1 items-start gap-1.5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
            <div className="overflow-x-auto rounded-md border border-border bg-zinc-950/50 p-1">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-1">
                {settings.videoInputs.map((input, index) => {
                  const on = input.id === settings.activeVideoInputId;
                  const next = input.id === previewVideo?.id;
                  const ready = videoInputReady(input);
                  return (
                    <div
                      key={input.id}
                      className="relative overflow-hidden rounded bg-zinc-900 text-left ring-1 ring-white/10 hover:ring-white/25"
                    >
                      <div
                        role="button"
                        tabIndex={busy ? -1 : 0}
                        onClick={() => {
                          if (busy) return;
                          if (!ready) return;
                          setPreviewInputId(input.id);
                          void persist({ previewVideoInputId: input.id });
                        }}
                        onDoubleClick={() => {
                          if (!busy) takeInput(input);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          if (busy || !ready) return;
                          setPreviewInputId(input.id);
                          void persist({ previewVideoInputId: input.id });
                        }}
                        className="relative aspect-video bg-black"
                      >
                        <div className={`absolute inset-x-0 top-0 z-10 h-1 ${on ? "bg-emerald-500" : next ? "bg-amber-500" : "bg-zinc-700"}`} />
                        {ready ? (
                          renderTilePicture(input)
                        ) : input.kind === "camera" ? (
                          <div
                            className="absolute inset-0 z-20 flex items-center p-1"
                            onClick={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                          >
                            <Select
                              aria-label={t("livestream.camera")}
                              className="h-7 w-full px-1 text-[10px]"
                              value={input.cameraDevice}
                              disabled={sourceLocked}
                              onChange={(e) => assignCameraDevice(input.id, e.target.value)}
                            >
                              <option value="">{t("livestream.cameraPick")}</option>
                              <CaptureDeviceOptions
                                cameras={cameras}
                                windows={windowSources}
                                screens={screenSources}
                                usedIds={usedCameraIds}
                                currentId={input.cameraDevice}
                                t={t}
                              />
                            </Select>
                          </div>
                        ) : input.kind === "browser" ? (
                          <div
                            className="absolute inset-0 z-20 flex items-center p-1"
                            onClick={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                          >
                            <Input
                              aria-label={t("livestream.browserUrl")}
                              className="h-7 px-1 text-[10px]"
                              type="url"
                              inputMode="url"
                              placeholder={t("livestream.browserUrlPlaceholder")}
                              value={browserUrlDrafts[input.id] ?? input.browserUrl}
                              disabled={sourceLocked}
                              onChange={(e) =>
                                setBrowserUrlDrafts((drafts) => ({ ...drafts, [input.id]: e.target.value }))
                              }
                              onBlur={(e) => {
                                const browserUrl = sanitizeBrowserUrl(e.target.value);
                                setBrowserUrlDrafts((drafts) => {
                                  const nextDrafts = { ...drafts };
                                  delete nextDrafts[input.id];
                                  return nextDrafts;
                                });
                                if (browserUrl !== input.browserUrl) {
                                  void patchVideoInput(input.id, { browserUrl });
                                }
                              }}
                            />
                          </div>
                        ) : input.kind === "media" ? (
                          <div
                            className="absolute inset-0 z-20 flex items-center justify-center p-1"
                            onClick={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                          >
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[10px]"
                              disabled={sourceLocked}
                              onClick={() => {
                                void (async () => {
                                  const mediaPath = await pickLocalMedia();
                                  if (!mediaPath) return;
                                  void patchVideoInput(input.id, {
                                    mediaPath,
                                    name: input.name.trim() || mediaPathFileName(mediaPath),
                                  });
                                })();
                              }}
                            >
                              {t("livestream.mediaPick")}
                            </Button>
                          </div>
                        ) : (
                          renderTilePicture(input)
                        )}
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 truncate bg-black/70 px-1 py-0.5 text-[10px] font-medium text-white">
                          <span className="mr-0.5 text-white/40">{index + 1}</span>
                          {inputLabel(input)}
                        </div>
                      </div>
                      {settings.videoInputs.length > 1 ? (
                        <button
                          type="button"
                          aria-label={t("livestream.videoInputRemove")}
                          title={t("livestream.videoInputRemove")}
                          disabled={sourceLocked}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeVideoSource(input.id);
                          }}
                          className="absolute right-0.5 top-1.5 z-30 flex h-5 w-5 items-center justify-center rounded bg-black/70 text-[11px] leading-none text-white/80 hover:bg-red-700 hover:text-white disabled:opacity-40"
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                {settings.videoInputs.length < 8 ? (
                  <div className="flex min-h-[4.75rem] flex-col justify-center gap-0.5 rounded bg-zinc-900/80 p-1 ring-1 ring-dashed ring-white/20">
                    {addPick ? (
                      <>
                        <div className="px-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/50">
                          {addPick === "camera"
                            ? t("livestream.cameraPick")
                            : addPick === "window"
                              ? t("livestream.windowPick")
                              : addPick === "screen"
                                ? t("livestream.screenPick")
                                : addPick === "browser"
                                  ? t("livestream.browserUrl")
                                  : t("livestream.mediaPick")}
                        </div>
                        {addPick === "camera" || addPick === "window" || addPick === "screen" ? (
                          <div className="max-h-28 overflow-y-auto">
                            {addPick === "camera" && cameras.length === 0 ? (
                              <button
                                type="button"
                                disabled={sourceLocked}
                                onClick={() => void loadCameras()}
                                className="h-6 w-full truncate rounded text-left text-[10px] text-amber-200 hover:bg-zinc-800"
                              >
                                {t("livestream.refreshCameras")}
                              </button>
                            ) : null}
                            {(addPick === "window" || addPick === "screen") &&
                            (addPick === "window" ? windowSources : screenSources).length === 0 ? (
                              <button
                                type="button"
                                disabled={sourceLocked}
                                onClick={() => void loadDesktopSources()}
                                className="h-6 w-full truncate rounded text-left text-[10px] text-amber-200 hover:bg-zinc-800"
                              >
                                {t("livestream.refreshWindows")}
                              </button>
                            ) : null}
                            {(addPick === "camera"
                              ? cameras
                              : addPick === "window"
                                ? windowSources
                                : screenSources
                            ).map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                disabled={sourceLocked || usedCameraIds.has(item.id)}
                                title={item.name}
                                onClick={() => addCaptureSource(item.id)}
                                className="h-6 w-full truncate rounded px-1 text-left text-[10px] font-medium text-zinc-100 hover:bg-zinc-800 disabled:opacity-40"
                              >
                                {item.name}
                              </button>
                            ))}
                          </div>
                        ) : addPick === "browser" ? (
                          <div className="flex flex-col gap-0.5">
                            <Input
                              aria-label={t("livestream.browserUrl")}
                              className="h-7 px-1 text-[10px]"
                              type="url"
                              inputMode="url"
                              placeholder={t("livestream.browserUrlPlaceholder")}
                              value={addBrowserUrl}
                              disabled={sourceLocked}
                              onChange={(e) => setAddBrowserUrl(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") addBrowserSource();
                              }}
                            />
                            <button
                              type="button"
                              disabled={sourceLocked || !sanitizeBrowserUrl(addBrowserUrl)}
                              onClick={addBrowserSource}
                              className="h-6 rounded text-[10px] font-semibold text-zinc-100 hover:bg-zinc-800 disabled:opacity-40"
                            >
                              {t("common.add")}
                            </button>
                          </div>
                        ) : (
                          <div className="max-h-24 overflow-y-auto">
                            <button
                              type="button"
                              disabled={sourceLocked}
                              onClick={() => {
                                void (async () => {
                                  const mediaPath = await pickLocalMedia();
                                  if (!mediaPath) return;
                                  addLibraryMedia(mediaPath);
                                })();
                              }}
                              className="h-6 w-full truncate rounded px-1 text-left text-[10px] font-semibold text-zinc-100 hover:bg-zinc-800 disabled:opacity-40"
                            >
                              {t("livestream.mediaPick")}
                            </button>
                            {(libraryMedia ?? [])
                              .filter((item) => item.active !== false && !item.hideFromLibrary)
                              .map((item) => (
                                <button
                                  key={item.id}
                                  type="button"
                                  disabled={sourceLocked}
                                  title={item.title || mediaPathFileName(item.path)}
                                  onClick={() => addLibraryMedia(item.path, item.title)}
                                  className="h-6 w-full truncate rounded px-1 text-left text-[10px] font-medium text-zinc-100 hover:bg-zinc-800 disabled:opacity-40"
                                >
                                  {item.title || mediaPathFileName(item.path)}
                                </button>
                              ))}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setAddPick(null);
                            setAddBrowserUrl("");
                          }}
                          className="h-5 text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          {t("common.cancel")}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={sourceLocked}
                          onClick={() => startAddPick("camera")}
                          className="h-6 rounded text-[10px] font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
                        >
                          {t("livestream.videoInputsAdd")}
                        </button>
                        <button
                          type="button"
                          disabled={sourceLocked}
                          onClick={() => startAddPick("window")}
                          className="h-6 rounded text-[10px] font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
                        >
                          {t("livestream.videoInputsAddWindow")}
                        </button>
                        <button
                          type="button"
                          disabled={sourceLocked}
                          onClick={() => startAddPick("screen")}
                          className="h-6 rounded text-[10px] font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
                        >
                          {t("livestream.videoInputsAddScreen")}
                        </button>
                        <button
                          type="button"
                          disabled={sourceLocked}
                          onClick={() => startAddPick("browser")}
                          className="h-6 rounded text-[10px] font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
                        >
                          {t("livestream.videoInputsAddBrowser")}
                        </button>
                        <button
                          type="button"
                          disabled={sourceLocked}
                          onClick={() => startAddPick("media")}
                          className="h-6 rounded text-[10px] font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
                        >
                          {t("livestream.videoInputsAddMedia")}
                        </button>
                        {settings.videoInputs.some((item) => item.kind === "display") ? null : (
                          <button
                            type="button"
                            disabled={sourceLocked}
                            onClick={() => addVideoSource("display")}
                            className="h-6 rounded text-[10px] font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
                          >
                            {t("livestream.videoInputsAddDisplay")}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="overflow-x-auto rounded-md border border-border bg-zinc-950/50 p-1.5">{mixer}</div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1 rounded-md border border-border bg-zinc-950/70 p-1">
            <span className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("livestream.deckSection")}
            </span>
            {settings.streamDeckSlots.length === 0 ? (
              <button
                type="button"
                className="h-9 rounded-md px-2 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setStudioTab("setup")}
              >
                {t("livestream.deckEmpty")}
              </button>
            ) : (
              settings.streamDeckSlots.map((slot, index) => {
                const action = slot.action;
                const source =
                  action.id === "input" || action.id === "preview"
                    ? settings.videoInputs[action.index - 1]
                    : undefined;
                const on = source && action.id === "input" && source.id === settings.activeVideoInputId;
                const next =
                  source &&
                  (action.id === "preview" || action.id === "input") &&
                  source.id === previewVideo?.id &&
                  !on;
                const live = action.id === "stream" && status.running;
                const rec = action.id === "record" && status.recording;
                return (
                  <button
                    key={slot.id}
                    type="button"
                    disabled={busy}
                    title={`${STREAM_DECK_SLOT_ACCELERATORS[index] ?? `/key/${index + 1}`} · ${streamDeckSlotLabel(slot, t)}`}
                    onClick={() => runDeckAction(action)}
                    className={`h-9 min-w-[2.75rem] max-w-[7rem] truncate rounded-md px-2 text-[10px] font-bold ${
                      rec
                        ? "bg-red-700 text-white"
                        : live
                          ? "bg-red-600 text-white"
                          : on
                            ? "bg-emerald-600 text-white"
                            : next
                              ? "bg-amber-500 text-black"
                              : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    }`}
                  >
                    {streamDeckSlotLabel(slot, t)}
                  </button>
                );
              })
            )}
            <button
              type="button"
              className="ml-auto h-9 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-zinc-800 hover:text-foreground"
              onClick={() => setStudioTab("setup")}
            >
              {t("livestream.deckEdit")}
            </button>
          </div>

          {streamBar}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
                {studioTab === "setup" ? (
        <StudioSection
          title={t("livestream.outputSection")}
          summary={
            settings.dualEnabled
              ? t("livestream.outputDual", { platform: settings.platform, platform2: settings.platform2 })
              : settings.platform
          }
        >
          <DestinationFields
            prefix="ls1"
            platform={settings.platform}
            customUrl={settings.customUrl}
            streamKey={settings.streamKey}
            disabled={locked}
            showKey={showKey}
            onToggleKey={() => setShowKey((v) => !v)}
            onPlatform={(platform) => void persist({ platform })}
            onUrlChange={(customUrl) => setSettings((s) => ({ ...s, customUrl }))}
            onUrlBlur={() => void persist({ customUrl: settings.customUrl })}
            onKeyChange={(streamKey) => setSettings((s) => ({ ...s, streamKey }))}
            onKeyBlur={() => void persist({ streamKey: settings.streamKey })}
            t={t}
          />
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.dualEnabled}
              disabled={locked}
              onChange={(e) => void persist({ dualEnabled: e.target.checked })}
            />
            {t("livestream.dualEnabled")}
          </label>
          {settings.dualEnabled && (
            <>
              <div className="text-[11px] font-medium text-muted-foreground">{t("livestream.output2")}</div>
              <DestinationFields
                prefix="ls2"
                platform={settings.platform2}
                customUrl={settings.customUrl2}
                streamKey={settings.streamKey2}
                disabled={locked}
                showKey={showKey2}
                onToggleKey={() => setShowKey2((v) => !v)}
                onPlatform={(platform2) => void persist({ platform2 })}
                onUrlChange={(customUrl2) => setSettings((s) => ({ ...s, customUrl2 }))}
                onUrlBlur={() => void persist({ customUrl2: settings.customUrl2 })}
                onKeyChange={(streamKey2) => setSettings((s) => ({ ...s, streamKey2 }))}
                onKeyBlur={() => void persist({ streamKey2: settings.streamKey2 })}
                t={t}
              />
            </>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground">{t("livestream.recordFolder")}</span>
            <span className="max-w-[22rem] truncate font-mono text-[11px]">
              {settings.recordDir.trim() || t("livestream.recordFolderDefault")}
            </span>
            <Button size="sm" variant="outline" disabled={status.recording} onClick={() => void pickRecordDir()}>
              {t("livestream.recordFolderPick")}
            </Button>
          </div>
        </StudioSection>
        ) : null}

        {studioTab === "setup" ? (
        <StudioSection
          title={t("livestream.deckSection")}
          summary={t("livestream.deckSlotCount", { n: settings.streamDeckSlots.length })}
        >
          <p className="text-[11px] text-muted-foreground leading-snug">{t("livestream.deckHelp")}</p>
          <p className="text-[11px] text-muted-foreground">
            {deckInfo?.pluginInstalled ? t("livestream.deckPluginOn") : t("livestream.deckPluginOff")}
            {" · "}
            <span className="font-mono">{deckInfo?.baseUrl ?? `http://127.0.0.1:${STREAM_DECK_HTTP_PORT}`}</span>
          </p>
          <div className="flex flex-wrap gap-1">
            {STREAM_DECK_KINDS.map((kind) => (
              <button
                key={kind.id}
                type="button"
                disabled={settings.streamDeckSlots.length >= STREAM_DECK_MAX_SLOTS}
                className="h-7 rounded-md bg-secondary px-2 text-[11px] hover:bg-secondary/80 disabled:opacity-40"
                onClick={() =>
                  patchDeckSlots([
                    ...settings.streamDeckSlots,
                    createStreamDeckSlot(actionFromKind(kind.id, { index: 1, side: "home" })),
                  ])
                }
              >
                + {t(kind.labelKey)}
              </button>
            ))}
          </div>
          {settings.streamDeckSlots.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("livestream.deckEmptyHelp")}</p>
          ) : (
            <div className="grid gap-1.5">
              {settings.streamDeckSlots.map((slot, index) => {
                const kind: StreamDeckKind = slot.action.id === "key" ? "cut" : slot.action.id;
                const sourceIndex =
                  slot.action.id === "input" || slot.action.id === "preview" ? slot.action.index : 1;
                const scoreSide = slot.action.id === "score" ? slot.action.side : "home";
                const update = (next: StreamDeckSlot) => {
                  patchDeckSlots(settings.streamDeckSlots.map((item) => (item.id === slot.id ? next : item)));
                };
                return (
                  <div
                    key={slot.id}
                    className="grid grid-cols-1 items-center gap-1.5 rounded-md border border-border p-1.5 sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)_auto]"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {STREAM_DECK_SLOT_ACCELERATORS[index] ?? `/key/${index + 1}`}
                    </span>
                    <Select
                      value={kind}
                      disabled={locked}
                      className="h-8 text-[11px]"
                      onChange={(e) =>
                        update({
                          ...slot,
                          action: actionFromKind(e.target.value as StreamDeckKind, {
                            index: sourceIndex,
                            side: scoreSide,
                          }),
                        })
                      }
                    >
                      {STREAM_DECK_KINDS.map((item) => (
                        <option key={item.id} value={item.id}>
                          {t(item.labelKey)}
                        </option>
                      ))}
                    </Select>
                    {kind === "input" || kind === "preview" ? (
                      <Select
                        value={String(sourceIndex)}
                        disabled={locked}
                        className="h-8 text-[11px]"
                        onChange={(e) =>
                          update({
                            ...slot,
                            action: actionFromKind(kind, { index: Number(e.target.value) }),
                          })
                        }
                      >
                        {settings.videoInputs.map((input, inputIndex) => (
                          <option key={input.id} value={String(inputIndex + 1)}>
                            {inputIndex + 1}. {input.name.trim() || videoKindLabel(input.kind, t, true, input.cameraDevice)}
                          </option>
                        ))}
                      </Select>
                    ) : kind === "score" ? (
                      <Select
                        value={scoreSide}
                        disabled={locked}
                        className="h-8 text-[11px]"
                        onChange={(e) =>
                          update({
                            ...slot,
                            action: actionFromKind("score", {
                              side: e.target.value as "home" | "away",
                            }),
                          })
                        }
                      >
                        <option value="home">{t("livestream.deckScoreHome")}</option>
                        <option value="away">{t("livestream.deckScoreAway")}</option>
                      </Select>
                    ) : (
                      <Input
                        value={slot.title}
                        disabled={locked}
                        className="h-8 text-[11px]"
                        placeholder={t("livestream.deckLabel")}
                        onChange={(e) => update({ ...slot, title: e.target.value.slice(0, 16) })}
                      />
                    )}
                    <div className="flex items-center gap-1">
                      {(kind === "input" || kind === "preview" || kind === "score") && (
                        <Input
                          value={slot.title}
                          disabled={locked}
                          className="h-8 w-24 text-[11px]"
                          placeholder={t("livestream.deckLabel")}
                          onChange={(e) => update({ ...slot, title: e.target.value.slice(0, 16) })}
                        />
                      )}
                      <button
                        type="button"
                        className="h-8 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                        disabled={locked || index === 0}
                        onClick={() => {
                          const next = [...settings.streamDeckSlots];
                          [next[index - 1], next[index]] = [next[index], next[index - 1]];
                          patchDeckSlots(next);
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="h-8 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                        disabled={locked || index === settings.streamDeckSlots.length - 1}
                        onClick={() => {
                          const next = [...settings.streamDeckSlots];
                          [next[index + 1], next[index]] = [next[index], next[index + 1]];
                          patchDeckSlots(next);
                        }}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="h-8 px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
                        disabled={locked}
                        onClick={() =>
                          patchDeckSlots(settings.streamDeckSlots.filter((item) => item.id !== slot.id))
                        }
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </StudioSection>
        ) : null}

        {studioTab === "setup" ? (
        <StudioSection
          title={t("livestream.sourceSection")}
          summary={t("livestream.sourceCount", { n: settings.videoInputs.length })}
        >
          {settings.videoInputs.map((input, index) => {
            const followChannels = armedFollowChannels(settings.audioChannels);
            const follow = summarizeAudioFollow(input, followChannels, (n) =>
              t("livestream.audioChannel", { n }),
            );
            const followSummary = follow.empty
              ? t("livestream.audioFollowNone")
              : [
                  follow.unmute.length ? `${follow.unmute.join(", ")} ${t("livestream.audioFollowOnShort")}` : "",
                  follow.mute.length ? `${follow.mute.join(", ")} ${t("livestream.audioFollowOffShort")}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ");
            return (
              <div key={input.id} className="rounded-lg border border-border p-2.5 flex flex-col gap-2">
                <div className="flex items-end gap-2">
                  <StudioField
                    label={t("livestream.videoInputName")}
                    htmlFor={`ls-vin-name-${input.id}`}
                    className="flex-1"
                  >
                    <Input
                      id={`ls-vin-name-${input.id}`}
                      className="h-8"
                      value={input.name}
                      disabled={sourceLocked}
                      placeholder={
                        input.kind === "display"
                          ? t("livestream.sourceDisplay")
                          : input.kind === "browser"
                            ? t("livestream.sourceBrowser")
                            : input.kind === "media"
                              ? t("livestream.videoInputMediaName", { n: index + 1 })
                              : t("livestream.videoInputCameraName", { n: index + 1 })
                      }
                      onChange={(e) => void patchVideoInput(input.id, { name: e.target.value })}
                    />
                  </StudioField>
                  <div className="mb-0.5 flex h-8 w-[6.5rem] shrink-0 items-center rounded-md bg-secondary/60 px-2 text-[11px] text-muted-foreground">
                    {videoKindLabel(input.kind, t, true, input.cameraDevice)}
                  </div>
                  {settings.videoInputs.length > 1 ? (
                    <button
                      type="button"
                      aria-label={t("livestream.videoInputRemove")}
                      title={t("livestream.videoInputRemove")}
                      className="mb-0.5 h-8 shrink-0 rounded-md px-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      disabled={sourceLocked}
                      onClick={() => removeVideoSource(input.id)}
                    >
                      ×
                    </button>
                  ) : null}
                </div>

                {input.kind === "media" ? (
                  <div className="flex flex-col gap-1">
                    <StudioField label={t("livestream.mediaFile")} htmlFor={`ls-vin-media-${input.id}`}>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant={input.mediaPath ? "outline" : "default"}
                          disabled={sourceLocked}
                          onClick={() => {
                            void (async () => {
                              const mediaPath = await pickLocalMedia();
                              if (!mediaPath) return;
                              const name = mediaPathFileName(mediaPath);
                              void patchVideoInput(input.id, { mediaPath, name });
                            })();
                          }}
                        >
                          {input.mediaPath ? mediaPathFileName(input.mediaPath) : t("livestream.mediaPick")}
                        </Button>
                        {libraryMedia && libraryMedia.length > 0 ? (
                          <Select
                            id={`ls-vin-media-${input.id}`}
                            className="h-8 min-w-[10rem] flex-1"
                            value={libraryMedia.some((item) => item.path === input.mediaPath) ? input.mediaPath : ""}
                            disabled={sourceLocked}
                            onChange={(e) => {
                              const mediaPath = sanitizeMediaPath(e.target.value);
                              if (!mediaPath) return;
                              const item = libraryMedia.find((entry) => entry.path === mediaPath);
                              void patchVideoInput(input.id, {
                                mediaPath,
                                name: input.name.trim() || (item?.title ?? mediaPathFileName(mediaPath)).slice(0, 40),
                              });
                            }}
                          >
                            <option value="">{t("livestream.mediaFromLibrary")}</option>
                            {libraryMedia
                              .filter((item) => item.active !== false && !item.hideFromLibrary)
                              .map((item) => (
                                <option key={item.id} value={item.path}>
                                  {item.title || mediaPathFileName(item.path)}
                                </option>
                              ))}
                          </Select>
                        ) : null}
                      </div>
                    </StudioField>
                    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={input.mediaLoop}
                        disabled={sourceLocked}
                        onChange={(e) => void patchVideoInput(input.id, { mediaLoop: e.target.checked })}
                      />
                      {t("livestream.mediaLoop")}
                    </label>
                  </div>
                ) : input.kind === "browser" ? (
                  <StudioField label={t("livestream.browserUrl")} htmlFor={`ls-vin-url-${input.id}`}>
                    <Input
                      id={`ls-vin-url-${input.id}`}
                      className="h-8"
                      type="url"
                      inputMode="url"
                      placeholder={t("livestream.browserUrlPlaceholder")}
                      value={browserUrlDrafts[input.id] ?? input.browserUrl}
                      disabled={sourceLocked}
                      onChange={(e) =>
                        setBrowserUrlDrafts((drafts) => ({ ...drafts, [input.id]: e.target.value }))
                      }
                      onBlur={(e) => {
                        const browserUrl = sanitizeBrowserUrl(e.target.value);
                        setBrowserUrlDrafts((drafts) => {
                          const next = { ...drafts };
                          delete next[input.id];
                          return next;
                        });
                        if (browserUrl !== input.browserUrl) void patchVideoInput(input.id, { browserUrl });
                      }}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={sourceLocked || !sanitizeBrowserUrl(browserUrlDrafts[input.id] ?? input.browserUrl)}
                        onClick={() => {
                          const browserUrl = sanitizeBrowserUrl(browserUrlDrafts[input.id] ?? input.browserUrl);
                          if (browserUrl !== input.browserUrl) void patchVideoInput(input.id, { browserUrl });
                          void window.electronAPI?.openLivestreamBrowserInteract?.(browserUrl);
                        }}
                      >
                        {t("livestream.browserInteract")}
                      </Button>
                    </div>
                  </StudioField>
                ) : input.kind === "camera" ? (
                  <StudioField label={t("livestream.camera")} htmlFor={`ls-vin-cam-${input.id}`}>
                    <Select
                      id={`ls-vin-cam-${input.id}`}
                      className="h-8"
                      value={input.cameraDevice}
                      disabled={sourceLocked}
                      onChange={(e) => assignCameraDevice(input.id, e.target.value)}
                    >
                      <option value="">{t("livestream.cameraPick")}</option>
                      <CaptureDeviceOptions
                        cameras={cameras}
                        windows={windowSources}
                        screens={screenSources}
                        usedIds={usedCameraIds}
                        currentId={input.cameraDevice}
                        t={t}
                      />
                    </Select>
                  </StudioField>
                ) : null}

                {settings.audioEnabled && followChannels.length > 1 && settings.videoInputs.length > 1 ? (
                  <StudioDisclosure title={t("livestream.audioFollowTitle")} summary={followSummary}>
                    {followChannels.map((channel, channelIndex) => (
                      <div key={channel.id} className="grid grid-cols-[1fr_auto] items-center gap-2">
                        <span className="truncate text-[11px]">
                          {channelLabel(channel, channelIndex, (n) => t("livestream.audioChannel", { n }))}
                        </span>
                        <Select
                          aria-label={t("livestream.audioFollowTitle")}
                          className="h-8 w-[8.5rem]"
                          value={input.audioFollow[channel.id] ?? "leave"}
                          disabled={sourceLocked}
                          onChange={(e) =>
                            void patchVideoInput(input.id, {
                              audioFollow: {
                                ...input.audioFollow,
                                [channel.id]: e.target.value as LivestreamAudioFollowAction,
                              },
                            })
                          }
                        >
                          <option value="leave">{t("livestream.audioFollowLeave")}</option>
                          <option value="unmute">{t("livestream.audioFollowUnmute")}</option>
                          <option value="mute">{t("livestream.audioFollowMute")}</option>
                        </Select>
                      </div>
                    ))}
                  </StudioDisclosure>
                ) : null}
              </div>
            );
          })}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={sourceLocked || settings.videoInputs.length >= 8}
              onClick={() => addVideoSource("camera")}
            >
              {t("livestream.videoInputsAdd")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={sourceLocked || settings.videoInputs.length >= 8}
              onClick={() => {
                setStudioTab("live");
                startAddPick("window");
              }}
            >
              {t("livestream.videoInputsAddWindow")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={sourceLocked || settings.videoInputs.length >= 8}
              onClick={() => {
                setStudioTab("live");
                startAddPick("screen");
              }}
            >
              {t("livestream.videoInputsAddScreen")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={sourceLocked || settings.videoInputs.length >= 8}
              onClick={() => addVideoSource("browser")}
            >
              {t("livestream.videoInputsAddBrowser")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={sourceLocked || settings.videoInputs.length >= 8}
              onClick={addMediaSource}
            >
              {t("livestream.videoInputsAddMedia")}
            </Button>
            {settings.videoInputs.some((item) => item.kind === "display") ? null : (
              <Button
                size="sm"
                variant="outline"
                disabled={sourceLocked || settings.videoInputs.length >= 8}
                onClick={() => addVideoSource("display")}
              >
                {t("livestream.videoInputsAddDisplay")}
              </Button>
            )}
            {cameras.length === 0 ? (
              <Button size="sm" variant="outline" onClick={() => void loadCameras()} disabled={sourceLocked}>
                {t("livestream.refreshCameras")}
              </Button>
            ) : null}
          </div>
        </StudioSection>
        ) : null}

        <StudioSection
          title={t("livestream.audioSection")}
          summary={
            settings.audioEnabled
              ? t("livestream.audioCount", { n: armedFollowChannels(settings.audioChannels).length })
              : t("common.off")
          }
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.audioEnabled}
              disabled={locked}
              onChange={(e) => void persist({ audioEnabled: e.target.checked })}
            />
            {t("livestream.audioEnabled")}
          </label>
          {settings.audioEnabled && (
            <>
              {mixer}
              {audioDevices.length === 0 ? (
                <Button size="sm" variant="outline" onClick={() => void loadAudioDevices()} disabled={locked}>
                  {t("livestream.refreshAudio")}
                </Button>
              ) : null}
            </>
          )}
        </StudioSection>

        {studioTab === "setup" && settings.source === "camera" && (
          <StudioSection
            title={t("livestream.layersSection")}
            summary={
              settings.layoutMode === "auto" ? t("livestream.layoutAuto") : t("livestream.layoutManual")
            }
          >
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`rounded-lg border px-3 py-2 text-left text-sm ${
                  settings.layoutMode === "auto" ? "border-primary bg-primary/10 font-semibold" : "border-border"
                }`}
                onClick={() => void persist({ layoutMode: "auto" })}
              >
                {t("livestream.layoutAuto")}
                <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                  {t("livestream.layoutAutoShort")}
                </span>
              </button>
              <button
                type="button"
                className={`rounded-lg border px-3 py-2 text-left text-sm ${
                  settings.layoutMode === "manual" ? "border-primary bg-primary/10 font-semibold" : "border-border"
                }`}
                onClick={() => void persist({ layoutMode: "manual" })}
              >
                {t("livestream.layoutManual")}
                <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                  {t("livestream.layoutManualShort")}
                </span>
              </button>
            </div>
            {settings.layoutMode === "auto" ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.sponsors}
                  onChange={(e) => void persist({ sponsors: e.target.checked })}
                />
                {t("livestream.sponsorsDuringBreakAuto")}
              </label>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.manualPhaseSplit}
                    onChange={(e) => void persist({ manualPhaseSplit: e.target.checked })}
                  />
                  {t("livestream.manualPhaseSplit")}
                </label>
                {!settings.manualPhaseSplit ? (
                  <LivestreamLayoutEditor
                    idPrefix="ls-unified"
                    layout={settings.manualLayout}
                    onChange={(partial) => void persistLayout("unified", partial)}
                    t={t}
                  />
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary/40 p-1">
                      <button
                        type="button"
                        className={`rounded-md px-2 py-1.5 text-xs ${
                          editPhase === "play" ? "bg-background font-semibold shadow-sm" : "text-muted-foreground"
                        }`}
                        onClick={() => setEditPhase("play")}
                      >
                        {t("livestream.phasePlay")}
                        {programPhase === "play" ? ` · ${t("livestream.previewLayoutActive")}` : ""}
                      </button>
                      <button
                        type="button"
                        className={`rounded-md px-2 py-1.5 text-xs ${
                          editPhase === "break" ? "bg-background font-semibold shadow-sm" : "text-muted-foreground"
                        }`}
                        onClick={() => setEditPhase("break")}
                      >
                        {t("livestream.phaseBreak")}
                        {programPhase === "break" ? ` · ${t("livestream.previewLayoutActive")}` : ""}
                      </button>
                    </div>
                    {editPhase === "play" ? (
                      <LivestreamLayoutEditor
                        idPrefix="ls-play"
                        layout={settings.manualPlayLayout}
                        onChange={(partial) => void persistLayout("play", partial)}
                        t={t}
                      />
                    ) : (
                      <LivestreamLayoutEditor
                        idPrefix="ls-break"
                        layout={settings.manualBreakLayout}
                        onChange={(partial) => void persistLayout("break", partial)}
                        t={t}
                      />
                    )}
                  </>
                )}
              </>
            )}
            <StreamScoreWidgetEditor
              widget={settings.scoreWidget}
              designs={settings.scoreWidgetDesigns}
              onChange={(partial) =>
                void persist({ scoreWidget: { ...settings.scoreWidget, ...partial } })
              }
              onDesignsChange={(scoreWidgetDesigns) => void persist({ scoreWidgetDesigns })}
              t={t}
            />
          </StudioSection>
        )}

        {studioTab === "setup" ? (
        <StudioDisclosure title={t("livestream.encoderSection")} summary={encoderSummary(settings)}>
          <div className="grid grid-cols-2 gap-2">
            <StudioField label={t("livestream.encoder")} htmlFor="ls-encoder">
              <Select
                id="ls-encoder"
                className="h-8"
                value={settings.encoder}
                disabled={locked}
                onChange={(e) => void persist({ encoder: e.target.value as LivestreamEncoderPref })}
              >
                <option value="auto">{t("livestream.encoderAuto")}</option>
                <option value="h264_nvenc">{t("livestream.encoderNvenc")}</option>
                <option value="libx264">{t("livestream.encoderX264")}</option>
              </Select>
            </StudioField>
            <StudioField label={t("livestream.resolution")} htmlFor="ls-res">
              <Select
                id="ls-res"
                className="h-8"
                value={settings.resolution}
                disabled={locked}
                onChange={(e) => void persist({ resolution: e.target.value as LivestreamResolution })}
              >
                <option value="1920x1080">1920×1080</option>
                <option value="1280x720">1280×720</option>
              </Select>
            </StudioField>
            <StudioField label={t("livestream.fps")} htmlFor="ls-fps">
              <Select
                id="ls-fps"
                className="h-8"
                value={String(settings.fps)}
                disabled={locked}
                onChange={(e) => void persist({ fps: Number(e.target.value) })}
              >
                <option value="15">15</option>
                <option value="30">30</option>
                <option value="60">60</option>
              </Select>
            </StudioField>
            <StudioField label={t("livestream.bitrate")} htmlFor="ls-br">
              <Select
                id="ls-br"
                className="h-8"
                value={String(settings.bitrateKbps)}
                disabled={locked}
                onChange={(e) => void persist({ bitrateKbps: Number(e.target.value) })}
              >
                {bitrateOptions.map((kbps) => (
                  <option key={kbps} value={kbps}>
                    {kbps} kbps{kbps === advice.recommendedKbps ? ` — ${t("livestream.bitrateRecommended")}` : ""}
                  </option>
                ))}
              </Select>
            </StudioField>
          </div>
          {verdict === "low" && (
            <p className="text-[11px] leading-snug text-amber-600/90">
              {t("livestream.bitrateTooLow", {
                recommended: advice.recommendedKbps,
                resolution: settings.resolution === "1920x1080" ? "1080p" : "720p",
                fps: settings.fps,
              })}
            </p>
          )}
          {verdict === "high" && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("livestream.bitrateTooHigh", { maximum: advice.maximumKbps })}
            </p>
          )}
        </StudioDisclosure>
        ) : null}
        </div>
      )}
    </div>
  );
}
