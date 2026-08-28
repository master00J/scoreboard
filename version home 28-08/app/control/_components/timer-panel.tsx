"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { sendCommand } from "@/lib/use-socket";
import { useDisplayStore } from "@/lib/store";
import { useLiveTimerSeconds } from "@/lib/use-timer";
import { StableClockText } from "@/components/stable-clock-text";
import { formatTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useApi } from "@/lib/use-api";
import type { Match } from "@/lib/types";
import { getSportProfile, sportClockSeconds, sportHasMainClock } from "@/lib/sports";

export function TimerPanel() {
  const { t } = useTranslation();
  const state = useDisplayStore((s) => s.state);
  const { data: match, reload } = useApi<Match>(
    state?.matchId ? `/api/matches/${state.matchId}` : null,
  );
  const elapsed = useLiveTimerSeconds();
  const profile = getSportProfile(match?.sport);
  const hasClock = sportHasMainClock(match?.sport);
  const displaySeconds = sportClockSeconds(match?.sport, elapsed, match?.periodDurationSec);
  const running = !!state?.timerRunning;
  const addedTimeMinutes = Math.max(0, state?.addedTimeMinutes ?? 0);
  const [setOpen, setSetOpen] = useState(false);
  const [mm, setMm] = useState("0");
  const [ss, setSs] = useState("0");
  const [injuryDraft, setInjuryDraft] = useState(String(addedTimeMinutes));

  useEffect(() => {
    reload();
  }, [state?.updatedAt, reload]);

  useEffect(() => {
    setInjuryDraft(String(addedTimeMinutes));
  }, [addedTimeMinutes]);

  function applyInjuryMinutes(raw: string) {
    const parsed = Number.parseInt(raw.trim(), 10);
    const minutes = Number.isFinite(parsed) ? Math.max(0, Math.min(30, parsed)) : 0;
    setInjuryDraft(String(minutes));
    if (minutes !== addedTimeMinutes) {
      void sendCommand({ type: "timer:setAddedTime", minutes });
    }
  }

  return (
    <div className="@container flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl border border-border bg-card p-3">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        {profile.label} · {t("timer.title")}
      </div>
      {hasClock ? (
        <div className="flex w-full justify-center px-1">
          <StableClockText
            value={formatTime(displaySeconds)}
            className="max-w-full text-center font-black leading-none text-[clamp(2.25rem,10cqi,3.25rem)]"
            style={{ color: running ? "#22c55e" : "#f59e0b" }}
          />
        </div>
      ) : (
        <div className="px-1 text-center text-2xl font-black leading-none text-muted-foreground">
          {t("timer.noClock")}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          size="sm"
          className="h-9"
          variant={running ? "warning" : "success"}
          disabled={!hasClock}
          onClick={() => sendCommand({ type: running ? "timer:pause" : "timer:start" })}
        >
          {running ? t("common.pause") : t("common.start")}
        </Button>
        <Button
          size="sm"
          className="h-9"
          variant="outline"
          disabled={!hasClock}
          onClick={() => setSetOpen(true)}
        >
          {t("timer.setTime")}
        </Button>
      </div>
      {profile.id === "FOOTBALL" ? (
      <div className="grid grid-cols-4 gap-1.5">
        <Button className="h-8 px-1 text-[10px]" variant="outline" size="sm" onClick={() => sendCommand({ type: "timer:preset", preset: "FIRST_HALF" })}>
          {t("timer.presetFirst")}
        </Button>
        <Button className="h-8 px-1 text-[10px]" variant="outline" size="sm" onClick={() => sendCommand({ type: "timer:preset", preset: "SECOND_HALF" })}>
          {t("timer.presetSecond")}
        </Button>
        <Button className="h-8 px-1 text-[10px]" variant="outline" size="sm" onClick={() => sendCommand({ type: "timer:preset", preset: "ET1" })}>
          {t("timer.presetEt1")}
        </Button>
        <Button className="h-8 px-1 text-[10px]" variant="outline" size="sm" onClick={() => sendCommand({ type: "timer:preset", preset: "ET2" })}>
          {t("timer.presetEt2")}
        </Button>
      </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: profile.periodCount }, (_, index) => index + 1).map((period) => (
            <Button
              key={period}
              variant={match?.currentPeriod === period ? "default" : "outline"}
              size="sm"
              onClick={() => sendCommand({ type: "sport:setPeriod", period })}
            >
              {profile.periodLabel} {period}
            </Button>
          ))}
        </div>
      )}

      {profile.id === "FOOTBALL" && (
        <div className="rounded-lg border border-border bg-muted/20 p-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              {t("timer.injuryTime")}
            </div>
            <div className="rounded-md bg-amber-500 px-2 py-1 text-xs font-black tabular-nums text-black">
              +{addedTimeMinutes}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-muted-foreground shrink-0">+</span>
            <Input
              type="number"
              min={0}
              max={30}
              step={1}
              inputMode="numeric"
              aria-label={t("timer.injuryAria")}
              value={injuryDraft}
              onChange={(e) => setInjuryDraft(e.target.value)}
              onBlur={() => applyInjuryMinutes(injuryDraft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="h-8 font-mono text-sm"
            />
            <span className="shrink-0 text-[10px] text-muted-foreground">{t("common.minutes")}</span>
            <Button
              type="button"
              size="sm"
              className="h-8 px-2 text-[10px]"
              variant="outline"
              disabled={addedTimeMinutes === 0}
              onClick={() => applyInjuryMinutes("0")}
            >
              {t("timer.injuryOff")}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={setOpen} onOpenChange={setSetOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("timer.setTimeTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              value={mm}
              onChange={(e) => setMm(e.target.value)}
              placeholder={t("timer.minutesPlaceholder")}
            />
            <span className="text-2xl">:</span>
            <Input
              type="number"
              value={ss}
              onChange={(e) => setSs(e.target.value)}
              placeholder={t("timer.secondsPlaceholder")}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSetOpen(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={() => {
                const requested = Math.max(0, Number(mm) * 60 + Number(ss));
                const seconds =
                  profile.timerMode === "COUNT_DOWN"
                    ? Math.max(
                        0,
                        (match?.periodDurationSec ?? profile.defaultPeriodDurationSec) - requested,
                      )
                    : requested;
                sendCommand({ type: "timer:set", seconds });
                setSetOpen(false);
              }}
            >
              {t("common.apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
