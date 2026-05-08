"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDisplayStore } from "@/lib/store";
import { sendCommand } from "@/lib/use-socket";
import { useApi } from "@/lib/use-api";
import { isElectron } from "@/lib/electron";
import type { Match, MatchEvent, Player, MediaItem } from "@/lib/types";
import type { MatchStatusT } from "@/lib/validation/commands";
import { isLivePlayingMatchStatus } from "@/lib/live-cycle-settings";

const PHASES: { status: MatchStatusT; label: string; hint?: string }[] = [
  { status: "PREMATCH", label: "Voor wedstrijd", hint: "SETUP of PREMATCH" },
  { status: "FIRST_HALF", label: "1e helft" },
  { status: "HALF_TIME", label: "Rust" },
  { status: "SECOND_HALF", label: "2e helft" },
  { status: "EXTRA_TIME", label: "Verlenging" },
  { status: "FULL_TIME", label: "Einde", hint: "na afloop evt. POST via status rechts" },
];

function phaseButtonActive(phaseStatus: MatchStatusT, current?: string): boolean {
  if (!current) return false;
  if (phaseStatus === "PREMATCH") {
    return current === "SETUP" || current === "PREMATCH";
  }
  if (phaseStatus === "FULL_TIME") {
    return current === "FULL_TIME" || current === "POST_MATCH";
  }
  return current === phaseStatus;
}

