"use client";

import type { CSSProperties } from "react";
import type { Match } from "@/lib/types";
import { formatShotClock, getSportProfile } from "@/lib/sports";
import { useDisplayStore } from "@/lib/store";
import { useLivePenaltySeconds } from "@/lib/use-timer";
import { formatSetHistory, normalizeServingSide } from "@/lib/volleyball";
import { teamExtrasFitCqw, teamExtrasPartFitPx, type TeamExtrasPart } from "@/lib/team-extras-fit";

/** Heeft deze sport iets extra's naast de score (sets, time-outs, fouten, service)? */
export function sportHasTeamExtras(sport: unknown): boolean {
  const profile = getSportProfile(sport);
  return profile.hasSets || profile.timeoutLimitForPeriod(1) > 0 || !!profile.statLabel;
}

/** Deel van de vakbreedte waarin de regel moet passen (zonder de marges van vak en regel). */
const EXTRAS_AVAILABLE_CQW = 84;

/** Wat er op de regel onder de score staat, in de volgorde van `SportTeamExtras`. */
function teamExtrasParts(match: Match, side: "home" | "away"): TeamExtrasPart[] {
  const profile = getSportProfile(match.sport);
  const fouls = side === "home" ? match.homeFouls : match.awayFouls;
  const parts: TeamExtrasPart[] = [];
  if (profile.supportsPossessionArrow && match.possessionArrow === side) parts.push({ text: "◀◀" });
  if (profile.hasSets && normalizeServingSide(match.servingSide) === side) parts.push({ text: "Serve", badge: true });
  if (profile.hasSets) parts.push({ text: `Sets ${side === "home" ? match.homeSets : match.awaySets}` });
  if (profile.timeoutLimitForPeriod(1) > 0) {
    const timeouts = side === "home" ? match.homeTimeouts : match.awayTimeouts;
    parts.push({ text: `TO ${timeouts}/${profile.timeoutLimitForPeriod(match.currentPeriod || 1)}` });
  }
  if (profile.statLabel) parts.push({ text: `F ${fouls}` });
  if (profile.foulBonusFrom != null && fouls >= profile.foulBonusFrom) {
    parts.push({ text: profile.id === "FUTSAL" ? "PK" : "BONUS", badge: true });
  }
  return parts;
}

/**
 * Lettergrootte (CSS) van de regel onder de score in een vak dat met de container schaalt, of
 * `null` als er geen regel is. Begrensd op de vakbreedte, zodat de regel op één lijn blijft.
 * Een scorevak gebruikt dit om ruimte voor de regel vrij te houden.
 */
export function teamExtrasFontSize(
  match: Match,
  side: "home" | "away",
  opts: { compact?: boolean; fontSize?: string } = {},
): string | null {
  const fit = teamExtrasFitCqw(teamExtrasParts(match, side), EXTRAS_AVAILABLE_CQW);
  if (fit == null) return null;
  const base = opts.fontSize ?? (opts.compact ? "32px, 20cqh" : "28cqh, 8cqw, 42px");
  return `min(${base}, ${fit}cqw)`;
}

