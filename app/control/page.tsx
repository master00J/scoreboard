"use client";

import { useEffect } from "react";
import { useSocketSync, sendCommand, onDisplayError } from "@/lib/use-socket";
import { useDisplayStore } from "@/lib/store";
import { useApi } from "@/lib/use-api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ToastViewport, toast } from "@/components/ui/toast";
import { TimerPanel } from "./_components/timer-panel";
import { MatchLivePanel } from "./_components/match-live-panel";
import { SetupPanel } from "./_components/setup-panel";
import { MediaPanel } from "./_components/media-panel";
import { DisplayControlPanel, EventLog } from "./_components/display-control-panel";
import { SponsorLiveOverview } from "./_components/sponsor-live-overview";
import { ExternalCapturePanel } from "./_components/external-capture-panel";
import { PlayerIntroLauncher } from "./_components/player-intro-launcher";
import { CrashRecoveryBanner } from "./_components/crash-recovery";
import { SponsorPhaseHud } from "./_components/sponsor-phase-hud";
import { UpdateNudgeBanner } from "./_components/update-nudge-banner";
import { LicenseActivationGate } from "./_components/license-activation-gate";
import type { Match } from "@/lib/types";
import type { MatchStatusT } from "@/lib/validation/commands";
import { isFullMatch } from "@/lib/is-full-match";
import { exportMatch, focusDisplayWindow } from "@/lib/electron";
import { Button } from "@/components/ui/button";
import { MatchTabGrid, LivePreviewPanel } from "./_components/match-tab-grid";

export default function ControlPage() {
  useSocketSync();
  const connected = useDisplayStore((s) => s.connected);
  const state = useDisplayStore((s) => s.state);
  const { data: match, reload: reloadMatch } = useApi<Match>(
    state?.matchId ? `/api/matches/${state.matchId}` : null,
  );

  useEffect(() => {
    reloadMatch();
  }, [state?.updatedAt, reloadMatch]);

  // Surface server error toasts
  useEffect(() => {
    const onErr = (p: { message: string }) => {
      toast({ title: "Command failed", description: p.message, variant: "error" });
    };
    return onDisplayError(onErr);
  }, []);

  return (
    <LicenseActivationGate>
      <main className="min-h-screen w-full max-w-none px-4 py-6 sm:px-6">
      <ToastViewport />

      <UpdateNudgeBanner />

      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Stadium Control</h1>
          <p className="text-sm text-muted-foreground">
            {!state?.matchId
              ? "No active match"
              : isFullMatch(match)
                ? `${match.homeTeam.name} vs ${match.awayTeam.name} · ${match.status}`
                : "Match wordt geladen…"}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 text-xs">
            <span
              className={`h-3 w-3 rounded-full ${
                connected ? "bg-green-500 animate-pulse-dot" : "bg-red-500"
              }`}
            />
            {connected ? "Connected" : "Disconnected"}
          </span>
          <span className="px-2 py-1 rounded bg-secondary text-xs font-mono">
            mode: {state?.mode ?? "…"}
          </span>
          <button
            type="button"
            onClick={() => void focusDisplayWindow()}
            className="text-xs underline text-muted-foreground"
          >
            Open /display
          </button>
        </div>
      </header>

      <CrashRecoveryBanner />

      <Tabs defaultValue="match">
        <TabsList>
          <TabsTrigger value="match">Match</TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="media">Media</TabsTrigger>
        </TabsList>

        <TabsContent value="match">
          <MatchTabGrid
            panels={{
              timer: <TimerPanel />,
              display: <DisplayControlPanel activeMatch={isFullMatch(match) ? match : null} />,
              "sponsor-hud": <SponsorPhaseHud match={isFullMatch(match) ? match : null} />,
              "sponsor-overview": <SponsorLiveOverview activeMatch={isFullMatch(match) ? match : null} />,
              ...(isFullMatch(match)
                ? ({ "player-intro": <PlayerIntroLauncher match={match} /> } as const)
                : {}),
              external: <ExternalCapturePanel />,
              preview: <LivePreviewPanel embedInControl />,
              "match-live": <MatchLivePanel />,
              "event-log": <EventLog match={isFullMatch(match) ? match : null} />,
              "match-info": <MatchInfoPanel match={isFullMatch(match) ? match : null} />,
            }}
          />
        </TabsContent>

        <TabsContent value="setup">
          <SetupPanel />
        </TabsContent>

        <TabsContent value="media">
          <MediaPanel />
        </TabsContent>
      </Tabs>
    </main>
    </LicenseActivationGate>
  );
}

function MatchInfoPanel({ match }: { match: Match | null }) {
  if (!match) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 text-sm text-muted-foreground">
        Activate a match on the <strong>Setup</strong> tab to begin.
      </div>
    );
  }
  const statuses: MatchStatusT[] = [
    "SETUP",
    "PREMATCH",
    "FIRST_HALF",
    "HALF_TIME",
    "SECOND_HALF",
    "EXTRA_TIME",
    "FULL_TIME",
    "POST_MATCH",
  ];
  return (
    <div className="bg-card border border-border rounded-xl p-6 flex flex-col gap-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        Match status
      </div>
      <div className="grid grid-cols-2 gap-1">
        {statuses.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={match.status === s ? "default" : "outline"}
            onClick={() => sendCommand({ type: "match:setStatus", status: s })}
          >
            {s.replace("_", " ")}
          </Button>
        ))}
      </div>
      <div className="text-xs text-muted-foreground pt-2 border-t border-border">
        Match ID: <span className="font-mono">{match.id.slice(0, 8)}</span>
        <br />
        Created: {new Date(match.createdAt).toLocaleString()}
      </div>
      <div className="flex gap-2 pt-2 border-t border-border">
        <button
          type="button"
          onClick={() => void exportMatch(match.id, "json")}
          className="inline-flex flex-1 items-center justify-center h-9 px-3 rounded-lg border border-input text-sm hover:bg-secondary"
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={() => void exportMatch(match.id, "html")}
          className="inline-flex flex-1 items-center justify-center h-9 px-3 rounded-lg border border-input text-sm hover:bg-secondary"
        >
          Printable HTML
        </button>
      </div>
    </div>
  );
}
