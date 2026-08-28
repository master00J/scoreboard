"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { sendCommand } from "@/lib/use-socket";
import { useDisplayStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AppSettings, Match, Player } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { isFullMatch } from "@/lib/is-full-match";
import { defaultFieldFromRoster } from "@/lib/match-field-lineup";
import { squadOnFieldAndBench } from "@/lib/match-squad";
import { toast } from "@/components/ui/toast";
import { getSportProfile } from "@/lib/sports";
import { tMatchStatus } from "@/lib/i18n/t-phase";
import { SportLiveControls } from "./sport-live-controls";

export function MatchLivePanel() {
  const { t } = useTranslation();
  const state = useDisplayStore((s) => s.state);
  const { data: match, reload } = useApi<Match>(
    state?.matchId ? `/api/matches/${state.matchId}` : null,
  );
  const { data: settings } = useApi<AppSettings>("/api/settings");
  const [scoreModal, setScoreModal] = useState<null | "home" | "away">(null);
  const [subModal, setSubModal] = useState(false);
  const [lineupModal, setLineupModal] = useState(false);
  const [cardModal, setCardModal] = useState<null | "YELLOW" | "RED">(null);

  useEffect(() => {
    reload();
  }, [state?.updatedAt, reload]);

  if (!isFullMatch(match)) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-muted-foreground">
        {t("matchLive.noMatch")}
      </div>
    );
  }

  const profile = getSportProfile(match.sport);
  const isGoalSport = profile.scoreLabel === "Goal";
  const homeGoalVisualEnabled = isGoalSport && (settings?.goalVisualHomeEnabled ?? true);
  const awayGoalVisualEnabled = isGoalSport && (settings?.goalVisualAwayEnabled ?? false);

  async function handleScoreClick(side: "home" | "away", points: number) {
    const visualEnabled = side === "home" ? homeGoalVisualEnabled : awayGoalVisualEnabled;
    if (points === 1 && visualEnabled) {
      setScoreModal(side);
      return;
    }
    await sendCommand({ type: "score:adjust", side, delta: points });
  }

  return (
    <div className="@container flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          {t("matchLive.title")}
        </div>
        <div className="text-xs text-muted-foreground">
          {match.homeTeam.name} vs {match.awayTeam.name} · {tMatchStatus(t, match.status)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SideControl
          side="home"
          team={match.homeTeam}
          score={match.homeScore}
          goalVisualEnabled={homeGoalVisualEnabled}
          scoreLabel={profile.scoreLabel}
          increments={profile.scoreIncrements}
          onScoreClick={(points) => void handleScoreClick("home", points)}
          onAdjust={(d) => sendCommand({ type: "score:adjust", side: "home", delta: d })}
        />
        <SideControl
          side="away"
          team={match.awayTeam}
          score={match.awayScore}
          goalVisualEnabled={awayGoalVisualEnabled}
          scoreLabel={profile.scoreLabel}
          increments={profile.scoreIncrements}
          onScoreClick={(points) => void handleScoreClick("away", points)}
          onAdjust={(d) => sendCommand({ type: "score:adjust", side: "away", delta: d })}
        />
      </div>

      <SportLiveControls match={match} />

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        <Button className="h-9 px-2 text-[11px]" variant="secondary" onClick={() => setSubModal(true)}>
          {t("matchLive.sub")}
        </Button>
        <Button className="h-9 px-2 text-[11px]" variant="outline" onClick={() => setLineupModal(true)}>
          {t("matchLive.lineup")}
        </Button>
        <Button
          className="h-9 bg-amber-500 px-2 text-[11px] text-black hover:bg-amber-600"
          onClick={() => setCardModal("YELLOW")}
        >
          {t("matchLive.yellowCard")}
        </Button>
        <Button
          className="h-9 bg-red-600 px-2 text-[11px] text-white hover:bg-red-700"
          onClick={() => setCardModal("RED")}
        >
          {t("matchLive.redCard")}
        </Button>
        <Button
          className="h-9 px-2 text-[11px]"
          variant="outline"
          onClick={() =>
            sendCommand({ type: "match:setStatus", status: "HALF_TIME" })
          }
        >
          {t("common.pause")}
        </Button>
      </div>

      {scoreModal && (
        <ScorerPicker
          match={match}
          side={scoreModal}
          onClose={() => setScoreModal(null)}
        />
      )}
      {subModal && (
        <SubPicker
          match={match}
          onClose={() => setSubModal(false)}
          onRequestLineup={() => {
            setSubModal(false);
            setLineupModal(true);
          }}
        />
      )}
      {lineupModal && (
        <MatchFieldLineupDialog
          match={match}
          onClose={() => setLineupModal(false)}
          onSaved={() => {
            void reload();
            setLineupModal(false);
          }}
        />
      )}
      {cardModal && (
        <CardPicker
          match={match}
          color={cardModal}
          onClose={() => setCardModal(null)}
        />
      )}
    </div>
  );
}

