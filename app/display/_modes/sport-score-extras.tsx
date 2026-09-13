"use client";

import type { Match } from "@/lib/types";
import { getSportProfile } from "@/lib/sports";
import { useLivePenaltySeconds } from "@/lib/use-timer";
import { formatSetHistory, normalizeServingSide } from "@/lib/volleyball";

export function SportTeamExtras({
  match,
  side,
  compact = false,
}: {
  match: Match;
  side: "home" | "away";
  compact?: boolean;
}) {
  const profile = getSportProfile(match.sport);
  const timeouts = side === "home" ? match.homeTimeouts : match.awayTimeouts;
  const fouls = side === "home" ? match.homeFouls : match.awayFouls;
  const sets = side === "home" ? match.homeSets : match.awaySets;
  const serving = profile.hasSets && normalizeServingSide(match.servingSide) === side;
  const bonus =
    profile.foulBonusFrom != null && fouls >= profile.foulBonusFrom
      ? profile.id === "FUTSAL"
        ? "PK"
        : "BONUS"
      : null;
  if (
    !profile.hasSets &&
    profile.timeoutLimitForPeriod(1) <= 0 &&
    !profile.statLabel &&
    !serving
  ) {
    return null;
  }
  const cls = compact
    ? "flex flex-wrap items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-white/70"
    : "flex flex-wrap items-center justify-center gap-3 text-center text-xl font-bold uppercase tracking-wider text-white/65";
  return (
    <div className={cls}>
      {serving ? <span className="rounded bg-amber-400 px-1.5 py-0.5 text-black">Serve</span> : null}
      {profile.hasSets && <span>Sets {sets}</span>}
      {profile.timeoutLimitForPeriod(1) > 0 && (
        <span>
          TO {timeouts}/{profile.timeoutLimitForPeriod(match.currentPeriod || 1)}
        </span>
      )}
      {profile.statLabel && (
        <span>
          {profile.statLabel} {fouls}
          {bonus ? ` · ${bonus}` : ""}
        </span>
      )}
    </div>
  );
}

export function SportMatchMeta({
  match,
  shotClock = 0,
  homePenalty: homePenaltyProp,
  awayPenalty: awayPenaltyProp,
}: {
  match: Match;
  shotClock?: number;
  homePenalty?: number;
  awayPenalty?: number;
}) {
  const liveHomePenalty = useLivePenaltySeconds("home");
  const liveAwayPenalty = useLivePenaltySeconds("away");
  const homePenalty = homePenaltyProp ?? liveHomePenalty;
  const awayPenalty = awayPenaltyProp ?? liveAwayPenalty;
  const profile = getSportProfile(match.sport);
  const history = formatSetHistory(match.setHistory ?? []);
  return (
    <div className="flex flex-col items-center gap-1 text-center text-white/70">
      {history ? (
        <div className="text-sm font-bold uppercase tracking-widest">{history}</div>
      ) : null}
      {profile.shotClockPresets.length > 0 && (
        <div className="rounded-lg border border-red-400/50 bg-red-600/15 px-4 py-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-red-200/80">
            Shotclock
          </div>
          <div className="text-4xl font-black tabular-nums leading-none text-red-400">
            {Math.ceil(shotClock)}
          </div>
        </div>
      )}
      {profile.penaltyClockPresets.length > 0 && (homePenalty > 0 || awayPenalty > 0) && (
        <div className="flex gap-4 text-lg font-black tabular-nums text-amber-300">
          {homePenalty > 0 ? <span>P {Math.ceil(homePenalty)}</span> : null}
          {awayPenalty > 0 ? <span>P {Math.ceil(awayPenalty)}</span> : null}
        </div>
      )}
    </div>
  );
}