export function SportTeamExtras({
  match,
  side,
  compact = false,
  fontSize,
  widthPx,
}: {
  match: Match;
  side: "home" | "away";
  compact?: boolean;
  /**
   * Breedte van een vak zonder container (L-balk), bij een vaste `fontSize` in px. De regel krijgt dan
   * een kleine vaste marge en geen onderdeel wordt breder dan het vak.
   */
  widthPx?: number;
  /** Vaste LED-grootte in px, of een CSS-grootte voor een eigen vak. Zonder waarde schaalt het met de container. */
  fontSize?: number | string;
}) {
  const profile = getSportProfile(match.sport);
  const timeouts = side === "home" ? match.homeTimeouts : match.awayTimeouts;
  const fouls = side === "home" ? match.homeFouls : match.awayFouls;
  const sets = side === "home" ? match.homeSets : match.awaySets;
  const serving = profile.hasSets && normalizeServingSide(match.servingSide) === side;
  const possession = profile.supportsPossessionArrow && match.possessionArrow === side;
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
    !serving &&
    !possession
  ) {
    return null;
  }
  // Een vaste grootte in px (L-balk, onderstrip) mag zoals voorheen afbreken; een grootte die met het
  // vak schaalt, blijft op één lijn.
  const fixedPx =
    typeof fontSize === "number" && widthPx
      ? teamExtrasPartFitPx(teamExtrasParts(match, side), widthPx - 8, fontSize)
      : fontSize;
  const style: CSSProperties =
    typeof fixedPx === "number"
      ? {
          fontSize: fixedPx,
          gap: Math.max(6, Math.round(fixedPx * 0.28)),
          ...(widthPx ? { paddingInline: 4 } : {}),
        }
      : {
          fontSize: teamExtrasFontSize(match, side, { compact, fontSize: typeof fontSize === "string" ? fontSize : undefined }) ?? undefined,
          gap: "0.28em",
          flexWrap: "nowrap",
          whiteSpace: "nowrap",
        };
  return (
    <div
      className="flex w-full min-w-0 max-w-full flex-wrap items-center justify-center px-[2cqw] text-center font-black uppercase leading-none tracking-wide text-white"
      style={style}
    >
      {possession ? (
        <span aria-label="Volgend balbezit" className="text-amber-300" style={{ fontSize: "1.45em" }}>
          {side === "home" ? "◀" : "▶"}
        </span>
      ) : null}
      {serving ? (
        <span className="rounded bg-amber-400 text-black" style={{ padding: "0.08em 0.35em" }}>
          Serve
        </span>
      ) : null}
      {profile.hasSets && <span>Sets {sets}</span>}
      {profile.timeoutLimitForPeriod(1) > 0 && (
        <span className="tabular-nums">
          TO {timeouts}/{profile.timeoutLimitForPeriod(match.currentPeriod || 1)}
        </span>
      )}
      {profile.statLabel && (
        <span className="tabular-nums">
          F {fouls}
        </span>
      )}
      {bonus ? (
        <span
          className="rounded bg-red-600 text-white"
          style={{ padding: "0.08em 0.4em", letterSpacing: "0.08em" }}
        >
          {bonus}
        </span>
      ) : null}
    </div>
  );
}

/** Eigen vak voor de shotclock. `off` verbergt het cijfer (FIBA, wedstrijdklok onder 14s). */
export function ShotClockReadout({
  seconds,
  off = false,
  fontSize,
}: {
  seconds: number;
  off?: boolean;
  fontSize: number | string;
}) {
  if (off) return null;
  const hot = seconds > 0 && seconds < 5;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center" style={{ containerType: "size" }}>
      <div
        className="font-black uppercase tracking-[0.28em] text-red-200"
        style={{ fontSize: "min(18cqh, 14cqw, 28px)" }}
      >
        Shot
      </div>
      <div
        className="font-black tabular-nums leading-none"
        style={{
          fontSize,
          color: hot ? "#fecaca" : "#f87171",
          textShadow: "0 8px 28px rgba(0,0,0,0.55)",
        }}
      >
        {formatShotClock(seconds)}
      </div>
    </div>
  );
}

export function useShotClockOff(): boolean {
  return useDisplayStore((store) => !!store.state?.shotClockOff);
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
      {profile.penaltyClockPresets.length > 0 && (homePenalty > 0 || awayPenalty > 0) && (
        <div className="flex gap-4 text-lg font-black tabular-nums text-amber-300">
          {homePenalty > 0 ? <span>P {Math.ceil(homePenalty)}</span> : null}
          {awayPenalty > 0 ? <span>P {Math.ceil(awayPenalty)}</span> : null}
        </div>
      )}
    </div>
  );
}