function SideControl({
  side,
  team,
  score,
  goalVisualEnabled,
  scoreLabel,
  increments,
  onScoreClick,
  onAdjust,
}: {
  side: "home" | "away";
  team: { name: string; shortName: string; primaryColor: string };
  score: number;
  goalVisualEnabled: boolean;
  scoreLabel: string;
  increments: number[];
  onScoreClick: (points: number) => void;
  onAdjust: (delta: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 rounded-lg border p-2.5"
      style={{ borderColor: team.primaryColor + "80" }}
    >
      <div className="flex items-center justify-between">
        <div
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: team.primaryColor }}
        >
          {side === "home" ? t("common.home") : t("common.away")}
        </div>
        <div className="text-xs text-muted-foreground truncate">{team.name}</div>
      </div>
      <div className="text-center text-[clamp(3rem,10cqi,4.5rem)] font-black tabular-nums leading-none">
        {score}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {increments.map((points) => (
          <Button
            key={points}
            size="sm"
            className="h-10 min-w-16 flex-1 bg-green-500 px-2 text-sm font-black text-black hover:bg-green-600"
            onClick={() => onScoreClick(points)}
          >
            {scoreLabel === "Goal" && points === 1
              ? t("matchLive.goalPlus")
              : `${scoreLabel.toUpperCase()} +${points}`}
            {scoreLabel === "Goal" && points === 1 && (
              <span className="block text-[10px] font-semibold opacity-75">
                {goalVisualEnabled ? t("matchLive.withVisual") : t("matchLive.scoreOnly")}
              </span>
            )}
          </Button>
        ))}
        <Button className="h-10 px-3" size="sm" variant="outline" onClick={() => onAdjust(-1)}>
          {t("matchLive.minusOne")}
        </Button>
      </div>
    </div>
  );
}

