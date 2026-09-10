"use client";

import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { Match } from "@/lib/types";
import { getSportProfile } from "@/lib/sports";
import { useDisplayStore } from "@/lib/store";
import { useLivePenaltySeconds, useLiveTimeoutSeconds } from "@/lib/use-timer";
import { formatSetHistory, normalizeServingSide } from "@/lib/volleyball";
import { tBoard, tStatLabel } from "@/lib/i18n/t-sport";

function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-9));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

/** Heeft deze sport iets extra's naast de score (sets, time-outs, fouten, service)? */
export function sportHasTeamExtras(sport: unknown): boolean {
  const profile = getSportProfile(sport);
  return profile.hasSets || profile.timeoutLimitForPeriod(1) > 0 || !!profile.statLabel;
}

/**
 * Per team: gewonnen sets, resterende time-outs, teamfouten (met bonus/10 m-indicator) en
 * service-indicator (volleybal). Labels volgen de UI-taal.
 */
export function SportTeamExtras({
  match,
  side,
  className,
  style,
}: {
  match: Match;
  side: "home" | "away";
  className?: string;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  const profile = getSportProfile(match.sport);
  if (!sportHasTeamExtras(match.sport)) return null;
  const timeoutsUsed = side === "home" ? match.homeTimeouts : match.awayTimeouts;
  const timeoutLimit = profile.timeoutLimitForPeriod(match.currentPeriod);
  const timeoutsLeft = Math.max(0, timeoutLimit - timeoutsUsed);
  const fouls = side === "home" ? match.homeFouls : match.awayFouls;
  const sets = side === "home" ? match.homeSets : match.awaySets;
  const serving = profile.hasSets && normalizeServingSide(match.servingSide) === side;
  const bonus =
    profile.foulBonusFrom != null && fouls >= profile.foulBonusFrom
      ? profile.id === "FUTSAL"
        ? tBoard(t, "tenMeter", "10 M")
        : tBoard(t, "bonus", "BONUS")
      : null;
  const statLabel = tStatLabel(t, match.sport);
  const parts: Array<{ key: string; node: React.ReactNode }> = [];
  if (serving) {
    parts.push({
      key: "serve",
      node: (
        <span className="rounded bg-amber-400 px-[0.4em] py-[0.1em] text-black">
          {tBoard(t, "serve", "SERVICE")}
        </span>
      ),
    });
  }
  if (profile.hasSets) {
    parts.push({ key: "sets", node: <span className="whitespace-nowrap">{tBoard(t, "sets", "SETS")} {sets}</span> });
  }
  if (timeoutLimit > 0) {
    parts.push({
      key: "to",
      node: (
        <span className="whitespace-nowrap">
          {tBoard(t, "timeouts", "TO")} {timeoutsLeft}
        </span>
      ),
    });
  }
  if (statLabel) {
    parts.push({
      key: "fouls",
      node: (
        <span className={`whitespace-nowrap ${bonus ? "text-amber-300" : ""}`}>
          {statLabel} {fouls}
          {bonus ? ` · ${bonus}` : ""}
        </span>
      ),
    });
  }
  if (parts.length === 0) return null;
  return (
    <div
      className={
        className ??
        "flex w-full max-w-full shrink-0 flex-nowrap items-center justify-center gap-[0.45em] px-[3cqw] text-center font-bold uppercase leading-none tracking-wide text-white/65"
      }
      style={style}
    >
      {parts.map((p, i) => (
        <span key={p.key} className="contents">
          {i > 0 && (
            <span className="opacity-40" aria-hidden>
              ·
            </span>
          )}
          {p.node}
        </span>
      ))}
    </div>
  );
}

/**
 * Onder de klok: setgeschiedenis, shotclock, straftijd per team en de time-outklok.
 * `scale` = 1 voor het volledige scorebord, kleiner voor de L-layout / strip.
 */
export function SportMatchMeta({
  match,
  shotClock = 0,
  scale = 1,
}: {
  match: Match;
  shotClock?: number;
  scale?: number;
}) {
  const { t } = useTranslation();
  const state = useDisplayStore((s) => s.state);
  const homePenalty = useLivePenaltySeconds("home");
  const awayPenalty = useLivePenaltySeconds("away");
  const timeoutRemaining = useLiveTimeoutSeconds();
  const profile = getSportProfile(match.sport);
  const history = profile.hasSets ? formatSetHistory(match.setHistory ?? []) : "";
  const timeoutRunning = !!state?.timeoutRunning && timeoutRemaining > 0;
  const timeoutSide = state?.timeoutSide ?? null;
  const showShotClock = profile.shotClockPresets.length > 0;
  const showPenalties = profile.penaltyClockPresets.length > 0 && (homePenalty > 0 || awayPenalty > 0);
  if (!history && !showShotClock && !showPenalties && !timeoutRunning) return null;

  const px = (n: number) => `${Math.round(n * scale)}px`;

  return (
    <div className="flex flex-col items-center gap-[0.35em] text-center text-white/70" style={{ fontSize: px(16) }}>
      {history ? (
        <div className="font-bold uppercase tracking-widest" style={{ fontSize: px(18) }}>
          {history}
        </div>
      ) : null}
      {timeoutRunning ? (
        <div
          className="rounded-lg border border-amber-400/60 bg-amber-500/20 px-[0.9em] py-[0.25em]"
          style={{ fontSize: px(14) }}
        >
          <div className="font-bold uppercase tracking-[0.3em] text-amber-200/90">
            {timeoutSide === "technical"
              ? tBoard(t, "technicalTimeout", "TECHNISCHE TIME-OUT")
              : `${tBoard(t, "timeout", "TIME-OUT")}${
                  timeoutSide === "home"
                    ? ` · ${match.homeTeam.shortName || tBoard(t, "homeShort", "THUIS")}`
                    : timeoutSide === "away"
                      ? ` · ${match.awayTeam.shortName || tBoard(t, "awayShort", "UIT")}`
                      : ""
                }`}
          </div>
          <div className="font-black tabular-nums leading-none text-amber-300" style={{ fontSize: px(44) }}>
            {formatCountdown(timeoutRemaining)}
          </div>
        </div>
      ) : null}
      {showShotClock ? (
        <div className="rounded-lg border border-red-400/50 bg-red-600/15 px-[0.9em] py-[0.2em]" style={{ fontSize: px(14) }}>
          <div className="font-bold uppercase tracking-[0.3em] text-red-200/80">
            {tBoard(t, "shotclock", "SHOTCLOCK")}
          </div>
          <div className="font-black tabular-nums leading-none text-red-400" style={{ fontSize: px(52) }}>
            {Math.ceil(shotClock - 1e-9)}
          </div>
        </div>
      ) : null}
      {showPenalties ? (
        <div className="flex gap-[1.2em] font-black tabular-nums text-amber-300" style={{ fontSize: px(22) }}>
          {homePenalty > 0 ? (
            <span>
              <span className="mr-[0.4em] text-[0.6em] font-bold uppercase tracking-widest text-amber-200/80">
                {tBoard(t, "penalty", "STRAF")} {match.homeTeam.shortName || tBoard(t, "homeShort", "THUIS")}
              </span>
              {formatCountdown(homePenalty)}
            </span>
          ) : null}
          {awayPenalty > 0 ? (
            <span>
              <span className="mr-[0.4em] text-[0.6em] font-bold uppercase tracking-widest text-amber-200/80">
                {tBoard(t, "penalty", "STRAF")} {match.awayTeam.shortName || tBoard(t, "awayShort", "UIT")}
              </span>
              {formatCountdown(awayPenalty)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
