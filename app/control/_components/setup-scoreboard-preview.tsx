"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Match, Team } from "@/lib/types";
import type { ResolvedScoreboardTheme } from "@/lib/scoreboard-theme";
import { CustomScoreboardLayout } from "@/app/display/_modes/custom-scoreboard-layout";
import { LeftScoreboardLayout } from "@/app/display/_modes/left-scoreboard-layout";
import { MatchScoreboardFull } from "@/app/display/_modes/match-scoreboard-full";
import { StripScoreboardLayout } from "@/app/display/_modes/scoreboard-strip";

/** Logisch canvas van het stadionscherm; previews schalen hiervandaan naar kaartbreedte. */
const PREVIEW_CANVAS_W = 1920;
const PREVIEW_CANVAS_H = 1080;

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

function PreviewSixteenByNinePlate() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-zinc-800 via-zinc-900 to-black">
      <div className="rounded border border-white/25 px-[4%] py-[2%] text-[min(8cqw,42px)] font-black tracking-[0.28em] text-white/55">
        16:9
      </div>
      <div className="mt-[2%] text-[min(3.4cqw,22px)] uppercase tracking-[0.2em] text-white/35">Video</div>
    </div>
  );
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
  const { t } = useTranslation();
  const match = previewMatch(
    homeTeam ?? { ...FALLBACK_HOME, name: t("common.home"), shortName: t("common.home").slice(0, 3).toUpperCase() },
    awayTeam ?? { ...FALLBACK_AWAY, name: t("common.away"), shortName: t("common.away").slice(0, 3).toUpperCase() },
  );
  const period = t("sports.period.half1");
  const mode = theme.layoutMode;
  const video = <PreviewSixteenByNinePlate />;
  const board =
    mode === "custom" || mode === "auto" ? (
      <CustomScoreboardLayout
        match={match}
        elapsed={512}
        running
        period={period}
        addedTime={2}
        theme={theme}
      >
        {video}
      </CustomScoreboardLayout>
    ) : mode === "bottom-strip" ? (
      <StripScoreboardLayout
        match={match}
        elapsed={512}
        running
        period={period}
        addedTime={2}
        theme={theme}
      >
        {video}
      </StripScoreboardLayout>
    ) : mode === "left-l" ? (
      <LeftScoreboardLayout
        match={match}
        elapsed={512}
        running
        period={period}
        addedTime={2}
        theme={theme}
      >
        {video}
      </LeftScoreboardLayout>
    ) : (
      <MatchScoreboardFull
        match={match}
        elapsed={512}
        running
        period={period}
        addedTime={2}
        theme={theme}
      />
    );

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-black">
      <PreviewCanvas>{board}</PreviewCanvas>
    </div>
  );
}

/**
 * Schaalt het 1920×1080-scorebord naar de kaartbreedte.
 *
 * `scale()` verwacht een getal: `calc(100cqw / 1920)` is een lengte en wordt door de
 * browser genegeerd, waardoor het bord op ware grootte uit de kaart liep. Delen door
 * `1920px` levert wél een verhouding op. De ResizeObserver-fallback dekt engines zonder
 * container-query-units af, zodat de preview nooit ongeschaald blijft staan.
 */
function PreviewCanvas({ children }: { children: React.ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [measuredScale, setMeasuredScale] = useState<number | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const supportsCqw =
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("width", "1cqw");
    if (supportsCqw) {
      setMeasuredScale(null);
      return;
    }
    const update = () => {
      const width = el.getBoundingClientRect().width;
      setMeasuredScale(width > 0 ? width / PREVIEW_CANVAS_W : null);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      className="relative w-full overflow-hidden [container-type:inline-size]"
      style={{ aspectRatio: "16 / 9" }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: PREVIEW_CANVAS_W,
          height: PREVIEW_CANVAS_H,
          transform:
            measuredScale != null
              ? `scale(${measuredScale})`
              : `scale(calc(100cqw / ${PREVIEW_CANVAS_W}px))`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
