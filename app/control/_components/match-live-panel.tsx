"use client";

import { useEffect, useMemo, useState } from "react";
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
import { SportLiveControls } from "./sport-live-controls";

export function MatchLivePanel() {
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
      <div className="bg-card border border-border rounded-xl p-6 text-center text-muted-foreground">
        No active match. Create or select a match in <span className="font-semibold text-foreground">Setup</span>.
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
    <div className="bg-card border border-border rounded-xl p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          Live Match
        </div>
        <div className="text-xs text-muted-foreground">
          {match.homeTeam.name} vs {match.awayTeam.name} · status: {match.status}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
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

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Button variant="secondary" onClick={() => setSubModal(true)}>
          Wissel
        </Button>
        <Button variant="outline" onClick={() => setLineupModal(true)}>
          Opstelling veld
        </Button>
        <Button
          className="bg-amber-500 text-black hover:bg-amber-600"
          onClick={() => setCardModal("YELLOW")}
        >
          Yellow card
        </Button>
        <Button
          className="bg-red-600 hover:bg-red-700 text-white"
          onClick={() => setCardModal("RED")}
        >
          Red card
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            sendCommand({ type: "match:setStatus", status: "HALF_TIME" })
          }
        >
          Pauze
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
  return (
    <div
      className="rounded-lg p-4 border flex flex-col gap-3"
      style={{ borderColor: team.primaryColor + "80" }}
    >
      <div className="flex items-center justify-between">
        <div
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: team.primaryColor }}
        >
          {side === "home" ? "HOME" : "AWAY"}
        </div>
        <div className="text-xs text-muted-foreground truncate">{team.name}</div>
      </div>
      <div className="text-center text-[88px] font-black tabular-nums leading-none">
        {score}
      </div>
      <div className="flex flex-wrap gap-2">
        {increments.map((points) => (
          <Button
            key={points}
            size="lg"
            className="min-w-24 flex-1 bg-green-500 hover:bg-green-600 text-black text-lg font-black"
            onClick={() => onScoreClick(points)}
          >
            {scoreLabel.toUpperCase()} +{points}
            {scoreLabel === "Goal" && points === 1 && (
              <span className="block text-[10px] font-semibold opacity-75">
                {goalVisualEnabled ? "met visual" : "alleen score"}
              </span>
            )}
          </Button>
        ))}
        <Button variant="outline" onClick={() => onAdjust(-1)}>
          −1
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
            Goal · {team.name} — select scorer
          </DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground mb-2">
          Algemene goal-video (uit Setup) of GOAL-playlist speelt — kies de scorer voor een
          persoonlijke clip indien ingesteld (media of goal-video uit map), anders het tekst-doelpunt.
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
                        ? "Persoonlijke goal-video (uit media)"
                        : "Persoonlijke goal-video (uit map-import)"
                    }
                  >
                    video
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
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await sendCommand({ type: "goal:trigger", side });
              onClose();
            }}
          >
            Skip scorer
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
            Confirm GOAL
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
        title: `Kies 1 tot ${maximumPlayers} spelers voor de thuisploeg op het veld`,
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
        toast({ title: body.error ?? "Opslaan mislukt", variant: "error" });
        return;
      }
      toast({ title: "Opstelling opgeslagen", variant: "success" });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Wie staat op het veld? (thuisploeg)</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground mb-3">
          Alleen <strong>thuis</strong>: max. {maximumPlayers} spelers (geen coaches). Bepaalt de thuislijsten bij{" "}
          <strong>Wissel</strong> en wordt bij getoonde wissels bijgewerkt. Uitploeg: standaard
          basiself (rugnummer) zoals de server die zet, tenzij die al in de wedstrijd staat.
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
            Sluiten
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Opslaan…" : "Opslaan opstelling"}
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
          <DialogTitle>Wissel · meerdere na elkaar mogelijk</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground mb-3">
          Links wie op het veld staat (volgens <strong>Opstelling veld</strong>), rechts de bank.
          Kies uit en in, voeg eventueel toe aan de lijst, daarna <strong>Start op scherm</strong>{" "}
          (elk ca. 6 s). Zonder opstelling: eerste 11 op rugnummer, bijgewerkt via eerdere wissels in
          het logboek.
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
            title="Op het veld · uit"
            players={onField}
            selectedId={outId}
            excludeId={inId}
            onSelect={setOutId}
            emptyMessage="Geen spelers op het veld volgens de opstelling — gebruik Opstelling veld of controleer het team."
          />
          <PlayerColumn
            title="Bank · in"
            players={bench}
            selectedId={inId}
            excludeId={outId}
            onSelect={setInId}
            emptyMessage="Geen wisselspelers (alle geselecteerden staan op het veld, of te weinig spelers in het team)."
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
            Toevoegen aan wissellijst
          </Button>
        </div>
        {pending.length > 0 && (
          <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Wissellijst ({pending.length})
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
                    Verwijder
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
              Opstelling veld…
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Annuleren
          </Button>
          <Button disabled={readyCount === 0} onClick={() => void startOnDisplay()}>
            {readyCount <= 1
              ? "Start wissel op scherm"
              : `Start ${readyCount} wissels op scherm`}
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
  const [teamId, setTeamId] = useState<string>(match.homeTeamId);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const team = teamId === match.homeTeamId ? match.homeTeam : match.awayTeam;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {color === "YELLOW" ? "Yellow card" : "Red card"}
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
          title={`Select player · ${team.name}`}
          players={team.players ?? []}
          selectedId={playerId}
          onSelect={setPlayerId}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
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
            Apply
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
