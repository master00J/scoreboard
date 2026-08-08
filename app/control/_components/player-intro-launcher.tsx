"use client";

import { useMemo, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDisplayStore } from "@/lib/store";
import { sendCommand } from "@/lib/use-socket";
import type { Match, Player, Team } from "@/lib/types";

export function PlayerIntroLauncher({ match }: { match: Match | null }) {
  const { t } = useTranslation();
  const state = useDisplayStore((s) => s.state);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [intervalSec, setIntervalSec] = useState(3);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [introOrders, setIntroOrders] = useState<Record<string, string[]>>({});

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

  useEffect(() => {
    if (!match) return;
    setIntroOrders((prev) => ({
      ...prev,
      [match.homeTeamId]: prev[match.homeTeamId] ?? defaultIntroOrder(match, match.homeTeam),
      [match.awayTeamId]: prev[match.awayTeamId] ?? defaultIntroOrder(match, match.awayTeam),
    }));
  }, [match]);

  const players = useMemo(
    () => playersFromOrder(activeTeam, introOrders[activeTeam?.id ?? ""]),
    [activeTeam, introOrders],
  );

  const idx = players.findIndex((p) => p.id === currentId);

  useEffect(() => {
    if (!autoAdvance) return;
    if (state?.mode !== "PLAYER_INTRO") return;
    if (players.length === 0) return;
    const id = setInterval(() => {
      const nextIdx = idx < 0 ? 0 : idx + 1;
      if (nextIdx >= players.length) {
        setAutoAdvance(false);
        sendCommand({ type: "display:setMode", mode: "MATCH" });
        return;
      }
      sendCommand({
        type: "display:setMode",
        mode: "PLAYER_INTRO",
        meta: { activePlayerId: players[nextIdx]!.id },
      });
    }, intervalSec * 1000);
    return () => clearInterval(id);
  }, [autoAdvance, intervalSec, players, idx, state?.mode]);

  if (!match) return null;
  const currentMatch = match;

  function launch(side: "home" | "away") {
    const selected = side === "home" ? currentMatch.homeTeam : currentMatch.awayTeam;
    setSelectedTeamId(selected.id);
    sendCommand({
      type: "display:setMode",
      mode: "PLAYER_INTRO",
      meta: { activePlayerId: null },
    });
  }

  function pickPlayer(p: Player) {
    const teamId =
      p.teamId === currentMatch.homeTeamId ? currentMatch.homeTeamId : currentMatch.awayTeamId;
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
        <h2 className="text-lg font-semibold">{t("playerIntro.title")}</h2>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {t("playerIntro.help", { title: t("playerIntro.title") })}
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-2">
          {t("playerIntro.customVisuals")}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" onClick={() => launch("home")}>
          {t("playerIntro.start")}: {currentMatch.homeTeam.shortName ?? currentMatch.homeTeam.name}
        </Button>
        <Button type="button" onClick={() => launch("away")}>
          {t("playerIntro.start")}: {currentMatch.awayTeam.shortName ?? currentMatch.awayTeam.name}
        </Button>
      </div>
      <Button type="button" variant="outline" onClick={() => setOrderDialogOpen(true)}>
        {t("playerIntro.prepareOrder")}
      </Button>

      {state?.mode === "PLAYER_INTRO" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border border-border rounded-lg p-2 bg-muted/20">
            <div className="text-[11px] text-muted-foreground leading-snug">
              {t("playerIntro.readyHint")}
            </div>
            <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={selectedTeamId === currentMatch.homeTeamId ? "default" : "outline"}
              onClick={() => setSelectedTeamId(currentMatch.homeTeamId)}
            >
              {currentMatch.homeTeam.shortName ?? t("common.home")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={selectedTeamId === currentMatch.awayTeamId ? "default" : "outline"}
              onClick={() => setSelectedTeamId(currentMatch.awayTeamId)}
            >
              {currentMatch.awayTeam.shortName ?? t("common.away")}
            </Button>
            </div>
          </div>

          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("playerIntro.liveOrder", {
              team: activeTeam?.shortName ?? activeTeam?.name ?? "—",
            })}
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{t("playerIntro.current")}</div>
                <div className="truncate text-sm font-semibold">
                  {idx >= 0 && players[idx]
                    ? `#${players[idx]!.number} ${players[idx]!.firstName} ${players[idx]!.lastName}`
                    : t("playerIntro.noPlayers")}
                </div>
              </div>
              <div className="min-w-0 text-right">
                <div className="text-xs text-muted-foreground">{t("playerIntro.next")}</div>
                <div className="truncate text-sm font-semibold text-primary">
                  {players[idx + 1] ?? (idx < 0 ? players[0] : null)
                    ? (() => {
                        const p = players[idx + 1] ?? players[0]!;
                        return `#${p.number} ${p.firstName} ${p.lastName}`;
                      })()
                    : t("playerIntro.endOfList")}
                </div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {players.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickPlayer(p)}
                  className={`rounded border px-2 py-1 text-[10px] ${
                    p.id === currentId
                      ? "border-primary bg-primary/20 text-foreground"
                      : i < idx
                        ? "border-border bg-background/40 text-muted-foreground"
                        : "border-border bg-background hover:bg-muted/50"
                  }`}
                >
                  {i + 1}. #{p.number}
                </button>
              ))}
            </div>
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
                {t("playerIntro.auto")}
              </label>
              <input
                type="number"
                value={intervalSec}
                min={1}
                max={30}
                onChange={(e) => setIntervalSec(Number(e.target.value))}
                className="w-14 h-7 rounded bg-background border border-border px-2 text-xs"
              />
              <span>{t("common.seconds")}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => step(-1)}>
              {t("playerIntro.prev")}
            </Button>
            <Button type="button" variant="outline" onClick={() => step(1)}>
              {t("playerIntro.nextBtn")}
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
        {t("playerIntro.showTeamIntro")}
      </Button>

      {orderDialogOpen && (
        <IntroOrderDialog
          match={currentMatch}
          orders={introOrders}
          setOrders={setIntroOrders}
          selectedTeamId={selectedTeamId}
          onSelectTeam={setSelectedTeamId}
          onClose={() => setOrderDialogOpen(false)}
        />
      )}
    </div>
  );
}