export function DisplayControlPanel({ activeMatch }: { activeMatch: Match | null }) {
  const state = useDisplayStore((s) => s.state);
  const tick = useDisplayStore((s) => s.tick);
  const mode = state?.mode ?? "IDLE";
  const safeMode = state?.safeMode ?? false;
  const livePlay = isLivePlayingMatchStatus(activeMatch?.status);

  // Heartbeat: detecteer of het display al lang geen tick meer stuurt terwijl
  // de timer wél zou moeten lopen. In dat geval is het waarschijnlijk vastgelopen.
  const [now, setNow] = useState(() => Date.now());
  const [lastTickAt, setLastTickAt] = useState<number>(0);
  useEffect(() => {
    if (tick) setLastTickAt(Date.now());
  }, [tick]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(id);
  }, []);
  const heartbeatStaleMs =
    state?.timerRunning && lastTickAt > 0 ? now - lastTickAt : 0;
  const displayLikelyStuck = heartbeatStaleMs > 8000;

  const reloadDisplay = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.reloadDisplayWindow) return;
    await window.electronAPI.reloadDisplayWindow();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.shiftKey)) return;
      if (e.key !== "S" && e.key !== "s") return;
      if (isEditable(e.target)) return;
      e.preventDefault();
      void sendCommand({ type: "display:setSafeMode", enabled: !safeMode });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [safeMode]);
  const { data: mediaRaw } = useApi<MediaItem[]>("/api/media");
  const mediaList = useMemo(
    () =>
      (mediaRaw ?? [])
        .filter((m) => m.active && !m.hideFromLibrary)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [mediaRaw],
  );
  const [mediaPickId, setMediaPickId] = useState("");
  const [mediaSearch, setMediaSearch] = useState("");

  const filteredMediaList = useMemo(() => {
    const q = mediaSearch.trim().toLowerCase();
    if (!q) return mediaList;
    return mediaList.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        (m.type === "VIDEO" ? "video" : "beeld").includes(q) ||
        String(m.durationSec).includes(q),
    );
  }, [mediaList, mediaSearch]);

  const applyPhase = useCallback(async (status: MatchStatusT) => {
    await sendCommand({ type: "match:setStatus", status });
    await sendCommand({ type: "display:setMode", mode: "MATCH" });
  }, []);

  async function playMediaOnce() {
    if (!mediaPickId) return;
    await sendCommand({
      type: "display:setMode",
      mode: "SPONSOR",
      meta: { activeMediaId: mediaPickId },
    });
  }

  async function backToLiveProgram() {
    await sendCommand({ type: "display:setMode", mode: "SPONSOR_ROTATION" });
  }

  const primaryLive = mode === "SPONSOR_ROTATION";
  const onlyBoard = mode === "MATCH";
  const oneOffMedia = mode === "SPONSOR" && !!state?.activeMediaId;

  return (
    <div className="bg-card border border-border rounded-xl p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          Scherm &amp; fase
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse-dot" />
          <span className="font-mono text-[10px] sm:text-xs bg-secondary px-2 py-1 rounded max-w-[140px] truncate">
            {mode}
          </span>
        </div>
      </div>

      {safeMode && (
        <div className="rounded-md border border-red-500/60 bg-red-500/10 p-3 text-xs leading-snug">
          <p className="font-bold uppercase tracking-widest text-red-600 dark:text-red-400">
            Veilige modus actief
          </p>
          <p className="mt-1 text-foreground/90">
            Het scherm toont enkel het scorebord. Geen sponsors, geen overlays, geen externe capture.
            Druk <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">Ctrl+Shift+S</kbd> of de knop hieronder om uit te schakelen.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-full border-red-500/60 hover:bg-red-500/20"
            onClick={() => void sendCommand({ type: "display:setSafeMode", enabled: false })}
          >
            Veilige modus uitschakelen
          </Button>
        </div>
      )}

      {!safeMode && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="text-[11px] h-8 border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300"
            title="Forceert pure scoreboard. Sneltoets: Ctrl+Shift+S"
            onClick={() => void sendCommand({ type: "display:setSafeMode", enabled: true })}
          >
            Noodknop: veilige modus (Ctrl+Shift+S)
          </Button>
          {isElectron && (
            <Button
              size="sm"
              variant="outline"
              className="text-[11px] h-8"
              title="Herstart enkel het display-venster (handig als het scherm vastgelopen lijkt)"
              onClick={() => void reloadDisplay()}
            >
              Display herstarten
            </Button>
          )}
        </div>
      )}

      {displayLikelyStuck && !safeMode && (
        <div className="rounded-md border border-amber-500/60 bg-amber-500/10 p-3 text-xs leading-snug">
          <p className="font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
            Display lijkt vastgelopen
          </p>
          <p className="mt-1 text-foreground/90">
            Het scherm stuurt al {Math.round(heartbeatStaleMs / 1000)}s geen update meer terwijl
            de timer loopt. Activeer de noodknop of herstart het display-venster.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-amber-500/60"
              onClick={() => void sendCommand({ type: "display:setSafeMode", enabled: true })}
            >
              Veilige modus aan
            </Button>
            {isElectron && (
              <Button
                size="sm"
                variant="outline"
                className="border-amber-500/60"
                onClick={() => void reloadDisplay()}
              >
                Display herstarten
              </Button>
            )}
          </div>
        </div>
      )}

      <section className="space-y-2">
        <div className="text-xs font-medium text-foreground/90">Wedstrijdfase</div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          Zet de fase van de wedstrijd; het scherm blijft op <strong>alleen scorebord</strong>.
          Start sponsors daarna manueel met <strong>Scorebord + sponsors</strong>. Geen actieve wedstrijd? Activeer eerst een match.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PHASES.map((p) => (
            <Button
              key={p.status}
              size="sm"
              variant={phaseButtonActive(p.status, activeMatch?.status) ? "default" : "outline"}
              disabled={!activeMatch}
              className="h-auto min-h-10 py-2 whitespace-normal text-center leading-tight"
              title={p.hint}
              onClick={() => void applyPhase(p.status)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {!activeMatch && (
          <p className="text-[11px] text-amber-600/90 dark:text-amber-400/90">
            Geen actieve wedstrijd — faseknoppen zijn uitgeschakeld.
          </p>
        )}
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <div className="text-xs font-medium text-foreground/90">Scorebord vs. sponsorronde</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button
            size="lg"
            variant={primaryLive ? "default" : "outline"}
            className="h-auto min-h-[3rem] py-3 whitespace-normal text-center leading-snug"
            onClick={() => void sendCommand({ type: "display:setMode", mode: "SPONSOR_ROTATION" })}
          >
            Scorebord + sponsors
            {livePlay && (
              <span className="block text-[10px] font-normal opacity-80 mt-1">
                sponsors volgens Media → Sponsors
              </span>
            )}
          </Button>
          <Button
            size="lg"
            variant={onlyBoard ? "default" : "outline"}
            className="h-auto min-h-[3rem] py-3 whitespace-normal text-center leading-snug"
            onClick={() => void sendCommand({ type: "display:setMode", mode: "MATCH" })}
          >
            Alleen scorebord
            <span className="block text-[10px] font-normal opacity-80 mt-1">
              geen sponsorclips naast het scorebord
            </span>
          </Button>
        </div>
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <div className="text-xs font-medium text-foreground/90">Eenmalig media (fullscreen)</div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          Kies een bestand uit je mediabibliotheek en toon het één keer volledig. Daarna terug naar het normale
          wedstrijdscherm. (Meer beheer: tab <strong>Media</strong>.)
        </p>
        <div className="space-y-2">
          <Input
            type="search"
            placeholder="Zoek op titel, type of duur…"
            value={mediaSearch}
            onChange={(e) => setMediaSearch(e.target.value)}
            className="h-10"
            aria-label="Zoek in mediabibliotheek"
          />
          <div className="max-h-44 overflow-y-auto rounded-md border border-input bg-background">
            {filteredMediaList.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                {mediaList.length === 0
                  ? "Nog geen media — voeg bestanden toe via tab Media."
                  : "Geen resultaten voor deze zoekterm."}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {filteredMediaList.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className={`w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-secondary/80 ${
                        mediaPickId === m.id ? "bg-secondary font-medium" : ""
                      }`}
                      onClick={() => setMediaPickId(m.id)}
                    >
                      <span className="text-muted-foreground text-xs mr-2">
                        {m.type === "VIDEO" ? "Video" : "Beeld"}
                      </span>
                      <span className="break-words">{m.title}</span>
                      <span className="text-muted-foreground text-xs ml-1">· {m.durationSec}s</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {mediaPickId && (
            <p className="text-[11px] text-muted-foreground">
              Geselecteerd:{" "}
              <strong className="text-foreground">
                {mediaList.find((m) => m.id === mediaPickId)?.title ?? "—"}
              </strong>
              <button
                type="button"
                className="ml-2 underline text-foreground/80 hover:text-foreground"
                onClick={() => setMediaPickId("")}
              >
                wissen
              </button>
            </p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            type="button"
            className="sm:flex-1"
            disabled={!mediaPickId}
            variant={oneOffMedia ? "default" : "secondary"}
            onClick={() => void playMediaOnce()}
          >
            Toon op scherm
          </Button>
          <Button type="button" variant="outline" className="sm:flex-1" onClick={() => void backToLiveProgram()}>
            Terug: scorebord + sponsors
          </Button>
        </div>
      </section>

      <Button
        size="lg"
        variant="destructive"
        className="font-black tracking-wider"
        onClick={() => void sendCommand({ type: "display:blackout" })}
      >
        BLACKOUT
      </Button>
    </div>
  );
}

export function EventLog({ match }: { match: Match | null }) {
  const { data: fresh, reload } = useApi<Match>(match ? `/api/matches/${match.id}` : null);
  const state = useDisplayStore((s) => s.state);

  useEffect(() => {
    reload();
  }, [state?.updatedAt, reload]);

  const events = fresh?.events ?? [];
  const playerMap: Record<string, Player> = {};
  for (const p of fresh?.homeTeam.players ?? []) playerMap[p.id] = p;
  for (const p of fresh?.awayTeam.players ?? []) playerMap[p.id] = p;

  return (
    <div className="bg-card border border-border rounded-xl p-6 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Event log</h2>
      <div className="flex flex-col gap-1 max-h-80 overflow-auto">
        {events.length === 0 && (
          <div className="text-sm text-muted-foreground">No events yet.</div>
        )}
        {events.map((e) => (
          <EventRow
            key={e.id}
            event={e}
            playerMap={playerMap}
            onUndo={async () => {
              await sendCommand({ type: "event:undo", eventId: e.id });
              reload();
            }}
          />
        ))}
      </div>
    </div>
  );
}

function EventRow({
  event,
  playerMap,
  onUndo,
}: {
  event: MatchEvent;
  playerMap: Record<string, Player>;
  onUndo: () => void;
}) {
  const p = event.playerInId ? playerMap[event.playerInId] : null;
  const out = event.playerOutId ? playerMap[event.playerOutId] : null;

  const icon =
    event.type === "GOAL"
      ? "⚽"
      : event.type === "SUB"
        ? "🔁"
        : event.type === "CARD_YELLOW"
          ? "🟨"
          : event.type === "CARD_RED"
            ? "🟥"
            : event.type === "TIMER_ADJUST"
              ? "⏱"
              : "·";

  return (
    <div className="flex items-center gap-3 rounded border border-border p-2 text-sm">
      <span className="text-xs text-muted-foreground w-10 text-right">
        {event.minute}'
      </span>
      <span className="text-lg">{icon}</span>
      <span className="flex-1 truncate">
        {event.type === "GOAL" && p && `Goal — ${p.firstName} ${p.lastName} (#${p.number})`}
        {event.type === "SUB" && (
          <>
            Sub: {out ? `${out.lastName}` : "?"} → {p ? `${p.lastName}` : "?"}
          </>
        )}
        {event.type === "CARD_YELLOW" && p && `Yellow — ${p.lastName}`}
        {event.type === "CARD_RED" && p && `Red — ${p.lastName}`}
        {event.type === "TIMER_ADJUST" && <span className="text-muted-foreground">{event.note}</span>}
      </span>
      <Button size="sm" variant="ghost" onClick={onUndo}>
        Undo
      </Button>
    </div>
  );
}

export function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}
