"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSocketSync, sendCommand, onDisplayError } from "@/lib/use-socket";
import { useDisplayStore } from "@/lib/store";
import { useApi } from "@/lib/use-api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ToastViewport, toast } from "@/components/ui/toast";
import { TimerPanel } from "./_components/timer-panel";
import { GoalScorerOverlay, MatchLivePanel } from "./_components/match-live-panel";
import { SetupPanel, MatchDialog } from "./_components/setup-panel";
import { MediaPanel } from "./_components/media-panel";
import { ProofOfPlayPanel } from "./_components/proof-of-play-panel";
import { DisplayControlPanel, EventLog } from "./_components/display-control-panel";
import { SponsorLiveOverview } from "./_components/sponsor-live-overview";
import { SponsorTimelinePreview } from "./_components/sponsor-timeline-preview";
import { ExternalCapturePanel } from "./_components/external-capture-panel";
import { LivestreamStudio } from "./_components/livestream-studio";
import { PlayerIntroLauncher } from "./_components/player-intro-launcher";
import { CrashRecoveryBanner } from "./_components/crash-recovery";
import { SponsorPhaseHud } from "./_components/sponsor-phase-hud";
import { UpdateNudgeBanner } from "./_components/update-nudge-banner";
import { LicenseActivationGate } from "./_components/license-activation-gate";
import type { AppSettings, Match, Team } from "@/lib/types";
import type { MobileBridgeInfo } from "@/lib/desktop-bridge";
import { isFullMatch } from "@/lib/is-full-match";
import { exportMatch, focusDisplayWindow } from "@/lib/electron";
import { Button } from "@/components/ui/button";
import { MatchTabGrid, LivePreviewPanel } from "./_components/match-tab-grid";
import { AppResourceMeter } from "./_components/app-resource-meter";
import { MobileBridgeMenu } from "./_components/mobile-bridge-menu";
import { useLicenseFeatures } from "@/lib/use-license-features";
import { tMatchStatus } from "@/lib/i18n/t-phase";

