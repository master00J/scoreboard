"use client";

import type { ReactNode } from "react";
import { Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import {
  AUDIO_MONITOR_MASTER_ID,
  audioDeviceDisplayName,
  audioMonitorOutputConflicts,
  createAudioChannel,
  isSourceAudioDevice,
  type LivestreamAudioChannel,
  type LivestreamAudioDevice,
} from "@/lib/livestream";
import { meterFillPercent, useInputMeters } from "@/lib/use-input-meter";

const SEGMENTS = 16;

function VerticalFader({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      id={id}
      type="range"
      min={0}
      max={150}
      step={1}
      value={value}
      aria-valuemin={0}
      aria-valuemax={150}
      aria-valuenow={value}
      className="h-[140px] w-6 cursor-ns-resize accent-emerald-400"
      style={{ writingMode: "vertical-lr", direction: "rtl" }}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

function LevelMeter({ peak, muted }: { peak: number; muted: boolean }) {
  const fill = muted ? 0 : meterFillPercent(peak);
  const clip = !muted && fill >= 96;
  return (
    <div
      className="relative h-[140px] w-2.5 overflow-hidden rounded-sm bg-black/70 ring-1 ring-white/10"
      aria-hidden
    >
      <div className="absolute inset-0 flex flex-col-reverse gap-px p-px">
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const step = ((i + 1) / SEGMENTS) * 100;
          const on = fill >= step;
          const color =
            i >= SEGMENTS - 2 ? "bg-red-500" : i >= SEGMENTS - 6 ? "bg-amber-400" : "bg-emerald-400";
          return <div key={i} className={`min-h-0 flex-1 ${on ? color : "bg-white/5"}`} />;
        })}
      </div>
      {clip && <div className="absolute inset-x-0 top-0 h-1 bg-red-500" />}
    </div>
  );
}

function MixerStrip({
  title,
  deviceSelect,
  volume,
  muted,
  peak,
  locked,
  canRemove,
  showMute,
  cueActive,
  faderId,
  t,
  onVolume,
  onMute,
  onCue,
  onRemove,
}: {
  title: string;
  deviceSelect?: ReactNode;
  volume: number;
  muted: boolean;
  peak: number;
  locked: boolean;
  canRemove: boolean;
  showMute: boolean;
  cueActive: boolean;
  faderId: string;
  t: (key: string, opts?: Record<string, string | number>) => string;
  onVolume: (value: number) => void;
  onMute?: () => void;
  onCue: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex w-[96px] shrink-0 flex-col gap-1 rounded-md border border-border/70 bg-zinc-950/50 p-1.5">
      <div className="flex items-start justify-between gap-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
        {canRemove && (
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground"
            disabled={locked}
            onClick={onRemove}
          >
            ×
          </button>
        )}
      </div>
      {deviceSelect}
      <div className="flex items-end justify-center gap-2 pt-1">
        <LevelMeter peak={peak} muted={muted} />
        <VerticalFader id={faderId} value={volume} onChange={onVolume} />
      </div>
      <div className="text-center text-[11px] tabular-nums text-muted-foreground">
        {muted ? t("livestream.audioMuted") : `${volume}%`}
      </div>
      {showMute && onMute ? (
        <button
          type="button"
          className={`h-7 rounded-md text-xs font-bold ${
            muted ? "bg-amber-500 text-black" : "bg-secondary text-muted-foreground hover:text-foreground"
          }`}
          onClick={onMute}
        >
          {muted ? t("livestream.audioUnmute") : t("livestream.audioMute")}
        </button>
      ) : (
        <div className="h-7" />
      )}
      <button
        type="button"
        title={t("livestream.audioCue")}
        aria-pressed={cueActive}
        disabled={locked}
        className={`flex h-7 items-center justify-center rounded-md ${
          cueActive
            ? "bg-sky-500 text-black"
            : "bg-secondary text-muted-foreground hover:text-foreground"
        }`}
        onClick={onCue}
      >
        <Headphones className="size-3.5" />
      </button>
    </div>
  );
}

