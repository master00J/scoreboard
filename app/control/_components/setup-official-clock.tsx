"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { isElectron } from "@/lib/electron";
import { OFFICIAL_CLOCK_PROTOCOL_LIST, officialClockProtocol } from "@/lib/official-clock/protocols";
import {
  OFFICIAL_CLOCK_CONNECTIONS,
  type OfficialClockConnection,
  type OfficialClockProtocolId,
  type OfficialClockSettings,
  type OfficialClockStatus,
} from "@/lib/official-clock/types";
import { formatShotClock } from "@/lib/sports";
import { useOfficialClockStatus } from "@/lib/use-official-clock";

const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

const CONNECTION_KEY: Record<OfficialClockConnection, string> = {
  "tcp-listen": "tcp_listen",
  "tcp-connect": "tcp_connect",
  udp: "udp",
  serial: "serial",
};

/** Klokstand zoals hij op een bord staat: "8:05" boven de minuut, "45.3" met tienden. */
function boardClock(seconds: number, resolution: number): string {
  if (resolution < 1) {
    const tenths = Math.round(seconds * 10);
    if (tenths < 600) return `${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function linkTone(status: OfficialClockStatus): string {
  if (status.link === "receiving") return status.unrecognized ? "text-amber-300" : "text-emerald-400";
  if (status.link === "lost" || status.link === "error") return "text-red-300";
  return "text-muted-foreground";
}

/** Setup: de console van de jurytafel kiezen en controleren of de standen gelijklopen. */
export function OfficialClockSection() {
  const { t } = useTranslation();
  const status = useOfficialClockStatus();
  const [draft, setDraft] = useState<OfficialClockSettings | null>(null);
  const [ports, setPorts] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    void window.electronAPI?.getOfficialClockSettings?.().then((settings) => {
      if (settings) setDraft(settings);
    });
  }, []);

  const loadPorts = useCallback(async () => {
    setPorts((await window.electronAPI?.listOfficialClockSerialPorts?.()) ?? []);
  }, []);

  useEffect(() => {
    if (draft?.connection === "serial" && ports === null) void loadPorts();
  }, [draft?.connection, ports, loadPorts]);

  if (!isElectron || !window.electronAPI?.getOfficialClockSettings || !draft) return null;

  const protocol = officialClockProtocol(draft.protocol);

  function change(patch: Partial<OfficialClockSettings>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  }

  /** Ander merk: stel meteen de verbinding en poort voor die bij dat merk horen. */
  function chooseProtocol(id: OfficialClockProtocolId) {
    const next = officialClockProtocol(id);
    change({ protocol: id, connection: next.connection, port: next.port, baudRate: 0 });
  }

  async function save(next: OfficialClockSettings) {
    setBusy(true);
    try {
      const result = await window.electronAPI?.saveOfficialClockSettings?.(next);
      if (!result) {
        toast({ title: t("officialClock.saveFailed"), variant: "error" });
        return;
      }
      setDraft(result.settings);
      setDirty(false);
      toast({ title: t("officialClock.saved"), variant: "success" });
    } finally {
      setBusy(false);
    }
  }

  async function toggleCapture() {
    if (status?.capturePath) {
      await window.electronAPI?.stopOfficialClockCapture?.();
      return;
    }
    const result = await window.electronAPI?.startOfficialClockCapture?.();
    if (!result?.ok) toast({ title: t("officialClock.captureFailed"), variant: "error" });
  }

  const usesNetwork = draft.connection !== "serial";
  const serialChoices = [...new Set([...(ports ?? []), ...(draft.serialPath ? [draft.serialPath] : [])])];

  return (
    <section className="bg-card border border-border rounded-xl p-6" data-official-clock-settings>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="mb-1 text-lg font-semibold">{t("officialClock.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("officialClock.body")}</p>
        </div>
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={busy}
            onChange={(e) => void save({ ...draft, enabled: e.target.checked })}
          />
          <span>{t("officialClock.enable")}</span>
        </label>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <Label>{t("officialClock.brand")}</Label>
          <Select value={draft.protocol} onChange={(e) => chooseProtocol(e.target.value as OfficialClockProtocolId)}>
            {OFFICIAL_CLOCK_PROTOCOL_LIST.map((item) => (
              <option key={item.id} value={item.id}>
                {t(`officialClock.protocol_${item.id}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{t("officialClock.connection")}</Label>
          <Select
            value={draft.connection}
            onChange={(e) => change({ connection: e.target.value as OfficialClockConnection })}
          >
            {OFFICIAL_CLOCK_CONNECTIONS.map((connection) => (
              <option key={connection} value={connection}>
                {t(`officialClock.connection_${CONNECTION_KEY[connection]}`)}
              </option>
            ))}
          </Select>
        </div>
        {draft.connection === "tcp-connect" ? (
          <div>
            <Label>{t("officialClock.host")}</Label>
            <Input value={draft.host} placeholder="192.168.1.50" onChange={(e) => change({ host: e.target.value })} />
          </div>
        ) : null}
        {usesNetwork ? (
          <div>
            <Label>{t("officialClock.port")}</Label>
            <Input
              type="number"
              min={1}
              max={65535}
              value={draft.port}
              onChange={(e) => change({ port: Number(e.target.value) })}
            />
          </div>
        ) : (
          <>
            <div>
              <Label>{t("officialClock.serialPort")}</Label>
              <div className="flex gap-2">
                <Select value={draft.serialPath} onChange={(e) => change({ serialPath: e.target.value })}>
                  <option value="">{t("officialClock.serialNone")}</option>
                  {serialChoices.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
                <Button type="button" size="sm" variant="outline" className="h-10" onClick={() => void loadPorts()}>
                  {t("officialClock.serialRefresh")}
                </Button>
              </div>
              {ports !== null && ports.length === 0 ? (
                <p className="mt-1 text-[11px] text-muted-foreground">{t("officialClock.serialEmpty")}</p>
              ) : null}
            </div>
            <div>
              <Label>{t("officialClock.baud")}</Label>
              <Select value={String(draft.baudRate)} onChange={(e) => change({ baudRate: Number(e.target.value) })}>
                <option value="0">{t("officialClock.baudDefault", { baud: protocol.baudRate })}</option>
                {BAUD_RATES.map((baud) => (
                  <option key={baud} value={baud}>
                    {baud}
                  </option>
                ))}
              </Select>
            </div>
          </>
        )}
      </div>

      <p className="mt-2 max-w-3xl text-[11px] text-muted-foreground">
        {t(`officialClock.basis_${protocol.basis}`)} {t("officialClock.checkFirst")}
        {draft.connection === "tcp-listen" || draft.connection === "udp" ? ` ${t("officialClock.firewallHint")}` : ""}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <label className="flex cursor-pointer select-none items-center gap-2">
          <input type="checkbox" checked={draft.followGameClock} onChange={(e) => change({ followGameClock: e.target.checked })} />
          <span>{t("officialClock.followGame")}</span>
        </label>
        <label className="flex cursor-pointer select-none items-center gap-2" title={t("officialClock.followShotHint")}>
          <input type="checkbox" checked={draft.followShotClock} onChange={(e) => change({ followShotClock: e.target.checked })} />
          <span>{t("officialClock.followShot")}</span>
        </label>
        <label className="flex cursor-pointer select-none items-center gap-2">
          <input type="checkbox" checked={draft.muteHorn} onChange={(e) => change({ muteHorn: e.target.checked })} />
          <span>{t("officialClock.muteHorn")}</span>
        </label>
        <label className="flex items-center gap-2">
          <span>{t("officialClock.direction")}</span>
          <Select
            className="h-9 w-auto"
            value={draft.gameClockDirection}
            onChange={(e) => change({ gameClockDirection: e.target.value as OfficialClockSettings["gameClockDirection"] })}
          >
            {(["auto", "down", "up"] as const).map((direction) => (
              <option key={direction} value={direction}>
                {t(`officialClock.direction_${direction}`)}
              </option>
            ))}
          </Select>
        </label>
        <Button type="button" size="sm" disabled={busy || !dirty} onClick={() => void save(draft)}>
          {t("officialClock.apply")}
        </Button>
      </div>

      {status && status.link !== "off" ? (
        <div className="mt-4 rounded-lg border border-border p-3" data-official-clock-status={status.link}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t("officialClock.statusTitle")}
            </span>
            <span className={`text-sm font-semibold ${linkTone(status)}`}>
              {t(`officialClock.link_${status.link}`)}
              {status.link === "error" && status.error ? `: ${status.error}` : ""}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {t("officialClock.frames", { frames: status.frames, rejected: status.rejected })}
            </span>
          </div>
          {status.unrecognized ? <p className="mt-2 text-xs text-amber-300">{t("officialClock.unrecognized")}</p> : null}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("officialClock.consoleGame")}</div>
              <div className="text-2xl font-black tabular-nums">
                {status.game ? boardClock(status.game.seconds, status.game.resolution) : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {status.game
                  ? t(status.game.running ? "officialClock.consoleRunning" : "officialClock.consoleStopped")
                  : t("officialClock.consoleNone")}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("officialClock.consoleShot")}</div>
              <div className="text-2xl font-black tabular-nums">
                {status.shot ? (status.shot.off ? t("officialClock.consoleShotOff") : formatShotClock(status.shot.seconds)) : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {status.shot
                  ? status.shot.off
                    ? ""
                    : t(status.shot.running ? "officialClock.consoleRunning" : "officialClock.consoleStopped")
                  : t("officialClock.consoleNone")}
              </div>
            </div>
          </div>
          {status.gameClockHold ? (
            <p className="mt-2 text-xs text-amber-300">{t(`officialClock.hold_${status.gameClockHold}`)}</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 border-t border-border pt-3">
        <div className="text-sm font-medium">{t("officialClock.captureTitle")}</div>
        <p className="max-w-3xl text-[11px] text-muted-foreground">{t("officialClock.captureBody")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={!draft.enabled} onClick={() => void toggleCapture()}>
            {t(status?.capturePath ? "officialClock.captureStop" : "officialClock.captureStart")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void window.electronAPI?.showOfficialClockCaptures?.()}>
            {t("officialClock.captureOpen")}
          </Button>
          {status?.capturePath ? (
            <span className="text-[11px] text-amber-300">{t("officialClock.captureRunning", { path: status.capturePath })}</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
