"use client";

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { sendCommand } from "@/lib/use-socket";
import { useDisplayStore } from "@/lib/store";
import { useLiveShotClockSeconds } from "@/lib/use-timer";
import { getSportProfile } from "@/lib/sports";
import { tSportLabel, tSportPeriodLabel, tSportPeriodName } from "@/lib/i18n/t-phase";
import type { Match } from "@/lib/types";

export function SportLiveControls({ match }: { match: Match }) {
  const { t } = useTranslation();
  const state = useDisplayStore((store) => store.state);
  const shotClock = useLiveShotClockSeconds();
  const profile = getSportProfile(match.sport);
  const timeoutLimit = profile.timeoutLimitForPeriod(match.currentPeriod);

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/15 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t("matchLive.footballRules").replace(/^[^·]*·\s*/, `${tSportLabel(t, profile.id, profile.label)} · `)}
          </div>
          <div className="mt-1 text-sm font-semibold">
            {tSportPeriodLabel(t, match.sport, match.currentPeriod)}
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
              {tSportPeriodName(t, match.sport, period)}
            </Button>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void sendCommand({ type: "match:setStatus", status: "HALF_TIME" })}
          >
            {t("common.pause")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void sendCommand({ type: "match:setStatus", status: "FULL_TIME" })}
          >
            {t("phases.FULL_TIME")}
          </Button>
        </div>
      </div>

      {timeoutLimit > 0 && (
        <StatRow
          label={t("matchLive.timeoutsUsed", { label: profile.timeoutLabel, n: timeoutLimit })}
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
              ? t("matchLive.statLimit", {
                  label: profile.statLabel,
                  n: profile.statLimit + 1,
                })
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
          label={t("matchLive.wonSets")}
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
              {t("matchLive.shotClock")}
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
              {state?.shotClockRunning ? t("common.pause") : t("common.start")}
            </Button>
            {profile.shotClockPresets.map((seconds) => (
              <Button
                key={seconds}
                variant="outline"
                onClick={() => void sendCommand({ type: "shotclock:reset", seconds })}
              >
                {t("common.reset")} {seconds}
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
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <Counter label={t("common.home")} value={home} onAdjust={(delta) => onAdjust("home", delta)} />
      <Counter label={t("common.away")} value={away} onAdjust={(delta) => onAdjust("away", delta)} />
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
