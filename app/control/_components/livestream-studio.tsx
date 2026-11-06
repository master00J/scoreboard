"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Crop, Gauge, Keyboard, Layers, Radio, Video, Volume2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Select } from "@/components/ui/form";
import { isElectron } from "@/lib/electron";
import { useApi } from "@/lib/use-api";
import { useDisplayStore } from "@/lib/store";
import { streamProgramPhase } from "@/lib/stream-program-layout";
import type { Match, MediaItem } from "@/lib/types";
import StreamProgramPage from "@/app/stream/page";
import { useDisplayPreviewFrame } from "@/lib/use-display-preview-frame";
import { shouldPauseDisplayPreviewCapture } from "@/lib/preview-capture-modes";
import { enumerateCameraCaptureOptions, type CameraCaptureOption } from "@/lib/enumerate-camera-capture-options";
import {
  isInternalArenaCueCaptureName,
  isScreenCaptureSourceId,
  isWindowCaptureSourceId,
} from "@/lib/get-desktop-capture-stream";
import type {
  NetworkSourceBridgeStatus, DesktopCaptureSourceInfo } from "@/lib/desktop-bridge";
import { enumerateAudioCaptureOptions, mergeAudioDeviceLists } from "@/lib/enumerate-audio-capture-options";
import { selectFilesViaDialog, selectFolderViaDialog } from "@/lib/electron";
import {
  DEFAULT_LIVESTREAM_HEALTH,
  DEFAULT_LIVESTREAM_SETTINGS,
  DEFAULT_LIVESTREAM_STATUS,
  guessDshowAudioForCameraLabel,
  applyScenePreview,
  applySceneSelection,
  applyVideoInputSelection,
  createVideoInput,
  programScene,
  takeScene,
  mergeLivestreamSettings,
  resolveActiveVideoInput,
  sanitizeBrowserUrl,
  sourceShowsStreamLayers,
  sanitizeMediaPath,
  mediaPathFileName,
  MEDIA_FILE_EXTENSIONS,
  sourceAudioDevices,
  audioDeviceLabel,
  mergeStreamScoreWidget,
  parseWasapiHelperError,
  clampBitrateKbps,
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
import { sanitizeNetworkUrl } from "@/lib/network-source";
import {
  bitrateAdvice,
  bitrateOptionsKbps,
  bitrateVerdict,
  AUDIO_BITRATES_KBPS,
  clampUploadMbps,
  effectiveBitrateKbps,
  ENCODER_PRESETS,
  KEYFRAME_SECONDS,
  LIVESTREAM_QUALITIES,
  streamFallingBehind,
  streamFormatPlan,
  totalUploadKbps,
  uploadBudgetKbps,
  type LivestreamEncoderPreset,
  type LivestreamQuality,
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
import { StreamLayoutDesigner } from "@/app/control/_components/stream-layout-designer";
import { autoPhaseLayout, type StreamProgramPhase } from "@/lib/stream-program-layout";
import { LivestreamAudioMixer } from "@/app/control/_components/livestream-audio-mixer";
import { StreamOverlaySwitch } from "@/app/control/_components/stream-overlay-switch";
import { syncLegacyFromManualLayout } from "@/lib/stream-layer-layout";
import { STREAM_TRANSITIONS, transitionDurationOptions } from "@/lib/stream-transition";
import { sendCommand } from "@/lib/use-socket";
import {
  addSceneLayer,
  canAddSceneLayer,
  duplicateScene,
  layerColorSupported,
  layerKindInPage,
  moveSceneLayer,
  removeSceneLayer,
  resetSceneLayer,
  sceneHasInput,
  sceneInputId,
  sceneIsComposite,
  sceneMainLayer,
  STREAM_SCENE_LAYER_LIMIT,
  STREAM_SCENE_LIMIT,
  updateSceneLayer,
  type StreamScene,
  type StreamSceneLayer,
} from "@/lib/stream-scenes";
import { StreamLayerFrame } from "@/components/stream-layer-frame";
import {
  StreamLayerEditor,
  StreamLayerPanel,
  type StreamLayerPatch,
} from "@/app/control/_components/stream-layer-editor";
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

/** Categorieën van het Instellen-tabblad, in de volgorde van het OBS-instellingenvenster. */
type SetupCategory = "stream" | "output" | "sources" | "audio" | "overlay" | "hotkeys";
const SETUP_CATEGORIES: readonly { id: SetupCategory; icon: LucideIcon }[] = [
  { id: "stream", icon: Radio },
  { id: "output", icon: Gauge },
  { id: "sources", icon: Video },
  { id: "audio", icon: Volume2 },
  { id: "overlay", icon: Layers },
  { id: "hotkeys", icon: Keyboard },
];

export function videoKindLabel(
  kind: LivestreamSource,
  t: (key: string, opts?: Record<string, string | number>) => string,
  short = false,
  cameraDevice = "",
) {
  if (kind === "display") return short ? t("livestream.sourceDisplayShort") : t("livestream.sourceDisplay");
  if (kind === "browser") return short ? t("livestream.sourceBrowserShort") : t("livestream.sourceBrowser");
  if (kind === "media") return short ? t("livestream.sourceMediaShort") : t("livestream.sourceMedia");
  if (kind === "network") return short ? t("livestream.sourceNetworkShort") : t("livestream.sourceNetwork");
  if (isWindowCaptureSourceId(cameraDevice)) {
    return short ? t("livestream.sourceWindowShort") : t("livestream.sourceWindow");
  }
  if (isScreenCaptureSourceId(cameraDevice)) {
    return short ? t("livestream.sourceScreenShort") : t("livestream.sourceScreen");
  }
  return short ? t("livestream.sourceCameraShort") : t("livestream.sourceCamera");
}

/** Naam van een scène: zijn eigen naam, anders die van de bron van de hoofdlaag. */
export function sceneLabel(
  scene: StreamScene,
  input: LivestreamVideoInput | undefined,
  t: (key: string, opts?: Record<string, string | number>) => string,
) {
  const own = scene.name.trim();
  if (own) return own;
  if (!input) return "—";
  return input.name.trim() || videoKindLabel(input.kind, t, true, input.cameraDevice);
}

/**
 * Wat de netwerkbron op dit moment doet.
 *
 * Een IP-camera kan wegvallen zonder dat de stream stopt: de pomp herhaalt het laatste beeld en
 * ffmpeg blijft doorlopen. Zonder deze regel zou de operator een stilstaand beeld moeten raden.
 */
function NetworkSourceState({
  status,
  t,
}: {
  status: NetworkSourceBridgeStatus | null;
  t: (key: string, opts?: Record<string, string | number>) => string;
}) {
  if (!status?.url) return null;
  const retrying = status.running && !status.receiving && status.attempt > 0;
  const text = status.receiving
    ? t("livestream.networkStateReceiving")
    : retrying
      ? t("livestream.networkStateRetrying", { n: status.attempt })
      : status.running
        ? t("livestream.networkStateWaiting")
        : t("livestream.networkStateOff");
  const tone = status.receiving
    ? "bg-emerald-500"
    : status.running
      ? "bg-amber-500"
      : "bg-muted-foreground/50";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} aria-hidden />
      <span className={status.receiving ? "" : "text-amber-600/90"}>{text}</span>
      {status.mode === "h264" ? (
        <span className="text-muted-foreground">{t("livestream.networkStateTranscoding")}</span>
      ) : null}
      <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">{status.url}</span>
    </div>
  );
}