export function LivestreamAudioMixer({
  channels,
  masterVolume,
  devices,
  outputs,
  deviceLabel,
  monitorDevice,
  monitorCueIds,
  locked,
  live: _live,
  t,
  onMaster,
  onChannels,
  onMonitorDevice,
  onMonitorCueIds,
}: {
  channels: LivestreamAudioChannel[];
  masterVolume: number;
  devices: LivestreamAudioDevice[];
  outputs: LivestreamAudioDevice[];
  deviceLabel?: (device: string) => string;
  monitorDevice: string;
  monitorCueIds: string[];
  locked: boolean;
  live: boolean;
  t: (key: string, opts?: Record<string, string | number>) => string;
  onMaster: (volume: number) => void;
  onChannels: (channels: LivestreamAudioChannel[]) => void;
  onMonitorDevice: (device: string) => void;
  onMonitorCueIds: (ids: string[]) => void;
}) {
  const update = (id: string, partial: Partial<LivestreamAudioChannel>) => {
    onChannels(channels.map((channel) => (channel.id === id ? { ...channel, ...partial } : channel)));
  };

  const add = () => {
    onChannels([...channels, createAudioChannel()]);
  };

  const toggleCue = (id: string) => {
    onMonitorCueIds(
      monitorCueIds.includes(id) ? monitorCueIds.filter((item) => item !== id) : [...monitorCueIds, id],
    );
  };

  const monitorConflict = audioMonitorOutputConflicts(monitorDevice, channels);

  const used = new Set(channels.map((c) => c.device).filter(Boolean));
  const meterNames = channels.map((c) => c.device);
  /**
   * Ook tijdens de uitzending meelezen: WASAPI/dshow-opnameapparaten mogen door
   * meerdere clients tegelijk geopend worden, dus de meters hoeven niet uit als
   * FFmpeg hetzelfde apparaat gebruikt. Zonder dit stond de VU-meter stil zodra
   * je live ging — precies wanneer je hem nodig hebt.
   */
  const meters = useInputMeters(meterNames, true);

  const masterPeak = channels.reduce((max, channel) => {
    if (channel.muted || !channel.device) return max;
    const raw = meters[channel.device]?.peak ?? 0;
    return Math.max(max, raw * (channel.volume / 100) * (masterVolume / 100));
  }, 0);

  return (
    <div className="flex flex-col gap-1.5">
      {devices.length === 0 && <p className="text-[11px] text-amber-600/90">{t("livestream.audioEmpty")}</p>}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {channels.map((channel, index) => (
          <MixerStrip
            key={channel.id}
            title={
              isSourceAudioDevice(channel.device)
                ? (deviceLabel?.(channel.device) ?? t("livestream.sourceBrowser"))
                : t("livestream.audioChannel", { n: index + 1 })
            }
            volume={channel.volume}
            muted={channel.muted}
            peak={(meters[channel.device]?.peak ?? 0) * (channel.volume / 100)}
            locked={locked}
            canRemove={channels.length > 1 && !isSourceAudioDevice(channel.device)}
            showMute
            cueActive={monitorCueIds.includes(channel.id)}
            faderId={`ls-vol-${channel.id}`}
            t={t}
            onVolume={(volume) => update(channel.id, { volume })}
            onMute={() => update(channel.id, { muted: !channel.muted })}
            onCue={() => toggleCue(channel.id)}
            onRemove={() => onChannels(channels.filter((c) => c.id !== channel.id))}
            deviceSelect={
              <Select
                id={`ls-audio-${channel.id}`}
                value={channel.device}
                disabled={locked || isSourceAudioDevice(channel.device)}
                className="h-8 px-1 text-[10px]"
                onChange={(e) => update(channel.id, { device: e.target.value })}
              >
                <option value="">{t("livestream.audioPick")}</option>
                {devices.map((dev) => (
                  <option key={dev.name} value={dev.name} disabled={used.has(dev.name) && channel.device !== dev.name}>
                    {deviceLabel?.(dev.name) ?? audioDeviceDisplayName(dev.name)}
                  </option>
                ))}
              </Select>
            }
          />
        ))}
        <MixerStrip
          title={t("livestream.audioMaster")}
          volume={masterVolume}
          muted={false}
          peak={masterPeak}
          locked={false}
          canRemove={false}
          showMute={false}
          cueActive={monitorCueIds.includes(AUDIO_MONITOR_MASTER_ID)}
          faderId="ls-master"
          t={t}
          onVolume={onMaster}
          onCue={() => toggleCue(AUDIO_MONITOR_MASTER_ID)}
          deviceSelect={
            <div className="h-8 text-center text-[10px] leading-8 text-muted-foreground">
              {t("livestream.audioMixOut")}
            </div>
          }
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Headphones className="size-3.5 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">{t("livestream.audioMonitor")}</span>
        <Select
          id="ls-monitor-out"
          value={monitorDevice}
          disabled={locked}
          className="h-8 max-w-[260px] px-1 text-[10px]"
          onChange={(e) => onMonitorDevice(e.target.value)}
        >
          <option value="">{t("livestream.audioMonitorDefault")}</option>
          {outputs.map((dev) => (
            <option key={dev.name} value={dev.name}>
              {dev.name}
            </option>
          ))}
        </Select>
      </div>
      {monitorConflict && (
        <p className="text-[11px] text-amber-600/90">{t("livestream.audioMonitorConflict")}</p>
      )}
      <Button size="sm" variant="outline" disabled={locked} onClick={add}>
        {t("livestream.audioAdd")}
      </Button>
    </div>
  );
}