function IntroOrderDialog({
  match,
  orders,
  setOrders,
  selectedTeamId,
  onSelectTeam,
  onClose,
}: {
  match: Match;
  orders: Record<string, string[]>;
  setOrders: Dispatch<SetStateAction<Record<string, string[]>>>;
  selectedTeamId: string | null;
  onSelectTeam: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const team = selectedTeamId === match.awayTeamId ? match.awayTeam : match.homeTeam;
  const allPlayers = sortedPlayers(team);
  const selectedIds = orders[team.id] ?? defaultIntroOrder(match, team);
  const selectedPlayers = playersFromOrder(team, selectedIds);
  const selectedSet = new Set(selectedIds);
  const available = allPlayers.filter((p) => !selectedSet.has(p.id));
  const [draggingId, setDraggingId] = useState<string | null>(null);

  function setTeamOrder(ids: string[]) {
    const allowed = new Set(allPlayers.map((p) => p.id));
    const clean = ids.filter((id, i) => allowed.has(id) && ids.indexOf(id) === i);
    setOrders((prev) => ({ ...prev, [team.id]: clean }));
  }

  function move(id: string, dir: -1 | 1) {
    const idx = selectedIds.indexOf(id);
    const nextIdx = idx + dir;
    if (idx < 0 || nextIdx < 0 || nextIdx >= selectedIds.length) return;
    const next = [...selectedIds];
    [next[idx], next[nextIdx]] = [next[nextIdx]!, next[idx]!];
    setTeamOrder(next);
  }

  function moveToIndex(id: string, toIndex: number) {
    const fromIndex = selectedIds.indexOf(id);
    if (fromIndex < 0 || toIndex < 0 || toIndex >= selectedIds.length || fromIndex === toIndex) return;
    const next = [...selectedIds];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved!);
    setTeamOrder(next);
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{t("playerIntro.orderDialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("playerIntro.orderDialogDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 mb-4">
          {[match.homeTeam, match.awayTeam].map((teamOpt) => (
            <Button
              key={teamOpt.id}
              type="button"
              size="sm"
              variant={team.id === teamOpt.id ? "default" : "outline"}
              onClick={() => onSelectTeam(teamOpt.id)}
            >
              {teamOpt.shortName || teamOpt.name}
            </Button>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => setTeamOrder(defaultIntroOrder(match, team))}>
            {t("playerIntro.resetBase11")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setTeamOrder(allPlayers.slice(0, 11).map((p) => p.id))}>
            {t("playerIntro.first11ByNumber")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setTeamOrder([])}>
            {t("playerIntro.clearOrder")}
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
          <section className="rounded-lg border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">
                {t("playerIntro.chosenOrder", { count: selectedPlayers.length })}
              </div>
              <div className="text-[10px] text-muted-foreground">{t("playerIntro.dragHint")}</div>
            </div>
            <div className="flex flex-col gap-1.5">
              {selectedPlayers.map((p, i) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={(e) => {
                    setDraggingId(p.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", p.id);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain") || draggingId;
                    if (id) moveToIndex(id, i);
                    setDraggingId(null);
                  }}
                  className={`flex cursor-grab items-center gap-2 rounded border px-2 py-1.5 active:cursor-grabbing ${
                    draggingId === p.id
                      ? "border-primary bg-primary/15 opacity-70"
                      : "border-border bg-background"
                  }`}
                >
                  <span className="w-6 text-[10px] font-semibold text-muted-foreground">{i + 1}.</span>
                  <span className="w-8 text-[11px] font-black tabular-nums">#{p.number}</span>
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {p.firstName} {p.lastName}
                  </span>
                  <span className="text-[10px] text-muted-foreground">↕</span>
                  <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => move(p.id, -1)}>
                    ↑
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => move(p.id, 1)}>
                    ↓
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[10px]"
                    onClick={() => setTeamOrder(selectedIds.filter((id) => id !== p.id))}
                  >
                    ×
                  </Button>
                </div>
              ))}
              {selectedPlayers.length === 0 && (
                <div className="text-xs text-muted-foreground">{t("playerIntro.noneChosen")}</div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border p-3">
            <div className="mb-2 text-sm font-semibold">{t("playerIntro.availablePlayers")}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-1.5">
              {available.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="flex items-center gap-2 rounded border border-border bg-background px-2 py-1.5 text-left hover:bg-muted/50"
                  onClick={() => setTeamOrder([...selectedIds, p.id])}
                >
                  <span className="w-8 text-[11px] font-black tabular-nums text-muted-foreground">#{p.number}</span>
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {p.firstName} {p.lastName}
                  </span>
                  {(p.lineupVideoPath || p.photoPath) && (
                    <span className="text-[9px] text-primary">
                      {p.lineupVideoPath ? t("media.typeVideo") : t("media.typeImage")}
                    </span>
                  )}
                </button>
              ))}
              {available.length === 0 && (
                <div className="text-xs text-muted-foreground">{t("playerIntro.allInOrder")}</div>
              )}
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function sortedPlayers(team: Team | null | undefined): Player[] {
  return [...(team?.players ?? [])]
    .filter((p) => !p.isCoach)
    .sort((a, b) => a.number - b.number);
}

function defaultIntroOrder(match: Match, team: Team): string[] {
  const all = sortedPlayers(team);
  const existing =
    team.id === match.homeTeamId ? match.homeFieldPlayerIds : match.awayFieldPlayerIds;
  if (existing && existing.length > 0) {
    const valid = new Set(all.map((p) => p.id));
    const ordered = existing.filter((id) => valid.has(id));
    if (ordered.length > 0) return ordered.slice(0, 11);
  }
  return all.slice(0, 11).map((p) => p.id);
}

function playersFromOrder(team: Team | null | undefined, order: string[] | undefined): Player[] {
  const all = sortedPlayers(team);
  if (!order || order.length === 0) return [];
  const byId = new Map(all.map((p) => [p.id, p]));
  return order.map((id) => byId.get(id)).filter((p): p is Player => !!p);
}
