"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/form";
import { useDisplayStore } from "@/lib/store";
import { sendCommand } from "@/lib/use-socket";
import { isElectron } from "@/lib/electron";
import type { DesktopCaptureSourceInfo } from "@/lib/desktop-bridge";
import { ExternalCaptureVideo } from "@/components/external-capture-video";
import { enumerateCameraCaptureOptions } from "@/lib/enumerate-camera-capture-options";

type UnifiedCaptureSource = DesktopCaptureSourceInfo & {
  category: "desktop" | "camera";
};

const AUDIO_STORAGE_KEY = "arenacue_external_capture_audio_v1";

export function ExternalCapturePanel() {
  const state = useDisplayStore((s) => s.state);
  const sourceId = state?.externalCaptureSourceId ?? null;
  const toDisplay = state?.externalCaptureToDisplay ?? false;

  const [sources, setSources] = useState<UnifiedCaptureSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [previewOn, setPreviewOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioPassthrough, setAudioPassthrough] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setAudioPassthrough(window.localStorage.getItem(AUDIO_STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const setAudioPersisted = useCallback((next: boolean) => {
    setAudioPassthrough(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(AUDIO_STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const refreshSources = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.getDesktopCaptureSources) {
      setError("Alleen in de desktop-app (Electron).");
      return;
    }
    setLoadingSources(true);
    setError(null);
    try {
      const [deskList, cameras] = await Promise.all([
        window.electronAPI.getDesktopCaptureSources(),
        enumerateCameraCaptureOptions(),
      ]);
      const desktop: UnifiedCaptureSource[] = deskList.map((s) => ({
        ...s,
        category: "desktop",
      }));
      const camRows: UnifiedCaptureSource[] = cameras.map((c) => ({
        id: c.id,
        name: c.name,
        thumbnailDataUrl: null,
        category: "camera",
      }));
      setSources([...desktop, ...camRows]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSources(false);
    }
  }, []);

  useEffect(() => {
    if (!sourceId) setPreviewOn(false);
  }, [sourceId]);

  const desktopSources = sources.filter((s) => s.category === "desktop");
  const cameraSources = sources.filter((s) => s.category === "camera");

  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
      <div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
          Extern beeld (SDI / HDMI / capture-kaart / webcam)
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          Voor pro <strong>HDMI/SDI capture-kaarten</strong> (Magewell, Elgato, Blackmagic): kies de
          kaart onder <em>Camera&apos;s &amp; video-invoer</em>. ArenaCue probeert automatisch
          1920×1080@30 op te halen. Je kan ook een <strong>scherm/venster</strong> kiezen voor vMix,
          OBS of andere SDI-software op deze PC. Preview hier, daarna fullscreen op het scorebord.
        </p>
      </div>

      {!isElectron && (
        <div className="text-xs text-amber-600/90">Niet beschikbaar in de browser-build.</div>
      )}

      {error && <div className="text-xs text-destructive">{error}</div>}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void refreshSources()} disabled={loadingSources}>
          {loadingSources ? "Laden…" : "Bronnen vernieuwen"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!sourceId}
          onClick={() => {
            void sendCommand({ type: "display:setExternalCapture", sourceId: null });
            setPreviewOn(false);
          }}
        >
          Wis bron
        </Button>
      </div>

      <div>
        <Label className="text-xs">Bron</Label>
        <select
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
          value={sourceId ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            void sendCommand({
              type: "display:setExternalCapture",
              sourceId: v === "" ? null : v,
            });
          }}
        >
          <option value="">— kies —</option>
          {desktopSources.length > 0 && (
            <optgroup label="Schermen & vensters">
              {desktopSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
          {cameraSources.length > 0 && (
            <optgroup label={"Camera's & video-invoer"}>
              {cameraSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {sources.length === 0 && !loadingSources && isElectron && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Nog geen bronnen geladen — druk op <strong>Bronnen vernieuwen</strong>.
          </p>
        )}
        {cameraSources.length === 0 && desktopSources.length > 0 && !loadingSources && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Geen camera&apos;s gevonden (of geen toestemming). Controleer privacy-instellingen voor camera.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Button
          size="sm"
          variant={previewOn ? "default" : "outline"}
          disabled={!sourceId}
          onClick={() => setPreviewOn((v) => !v)}
        >
          {previewOn ? "Preview uit" : "Preview aan"}
        </Button>
        <Button
          size="sm"
          variant={toDisplay ? "default" : "secondary"}
          disabled={!sourceId}
          onClick={() =>
            void sendCommand({
              type: "display:setExternalCaptureToDisplay",
              enabled: !toDisplay,
            })
          }
        >
          {toDisplay ? "Stop op scorebord" : "Fullscreen op scorebord"}
        </Button>
        <label className="ml-auto flex items-center gap-2 text-[11px] text-foreground/80 cursor-pointer select-none">
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={audioPassthrough}
            onChange={(e) => setAudioPersisted(e.target.checked)}
          />
          <span>
            Audio doorzetten
            <span className="block text-muted-foreground text-[10px]">
              voor capture-kaart met geluid (vMix/zendwagen)
            </span>
          </span>
        </label>
      </div>

      {previewOn && sourceId && (
        <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
          <ExternalCaptureVideo
            sourceId={sourceId}
            className="h-full w-full"
            audio={audioPassthrough}
          />
        </div>
      )}

      {toDisplay && (
        <div className="text-[11px] text-primary">
          Live op het display-venster (boven het scorebord). BLACKOUT schakelt dit uit.
        </div>
      )}
    </div>
  );
}
