"use client";

import type { Match, Team } from "@/lib/types";
import type { ResolvedScoreboardTheme } from "@/lib/scoreboard-theme";
import { CustomScoreboardLayout } from "@/app/display/_modes/custom-scoreboard-layout";
import { LeftScoreboardLayout } from "@/app/display/_modes/left-scoreboard-layout";
import { MatchScoreboardFull } from "@/app/display/_modes/match-scoreboard-full";
import { StripScoreboardLayout } from "@/app/display/_modes/scoreboard-strip";

function previewTeam(partial: Team | null | undefined, fallback: Team): Team {
  if (!partial) return fallback;
  return partial;
}

const FALLBACK_HOME: Team = {
  id: "preview-home",
  name: "Thuis",
  shortName: "THU",
  logoPath: null,
  primaryColor: "#2563eb",
  secondaryColor: "#1e3a8a",
};

const FALLBACK_AWAY: Team = {
  id: "preview-away",
  name: "Uit",
  shortName: "UIT",
  logoPath: null,
  primaryColor: "#dc2626",
  secondaryColor: "#7f1d1d",
};

function previewMatch(home?: Team | null, away?: Team | null): Match {
  return {
    id: "preview",
    homeTeamId: "preview-home",
    awayTeamId: "preview-away",
    homeTeam: previewTeam(home, FALLBACK_HOME),
    awayTeam: previewTeam(away, FALLBACK_AWAY),
    kickoffAt: null,
    halfDurationSec: 2700,
    halfBreakSec: 900,
    sport: "FOOTBALL",
    currentPeriod: 1,
    periodDurationSec: 2700,
    homeTimeouts: 0,
    awayTimeouts: 0,
    homeFouls: 0,
    awayFouls: 0,
    homeSets: 0,
    awaySets: 0,
    status: "FIRST_HALF",
    homeScore: 1,
    awayScore: 0,
    createdAt: new Date().toISOString(),
  };
}

export function ScoreboardThemePreview({
  theme,
  homeTeam,
  awayTeam,
}: {
  theme: ResolvedScoreboardTheme;
  homeTeam?: Team | null;
  awayTeam?: Team | null;
}) {
  const match = previewMatch(homeTeam, awayTeam);
  const mode = theme.layoutMode;
  const board =
    mode === "custom" || mode === "auto" ? (
      <CustomScoreboardLayout
        match={match}
        elapsed={512}
        running
        period="1ST HALF"
        addedTime={2}
        theme={theme}
      >
        <div className="flex h-full items-center justify-center bg-white/5 text-2xl font-bold uppercase tracking-[0.3em] text-white/40">
          Sponsors
        </div>
      </CustomScoreboardLayout>
    ) : mode === "bottom-strip" ? (
      <StripScoreboardLayout
        match={match}
        elapsed={512}
        running
        period="1ST HALF"
        addedTime={2}
        theme={theme}
      />
    ) : mode === "left-l" ? (
      <LeftScoreboardLayout
        match={match}
        elapsed={512}
        running
        period="1ST HALF"
        addedTime={2}
        theme={theme}
      />
    ) : (
      <MatchScoreboardFull
        match={match}
        elapsed={512}
        running
        period="1ST HALF"
        addedTime={2}
        theme={theme}
      />
    );

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-black">
      <div
        className="relative w-full overflow-hidden [container-type:inline-size]"
        style={{ aspectRatio: "16 / 9" }}
      >
        <div
          className="absolute left-0 top-0"
          style={{
            width: 1920,
            height: 1080,
            transform: "scale(calc(100cqw / 1920))",
            transformOrigin: "top left",
          }}
        >
          {board}
        </div>
      </div>
    </div>
  );
}