export function videoInputReady(input: LivestreamVideoInput): boolean {
  if (input.kind === "camera") return Boolean(input.cameraDevice.trim());
  if (input.kind === "browser") return Boolean(input.browserUrl.trim());
  if (input.kind === "media") return Boolean(input.mediaPath.trim());
  if (input.kind === "network") return Boolean(input.networkUrl.trim());
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
        <option value="facebook">{t("livestream.facebook")}</option>
        <option value="custom">{t("livestream.custom")}</option>
      </Select>
      {platform === "facebook" && (
        <p className="text-[11px] leading-snug text-muted-foreground">{t("livestream.facebookHint")}</p>
      )}
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
  const displayMode = useDisplayStore((s) => s.state?.mode);
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
  /** Wat de operator typt in het uploadveld (met komma of punt); null = toon de opgeslagen waarde. */
  const [uploadDraft, setUploadDraft] = useState<string | null>(null);
  /** Idem voor het vrije bitrateveld in de geavanceerde stand. */
  const [bitrateDraft, setBitrateDraft] = useState<string | null>(null);
  const [editPhase, setEditPhase] = useState(programPhase);
  /** Live = wat je tijdens de wedstrijd bedient; Setup = wat je één keer instelt. */
  const [studioTab, setStudioTab] = useState<"live" | "setup">("live");
  /** Welke categorie het Instellen-tabblad toont, zoals de lijst links in het OBS-instellingenvenster. */
  const [setupCategory, setSetupCategory] = useState<SetupCategory>("stream");
  const openSetup = (category: SetupCategory) => {
    setSetupCategory(category);
    setStudioTab("setup");
  };
  const [networkStatus, setNetworkStatus] = useState<NetworkSourceBridgeStatus | null>(null);
  /** Welke fase de indeling-editor toont; losgekoppeld van de lopende wedstrijd. */
  const [designerPhase, setDesignerPhase] = useState<StreamProgramPhase>("play");
  const [holdPreview, setHoldPreview] = useState(false);
  const [livePreview, setLivePreview] = useState<string | null>(null);
  const [livePreviewInputId, setLivePreviewInputId] = useState<string | null>(null);
  /** Scène die klaarstaat om in beeld te komen (oranje), los van wat nu program is. */
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  /** Welke monitor het rode kader toont, en welke laag van die scène. */
  const [editing, setEditing] = useState<{ role: "program" | "preview"; layerId: string | null } | null>(null);
  /** Tijdens slepen: wat binnenkomt van het hoofdproces is ouder dan wat de operator ziet. */
  const draggingRef = useRef(false);
  const liveSaveRef = useRef<{ timer: number | null; scenes: StreamScene[] | null }>({ timer: null, scenes: null });
  const [sourceThumbs, setSourceThumbs] = useState<Record<string, string>>({});
  const [deckInfo, setDeckInfo] = useState<StreamDeckInfo | null>(null);
  const [addPick, setAddPick] = useState<
    null | "camera" | "browser" | "media" | "window" | "screen" | "network"
  >(null);
  const [addBrowserUrl, setAddBrowserUrl] = useState("");
  const [addNetworkUrl, setAddNetworkUrl] = useState("");
  const [networkUrlDrafts, setNetworkUrlDrafts] = useState<Record<string, string>>({});
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const programBoxRef = useRef<HTMLDivElement>(null);
  const hasDisplayInput = settings.videoInputs.some((item) => item.kind === "display");
  const ledPreviewFrame = useDisplayPreviewFrame(
    Boolean(active && hasDisplayInput && !shouldPauseDisplayPreviewCapture(displayMode)),
  );

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
      if (!nextSettings.streamKey.trim() && !nextSettings.customUrl.trim()) openSetup("stream");
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
    const offSettings = window.electronAPI?.onLivestreamSettings?.((next) => {
      if (!draggingRef.current) setSettings(next);
    });
    const offPreview = window.electronAPI?.onLivestreamPreview?.((frame) => {
      if (typeof frame === "string") {
        setLivePreview(`data:image/jpeg;base64,${frame}`);
        setLivePreviewInputId(null);
        return;
      }
      setLivePreview(`data:image/jpeg;base64,${frame.jpeg}`);
      setLivePreviewInputId(frame.inputId ?? null);
    });
    const offNetwork = window.electronAPI?.onNetworkSourceStatus?.((next) => setNetworkStatus(next));
    return () => {
      offStatus?.();
      offSettings?.();
      offPreview?.();
      offNetwork?.();
    };
  }, [refresh, loadCameras, loadDesktopSources, loadAudioDevices]);

  useEffect(() => {
    if (!previewWanted) {
      setLivePreview(null);
      setLivePreviewInputId(null);
    }
  }, [previewWanted]);

  useEffect(() => {
    if (settings.previewSceneId && settings.previewSceneId !== previewSceneId) {
      setPreviewSceneId(settings.previewSceneId);
    }
  }, [settings.previewSceneId, previewSceneId]);

  const inputOf = (scene: StreamScene | null | undefined) =>
    scene ? settings.videoInputs.find((input) => input.id === sceneInputId(scene)) : undefined;
  const sceneReady = (scene: StreamScene) => {
    const input = inputOf(scene);
    return Boolean(input && videoInputReady(input));
  };

  useEffect(() => {
    const ids = new Set(settings.scenes.map((scene) => scene.id));
    if (previewSceneId && ids.has(previewSceneId) && previewSceneId !== settings.activeSceneId) return;
    const next = settings.scenes.find((scene) => scene.id !== settings.activeSceneId && sceneReady(scene))?.id;
    setPreviewSceneId(next ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.scenes, settings.videoInputs, settings.activeSceneId, previewSceneId]);

  /** Altijd de nieuwste instellingen, voor sleepacties die langer duren dan één render. */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const persist = async (partial: Partial<LivestreamSettings>) => {
    const next = mergeLivestreamSettings({ ...settings, ...partial });
    setSettings(next);
    if (!window.electronAPI?.saveLivestreamSettings) return;
    setSettings(await window.electronAPI.saveLivestreamSettings(partial));
  };

  /**
   * Een wijziging uit de indeling-editor wegschrijven.
   *
   * Staat de indeling nog op automatisch, dan gebeurt het overschakelen én de wijziging in één
   * schrijfactie. Twee keer achter elkaar `persist` aanroepen kan niet: beide rekenen vanaf
   * dezelfde `settings` uit de closure, dus de tweede wist de eerste.
   *
   * De handmatige indeling begint met precies wat automatisch nu zou tonen, zodat één vinkje
   * omzetten de rest van het beeld niet verandert.
   */
  const applyDesignerLayout = async (
    phase: StreamProgramPhase,
    partial: Partial<StreamLayerLayout>,
  ) => {
    if (settings.layoutMode === "manual") {
      await persistLayout(settings.manualPhaseSplit ? phase : "unified", partial);
      return;
    }
    const play = autoPhaseLayout(settings, "play");
    const brk = autoPhaseLayout(settings, "break");
    await persist({
      layoutMode: "manual",
      manualPhaseSplit: true,
      manualPlayLayout: phase === "play" ? { ...play, ...partial } : play,
      manualBreakLayout: phase === "break" ? { ...brk, ...partial } : brk,
    });
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
    // Per soort een eigen naam. Een ketting met een laatste "anders" gaf elk nieuw brontype
    // stilzwijgend de naam van het stadionscherm: een verse netwerkbron heette "LED".
    const defaultNames: Record<LivestreamSource, string> = {
      camera: t("livestream.videoInputCameraName", { n }),
      browser: t("livestream.videoInputBrowserName", { n }),
      media: t("livestream.videoInputMediaName", { n }),
      network: t("livestream.videoInputNetworkName", { n }),
      display: t("livestream.sourceDisplayShort"),
    };
    const name = extra?.name?.trim() || defaultNames[kind];
    const input = createVideoInput({
      name,
      kind,
      ...extra,
    });
    void saveVideoInputs([...settings.videoInputs, input]);
    // Het hoofdproces maakt er meteen een scène bij (`s-<bron>`); die komt klaar te staan.
    setPreviewSceneId(`s-${input.id}`);
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

  const startAddPick = (
    kind: "camera" | "browser" | "media" | "window" | "screen" | "network",
  ) => {
    setAddPick(kind);
    setAddBrowserUrl("");
    setAddNetworkUrl("");
    if (kind === "camera") void loadCameras();
    if (kind === "window" || kind === "screen") void loadDesktopSources();
  };

  const addNetworkSource = () => {
    const networkUrl = sanitizeNetworkUrl(addNetworkUrl);
    if (!networkUrl) return;
    addVideoSource("network", { networkUrl });
    setAddNetworkUrl("");
    setAddPick(null);
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
      settings.previewVideoInputId === id || sceneInputId(previewScene) === id
        ? videoInputs.find((item) => item.id !== nextActive && item.id !== id)?.id ?? ""
        : settings.previewVideoInputId;
    setPreviewSceneId(null);
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
  /** Bekende startfouten vertaald; andere meldingen komen zoals ffmpeg of het hoofdproces ze geeft. */
  const livestreamErrorText = (error: string) => {
    const wasapiDevices = parseWasapiHelperError(error);
    if (wasapiDevices) {
      return t("livestream.errorWasapiHelper", { devices: wasapiDevices.join(", ") });
    }
    return error;
  };
  const destinationReady =
    settings.platform === "custom"
      ? Boolean(settings.customUrl.trim() && settings.streamKey.trim())
      : Boolean(settings.streamKey.trim());
  const outputPlatforms = settings.dualEnabled ? [settings.platform, settings.platform2] : [settings.platform];
  const advice = bitrateAdvice(settings.resolution, settings.fps, outputPlatforms);
  const bitrateOptions = bitrateOptionsKbps(settings.resolution, settings.fps, outputPlatforms);
  const verdict = bitrateVerdict(
    settings.bitrateKbps,
    settings.resolution,
    settings.fps,
    outputPlatforms,
  );
  const destinationCount = outputPlatforms.length;
  const uploadBudget = uploadBudgetKbps(settings.uploadMbps, destinationCount, settings.audioBitrateKbps);
  const sentBitrate = effectiveBitrateKbps(settings.bitrateKbps, uploadBudget);
  const totalUploadMbps = (totalUploadKbps(sentBitrate, destinationCount, settings.audioBitrateKbps) / 1000).toFixed(1);
  /** Wat de wizard aanraadt voor deze platformen en deze upload. */
  const recommendation = streamFormatPlan("auto", settings.uploadMbps, outputPlatforms, settings.audioBitrateKbps);
  const followsRecommendation =
    settings.encoderMode === "simple"
      ? settings.quality === "auto"
      : settings.resolution === recommendation.resolution &&
        settings.fps === recommendation.fps &&
        settings.bitrateKbps === clampBitrateKbps(recommendation.bitrateKbps);
  const applyRecommendation = () =>
    settings.encoderMode === "simple"
      ? persist({ quality: "auto" })
      : persist({
          resolution: recommendation.resolution,
          fps: recommendation.fps,
          bitrateKbps: recommendation.bitrateKbps,
        });
  const resolutionLabel = settings.resolution === "1920x1080" ? "1080p" : "720p";
  const sourceLocked = busy;
  const health = status.health ?? DEFAULT_LIVESTREAM_HEALTH;
  const fallingBehind = status.running && streamFallingBehind(health);
  const healthWarn =
    status.running &&
    (health.stale ||
      fallingBehind ||
      health.dropFrames > 0 ||
      health.paintDrops > 2 ||
      health.packetLossHints > 0 ||
      (health.fps != null && health.targetFps > 0 && health.fps < health.targetFps * 0.85));

  const activeScene = programScene(settings) ?? settings.scenes[0] ?? null;
  const previewScene =
    (previewSceneId && previewSceneId !== activeScene?.id
      ? settings.scenes.find((scene) => scene.id === previewSceneId)
      : undefined) ??
    settings.scenes.find((scene) => scene.id !== activeScene?.id && sceneReady(scene)) ??
    null;
  const previewVideo = inputOf(previewScene) ?? null;

  const inputLabel = (input: LivestreamVideoInput) =>
    input.name.trim() || videoKindLabel(input.kind, t, true, input.cameraDevice);
  const labelOfScene = (scene: StreamScene | null | undefined) => (scene ? sceneLabel(scene, inputOf(scene), t) : "—");

  /** Scène live zetten (overgangsknop, dubbelklik, Stream Deck); de volgende komt klaar te staan. */
  const takeSceneNow = (scene: StreamScene | null | undefined) => {
    if (!scene) return;
    if (!sceneReady(scene)) {
      openSetup("sources");
      return;
    }
    if (scene.id === settings.activeSceneId) return;
    const partial = takeScene(settings, scene.id, videoInputReady);
    setPreviewSceneId(partial.previewSceneId ?? null);
    // Het kader hoort bij een monitor; na de wissel staat daar een andere scène.
    setEditing(null);
    void persist(partial);
  };

  const cueScene = (scene: StreamScene) => {
    if (busy || !sceneReady(scene)) return;
    setPreviewSceneId(scene.id);
    if (editing?.role === "preview") setEditing(null);
    void persist(applyScenePreview(settings, scene.id));
  };

  const duplicateSceneNow = (scene: StreamScene) => {
    if (busy || settings.scenes.length >= STREAM_SCENE_LIMIT) return;
    const copy = duplicateScene(scene, t("livestream.sceneCopyName", { name: labelOfScene(scene) }));
    const index = settings.scenes.findIndex((item) => item.id === scene.id);
    const scenes = [...settings.scenes.slice(0, index + 1), copy, ...settings.scenes.slice(index + 1)];
    setPreviewSceneId(copy.id);
    void persist({ scenes, ...applyScenePreview({ ...settings, scenes }, copy.id) });
  };

  /**
   * Scène weg. Gebruikt geen andere scène die bron nog, dan gaat de bron mee (zoals vroeger het
   * kruisje op een bron deed).
   */
  const removeScene = (scene: StreamScene) => {
    if (busy || settings.scenes.length <= 1) return;
    const scenes = settings.scenes.filter((item) => item.id !== scene.id);
    const inputId = sceneInputId(scene);
    const stillUsed = scenes.some((item) => item.layers.some((layer) => layer.inputId === inputId));
    if (editing) setEditing(null);
    if (!stillUsed && settings.videoInputs.length > 1) {
      removeVideoSource(inputId);
      return;
    }
    const base = { ...settings, scenes };
    const wasActive = scene.id === settings.activeSceneId;
    const nextActive = wasActive ? scenes[0]! : scenes.find((item) => item.id === settings.activeSceneId) ?? scenes[0]!;
    const nextPreview =
      scenes.find((item) => item.id === previewScene?.id && item.id !== nextActive.id) ??
      scenes.find((item) => item.id !== nextActive.id) ??
      null;
    setPreviewSceneId(nextPreview?.id ?? null);
    void persist({
      scenes,
      ...(wasActive ? applySceneSelection(base, nextActive.id) : { activeSceneId: nextActive.id }),
      ...(nextPreview ? applyScenePreview(base, nextPreview.id) : { previewSceneId: "" }),
    });
  };

  /**
   * Kader of kleur van een laag aanpassen. Tijdens slepen alleen hier; staat de scène live, dan gaat
   * de stream mee (hooguit ±7 keer per seconde). Bij loslaten wordt het opgeslagen.
   */
  const changeLayer = (sceneId: string, layerId: string, patch: StreamLayerPatch, commit: boolean) => {
    const scenes = updateSceneLayer(settingsRef.current.scenes, sceneId, layerId, patch);
    settingsRef.current = { ...settingsRef.current, scenes };
    setSettings((current) => ({ ...current, scenes }));
    const live = liveSaveRef.current;
    if (commit) {
      draggingRef.current = false;
      if (live.timer != null) window.clearTimeout(live.timer);
      live.timer = null;
      live.scenes = null;
      void persist({ scenes });
      return;
    }
    draggingRef.current = true;
    if (sceneId !== settings.activeSceneId || !status.running) return;
    live.scenes = scenes;
    if (live.timer != null) return;
    live.timer = window.setTimeout(() => {
      live.timer = null;
      const pending = live.scenes;
      live.scenes = null;
      if (pending && draggingRef.current) void window.electronAPI?.saveLivestreamSettings?.({ scenes: pending });
    }, 140);
  };

  const editedScene = editing ? (editing.role === "program" ? activeScene : previewScene) : null;
  const editedLayer: StreamSceneLayer | null = editedScene
    ? editedScene.layers.find((layer) => layer.id === editing?.layerId) ?? sceneMainLayer(editedScene)
    : null;
  const editedInput = editedLayer ? settings.videoInputs.find((input) => input.id === editedLayer.inputId) : undefined;

  useEffect(() => {
    // De bewerkte scène verdween (verwijderd, of de monitor toont nu niets): kader dicht.
    if (editing && !editedScene) setEditing(null);
  }, [editing, editedScene]);

  /** Het rode kader over een monitor, als die monitor bewerkt wordt. */
  const renderEditor = (scene: StreamScene | null, role: "program" | "preview") => {
    if (!editing || editing.role !== role || !scene || !editedLayer || editedScene?.id !== scene.id) return null;
    return (
      <StreamLayerEditor
        layer={editedLayer}
        live={role === "program" && status.running}
        onChange={(patch, commit) => changeLayer(scene.id, editedLayer.id, patch, commit)}
        others={scene.layers.filter((layer) => layer.id !== editedLayer.id && layer.visible)}
        onSelect={(layerId) => setEditing({ role, layerId })}
      />
    );
  };

  /** Bron als beeld-in-beeld bovenop een scène; daarna bewerk je meteen die nieuwe laag. */
  const addLayer = (scene: StreamScene, inputId: string, role: "program" | "preview") => {
    const added = addSceneLayer(scene, inputId);
    void persist({ scenes: settings.scenes.map((item) => (item.id === scene.id ? added.scene : item)) });
    setEditing({ role, layerId: added.layerId });
  };

  /**
   * Laag weg. Was het de bron die de scène live hield (de hoofdbron), dan gaat de scène met een
   * andere hoofdbron verder: anders zou de stream naar een andere scène springen.
   */
  const removeLayer = (scene: StreamScene, layerId: string, role: "program" | "preview") => {
    const next = removeSceneLayer(scene, layerId);
    if (next === scene) return;
    const scenes = settings.scenes.map((item) => (item.id === scene.id ? next : item));
    const base = { ...settings, scenes };
    const partial: Partial<LivestreamSettings> = { scenes };
    if (scene.id === settings.activeSceneId && !sceneHasInput(next, settings.activeVideoInputId)) {
      Object.assign(partial, applySceneSelection(base, scene.id));
    }
    if (scene.id === settings.previewSceneId && !sceneHasInput(next, settings.previewVideoInputId)) {
      Object.assign(partial, applyScenePreview(base, scene.id));
    }
    void persist(partial);
    if (editing?.layerId === layerId) setEditing({ role, layerId: null });
  };

  /** Welke bronnen er nog bij kunnen in deze scène, en anders waarom niet. */
  const layerOptions = (scene: StreamScene) => {
    const kindOf = (id: string) => settings.videoInputs.find((input) => input.id === id)?.kind;
    const sources = settings.videoInputs
      .filter((input) => videoInputReady(input) && canAddSceneLayer(scene, input, kindOf))
      .map((input) => ({ id: input.id, label: inputLabel(input) }));
    const blocked = !scene.layers.every((layer) => layerKindInPage(kindOf(layer.inputId) ?? ""));
    return {
      sources,
      hint: blocked
        ? t("livestream.layerAddBlocked")
        : scene.layers.length >= STREAM_SCENE_LAYER_LIMIT
          ? t("livestream.layerAddFull")
          : "",
    };
  };

  /** Knop op een monitor om het kader van die scène te bewerken. */
  const renderEditToggle = (scene: StreamScene | null, role: "program" | "preview") => {
    if (!scene || !settings.studioPreview || !active) return null;
    if (role === "preview" && scene.id === settings.activeSceneId) return null;
    const on = editing?.role === role;
    return (
      <button
        type="button"
        aria-pressed={on}
        title={on ? t("livestream.sceneEditDone") : t("livestream.sceneEdit")}
        onClick={(event) => {
          event.stopPropagation();
          setEditing(on ? null : { role, layerId: null });
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        className={`absolute bottom-1 right-1 z-50 flex h-6 items-center gap-1 rounded px-1.5 text-[10px] font-semibold ${
          on ? "bg-primary text-primary-foreground" : "bg-black/70 text-white/80 hover:bg-black/90 hover:text-white"
        }`}
      >
        <Crop className="h-3 w-3" aria-hidden />
        {on ? t("livestream.sceneEditDone") : t("livestream.sceneEdit")}
      </button>
    );
  };

  /** Rauw bronbeeld (JPEG of LED-beeld) in het kader van de scène, zoals de pomp het in de stream zet. */
  const framedImage = (src: string, scene: StreamScene, input: LivestreamVideoInput) => (
    <StreamLayerFrame layer={sceneMainLayer(scene)} colorSupported={layerColorSupported(input.kind)}>
      {(className) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className={className} />
      )}
    </StreamLayerFrame>
  );

  const renderPicture = (scene: StreamScene, role: "program" | "preview") => {
    const input = inputOf(scene);
    if (!input) return <StudioMonitorEmpty>{t("livestream.switcherNeedsSetup")}</StudioMonitorEmpty>;
    if (!settings.studioPreview) {
      return <StudioMonitorEmpty>{t("livestream.studioPreviewDisabled")}</StudioMonitorEmpty>;
    }
    if (!active) {
      return <StudioMonitorEmpty>{t("livestream.previewPaused")}</StudioMonitorEmpty>;
    }
    if (!videoInputReady(input)) {
      return <StudioMonitorEmpty>{t("livestream.switcherNeedsSetup")}</StudioMonitorEmpty>;
    }
    if (role === "preview" && scene.id === settings.activeSceneId) {
      return <StudioMonitorEmpty>{t("livestream.monitorSame")}</StudioMonitorEmpty>;
    }
    if (sceneIsComposite(scene)) {
      // Beeld-in-beeld live: het beeld van het streamvenster, met alle lagen, score en sponsors.
      if (role === "program" && status.running && livePreview) {
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={livePreview} alt="" className="absolute inset-0 h-full w-full object-contain" />
        );
      }
      // Anders tekent de studio de scène zelf. Terwijl de stream loopt heeft die de camera's open:
      // dan staan ze hier als vlak met hun naam.
      return (
        <StreamProgramPage
          embedded
          sceneMode
          liveCameras={!status.running && !holdPreview}
          settingsOverride={{
            ...settings,
            ...applySceneSelection(settings, scene.id),
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
      // Website en media: rauw bronbeeld, dus hier in het kader zetten. Een live camera komt als beeld
      // van de streampagina, met kader, score en sponsors er al in.
      if (input.kind === "browser" || input.kind === "media") return framedImage(livePreview ?? "", scene, input);
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={livePreview ?? undefined} alt="" className="absolute inset-0 h-full w-full object-contain" />
      );
    }
    if (input.kind === "display") {
      if (ledPreviewFrame) return framedImage(ledPreviewFrame, scene, input);
      return <StudioMonitorEmpty>{t("shell.previewLoading")}</StudioMonitorEmpty>;
    }
    if (input.kind === "camera" && !status.running && !holdPreview) {
      return (
        <StreamProgramPage
          embedded
          cameraOverride={input.cameraDevice}
          settingsOverride={{
            ...settings,
            ...applySceneSelection(settings, scene.id),
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

  const previewComposite = sceneIsComposite(previewScene);
  const activeComposite = sceneIsComposite(activeScene);
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
    // Bij beeld-in-beeld staan er meer video's op de monitor: welke van wie is dan niet zeker.
    const tick = () => {
      if (previewVideo && !previewComposite) grab(previewVideo.id, previewBoxRef.current);
      if (!activeComposite) grab(activeVideo.id, programBoxRef.current);
    };
    const timer = window.setInterval(tick, 140);
    return () => window.clearInterval(timer);
  }, [settings.studioPreview, active, previewVideo?.id, activeVideo.id, previewComposite, activeComposite]);

  /** Klein beeld op een scèneknop: het bronbeeld in het kader van die scène. */
  const renderTilePicture = (scene: StreamScene, input: LivestreamVideoInput) => {
    if (!videoInputReady(input)) {
      return (
        <div className="absolute inset-0 grid place-items-center px-1 text-center text-[9px] text-white/40">
          {t("livestream.switcherNeedsSetup")}
        </div>
      );
    }
    if (input.kind === "display") {
      const thumb = sourceThumbs[input.id];
      if (thumb) return framedImage(thumb, scene, input);
      return (
        <div className="absolute inset-0 grid place-items-center px-1 text-center text-[9px] text-white/40">
          {t("livestream.videoInputsAddDisplay")}
        </div>
      );
    }
    if (
      livePreview &&
      (livePreviewInputId ? livePreviewInputId === input.id : input.id === settings.activeVideoInputId) &&
      (input.kind === "browser" || input.kind === "media")
    ) {
      return framedImage(livePreview, scene, input);
    }
    // Miniaturen komen van het rauwe camerabeeld op de monitors, dus ook hier het kader erop.
    const thumb = sourceThumbs[input.id];
    if (thumb) return framedImage(thumb, scene, input);
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
              ...applySceneSelection(settings, scene.id),
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
    // Knop N = scène N (na de overstap dezelfde volgorde als de bronnen).
    if (action.id === "input") {
      takeSceneNow(settings.scenes[action.index - 1]);
      return;
    }
    if (action.id === "preview") {
      const scene = settings.scenes[action.index - 1];
      if (scene) cueScene(scene);
      return;
    }
    if (action.id === "cut") {
      takeSceneNow(previewScene);
      return;
    }
    if (action.id === "stream") {
      if (status.running) {
        void stop();
        return;
      }
      if (!destinationReady) {
        openSetup("stream");
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
              openSetup("stream");
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
      {fallingBehind ? (
        <p className="text-[11px] leading-snug text-amber-600/90">
          {t("livestream.uploadBehind", { speed: (health.speed ?? 0).toFixed(2) })}
        </p>
      ) : null}
      {settings.source === "network" ? <NetworkSourceState status={networkStatus} t={t} /> : null}
      {!destinationReady && !status.running ? (
        <p className="text-[11px] text-amber-600/90">{t("livestream.needsStreamKey")}</p>
      ) : null}
      {!isElectron && <div className="text-xs text-amber-600/90">{t("livestream.electronOnly")}</div>}
      {!status.ffmpegFound && !status.running && (
        <div className="text-xs text-amber-600/90">{t("livestream.ffmpegMissing")}</div>
      )}
      {status.error &&
      !/^(Beeld opnieuw|Bronwissel)/.test(status.error) ? (
        <div className="text-xs text-destructive">{livestreamErrorText(status.error)}</div>
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

      {active ? (
      <>
      <div
        className={studioTab === "live" ? "flex min-h-0 flex-1 flex-col gap-1.5" : undefined}
        aria-hidden={studioTab !== "live"}
        {...(studioTab !== "live" ? { inert: true } : {})}
        style={
          studioTab === "live"
            ? undefined
            : {
                position: "fixed",
                inset: 0,
                width: "100vw",
                height: "100vh",
                opacity: 0,
                pointerEvents: "none",
                overflow: "hidden",
                zIndex: -1,
              }
        }
      >
          <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center gap-2">
            <div
              ref={previewBoxRef}
              className={`aspect-video h-full min-h-0 w-auto min-w-0 max-w-[calc((100%-6rem)/2)] ${
                previewScene && editing?.role !== "preview" ? "cursor-pointer" : ""
              }`}
              title={
                previewScene && editing?.role !== "preview"
                  ? t("livestream.monitorNextDoubleClick", { transition: t(`livestream.transition_${settings.transition}`) })
                  : undefined
              }
              // Dubbelklik op VOLGENDE zet die scène live, net als de overgangsknop. Niet als je in het
              // beeld de score-widget of een kader versleept: dat is instellen, geen wissel.
              onDoubleClick={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest("[data-stream-overlay-transform], [data-stream-layer-editor]")) return;
                if (busy || editing?.role === "preview" || !previewScene) return;
                takeSceneNow(previewScene);
              }}
            >
              <StudioMonitor
                label={t("livestream.monitorNext")}
                name={labelOfScene(previewScene)}
                tone="preview"
              >
                {previewScene ? (
                  renderPicture(previewScene, "preview")
                ) : (
                  <StudioMonitorEmpty>{t("livestream.monitorSame")}</StudioMonitorEmpty>
                )}
                {renderEditor(previewScene, "preview")}
                {renderEditToggle(previewScene, "preview")}
              </StudioMonitor>
            </div>
            <div className="flex w-[5.5rem] shrink-0 flex-col items-stretch gap-1" data-transition-controls>
              <button
                type="button"
                disabled={busy || !previewScene}
                onClick={() => takeSceneNow(previewScene)}
                title={t("livestream.transitionTakeHint")}
                className="h-10 rounded-md bg-zinc-200 text-xs font-black uppercase tracking-wide text-zinc-900 hover:bg-white disabled:opacity-40"
              >
                {t(`livestream.transition_${settings.transition}`)}
              </button>
              <div className="grid grid-cols-3 gap-0.5" role="group" aria-label={t("livestream.transition")}>
                {STREAM_TRANSITIONS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={settings.transition === kind}
                    title={t(`livestream.transitionHint_${kind}`)}
                    onClick={() => void persist({ transition: kind })}
                    className={`h-6 rounded text-[9px] font-semibold uppercase ${
                      settings.transition === kind
                        ? "bg-primary text-primary-foreground"
                        : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    }`}
                  >
                    {t(`livestream.transitionShort_${kind}`)}
                  </button>
                ))}
              </div>
              {settings.transition !== "cut" ? (
                <Select
                  aria-label={t("livestream.transitionDuration")}
                  className="h-6 px-1 text-[10px]"
                  value={String(settings.transitionMs)}
                  onChange={(e) => void persist({ transitionMs: Number(e.target.value) })}
                >
                  {transitionDurationOptions(settings.transitionMs).map((ms) => (
                    <option key={ms} value={ms}>
                      {(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} s
                    </option>
                  ))}
                </Select>
              ) : null}
            </div>
            <div
              ref={programBoxRef}
              className="aspect-video h-full min-h-0 w-auto min-w-0 max-w-[calc((100%-6rem)/2)]"
            >
              <StudioMonitor
                label={t("livestream.monitorNow")}
                name={activeScene ? labelOfScene(activeScene) : inputLabel(activeVideo)}
                tone={status.running ? "live" : "program"}
              >
                {activeScene ? (
                  renderPicture(activeScene, "program")
                ) : (
                  <StudioMonitorEmpty>{t("livestream.switcherNeedsSetup")}</StudioMonitorEmpty>
                )}
                {renderEditor(activeScene, "program")}
                {renderEditToggle(activeScene, "program")}
              </StudioMonitor>
            </div>
          </div>

          {editing && editedScene && editedLayer ? (
            <StreamLayerPanel
              scene={editedScene}
              layer={editedLayer}
              sceneLabel={labelOfScene(editedScene)}
              sourceLabel={(layer) => {
                const input = settings.videoInputs.find((item) => item.id === layer.inputId);
                return input ? inputLabel(input) : "—";
              }}
              colorSupported={layerColorSupported(editedInput?.kind ?? "", sceneIsComposite(editedScene))}
              addableSources={layerOptions(editedScene).sources}
              addHint={layerOptions(editedScene).hint}
              onAddLayer={(inputId) => addLayer(editedScene, inputId, editing.role)}
              onRemoveLayer={(layerId) => removeLayer(editedScene, layerId, editing.role)}
              live={editing.role === "program" && status.running}
              t={t}
              onLayerChange={(patch, commit) => changeLayer(editedScene.id, editedLayer.id, patch, commit)}
              onSceneName={(name) =>
                void persist({
                  scenes: settings.scenes.map((scene) =>
                    scene.id === editedScene.id ? { ...scene, name: name.trim().slice(0, 40) } : scene,
                  ),
                })
              }
              onSelectLayer={(layerId) => setEditing({ role: editing.role, layerId })}
              onMoveLayer={(layerId, delta) =>
                void persist({
                  scenes: settings.scenes.map((scene) =>
                    scene.id === editedScene.id ? { ...scene, layers: moveSceneLayer(scene.layers, layerId, delta) } : scene,
                  ),
                })
              }
              onReset={() => changeLayer(editedScene.id, editedLayer.id, resetSceneLayer(editedLayer), true)}
              onClose={() => setEditing(null)}
            />
          ) : null}

          <div className="grid shrink-0 grid-cols-1 items-start gap-1.5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
            <div className="overflow-x-auto rounded-md border border-border bg-zinc-950/50 p-1">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-1">
                {settings.scenes.map((scene, index) => {
                  const input = inputOf(scene);
                  if (!input) return null;
                  const on = scene.id === activeScene?.id;
                  const next = scene.id === previewScene?.id;
                  const ready = videoInputReady(input);
                  return (
                    <div
                      key={scene.id}
                      className="relative overflow-hidden rounded bg-zinc-900 text-left ring-1 ring-white/10 hover:ring-white/25"
                    >
                      <div
                        role="button"
                        tabIndex={busy ? -1 : 0}
                        onClick={() => cueScene(scene)}
                        onDoubleClick={() => {
                          if (!busy) takeSceneNow(scene);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          cueScene(scene);
                        }}
                        className="relative aspect-video bg-black"
                      >
                        <div className={`absolute inset-x-0 top-0 z-10 h-1 ${on ? "bg-emerald-500" : next ? "bg-amber-500" : "bg-zinc-700"}`} />
                        {ready ? (
                          renderTilePicture(scene, input)
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
                          renderTilePicture(scene, input)
                        )}
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 truncate bg-black/70 px-1 py-0.5 text-[10px] font-medium text-white">
                          <span className="mr-0.5 text-white/40">{index + 1}</span>
                          {labelOfScene(scene)}
                          {sceneIsComposite(scene) ? (
                            <span className="ml-1 rounded bg-white/15 px-1 text-[9px] text-white/80">
                              {t("livestream.sceneLayerCount", { count: scene.layers.length })}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {ready && settings.scenes.length < STREAM_SCENE_LIMIT ? (
                        <button
                          type="button"
                          aria-label={t("livestream.sceneDuplicate")}
                          title={t("livestream.sceneDuplicate")}
                          disabled={sourceLocked}
                          onClick={(event) => {
                            event.stopPropagation();
                            duplicateSceneNow(scene);
                          }}
                          onDoubleClick={(event) => event.stopPropagation()}
                          className="absolute right-6 top-1.5 z-30 flex h-5 w-5 items-center justify-center rounded bg-black/70 text-white/80 hover:bg-zinc-700 hover:text-white disabled:opacity-40"
                        >
                          <Copy className="h-3 w-3" aria-hidden />
                        </button>
                      ) : null}
                      {settings.scenes.length > 1 ? (
                        <button
                          type="button"
                          aria-label={t("livestream.videoInputRemove")}
                          title={t("livestream.videoInputRemove")}
                          disabled={sourceLocked}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeScene(scene);
                          }}
                          onDoubleClick={(event) => event.stopPropagation()}
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
                                  : addPick === "network"
                                    ? t("livestream.networkUrl")
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
                        ) : addPick === "network" ? (
                          <div className="flex flex-col gap-0.5">
                            <Input
                              aria-label={t("livestream.networkUrl")}
                              className="h-7 px-1 text-[10px]"
                              inputMode="url"
                              placeholder={t("livestream.networkUrlPlaceholder")}
                              value={addNetworkUrl}
                              disabled={sourceLocked}
                              onChange={(e) => setAddNetworkUrl(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") addNetworkSource();
                              }}
                            />
                            <button
                              type="button"
                              disabled={sourceLocked || !sanitizeNetworkUrl(addNetworkUrl)}
                              onClick={addNetworkSource}
                              className="h-6 rounded text-[10px] font-semibold text-zinc-100 hover:bg-zinc-800 disabled:opacity-40"
                            >
                              {t("common.add")}
                            </button>
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
                            setAddNetworkUrl("");
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
                          onClick={() => startAddPick("network")}
                          className="h-6 rounded text-[10px] font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
                        >
                          {t("livestream.videoInputsAddNetwork")}
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
                onClick={() => openSetup("hotkeys")}
              >
                {t("livestream.deckEmpty")}
              </button>
            ) : (
              settings.streamDeckSlots.map((slot, index) => {
                const action = slot.action;
                const source =
                  action.id === "input" || action.id === "preview"
                    ? settings.scenes[action.index - 1]
                    : undefined;
                const on = source && action.id === "input" && source.id === activeScene?.id;
                const next =
                  source &&
                  (action.id === "preview" || action.id === "input") &&
                  source.id === previewScene?.id &&
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
              onClick={() => openSetup("hotkeys")}
            >
              {t("livestream.deckEdit")}
            </button>
          </div>

          {streamBar}
        </div>
      {studioTab !== "live" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row">
        {/* Categorieën links, instellingen rechts: zoals het OBS-instellingenvenster. */}
        <nav
          aria-label={t("livestream.tabSetup")}
          className="flex shrink-0 gap-0.5 overflow-x-auto rounded-xl border border-border bg-card p-1.5 sm:w-44 sm:flex-col sm:overflow-visible"
        >
          {SETUP_CATEGORIES.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={setupCategory === id ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs ${
                setupCategory === id
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
              onClick={() => setSetupCategory(id)}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {t(`livestream.setupCat_${id}`)}
            </button>
          ))}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
        {setupCategory === "sources" ? (
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
                ) : input.kind === "network" ? (
                  <StudioField label={t("livestream.networkUrl")} htmlFor={`ls-vin-net-${input.id}`}>
                    <Input
                      id={`ls-vin-net-${input.id}`}
                      className="h-8"
                      inputMode="url"
                      placeholder={t("livestream.networkUrlPlaceholder")}
                      value={networkUrlDrafts[input.id] ?? input.networkUrl}
                      disabled={sourceLocked}
                      onChange={(e) =>
                        setNetworkUrlDrafts((drafts) => ({ ...drafts, [input.id]: e.target.value }))
                      }
                      onBlur={(e) => {
                        const networkUrl = sanitizeNetworkUrl(e.target.value);
                        setNetworkUrlDrafts((drafts) => {
                          const next = { ...drafts };
                          delete next[input.id];
                          return next;
                        });
                        if (networkUrl !== input.networkUrl) void patchVideoInput(input.id, { networkUrl });
                      }}
                    />
                    {input.id === settings.activeVideoInputId ? (
                      <NetworkSourceState status={networkStatus} t={t} />
                    ) : null}
                    <p className="text-[10px] leading-snug text-muted-foreground">
                      {t("livestream.networkUrlHint")}
                    </p>
                  </StudioField>
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
              onClick={() => addVideoSource("network")}
            >
              {t("livestream.videoInputsAddNetwork")}
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

        {setupCategory === "audio" ? (
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
        ) : null}

        {setupCategory === "overlay" ? (
          <>
          <StudioSection title={t("livestream.overlayModeTitle")}>
            <StreamOverlaySwitch settings={settings} onChange={(partial) => void persist(partial)} t={t} />
          </StudioSection>
          {/* Het LED-scherm toont score en sponsors al; de overlay kan wel al klaargezet worden. */}
          {!sourceShowsStreamLayers(settings.source) ? (
            <p className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-[11px] leading-snug text-sky-200/90">
              {t("livestream.setupOverlayUnavailable")}
            </p>
          ) : null}
          <StudioSection
            title={t("livestream.layersSection")}
            summary={
              settings.layoutMode === "auto" ? t("livestream.layoutAuto") : t("livestream.layoutManual")
            }
          >
            <StreamLayoutDesigner
              settings={settings}
              phase={designerPhase}
              onPhaseChange={setDesignerPhase}
              onLayoutChange={(partial) => void applyDesignerLayout(designerPhase, partial)}
              onScoreWidgetChange={(partial, commit) => {
                const scoreWidget = mergeStreamScoreWidget({ ...settings.scoreWidget, ...partial });
                setSettings((s) => ({ ...s, scoreWidget }));
                if (commit) void persist({ scoreWidget });
              }}
              t={t}
            />
            <StudioDisclosure title={t("livestream.designerMore")}>
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
            </StudioDisclosure>
          </StudioSection>
          </>
        ) : null}

        {setupCategory === "stream" ? (
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
        </StudioSection>
        ) : null}

        {setupCategory === "output" ? (
        <StudioSection title={t("livestream.encoderSection")} summary={encoderSummary(settings)}>
          {/* Automatisch instellen, zoals de OBS-wizard: platformen + upload → aanbeveling. */}
          <div className="flex flex-col gap-2 rounded-md border border-border bg-card/60 p-2">
            <div className="text-[11px] font-medium">{t("livestream.autoSetupTitle")}</div>
            <div className="flex flex-wrap items-end gap-3">
              <StudioField label={t("livestream.uploadSpeed")} htmlFor="ls-upload">
                <Input
                  id="ls-upload"
                  className="h-8 w-28"
                  inputMode="decimal"
                  placeholder="—"
                  value={uploadDraft ?? (settings.uploadMbps > 0 ? String(settings.uploadMbps) : "")}
                  disabled={locked}
                  onChange={(e) => setUploadDraft(e.target.value)}
                  onBlur={() => {
                    if (uploadDraft == null) return;
                    const uploadMbps = clampUploadMbps(uploadDraft);
                    setUploadDraft(null);
                    if (uploadMbps !== settings.uploadMbps) void persist({ uploadMbps });
                  }}
                />
              </StudioField>
              <div className="flex min-w-0 flex-col gap-1 pb-1.5 text-[11px]">
                <span className="text-muted-foreground">
                  {t("livestream.autoSetupPlatforms", {
                    platforms: outputPlatforms.map((p) => t(`livestream.${p}`)).join(" + "),
                  })}
                </span>
                <span>
                  {t("livestream.autoSetupResult", {
                    resolution: recommendation.resolution.replace("x", "×"),
                    fps: recommendation.fps,
                    bitrate: recommendation.bitrateKbps,
                  })}
                </span>
              </div>
              {!followsRecommendation ? (
                <Button size="sm" className="mb-0.5" disabled={locked} onClick={() => void applyRecommendation()}>
                  {t("livestream.autoSetupApply")}
                </Button>
              ) : null}
            </div>
            {settings.uploadMbps <= 0 ? (
              <p className="text-[11px] leading-snug text-muted-foreground">{t("livestream.uploadSpeedHelp")}</p>
            ) : null}
          </div>

          <div className="inline-flex w-fit rounded-md border border-border p-0.5" role="radiogroup">
            {(["simple", "advanced"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={settings.encoderMode === mode}
                disabled={locked}
                className={`h-7 rounded px-3 text-[11px] disabled:opacity-50 ${
                  settings.encoderMode === mode
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => void persist({ encoderMode: mode })}
              >
                {t(mode === "simple" ? "livestream.encoderModeSimple" : "livestream.encoderModeAdvanced")}
              </button>
            ))}
          </div>

          {settings.encoderMode === "simple" ? (
            <div className="grid grid-cols-2 gap-2">
              <StudioField label={t("livestream.quality")} htmlFor="ls-quality">
                <Select
                  id="ls-quality"
                  className="h-8"
                  value={settings.quality}
                  disabled={locked}
                  onChange={(e) => void persist({ quality: e.target.value as LivestreamQuality })}
                >
                  {LIVESTREAM_QUALITIES.map((q) => (
                    <option key={q} value={q}>
                      {q === "auto" ? t("livestream.qualityAuto") : q}
                    </option>
                  ))}
                </Select>
              </StudioField>
              <StudioField label={t("livestream.encoder")} htmlFor="ls-encoder-simple">
                <Select
                  id="ls-encoder-simple"
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
              <p className="col-span-2 text-[11px] leading-snug text-muted-foreground">
                {t("livestream.qualityResult", {
                  resolution: settings.resolution.replace("x", "×"),
                  fps: settings.fps,
                  bitrate: sentBitrate,
                })}
              </p>
            </div>
          ) : (
          <>
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
            <StudioField label={`${t("livestream.bitrate")} (kbps)`} htmlFor="ls-br">
              <Input
                id="ls-br"
                className="h-8"
                inputMode="numeric"
                list="ls-br-options"
                value={bitrateDraft ?? String(settings.bitrateKbps)}
                disabled={locked}
                onChange={(e) => setBitrateDraft(e.target.value)}
                onBlur={() => {
                  if (bitrateDraft == null) return;
                  const typed = Number(bitrateDraft.replace(/[^\d]/g, ""));
                  setBitrateDraft(null);
                  if (typed > 0 && clampBitrateKbps(typed) !== settings.bitrateKbps) {
                    void persist({ bitrateKbps: clampBitrateKbps(typed) });
                  }
                }}
              />
              <datalist id="ls-br-options">
                {bitrateOptions.map((kbps) => (
                  <option key={kbps} value={kbps}>
                    {kbps === advice.recommendedKbps ? t("livestream.bitrateRecommended") : undefined}
                  </option>
                ))}
              </datalist>
            </StudioField>
            <StudioField label={t("livestream.encoderPreset")} htmlFor="ls-preset">
              <Select
                id="ls-preset"
                className="h-8"
                value={settings.encoderPreset}
                disabled={locked}
                onChange={(e) => void persist({ encoderPreset: e.target.value as LivestreamEncoderPreset })}
              >
                {ENCODER_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {t(`livestream.encoderPreset_${preset}`)}
                  </option>
                ))}
              </Select>
            </StudioField>
            <StudioField label={t("livestream.keyframeSec")} htmlFor="ls-keyframe">
              <Select
                id="ls-keyframe"
                className="h-8"
                value={String(settings.keyframeSec)}
                disabled={locked}
                onChange={(e) => void persist({ keyframeSec: Number(e.target.value) })}
              >
                {KEYFRAME_SECONDS.map((sec) => (
                  <option key={sec} value={sec}>
                    {sec} s
                  </option>
                ))}
              </Select>
            </StudioField>
            <StudioField label={t("livestream.audioBitrate")} htmlFor="ls-audio-br">
              <Select
                id="ls-audio-br"
                className="h-8"
                value={String(settings.audioBitrateKbps)}
                disabled={locked}
                onChange={(e) => void persist({ audioBitrateKbps: Number(e.target.value) })}
              >
                {AUDIO_BITRATES_KBPS.map((kbps) => (
                  <option key={kbps} value={kbps}>
                    {kbps} kbps
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
          </>
          )}
          <p className="text-[11px] leading-snug text-muted-foreground">
            {t("livestream.uploadTotal", { total: totalUploadMbps, n: destinationCount, per: sentBitrate })}
          </p>
          {uploadBudget != null && sentBitrate < settings.bitrateKbps && (
            <p className="text-[11px] leading-snug text-amber-600/90">
              {t("livestream.uploadCapped", { upload: settings.uploadMbps, per: sentBitrate, n: destinationCount })}
            </p>
          )}
          {uploadBudget != null && sentBitrate < advice.minimumKbps && (
            <p className="text-[11px] leading-snug text-amber-600/90">
              {t("livestream.uploadTooSlow", { per: sentBitrate, resolution: resolutionLabel, fps: settings.fps })}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-border pt-3">
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

        {setupCategory === "hotkeys" ? (
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
        </div>
        </div>
      ) : null}
      </>
      ) : null}
    </div>
  );
}