function ScorerPicker({
  match,
  side,
  onClose,
}: {
  match: Match;
  side: "home" | "away";
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const team = side === "home" ? match.homeTeam : match.awayTeam;
  const players = team.players ?? [];
  const [scorerId, setScorerId] = useState<string | null>(null);

  // As soon as the picker opens we kick off the generic goal video on the
  // display, so the celebration starts immediately (before the operator
  // has even picked the scorer).
  useEffect(() => {
    sendCommand({ type: "goal:prepare", side });
  }, [side]);

  async function handleClose(confirmed: boolean) {
    if (!confirmed) {
      // Operator bailed out — restore the display to sponsor rotation so
      // we don't leave a stale goal intro running.
      await sendCommand({ type: "goal:cancel" });
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={() => handleClose(false)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {t("matchLive.goalTitle", { team: team.name, action: t("matchLive.selectScorer") })}
          </DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground mb-2">
          {t("matchLive.scorerHelp")}
        </div>
        <div className="grid grid-cols-4 gap-2 max-h-[60vh] overflow-auto">
          {players.map((p) => (
            <button
              key={p.id}
              onClick={() => setScorerId(p.id)}
              className={`rounded-lg border p-3 text-left hover:bg-secondary ${
                scorerId === p.id ? "border-primary bg-primary/10" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="text-2xl font-black">#{p.number}</div>
                {(p.goalMediaId || p.goalVideoPath) && (
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider bg-green-500/20 text-green-400 rounded px-1.5 py-0.5"
                    title={
                      p.goalMediaId
                        ? t("matchLive.personalGoalMedia")
                        : t("matchLive.personalGoalMap")
                    }
                  >
                    {t("media.typeVideo")}
                  </span>
                )}
              </div>
              <div className="text-sm truncate">
                {p.firstName} {p.lastName}
              </div>
              <div className="text-xs text-muted-foreground">{p.position}</div>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await sendCommand({ type: "goal:trigger", side });
              onClose();
            }}
          >
            {t("matchLive.skipScorer")}
          </Button>
          <Button
            disabled={!scorerId}
            onClick={async () => {
              await sendCommand({
                type: "goal:trigger",
                side,
                scorerId: scorerId!,
              });
              onClose();
            }}
          >
            {t("matchLive.confirmGoal")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type SubLine = { teamId: string; playerOutId: string; playerInId: string };

function findPlayer(match: Match, teamId: string, playerId: string): Player | undefined {
  const team = teamId === match.homeTeamId ? match.homeTeam : match.awayTeam;
  return team.players?.find((p) => p.id === playerId);
}

function subLineLabel(match: Match, line: SubLine): string {
  const outP = findPlayer(match, line.teamId, line.playerOutId);
  const inP = findPlayer(match, line.teamId, line.playerInId);
  const teamShort =
    line.teamId === match.homeTeamId ? match.homeTeam.shortName : match.awayTeam.shortName;
  const outS = outP ? `#${outP.number} ${outP.lastName}` : "?";
  const inS = inP ? `#${inP.number} ${inP.lastName}` : "?";
  return `${teamShort}: ${outS} → ${inS}`;
}

function MatchFieldLineupDialog({
  match,
  onClose,
  onSaved,
}: {
  match: Match;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const maximumPlayers = getSportProfile(match.sport).fieldPlayers;
  const [saving, setSaving] = useState(false);
  const [homeSel, setHomeSel] = useState<Set<string>>(() => {
    const ids = match.homeFieldPlayerIds;
    if (ids && ids.length > 0) return new Set(ids);
    return new Set(defaultFieldFromRoster(match.homeTeam.players ?? [], maximumPlayers));
  });

  const roster = match.homeTeam.players ?? [];
  const squad = roster.filter((p) => !p.isCoach).sort((a, b) => a.number - b.number);

  function togglePlayer(id: string) {
    setHomeSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < maximumPlayers) next.add(id);
      return next;
    });
  }

  async function save() {
    if (homeSel.size < 1 || homeSel.size > maximumPlayers) {
      toast({
        title: t("matchLive.lineupCountError", { n: maximumPlayers }),
        variant: "error",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/matches/${match.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeFieldPlayerIds: Array.from(homeSel),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({ title: body.error ?? t("media.saveFailed"), variant: "error" });
        return;
      }
      toast({ title: t("matchLive.lineupSaved"), variant: "success" });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t("matchLive.lineupTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground mb-3">
          {t("matchLive.lineupHelp", { n: maximumPlayers })}
        </p>
        <div className="text-xs font-medium text-foreground mb-3">
          {match.homeTeam.shortName} · {homeSel.size}/{maximumPlayers}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[52vh] overflow-y-auto pr-1">
          {squad.map((p) => {
            const on = homeSel.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => togglePlayer(p.id)}
                className={`flex flex-col items-start rounded-lg border p-2 text-left text-sm transition-colors ${
                  on ? "border-primary bg-primary/15" : "border-border hover:bg-secondary"
                }`}
              >
                <span className="font-black">#{p.number}</span>
                <span className="truncate w-full">
                  {p.firstName} {p.lastName}
                </span>
                {p.position && (
                  <span className="text-[10px] text-muted-foreground">{p.position}</span>
                )}
              </button>
            );
          })}
        </div>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? t("common.loading") : t("matchLive.saveLineup")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubPicker({
  match,
  onClose,
  onRequestLineup,
}: {
  match: Match;
  onClose: () => void;
  onRequestLineup?: () => void;
}) {
  const { t } = useTranslation();
  const [teamId, setTeamId] = useState<string>(match.homeTeamId);
  const [outId, setOutId] = useState<string | null>(null);
  const [inId, setInId] = useState<string | null>(null);
  const [pending, setPending] = useState<SubLine[]>([]);
  const team = teamId === match.homeTeamId ? match.homeTeam : match.awayTeam;
  const { onField, bench } = useMemo(() => {
    const stored =
      teamId === match.homeTeamId
        ? match.homeFieldPlayerIds
        : match.awayFieldPlayerIds;
    if (stored && stored.length > 0) {
      const squad = (team.players ?? []).filter((p) => !p.isCoach);
      const idSet = new Set(stored);
      const onFieldList = squad
        .filter((p) => idSet.has(p.id))
        .sort((a, b) => a.number - b.number);
      const benchList = squad
        .filter((p) => !idSet.has(p.id))
        .sort((a, b) => a.number - b.number);
      return { onField: onFieldList, bench: benchList };
    }
    return squadOnFieldAndBench(teamId, team.players ?? [], match.events);
  }, [
    teamId,
    team.players,
    match.homeFieldPlayerIds,
    match.awayFieldPlayerIds,
    match.events,
  ]);

  function addCurrentToQueue() {
    if (!outId || !inId) return;
    setPending((p) => [
      ...p,
      { teamId, playerOutId: outId, playerInId: inId },
    ]);
    setOutId(null);
    setInId(null);
  }

  const readyCount = pending.length + (outId && inId ? 1 : 0);

  async function startOnDisplay() {
    const batch = [...pending];
    if (outId && inId) {
      batch.push({ teamId, playerOutId: outId, playerInId: inId });
    }
    if (batch.length === 0) return;
    if (batch.length === 1) {
      const one = batch[0]!;
      await sendCommand({
        type: "sub:trigger",
        teamId: one.teamId,
        playerOutId: one.playerOutId,
        playerInId: one.playerInId,
      });
    } else {
      await sendCommand({ type: "sub:triggerBatch", substitutions: batch });
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t("matchLive.subTitle", { team: team.name })}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground mb-3">
          {t("matchLive.subHelp")}
        </p>
        <div className="flex gap-2 mb-4">
          <Button
            variant={teamId === match.homeTeamId ? "default" : "outline"}
            onClick={() => {
              setTeamId(match.homeTeamId);
              setInId(null);
              setOutId(null);
            }}
          >
            {match.homeTeam.name}
          </Button>
          <Button
            variant={teamId === match.awayTeamId ? "default" : "outline"}
            onClick={() => {
              setTeamId(match.awayTeamId);
              setInId(null);
              setOutId(null);
            }}
          >
            {match.awayTeam.name}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <PlayerColumn
            title={t("matchLive.playerOut")}
            players={onField}
            selectedId={outId}
            excludeId={inId}
            onSelect={setOutId}
            emptyMessage={t("matchLive.noOnField")}
          />
          <PlayerColumn
            title={t("matchLive.playerIn")}
            players={bench}
            selectedId={inId}
            excludeId={outId}
            onSelect={setInId}
            emptyMessage={t("matchLive.noBench")}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!outId || !inId}
            onClick={addCurrentToQueue}
          >
            {t("matchLive.addToSubQueue")}
          </Button>
        </div>
        {pending.length > 0 && (
          <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("matchLive.subQueue", { count: pending.length })}
            </div>
            <ul className="space-y-1.5 text-sm">
              {pending.map((line, i) => (
                <li
                  key={`${line.teamId}-${line.playerOutId}-${line.playerInId}-${i}`}
                  className="flex items-center justify-between gap-2 rounded border border-border/60 bg-background/80 px-2 py-1.5"
                >
                  <span className="truncate">{subLineLabel(match, line)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 h-7 px-2"
                    onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                  >
                    {t("common.remove")}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter className="mt-4 flex flex-wrap gap-2 sm:justify-end">
          {onRequestLineup && (
            <Button
              type="button"
              variant="outline"
              className="mr-auto"
              onClick={() => onRequestLineup()}
            >
              {t("matchLive.lineup")}…
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={readyCount === 0} onClick={() => void startOnDisplay()}>
            {readyCount <= 1
              ? t("matchLive.startSub")
              : t("matchLive.startSubsBatch", { count: readyCount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CardPicker({
  match,
  color,
  onClose,
}: {
  match: Match;
  color: "YELLOW" | "RED";
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [teamId, setTeamId] = useState<string>(match.homeTeamId);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const team = teamId === match.homeTeamId ? match.homeTeam : match.awayTeam;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {color === "YELLOW" ? t("matchLive.yellowCard") : t("matchLive.redCard")}
          </DialogTitle>
        </DialogHeader>
        <div className="flex gap-2 mb-4">
          <Button
            variant={teamId === match.homeTeamId ? "default" : "outline"}
            onClick={() => {
              setTeamId(match.homeTeamId);
              setPlayerId(null);
            }}
          >
            {match.homeTeam.name}
          </Button>
          <Button
            variant={teamId === match.awayTeamId ? "default" : "outline"}
            onClick={() => {
              setTeamId(match.awayTeamId);
              setPlayerId(null);
            }}
          >
            {match.awayTeam.name}
          </Button>
        </div>
        <PlayerColumn
          title={t("matchLive.selectPlayer", { side: team.name })}
          players={team.players ?? []}
          selectedId={playerId}
          onSelect={setPlayerId}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!playerId}
            onClick={async () => {
              await sendCommand({
                type: "card:trigger",
                teamId,
                playerId: playerId!,
                color,
              });
              onClose();
            }}
          >
            {t("common.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlayerColumn({
  title,
  players,
  selectedId,
  excludeId,
  onSelect,
  emptyMessage,
}: {
  title: string;
  players: Player[];
  selectedId: string | null;
  excludeId?: string | null;
  onSelect: (id: string) => void;
  emptyMessage?: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
        {title}
      </div>
      <div className="flex flex-col gap-1 max-h-[50vh] overflow-auto">
        {players.length === 0 && emptyMessage && (
          <div className="text-xs text-muted-foreground italic py-2 px-1">{emptyMessage}</div>
        )}
        {players.map((p) => {
          const disabled = excludeId === p.id;
          return (
            <button
              key={p.id}
              disabled={disabled}
              onClick={() => onSelect(p.id)}
              className={`flex items-center gap-3 rounded-lg border p-2 text-left text-sm ${
                disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-secondary"
              } ${
                selectedId === p.id
                  ? "border-primary bg-primary/10"
                  : "border-border"
              }`}
            >
              <span className="w-8 text-right font-black">#{p.number}</span>
              <span className="flex-1 truncate">
                {p.firstName} {p.lastName}
              </span>
              {p.position && (
                <span className="text-[10px] text-muted-foreground">{p.position}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
