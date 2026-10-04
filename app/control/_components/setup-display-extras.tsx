"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import {
  COUNTDOWN_LEAD_MINUTES,
  COUNTDOWN_POSITIONS,
  type CountdownPosition,
  type KickoffCountdownSettings,
} from "@/lib/display-extras";
import { isElectron } from "@/lib/electron";
import { sportStartEventVars } from "@/lib/i18n/t-phase";
import type { StadiumScreensPayload } from "@/lib/stadium-screen";
import { useDisplayExtras } from "@/lib/use-display-extras";

const AUTO = "auto";
const MISSING = "missing";

/** Op welke monitor het stadionscherm schermvullend komt. Alleen in de desktop-app. */
export function StadiumScreenPicker() {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<StadiumScreensPayload | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const next = await window.electronAPI?.listStadiumScreens?.();
    if (next) setPayload(next);
  }, []);

  useEffect(() => {
    void load();
    // Monitor aangesloten of losgekoppeld terwijl dit tabblad open staat.
    return window.electronAPI?.onStadiumScreensChanged?.((next) => setPayload(next));
  }, [load]);

  if (!isElectron || !window.electronAPI?.listStadiumScreens) return null;

  const active = payload?.screens.find((screen) => screen.active) ?? null;
  const value = !payload
    ? AUTO
    : payload.via === "choice" && active
      ? String(active.id)
      : payload.via === "fallback"
        ? MISSING
        : AUTO;

  async function choose(next: string) {
    if (next === MISSING) return;
    setBusy(true);
    try {
      const result = await window.electronAPI?.setStadiumScreen?.(next === AUTO ? null : Number(next));
      if (!result?.ok) {
        toast({ title: t("displayExtras.screenFailed"), variant: "error" });
        void load();
        return;
      }
      setPayload(result);
      const now = result.screens.find((screen) => screen.active);
      if (now) toast({ title: t("displayExtras.screenSaved", { number: now.number }), variant: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2" data-stadium-screen>
      <div>
        <div className="text-sm font-medium">{t("displayExtras.screenTitle")}</div>
        <p className="text-[11px] text-muted-foreground">{t("displayExtras.screenBody")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="h-9 w-auto min-w-[16rem] max-w-full text-sm"
          value={value}
          disabled={busy || !payload}
          aria-label={t("displayExtras.screenTitle")}
          onFocus={() => void load()}
          onChange={(e) => void choose(e.target.value)}
        >
          <option value={AUTO}>{t("displayExtras.screenAuto")}</option>
          {payload?.via === "fallback" ? (
            <option value={MISSING} disabled>
              {t("displayExtras.screenNotConnected", { label: payload.missingLabel ?? "" })}
            </option>
          ) : null}
          {(payload?.screens ?? []).map((screen) => (
            <option key={screen.id} value={screen.id}>
              {t("displayExtras.screenOption", {
                number: screen.number,
                label: screen.label || t("displayExtras.screenUnnamed"),
                width: screen.pixelWidth,
                height: screen.pixelHeight,
              })}
              {screen.primary ? ` · ${t("displayExtras.screenPrimary")}` : ""}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void window.electronAPI?.identifyStadiumScreens?.()}
        >
          {t("displayExtras.screenIdentify")}
        </Button>
      </div>
      {payload && active ? (
        <p className="text-[11px] text-muted-foreground" data-stadium-screen-status>
          {payload.via === "fallback"
            ? t("displayExtras.screenMissing", { label: payload.missingLabel ?? "", number: active.number })
            : t("displayExtras.screenNow", { number: active.number })}
          {payload.screens.length === 1 ? ` ${t("displayExtras.screenSingle")}` : ""}
        </p>
      ) : null}
    </div>
  );
}

const POSITION_KEY: Record<CountdownPosition, string> = {
  "top-left": "topLeft",
  "top-right": "topRight",
  "bottom-left": "bottomLeft",
  "bottom-right": "bottomRight",
  center: "center",
};

/** Aftelklok naar het geplande uur van de wedstrijd. */
export function KickoffCountdownSettingsBlock({ sport }: { sport?: string | null }) {
  const { t } = useTranslation();
  const { extras, loaded, update } = useDisplayExtras();
  const countdown = extras.kickoffCountdown;
  const start = sportStartEventVars(t, sport);

  async function save(patch: Partial<KickoffCountdownSettings>) {
    const ok = await update((current) => ({
      ...current,
      kickoffCountdown: { ...current.kickoffCountdown, ...patch },
    }));
    if (!ok) toast({ title: t("displayExtras.saveFailed"), variant: "error" });
  }

  return (
    <div className="space-y-3" data-kickoff-countdown-settings>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{t("displayExtras.countdownTitle")}</div>
          <p className="text-[11px] text-muted-foreground">{t("displayExtras.countdownBody", start)}</p>
        </div>
        <label className="flex cursor-pointer select-none items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={countdown.enabled}
            disabled={!loaded}
            onChange={(e) => void save({ enabled: e.target.checked })}
          />
          <span>{t("common.on")}</span>
        </label>
      </div>
      {countdown.enabled ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label>{t("displayExtras.countdownLead")}</Label>
            <Select
              value={String(countdown.leadMinutes)}
              onChange={(e) => void save({ leadMinutes: Number(e.target.value) })}
            >
              {[...new Set([...COUNTDOWN_LEAD_MINUTES, countdown.leadMinutes])]
                .sort((a, b) => a - b)
                .map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {t("displayExtras.countdownLeadOption", { minutes })}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <Label>{t("displayExtras.countdownPosition")}</Label>
            <Select
              value={countdown.position}
              onChange={(e) => void save({ position: e.target.value as CountdownPosition })}
            >
              {COUNTDOWN_POSITIONS.map((position) => (
                <option key={position} value={position}>
                  {t(`displayExtras.pos_${POSITION_KEY[position]}`)}
                </option>
              ))}
            </Select>
          </div>
          <p className="self-end text-[11px] leading-snug text-muted-foreground">
            {t("displayExtras.countdownNeedsKickoff", start)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
