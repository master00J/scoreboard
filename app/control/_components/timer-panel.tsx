"use client";

import { useEffect, useState } from "react";
import { sendCommand } from "@/lib/use-socket";
import { useDisplayStore } from "@/lib/store";
import { useLiveTimerSeconds } from "@/lib/use-timer";
import { formatTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useApi } from "@/lib/use-api";
import type { Match } from "@/lib/types";
import { getSportProfile, sportClockSeconds, sportHasMainClock } from "@/lib/sports";

export function TimerPanel() {
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

  useEffect(() => {
    reload();
  }, [state?.updatedAt, reload]);

  return (
    <div className="bg-card border border-border rounded-xl p-6 flex flex-col gap-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        {profile.label} · wedstrijdklok
      </div>
      <div
        className="text-center text-[96px] font-black tabular-nums leading-none"
        style={{ color: running ? "#22c55e" : "#f59e0b" }}
      >
        {hasClock ? formatTime(displaySeconds) : "GEEN KLOK"}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="xl"
          variant={running ? "warning" : "success"}
          disabled={!hasClock}
          onClick={() => sendCommand({ type: running ? "timer:pause" : "timer:start" })}
        >
          {running ? "Pause" : "Start"}
        </Button>
        <Button
          size="xl"
          variant="outline"
          disabled={!hasClock}
          onClick={() => setSetOpen(true)}
        >
          Set time
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <AdjustBtn label="-1m" delta={profile.timerMode === "COUNT_DOWN" ? 60 : -60} disabled={!hasClock} />
        <AdjustBtn label="-10s" delta={profile.timerMode === "COUNT_DOWN" ? 10 : -10} disabled={!hasClock} />
        <AdjustBtn label="+10s" delta={profile.timerMode === "COUNT_DOWN" ? -10 : 10} disabled={!hasClock} />
        <AdjustBtn label="+1m" delta={profile.timerMode === "COUNT_DOWN" ? -60 : 60} disabled={!hasClock} />
      </div>
      {profile.id === "FOOTBALL" ? (
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" onClick={() => sendCommand({ type: "timer:preset", preset: "FIRST_HALF" })}>
          ⇤ 1st half (0:00)
        </Button>
        <Button variant="outline" size="sm" onClick={() => sendCommand({ type: "timer:preset", preset: "SECOND_HALF" })}>
          ⇤ 2nd half (45:00)
        </Button>
        <Button variant="outline" size="sm" onClick={() => sendCommand({ type: "timer:preset", preset: "ET1" })}>
          ⇤ ET1 (90:00)
        </Button>
        <Button variant="outline" size="sm" onClick={() => sendCommand({ type: "timer:preset", preset: "ET2" })}>
          ⇤ ET2 (105:00)
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

      {profile.id === "FOOTBALL" && <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Blessuretijd
          </div>
          <div className="rounded-md bg-amber-500 px-3 py-1 text-sm font-black tabular-nums text-black">
            +{addedTimeMinutes}
          </div>
        </div>
        <div className="grid grid-cols-6 gap-2">
          {[1, 2, 3, 4, 5].map((minutes) => (
            <Button
              key={minutes}
              variant={addedTimeMinutes === minutes ? "default" : "secondary"}
              size="sm"
              onClick={() => sendCommand({ type: "timer:setAddedTime", minutes })}
            >
              +{minutes}
            </Button>
          ))}
          <Button
            variant={addedTimeMinutes === 0 ? "outline" : "warning"}
            size="sm"
            onClick={() => sendCommand({ type: "timer:setAddedTime", minutes: 0 })}
          >
            Uit
          </Button>
        </div>
      </div>}

      <Dialog open={setOpen} onOpenChange={setSetOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Set exact time</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              value={mm}
              onChange={(e) => setMm(e.target.value)}
              placeholder="Minutes"
            />
            <span className="text-2xl">:</span>
            <Input
              type="number"
              value={ss}
              onChange={(e) => setSs(e.target.value)}
              placeholder="Seconds"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSetOpen(false)}>Cancel</Button>
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
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdjustBtn({
  label,
  delta,
  disabled,
}: {
  label: string;
  delta: number;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={disabled}
      onClick={() => sendCommand({ type: "timer:adjust", deltaSec: delta })}
    >
      {label}
    </Button>
  );
}