export default function ControlPage() {
  const { t } = useTranslation();
  useSocketSync();
  const connected = useDisplayStore((s) => s.connected);
  const state = useDisplayStore((s) => s.state);
  const { isFeatureAllowed } = useLicenseFeatures();
  const [mobileBridge, setMobileBridge] = useState<MobileBridgeInfo | null>(null);
  const [activeTab, setActiveTab] = useState("match");
  const [newMatchOpen, setNewMatchOpen] = useState(false);
  const { data: match, reload: reloadMatch } = useApi<Match>(
    state?.matchId ? `/api/matches/${state.matchId}` : null,
  );
  const { data: teams } = useApi<Team[]>("/api/teams");
  const { data: settings } = useApi<AppSettings>("/api/settings");
  const homeTeam = (teams ?? []).find((team) => team.id === settings?.homeTeamId) ?? null;

  useEffect(() => {
    reloadMatch();
  }, [state?.updatedAt, reloadMatch]);

  useEffect(() => {
    let cancelled = false;
    async function loadMobileBridge() {
      const info = await window.electronAPI?.getMobileBridgeInfo();
      if (!cancelled && info) setMobileBridge(info);
    }
    void loadMobileBridge();
    const id = window.setInterval(() => void loadMobileBridge(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Surface server error toasts
  useEffect(() => {
    const onErr = (p: { message: string }) => {
      toast({ title: t("shell.commandFailed"), description: p.message, variant: "error" });
    };
    return onDisplayError(onErr);
  }, [t]);

  return (
    <LicenseActivationGate>
      <main
        data-control-shell
        className="flex h-dvh w-full max-w-none flex-col overflow-hidden px-3 py-2.5 sm:px-4"
      >
      <ToastViewport />

      <UpdateNudgeBanner />

      <header className="mb-2 flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">{t("shell.title")}</h1>
          <p className="truncate text-sm text-muted-foreground">
            {!state?.matchId
              ? t("shell.noActiveMatch")
              : isFullMatch(match)
                ? `${match.homeTeam.name} vs ${match.awayTeam.name} · ${tMatchStatus(t, match.status)}`
                : t("shell.matchLoading")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
          <AppResourceMeter />
          <MobileBridgeMenu info={mobileBridge} />
          <span className="flex items-center gap-2 text-xs">
            <span
              className={`h-3 w-3 rounded-full ${
                connected ? "bg-green-500 animate-pulse-dot" : "bg-red-500"
              }`}
            />
            {connected ? t("common.connected") : t("common.disconnected")}
          </span>
          <span className="px-2 py-1 rounded bg-secondary text-xs font-mono">
            {t("shell.mode")}: {state?.mode ?? "…"}
          </span>
          <button
            type="button"
            onClick={() => void focusDisplayWindow()}
            className="text-xs underline text-muted-foreground"
          >
            {t("shell.openDisplay")}
          </button>
        </div>
      </header>

      <div className="shrink-0">
        <CrashRecoveryBanner />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <TabsList>
            <TabsTrigger value="match">{t("shell.tabMatch")}</TabsTrigger>
            <TabsTrigger value="setup">{t("shell.tabSetup")}</TabsTrigger>
            <TabsTrigger value="media">{t("shell.tabMedia")}</TabsTrigger>
            <TabsTrigger value="reports">{t("shell.tabReports")}</TabsTrigger>
            <TabsTrigger value="livestream">{t("shell.tabLivestream")}</TabsTrigger>
          </TabsList>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-10 border-primary/40 bg-primary/10 text-foreground hover:bg-primary/20"
            onClick={() => setNewMatchOpen(true)}
          >
            {t("shell.startNewMatch")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-10 border-destructive/40 text-foreground hover:bg-destructive/15"
            disabled={!state?.matchId || !isFullMatch(match) || !!match.closedAt}
            onClick={() => {
              if (!isFullMatch(match) || match.closedAt) {
                toast({ title: t("shell.stopMatchNone"), variant: "error" });
                return;
              }
              if (
                !confirm(
                  t("shell.stopMatchConfirm", {
                    home: match.homeTeam.name,
                    away: match.awayTeam.name,
                  }),
                )
              ) {
                return;
              }
              void (async () => {
                const res = await fetch(`/api/matches/${match.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ closedAt: new Date().toISOString() }),
                });
                if (!res.ok) {
                  toast({
                    title: t("shell.stopMatchFailed"),
                    description: await res.text(),
                    variant: "error",
                  });
                  return;
                }
                await reloadMatch();
                toast({ title: t("shell.stopMatchDone"), variant: "success" });
              })();
            }}
          >
            {t("shell.stopMatch")}
          </Button>
        </div>

        <TabsContent value="match" forceMount className="min-h-0 overflow-hidden">
          <MatchTabGrid
            panels={{
              timer: <TimerPanel />,
              display: <DisplayControlPanel activeMatch={isFullMatch(match) ? match : null} />,
              "sponsor-hud": <SponsorPhaseHud match={isFullMatch(match) ? match : null} />,
              "sponsor-overview": <SponsorLiveOverview activeMatch={isFullMatch(match) ? match : null} />,
              "sponsor-timeline": <SponsorTimelinePreview match={isFullMatch(match) ? match : null} />,
              ...(isFullMatch(match)
                ? ({ "player-intro": <PlayerIntroLauncher match={match} /> } as const)
                : {}),
              external: <ExternalCapturePanel />,
              preview: <LivePreviewPanel embedInControl active={activeTab === "match"} />,
              "match-live": <MatchLivePanel />,
              "event-log": <EventLog match={isFullMatch(match) ? match : null} />,
              "match-info": <MatchInfoCard match={isFullMatch(match) ? match : null} />,
            }}
          />
        </TabsContent>

        <TabsContent value="setup" forceMount className="min-h-0 overflow-y-auto">
          <SetupPanel />
        </TabsContent>

        <TabsContent value="media" forceMount className="min-h-0 overflow-y-auto">
          <MediaPanel />
        </TabsContent>

        <TabsContent value="reports" className="min-h-0 overflow-y-auto">
          <ProofOfPlayPanel />
        </TabsContent>

        <TabsContent value="livestream" forceMount className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <LivestreamStudio active={activeTab === "livestream"} />
        </TabsContent>
      </Tabs>

      <GoalScorerOverlay match={isFullMatch(match) ? match : null} />

      {newMatchOpen && teams && (
        <MatchDialog
          quickStart
          teams={teams}
          homeTeam={homeTeam}
          onClose={() => setNewMatchOpen(false)}
          onSaved={(created, start) => {
            void (async () => {
              setNewMatchOpen(false);
              if (!created?.id) return;
              if (!start?.activate) {
                setActiveTab("setup");
                toast({ title: t("shell.newMatchCreatedOnly"), variant: "success" });
                return;
              }
              const sponsorsOk =
                !!start.sponsorRotation && isFeatureAllowed("automatic_sponsor_rotation");
              await sendCommand({ type: "match:setActive", matchId: created.id });
              await sendCommand({ type: "match:setStatus", status: "PREMATCH" });
              await sendCommand({
                type: "display:setMode",
                mode: sponsorsOk ? "SPONSOR_ROTATION" : "MATCH",
              });
              setActiveTab("match");
              toast({
                title: sponsorsOk
                  ? t("shell.newMatchStartedWithSponsors")
                  : t("shell.newMatchStarted"),
                variant: "success",
              });
            })();
          }}
        />
      )}
    </main>
    </LicenseActivationGate>
  );
}

function MatchInfoCard({ match }: { match: Match | null }) {
  const { t } = useTranslation();
  if (!match) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        {t("shell.activateMatchHint")}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        {t("shell.matchInfoTitle")}
      </div>
      <p className="text-sm text-foreground">
        {match.homeTeam.name} vs {match.awayTeam.name}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("shell.matchInfoPhaseHint")}{" "}
        <span className="font-mono text-foreground">{tMatchStatus(t, match.status)}</span>
      </p>
      <div className="border-t border-border pt-2 text-xs text-muted-foreground">
        Match ID: <span className="font-mono">{match.id.slice(0, 8)}</span>
        <br />
        Created: {new Date(match.createdAt).toLocaleString()}
      </div>
      <div className="flex gap-2 border-t border-border pt-2">
        <button
          type="button"
          onClick={() => void exportMatch(match.id, "json")}
          className="inline-flex h-9 flex-1 items-center justify-center rounded-lg border border-input px-3 text-sm hover:bg-secondary"
        >
          {t("shell.exportJson")}
        </button>
        <button
          type="button"
          onClick={() => void exportMatch(match.id, "html")}
          className="inline-flex h-9 flex-1 items-center justify-center rounded-lg border border-input px-3 text-sm hover:bg-secondary"
        >
          {t("shell.exportHtml")}
        </button>
      </div>
    </div>
  );
}
