"use client";

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { sendCommand } from "@/lib/use-socket";
import { useDisplayStore } from "@/lib/store";
import { useLicenseFeatures } from "@/lib/use-license-features";
import { useLivePenaltySeconds, useLiveShotClockSeconds, useLiveTimeoutSeconds } from "@/lib/use-timer";
import {
  basketballLateTimeoutBlocked,
  basketballLateTimeoutCounts,
  BASKETBALL_Q4_LATE_TIMEOUT_MAX,
  formatShotClock,
  getSportProfile,
  sportClockSeconds,
  sportMaxPeriod,
  sportMaxPeriodForMatch,
  timeoutDurationSecForMatch,
  timeoutLimitForMatch,
} from "@/lib/sports";
import { useLiveBreakSeconds, useLiveTimerSeconds } from "@/lib/use-timer";
import { applyLivePeriod, applyLivePhase } from "@/lib/live-phase-commands";
import { tPeriodButton, tPeriodName, tSportLabel, tStatLabel } from "@/lib/i18n/t-sport";
import { formatTechnicalTimeoutScores, volleyballRulesFromMatch } from "@/lib/volleyball";
import type { Match } from "@/lib/types";

function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-9));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

export function SportLiveControls({ match }: { match: Match }) {
  const { t } = useTranslation();
  const state = useDisplayStore((store) => store.state);
  const shotClock = useLiveShotClockSeconds();
  const elapsed = useLiveTimerSeconds();
  const breakRemaining = useLiveBreakSeconds();
  const homePenalty = useLivePenaltySeconds("home");
  const awayPenalty = useLivePenaltySeconds("away");
  const timeoutRemaining = useLiveTimeoutSeconds();
  const { isFeatureAllowed } = useLicenseFeatures();
  const automaticSponsorsAllowed = isFeatureAllowed("automatic_sponsor_rotation");
  const profile = getSportProfile(match.sport);
  const periodCount = profile.hasSets ? sportMaxPeriodForMatch(match) : profile.periodCount;
  const timeoutLimit = timeoutLimitForMatch(match);
  const timeoutDurationSec = timeoutDurationSecForMatch(match);
  const volleyRules = profile.hasSets ? volleyballRulesFromMatch(match) : null;
  const statLabel = tStatLabel(t, match.sport);
  const timeoutRunning = !!state?.timeoutRunning && timeoutRemaining > 0;
  const timeoutSide = state?.timeoutSide ?? null;
  const gameClock = sportClockSeconds(match.sport, elapsed, match.periodDurationSec, match.currentPeriod);
  const shotOff = !!state?.shotClockOff;
  const overtimeAvailable = profile.overtimeDurationSec > 0 && profile.maxOvertimePeriods > 0;
  const inOvertime = match.currentPeriod > profile.periodCount;
  const nextOvertimePeriod = Math.min(
    Math.max(profile.periodCount + 1, inOvertime ? match.currentPeriod + 1 : profile.periodCount + 1),
    sportMaxPeriod(match.sport),
  );

  function startTimeout(side: "home" | "away") {
    void sendCommand({ type: "timeout:start", side });
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/15 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {tSportLabel(t, match.sport)}
          </div>
          <div className="mt-0.5 text-xs font-semibold">
            {match.status === "PREMATCH" || match.status === "SETUP"
              ? t("phases.PREMATCH")
              : tPeriodName(t, match.sport, match.currentPeriod)}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            className="h-8 px-2 text-[10px]"
            variant={match.status === "PREMATCH" || match.status === "SETUP" ? "default" : "outline"}
            title={t("phases.PREMATCH")}
            onClick={() => void applyLivePhase("PREMATCH")}
          >
            {t("phases.PREMATCH_SHORT")}
          </Button>
          {Array.from({ length: periodCount }, (_, index) => index + 1).map((period) => (
            <Button
              key={period}
              size="sm"
              className="h-8 px-2 text-[10px]"
              variant={
                match.status !== "PREMATCH" &&
                match.status !== "SETUP" &&
                match.currentPeriod === period
                  ? "default"
                  : "outline"
              }
              onClick={() => void applyLivePeriod(period, automaticSponsorsAllowed)}
            >
              {tPeriodButton(t, match.sport, period)}
            </Button>
          ))}
          {overtimeAvailable && (
            <Button
              size="sm"
              className="h-8 px-2 text-[10px]"
              variant={
                match.status !== "PREMATCH" &&
                match.status !== "SETUP" &&
                inOvertime
                  ? "default"
                  : "outline"
              }
              onClick={() => void applyLivePeriod(nextOvertimePeriod, automaticSponsorsAllowed)}
            >
              {inOvertime ? tPeriodButton(t, match.sport, nextOvertimePeriod) : t("matchLive.overtimeButton")}
            </Button>
          )}
          <Button
            size="sm"
            className="h-8 px-2 text-[10px]"
            variant="secondary"
            onClick={() => void sendCommand({ type: "match:setStatus", status: "HALF_TIME" })}
          >
            {t("common.pause")}
          </Button>
          <Button
            size="sm"
            className="h-8 px-2 text-[10px]"
            variant="outline"
            onClick={() => void sendCommand({ type: "match:setStatus", status: "FULL_TIME" })}
          >
            {t("phases.FULL_TIME")}
          </Button>
        </div>
      </div>

      {breakRemaining > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-500/50 bg-sky-500/10 px-2 py-1.5">
          <div className="text-xs font-semibold uppercase tracking-widest text-sky-200">
            {t("matchLive.breakRunning")}
          </div>
          <div className="text-2xl font-black tabular-nums text-sky-200">{formatCountdown(breakRemaining)}</div>
        </div>
      )}

      {timeoutRunning && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1.5">
          <div className="text-xs font-semibold uppercase tracking-widest text-amber-200">
            {timeoutSide === "technical" ? t("matchLive.technicalTimeout") : t("matchLive.timeoutRunning")}
            {timeoutSide === "home" ? ` · ${t("common.home")}` : timeoutSide === "away" ? ` · ${t("common.away")}` : ""}
          </div>
          <div className="text-2xl font-black tabular-nums text-amber-300">{formatCountdown(timeoutRemaining)}</div>
          <Button
            size="sm"
            className="h-8 px-2 text-[10px]"
            variant="success"
            onClick={() => void sendCommand(profile.hasSets ? { type: "sport:resumePlay" } : { type: "timeout:clear" })}
          >
            {t("matchLive.endTimeout")}
          </Button>
        </div>
      )}

      {timeoutLimit > 0 && (
        <div className="grid gap-2 border-t border-border pt-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t("matchLive.timeoutsUsed", { label: profile.timeoutLabel, n: timeoutLimit })}
          </div>
          {(["home", "away"] as const).map((side) => {
            const used = side === "home" ? match.homeTimeouts : match.awayTimeouts;
            const lateUsed = side === "home" ? (match.homeLateTimeouts ?? 0) : (match.awayLateTimeouts ?? 0);
            const lateBlocked = basketballLateTimeoutBlocked({
              sport: match.sport,
              period: match.currentPeriod,
              gameClockRemainingSec: gameClock,
              lateTimeoutsUsed: lateUsed,
            });
            const inLateWindow = basketballLateTimeoutCounts(match.sport, match.currentPeriod, gameClock);
            return (
              <div key={side} className="flex items-center gap-1.5">
                <span className="w-10 text-[10px] uppercase text-muted-foreground">
                  {side === "home" ? t("common.home") : t("common.away")}
                </span>
                <Button
                  className="h-8 px-2"
                  size="sm"
                  variant="outline"
                  onClick={() => void sendCommand({ type: "sport:statAdjust", stat: "timeout", side, delta: -1 })}
                >
                  −
                </Button>
                <span className="min-w-7 text-center text-xl font-black tabular-nums">
                  {used}
                  <span className="text-xs font-semibold text-muted-foreground">/{timeoutLimit}</span>
                </span>
                <Button
                  className="h-8 px-2 text-[10px]"
                  size="sm"
                  variant={used >= timeoutLimit || timeoutRunning || lateBlocked ? "outline" : "warning"}
                  disabled={used >= timeoutLimit || timeoutRunning || lateBlocked}
                  onClick={() => startTimeout(side)}
                  title={t("matchLive.startTimeout")}
                >
                  {t("matchLive.startTimeout")}
                  {timeoutDurationSec > 0 ? ` ${timeoutDurationSec}s` : ""}
                </Button>
                {inLateWindow ? (
                  <span className="text-[10px] tabular-nums text-amber-200">
                    {t("matchLive.timeoutLate", { used: lateUsed, max: BASKETBALL_Q4_LATE_TIMEOUT_MAX })}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {volleyRules && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
          <Button
            size="sm"
            className="h-8 px-2 text-[10px]"
            variant="outline"
            disabled={timeoutRunning}
            onClick={() =>
              void sendCommand({
                type: "timeout:start",
                side: "technical",
                seconds: volleyRules.technicalTimeoutDurationSec,
              })
            }
          >
            {t("matchLive.startTechnicalTimeout")}
            {` ${volleyRules.technicalTimeoutDurationSec}s`}
          </Button>
          <span className="text-[10px] text-muted-foreground">
            {volleyRules.technicalTimeoutsEnabled
              ? t("matchLive.technicalTimeoutAuto", {
                  scores: formatTechnicalTimeoutScores(volleyRules.technicalTimeoutScores) || "—",
                })
              : t("matchLive.technicalTimeoutManual")}
          </span>
        </div>
      )}

      {statLabel && (
        <StatRow
          label={
            profile.statLimit
              ? t("matchLive.statLimit", {
                  label: statLabel,
                  n: profile.statLimit + 1,
                })
              : statLabel
          }
          home={match.homeFouls}
          away={match.awayFouls}
          bonusFrom={profile.foulBonusFrom}
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
      {profile.hasSets && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t("matchLive.serving")}
          </div>
          <Button
            size="sm"
            className="h-8 px-2 text-[10px]"
            variant={match.servingSide === "home" ? "default" : "outline"}
            onClick={() => void sendCommand({ type: "sport:setServing", side: "home" })}
          >
            {t("common.home")}
          </Button>
          <Button
            size="sm"
            className="h-8 px-2 text-[10px]"
            variant={match.servingSide === "away" ? "default" : "outline"}
            onClick={() => void sendCommand({ type: "sport:setServing", side: "away" })}
          >
            {t("common.away")}
          </Button>
          {match.status === "HALF_TIME" && (
            <Button
              size="sm"
              className="h-8 px-2 text-[10px]"
              variant="success"
              onClick={() => void sendCommand({ type: "sport:resumePlay" })}
            >
              {t("matchLive.resumePlay")}
            </Button>
          )}
        </div>
      )}

      {profile.supportsPossessionArrow && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t("matchLive.possession")}
          </div>
          <Button
            size="sm"
            className="h-8 px-2 text-[10px]"
            variant={match.possessionArrow === "home" ? "default" : "outline"}
            onClick={() => void sendCommand({ type: "sport:setPossession", side: "home" })}
          >
            ◀ {t("common.home")}
          </Button>
          <Button
            size="sm"
            className="h-8 px-2 text-[10px]"
            variant={match.possessionArrow === "away" ? "default" : "outline"}
            onClick={() => void sendCommand({ type: "sport:setPossession", side: "away" })}
          >
            {t("common.away")} ▶
          </Button>
        </div>
      )}

      {profile.shotClockPresets.length > 0 && (
        <div className="grid gap-2 border-t border-border pt-2 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t("matchLive.shotClock")}
            </div>
            <div
              className="mt-0.5 text-4xl font-black tabular-nums"
              style={{ color: shotOff ? "#71717a" : state?.shotClockRunning ? "#ef4444" : "#f59e0b" }}
            >
              {shotOff ? t("matchLive.shotClockOff") : formatShotClock(shotClock)}
            </div>
            <div className="text-[10px] text-muted-foreground">{t("matchLive.shotClockUnder14")}</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
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
      {profile.penaltyClockPresets.length > 0 && (
        <div className="space-y-1 border-t border-border pt-2">
          {profile.penaltyFollowsClock && (
            <div className="text-[10px] text-muted-foreground">{t("matchLive.penaltyFollowsClock")}</div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {(["home", "away"] as const).map((side) => {
              const remaining = side === "home" ? homePenalty : awayPenalty;
              const running =
                side === "home" ? !!state?.homePenaltyRunning : !!state?.awayPenaltyRunning;
              return (
                <div key={side} className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {t("matchLive.penaltyClock")} · {side === "home" ? t("common.home") : t("common.away")}
                  </div>
                  <div
                    className="text-2xl font-black tabular-nums"
                    style={{ color: remaining > 0 ? (running ? "#f59e0b" : "#a1a1aa") : undefined }}
                  >
                    {formatCountdown(remaining)}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {profile.penaltyClockPresets.map((seconds) => (
                      <Button
                        key={seconds}
                        size="sm"
                        className="h-8 px-2 text-[10px]"
                        variant="outline"
                        onClick={() => void sendCommand({ type: "penalty:start", side, seconds })}
                      >
                        {Math.round(seconds / 60)}′
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      className="h-8 px-2 text-[10px]"
                      variant="outline"
                      disabled={remaining <= 0}
                      onClick={() => void sendCommand({ type: "penalty:clear", side })}
                    >
                      {t("matchLive.clearPenalty")}
                    </Button>
                  </div>
                </div>
              );
            })}
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
  bonusFrom = null,
}: {
  label: string;
  home: number;
  away: number;
  onAdjust: (side: "home" | "away", delta: number) => void;
  bonusFrom?: number | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2 border-t border-border pt-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <Counter
        label={t("common.home")}
        value={home}
        highlight={bonusFrom != null && home >= bonusFrom}
        onAdjust={(delta) => onAdjust("home", delta)}
      />
      <Counter
        label={t("common.away")}
        value={away}
        highlight={bonusFrom != null && away >= bonusFrom}
        onAdjust={(delta) => onAdjust("away", delta)}
      />
    </div>
  );
}

function Counter({
  label,
  value,
  onAdjust,
  highlight = false,
}: {
  label: string;
  value: number;
  onAdjust: (delta: number) => void;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-10 text-[10px] uppercase text-muted-foreground">{label}</span>
      <Button className="h-8 px-2" size="sm" variant="outline" onClick={() => onAdjust(-1)}>
        −
      </Button>
      <span className={`min-w-7 text-center text-xl font-black tabular-nums ${highlight ? "text-red-400" : ""}`}>
        {value}
      </span>
      <Button className="h-8 px-2" size="sm" variant="outline" onClick={() => onAdjust(1)}>
        +
      </Button>
    </div>
  );
}
