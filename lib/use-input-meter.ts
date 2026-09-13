"use client";

import { useEffect, useMemo, useState } from "react";
import { isSourceAudioDevice, isWasapiAudioDevice } from "@/lib/livestream";

export type InputMeterReading = {
  peak: number;
  rms: number;
};

const silent: InputMeterReading = { peak: 0, rms: 0 };

async function deviceIdForLabel(label: string): Promise<string | null> {
  if (!navigator.mediaDevices?.enumerateDevices) return null;
  const want = label.startsWith("wasapi:") ? label.slice("wasapi:".length) : label;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const audios = devices.filter((d) => d.kind === "audioinput" && d.label);
  const exact = audios.find((d) => d.label === want || d.label === label);
  if (exact?.deviceId) return exact.deviceId;
  const lower = want.toLowerCase();
  const fuzzy = audios.find((d) => {
    const n = d.label.toLowerCase();
    return n.includes(lower) || lower.includes(n);
  });
  return fuzzy?.deviceId ?? null;
}

async function openAnalyser(deviceName: string): Promise<{
  ctx: AudioContext;
  stream: MediaStream;
  analyser: AnalyserNode;
} | null> {
  let id = await deviceIdForLabel(deviceName);
  if (!id) {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    tmp.getTracks().forEach((t) => t.stop());
    id = await deviceIdForLabel(deviceName);
  }
  if (!id) return null;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: id },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.2;
  source.connect(analyser);
  return { ctx, stream, analyser };
}

/** Eén analyser per unieke apparaatnaam — piek/RMS 0–1. */
export function useInputMeters(deviceNames: string[], enabled: boolean): Record<string, InputMeterReading> {
  const key = useMemo(
    () =>
      [...new Set(deviceNames.map((n) => n.trim()).filter(Boolean))]
        .sort()
        .join("\n"),
    [deviceNames],
  );
  const names = useMemo(() => (key ? key.split("\n") : []), [key]);
  const [readings, setReadings] = useState<Record<string, InputMeterReading>>({});

  useEffect(() => {
    if (!enabled || names.length === 0) {
      setReadings({});
      return;
    }

    let cancelled = false;
    let raf = 0;
    const handles: { name: string; ctx: AudioContext; stream: MediaStream; analyser: AnalyserNode }[] = [];
    const peakHold: Record<string, number> = {};
    let wasapiReadings: Record<string, InputMeterReading> = {};

    const stop = () => {
      cancelAnimationFrame(raf);
      for (const handle of handles) {
        handle.stream.getTracks().forEach((t) => t.stop());
        void handle.ctx.close();
      }
    };

    const offWasapi = window.electronAPI?.onLivestreamAudioMeters?.((next) => {
      if (cancelled) return;
      const picked: Record<string, InputMeterReading> = {};
      for (const name of names) {
        if (!isWasapiAudioDevice(name) && !isSourceAudioDevice(name)) continue;
        const reading = next[name];
        if (reading) picked[name] = reading;
      }
      wasapiReadings = picked;
      setReadings((prev) => ({ ...prev, ...picked }));
    });

    void (async () => {
      for (const name of names) {
        if (cancelled) return;
        if (isWasapiAudioDevice(name) || isSourceAudioDevice(name)) continue;
        try {
          const opened = await openAnalyser(name);
          if (!opened || cancelled) {
            opened?.stream.getTracks().forEach((t) => t.stop());
            void opened?.ctx.close();
            continue;
          }
          handles.push({ name, ...opened });
          peakHold[name] = 0;
        } catch {
          /* apparaat in gebruik of geen toestemming */
        }
      }
      if (cancelled || handles.length === 0) return;

      const buf = new Float32Array(1024);
      const tick = () => {
        if (cancelled) return;
        const next: Record<string, InputMeterReading> = {};
        for (const handle of handles) {
          handle.analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          let peak = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = Math.abs(buf[i] ?? 0);
            sum += v * v;
            if (v > peak) peak = v;
          }
          const hold = Math.max(peak, (peakHold[handle.name] ?? 0) * 0.92);
          peakHold[handle.name] = hold;
          next[handle.name] = { peak: hold, rms: Math.sqrt(sum / buf.length) };
        }
        setReadings({ ...wasapiReadings, ...next });
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => {
      cancelled = true;
      offWasapi?.();
      stop();
    };
  }, [enabled, key]);

  return readings;
}

/** dB-achtige meterhoogte 0–100 uit piek 0–1. */
export function meterFillPercent(peak: number): number {
  if (peak <= 0.0008) return 0;
  const db = 20 * Math.log10(Math.min(1, peak));
  return Math.min(100, Math.max(0, ((db + 48) / 48) * 100));
}

export function silentMeter(): InputMeterReading {
  return silent;
}
