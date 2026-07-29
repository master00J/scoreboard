"use client";

import { Button } from "@/components/ui/button";
import { sendCommand } from "@/lib/use-socket";
import { useDisplayStore } from "@/lib/store";
import { useLiveShotClockSeconds } from "@/lib/use-timer";
import { getSportProfile, sportPeriodLabel } from "@/lib/sports";
import type { Match } from "@/lib/types";

export function SportLiveControls({ match }: { match: Match }) {
  const state = useDisplayStore((store) => store.state);
  const shotClock = useLiveShotClockSeconds();
  const profile = getSportProfile(match.sport);
  const timeoutLimit = profile.timeoutLimitForPeriod(match.currentPeriod);

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/15 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {profile.label} · spelregels
          </div>
          <div className="mt-1 text-sm font-semibold">
            {sportPeriodLabel(match.sport, match.currentPeriod)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: profile.periodCount }, (_, index) => index + 1).map((period) => (
            <Button
              key={period}
              size="sm"
              variant={match.currentPeriod === period ? "default" : "outline"}
              onClick={() => void sendCommand({ type: "sport:setPeriod", period })}
            >
              {profile.periodLabel} {period}
            </Button>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void sendCommand({ type: "match:setStatus", status: "HALF_TIME" })}
          >
            Pauze
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void sendCommand({ type: "match:setStatus", status: "FULL_TIME" })}
          >
            Einde
          </Button>
        </div>
      </div>

      {timeoutLimit > 0 && (
        <StatRow
          label={`${profile.timeoutLabel} gebruikt · max. ${timeoutLimit}`}
          home={match.homeTimeouts}
          away={match.awayTimeouts}
          onAdjust={(side, delta) =>
            void sendCommand({ type: "sport:statAdjust", stat: "timeout", side, delta })
          }
        />
      )}

      {profile.statLabel && (
        <StatRow
          label={
            profile.statLimit
              ? `${profile.statLabel} · bonus/limiet vanaf ${profile.statLimit + 1}`
              : profile.statLabel
          }
          home={match.homeFouls}
          away={match.awayFouls}
          onAdjust={(side, delta) =>
            void sendCommand({ type: "sport:statAdjust", stat: "foul", side, delta })
          }
        />
      )}

      {profile.hasSets && (
        <StatRow
          label="Gewonnen sets"
          home={match.homeSets}
          away={match.awaySets}
          onAdjust={(side, delta) =>
            void sendCommand({ type: "sport:statAdjust", stat: "set", side, delta })
          }
        />
      )}

      {profile.shotClockPresets.length > 0 && (
        <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Shotclock
            </div>
            <div
              className="mt-1 text-5xl font-black tabular-nums"
              style={{ color: state?.shotClockRunning ? "#ef4444" : "#f59e0b" }}
            >
              {Math.ceil(shotClock)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={state?.shotClockRunning ? "warning" : "success"}
              onClick={() =>
                void sendCommand({
                  type: state?.shotClockRunning ? "shotclock:pause" : "shotclock:start",
                })
              }
            >
              {state?.shotClockRunning ? "Pauze" : "Start"}
            </Button>
            {profile.shotClockPresets.map((seconds) => (
              <Button
                key={seconds}
                variant="outline"
                onClick={() => void sendCommand({ type: "shotclock:reset", seconds })}
              >
                Reset {seconds}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatRow({
  label,
  home,
  away,
  onAdjust,
}: {
  label: string;
  home: number;
  away: number;
  onAdjust: (side: "home" | "away", delta: number) => void;
}) {
  return (
    <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <Counter label="Thuis" value={home} onAdjust={(delta) => onAdjust("home", delta)} />
      <Counter label="Uit" value={away} onAdjust={(delta) => onAdjust("away", delta)} />
    </div>
  );
}

function Counter({
  label,
  value,
  onAdjust,
}: {
  label: string;
  value: number;
  onAdjust: (delta: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-[10px] uppercase text-muted-foreground">{label}</span>
      <Button size="sm" variant="outline" onClick={() => onAdjust(-1)}>
        −
      </Button>
      <span className="min-w-8 text-center text-2xl font-black tabular-nums">{value}</span>
      <Button size="sm" variant="outline" onClick={() => onAdjust(1)}>
        +
      </Button>
    </div>
  );
}
