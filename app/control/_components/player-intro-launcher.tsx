"use client";

import { useMemo, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDisplayStore } from "@/lib/store";
import { sendCommand } from "@/lib/use-socket";
import type { Match, Player, Team } from "@/lib/types";

export function PlayerIntroLauncher({ match }: { match: Match | null }) {
  const state = useDisplayStore((s) => s.state);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [intervalSec, setIntervalSec] = useState(3);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const currentId = state?.activePlayerId ?? null;

  const activeTeam: Team | null = useMemo(() => {
    if (!match) return null;
    if (currentId) {
      const onHome = match.homeTeam.players?.some((p) => p.id === currentId);
      if (onHome) return match.homeTeam;
      const onAway = match.awayTeam.players?.some((p) => p.id === currentId);
      if (onAway) return match.awayTeam;
    }
    return selectedTeamId === match.awayTeamId ? match.awayTeam : match.homeTeam;
  }, [match, currentId, selectedTeamId]);

  useEffect(() => {
    if (!match || !currentId || selectedTeamId !== null) return;
    const onHome = match.homeTeam.players?.some((p) => p.id === currentId);
    setSelectedTeamId(onHome ? match.homeTeamId : match.awayTeamId);
  }, [match, currentId, selectedTeamId]);

  const players = useMemo(
    () => [...(activeTeam?.players ?? [])].filter((p) => !p.isCoach).sort((a, b) => a.number - b.number),
    [activeTeam?.players],
  );

  const idx = players.findIndex((p) => p.id === currentId);

  useEffect(() => {
    if (!autoAdvance) return;
    if (state?.mode !== "PLAYER_INTRO") return;
    if (players.length === 0) return;
    const id = setInterval(() => {
      const nextIdx = idx < 0 ? 0 : (idx + 1) % players.length;
      sendCommand({
        type: "display:setMode",
        mode: "PLAYER_INTRO",
        meta: { activePlayerId: players[nextIdx]!.id },
      });
    }, intervalSec * 1000);
    return () => clearInterval(id);
  }, [autoAdvance, intervalSec, players, idx, state?.mode]);

  if (!match) return null;

  function launch(team: "home" | "away") {
    const t = team === "home" ? match.homeTeam : match.awayTeam;
    setSelectedTeamId(t.id);
    const first = (t.players ?? []).filter((p) => !p.isCoach).sort((a, b) => a.number - b.number)[0];
    sendCommand({
      type: "display:setMode",
      mode: "PLAYER_INTRO",
      meta: { activePlayerId: first?.id ?? null },
    });
  }

  function pickPlayer(p: Player) {
    const teamId =
      p.teamId === match.homeTeamId ? match.homeTeamId : match.awayTeamId;
    setSelectedTeamId(teamId);
    sendCommand({
      type: "display:setMode",
      mode: "PLAYER_INTRO",
      meta: { activePlayerId: p.id },
    });
  }

  function step(dir: -1 | 1) {
    if (players.length === 0) return;
    const nextIdx = idx < 0 ? 0 : (idx + dir + players.length) % players.length;
    sendCommand({
      type: "display:setMode",
      mode: "PLAYER_INTRO",
      meta: { activePlayerId: players[nextIdx]!.id },
    });
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Spelerintro</h2>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Kies hier een team of een speler. Zonder keuze blijft het scherm het <strong className="text-foreground/90">scorebord</strong>{" "}
          tonen — <strong className="text-foreground/90">niet</strong> alleen de knop “Spelerintro” in Display mode gebruiken zonder speler.
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-2">
          <strong className="text-foreground/85">Custom visuals:</strong> zet per speler een{" "}
          <strong className="text-foreground/85">lineup-video</strong> (fullscreen) en/of{" "}
          <strong className="text-foreground/85">foto</strong> (grafisch sjabloon zonder video) onder{" "}
          <span className="text-foreground/90">Setup → team → speler bewerken</span>, of bulk onder{" "}
          <span className="text-foreground/90">Opstelling video’s…</span>.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" onClick={() => launch("home")}>
          Start: {match.homeTeam.shortName ?? match.homeTeam.name}
        </Button>
        <Button type="button" onClick={() => launch("away")}>
          Start: {match.awayTeam.shortName ?? match.awayTeam.name}
        </Button>
      </div>

      {state?.mode === "PLAYER_INTRO" && (
        <>
          <div className="flex flex-wrap gap-2 border border-border rounded-lg p-2 bg-muted/20">
            <Button
              type="button"
              size="sm"
              variant={selectedTeamId === match.homeTeamId ? "default" : "outline"}
              onClick={() => setSelectedTeamId(match.homeTeamId)}
            >
              {match.homeTeam.shortName ?? "Thuis"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={selectedTeamId === match.awayTeamId ? "default" : "outline"}
              onClick={() => setSelectedTeamId(match.awayTeamId)}
            >
              {match.awayTeam.shortName ?? "Uit"}
            </Button>
          </div>

          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Speler kiezen ({activeTeam?.shortName ?? activeTeam?.name ?? "—"})
          </div>
          <div className="grid grid-cols-1 gap-1.5 max-h-[220px] overflow-y-auto pr-1">
            {players.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pickPlayer(p)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  p.id === currentId
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border bg-background/80 hover:bg-muted/50"
                }`}
              >
                <span className="font-black tabular-nums w-8 text-muted-foreground">#{p.number}</span>
                <span className="truncate flex-1 min-w-0">
                  {p.firstName} {p.lastName}
                </span>
                <span className="flex shrink-0 gap-1">
                  {p.lineupVideoPath ? (
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-500/20 text-violet-200 border border-violet-500/35"
                      title="Eigen lineup-video (fullscreen)"
                    >
                      Video
                    </span>
                  ) : null}
                  {p.photoPath ? (
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-sky-500/20 text-sky-200 border border-sky-500/35"
                      title="Foto voor grafisch sjabloon (als er geen lineup-video is)"
                    >
                      Foto
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
            {players.length === 0 && (
              <div className="text-xs text-muted-foreground py-2">Geen spelers in dit team.</div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="text-sm tabular-nums">
              <span className="text-muted-foreground">{idx >= 0 ? idx + 1 : "—"}/</span>
              {players.length}
            </div>
            <div className="flex items-center gap-2 text-xs flex-wrap justify-end">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoAdvance}
                  onChange={(e) => setAutoAdvance(e.target.checked)}
                />
                Auto
              </label>
              <input
                type="number"
                value={intervalSec}
                min={1}
                max={30}
                onChange={(e) => setIntervalSec(Number(e.target.value))}
                className="w-14 h-7 rounded bg-background border border-border px-2 text-xs"
              />
              <span>s</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => step(-1)}>
              ← Vorige
            </Button>
            <Button type="button" variant="outline" onClick={() => step(1)}>
              Volgende →
            </Button>
          </div>
        </>
      )}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => sendCommand({ type: "display:setMode", mode: "TEAM_INTRO" })}
      >
        Teamintro tonen
      </Button>
    </div>
  );
}
