"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { sendCommand } from "@/lib/use-socket";
import {
  parseShootout,
  shootoutIsSuddenDeath,
  shootoutMarks,
  shootoutNextSide,
  shootoutScreenBlock,
  shootoutTally,
  shootoutWinner,
  SHOOTOUT_DEFAULT_ROUNDS,
  type ShootoutMark,
  type ShootoutSide,
} from "@/lib/penalty-shootout";
import { normalizeSport } from "@/lib/sports";
import { isLivePlayingMatchStatus } from "@/lib/live-cycle-settings";
import { sponsorRotationBesideScoreboard } from "@/lib/sponsor-display-helpers";
import { useDisplayStore } from "@/lib/store";
import type { Match } from "@/lib/types";

const ROUND_CHOICES = [3, 5] as const;
const SIDES: ShootoutSide[] = ["home", "away"];

function teamLabel(match: Match, side: ShootoutSide): string {
  const team = side === "home" ? match.homeTeam : match.awayTeam;
  return team.shortName || team.name;
}

function MarkDot({ mark }: { mark: ShootoutMark }) {
  const cls =
    mark === "scored"
      ? "border-emerald-400 bg-emerald-500"
      : mark === "missed"
        ? "border-red-400 bg-red-600"
        : "border-muted-foreground/50 bg-transparent";
  return <span className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 ${cls}`} aria-hidden />;
}

/** Zet het stadionscherm op het scorebord, waar de reeks overheen komt. */
function showScoreboardOnScreen() {
  return sendCommand({ type: "display:setMode", mode: "MATCH" });
}

/**
 * Een reeks volgt op het eindsignaal. Loopt de wedstrijd nog, dan eerst naar "Einde": de klok
 * stopt en er draaien geen sponsorclips meer naast het scorebord die de overlay zou afdekken.
 * Toont het scherm iets anders dan het scorebord (bv. sponsors), dan gaat het naar het scorebord,
 * zodat de reeks meteen in beeld komt.
 */
async function startShootout(
  match: Match,
  firstSide: ShootoutSide,
  rounds: number,
  displayMode: string | null | undefined,
) {
  if (isLivePlayingMatchStatus(match.status)) {
    const ended = await sendCommand({ type: "match:setStatus", status: "FULL_TIME" });
    if (!ended?.ok) return;
  }
  const started = await sendCommand({ type: "shootout:start", firstSide, rounds });
  if (!started?.ok) return;
  if (displayMode !== "MATCH" && displayMode !== "FULLTIME") await showScoreboardOnScreen();
}

/** Strafschoppenreeks (voetbal, futsal) of shoot-out (hockey) bedienen vanuit het live-paneel. */
export function ShootoutControls({ match }: { match: Match }) {
  const { t } = useTranslation();
  const [rounds, setRounds] = useState<number>(SHOOTOUT_DEFAULT_ROUNDS);
  const displayMode = useDisplayStore((s) => s.state?.mode);
  const shootout = parseShootout(match.shootoutJson);
  const title = normalizeSport(match.sport) === "HOCKEY" ? t("matchLive.shootoutTitleHockey") : t("matchLive.shootoutTitle");

  if (!shootout) {
    return (
      <div className="space-y-1.5 border-t border-border pt-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</div>
          <div className="flex gap-1">
            {ROUND_CHOICES.map((n) => (
              <Button
                key={n}
                size="sm"
                className="h-7 px-2 text-[10px]"
                variant={rounds === n ? "default" : "outline"}
                onClick={() => setRounds(n)}
              >
                {t("matchLive.shootoutRounds", { n })}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase text-muted-foreground">{t("matchLive.shootoutFirstSide")}</span>
          {SIDES.map((side) => (
            <Button
              key={side}
              size="sm"
              className="h-8 px-2 text-[10px]"
              variant="outline"
              onClick={() => void startShootout(match, side, rounds, displayMode)}
            >
              {t("matchLive.shootoutStartWith", { team: teamLabel(match, side) })}
            </Button>
          ))}
        </div>
        <div className="text-[10px] text-muted-foreground">{t("matchLive.shootoutHint")}</div>
      </div>
    );
  }

  const tally = shootoutTally(shootout);
  const winner = shootoutWinner(shootout);
  const next = shootoutNextSide(shootout);
  const marks = shootoutMarks(shootout);
  const suddenDeath = !winner && shootoutIsSuddenDeath(shootout);
  const noKicksYet = shootout.kicks.length === 0;
  const screenBlock = shootoutScreenBlock({
    onScreen: shootout.onScreen,
    displayMode,
    periodPlaying: sponsorRotationBesideScoreboard(match.status),
  });

  return (
    <div className="space-y-2 border-t border-border pt-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-2">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</div>
          <div className="text-xl font-black tabular-nums">
            {tally.homeScored} – {tally.awayScored}
          </div>
          {suddenDeath && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-200">
              {t("matchLive.shootoutSuddenDeath")}
            </span>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={shootout.onScreen}
            onChange={(event) => void sendCommand({ type: "shootout:setVisible", visible: event.target.checked })}
          />
          {t("matchLive.shootoutOnScreen")}
        </label>
      </div>

      {screenBlock === "screenMode" || screenBlock === "playing" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-100">
          <span>{t(screenBlock === "playing" ? "matchLive.shootoutWaitsForEnd" : "matchLive.shootoutNotOnScreen")}</span>
          <Button
            size="sm"
            className="h-7 px-2 text-[10px]"
            variant="outline"
            onClick={() =>
              void (screenBlock === "playing"
                ? sendCommand({ type: "match:setStatus", status: "FULL_TIME" })
                : showScoreboardOnScreen())
            }
          >
            {t(screenBlock === "playing" ? "matchLive.shootoutToFullTime" : "matchLive.shootoutShowNow")}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        {SIDES.map((side) => {
          const up = next === side;
          return (
            <div
              key={side}
              className={`space-y-1.5 rounded-md border px-2 py-1.5 ${
                winner === side ? "border-emerald-500/70 bg-emerald-500/10" : up ? "border-primary/70" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold">{teamLabel(match, side)}</span>
                <span className="text-lg font-black tabular-nums">
                  {side === "home" ? tally.homeScored : tally.awayScored}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {marks[side].map((mark, index) => (
                  <MarkDot key={index} mark={mark} />
                ))}
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  className="h-8 flex-1 px-2 text-[10px]"
                  variant={up ? "success" : "outline"}
                  disabled={!up}
                  onClick={() => void sendCommand({ type: "shootout:kick", side, scored: true })}
                >
                  {t("matchLive.shootoutScored")}
                </Button>
                <Button
                  size="sm"
                  className="h-8 flex-1 px-2 text-[10px]"
                  variant={up ? "destructive" : "outline"}
                  disabled={!up}
                  onClick={() => void sendCommand({ type: "shootout:kick", side, scored: false })}
                >
                  {t("matchLive.shootoutMissed")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="text-xs font-semibold">
          {winner
            ? t("matchLive.shootoutWinner", { team: teamLabel(match, winner) })
            : next
              ? t("matchLive.shootoutNextUp", { team: teamLabel(match, next) })
              : null}
        </div>
        <div className="flex flex-wrap gap-1">
          {noKicksYet &&
            SIDES.filter((side) => side !== shootout.firstSide).map((side) => (
              <Button
                key={side}
                size="sm"
                className="h-8 px-2 text-[10px]"
                variant="outline"
                onClick={() =>
                  void sendCommand({ type: "shootout:start", firstSide: side, rounds: shootout.rounds })
                }
              >
                {t("matchLive.shootoutStartWith", { team: teamLabel(match, side) })}
              </Button>
            ))}
          <Button
            size="sm"
            className="h-8 px-2 text-[10px]"
            variant="outline"
            disabled={noKicksYet}
            onClick={() => void sendCommand({ type: "shootout:undo" })}
          >
            {t("matchLive.shootoutUndo")}
          </Button>
          <Button
            size="sm"
            className="h-8 px-2 text-[10px]"
            variant="outline"
            onClick={() => {
              if (!confirm(t("matchLive.shootoutClearConfirm"))) return;
              void sendCommand({ type: "shootout:clear" });
            }}
          >
            {t("matchLive.shootoutClear")}
          </Button>
        </div>
      </div>
    </div>
  );
}
