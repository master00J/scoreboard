"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Match, Sponsor } from "@/lib/types";
import { useWallClockMs } from "@/lib/use-wall-clock-tick";
import { useLiveTimerSeconds } from "@/lib/use-timer";
import { useDisplayStore } from "@/lib/store";
import { useApi } from "@/lib/use-api";
import {
  activeSponsorsForSection,
  sponsorBudgetSectionFromMatchStatus,
  sponsorSectionBudgetSeconds,
} from "@/lib/sponsor-distribution";
import { prematchRosterClockSec } from "@/lib/prematch-spread-timing";
import { effectiveMatchPlayRosterSeconds } from "@/lib/sponsor-roster-effective-timeline";

/**
 * Visual timeline/preview of sponsor rotation schedule across match phases.
 * Shows:
 * - Budget allocation per sponsor per phase
 * - Live progress/remaining time
 * - Current active sponsors
 * - Visual timeline spanning all phases
 */
export function SponsorTimelinePreview({
  match,
}: {
  match: Match | null;
}) {
  const displayStateUpdatedAt = useDisplayStore((s) => s.state?.updatedAt);
  const { data: sponsors = [] } = useApi<Sponsor[]>("/api/sponsors");
  // Reload sponsors when display state updates
  useEffect(() => {
    // This will trigger reload when display state changes
    displayStateUpdatedAt;
  }, [displayStateUpdatedAt]);

  if (!match || !sponsors || sponsors.length === 0) {
    return null;
  }

  const phases = [
    { key: "prematch", label: "Voorkant", status: ["SETUP", "PREMATCH"] },
    { key: "h1", label: "1e helft", status: ["FIRST_HALF"] },
    { key: "h2", label: "2e helft", status: ["SECOND_HALF", "EXTRA_TIME"] },
    { key: "halftime", label: "Rust", status: ["HALF_TIME"] },
  ];

  const currentPhase = useMemo(() => {
    return phases.find((p) => p.status.includes(match.status)) || phases[0];
  }, [match.status]);

  const timelineData = useMemo(() => {
    return phases.map((phase) => {
      const phaseSponsors = activeSponsorsForSection(
        sponsors,
        phase.key as any,
        match.status,
      );

      return {
        phase: phase.key,
        label: phase.label,
        sponsors: phaseSponsors.map((s) => {
          const budget =
            phase.key === "prematch"
              ? sponsorSectionBudgetSeconds(s, "prematch")
              : phase.key === "h1"
                ? sponsorSectionBudgetSeconds(s, "match", "FIRST_HALF")
                : phase.key === "h2"
                  ? sponsorSectionBudgetSeconds(s, "match", "SECOND_HALF")
                  : sponsorSectionBudgetSeconds(s, "halftime");

          return {
            id: s.id,
            name: s.name,
            active: s.active,
            budget,
            hasMedia: (s.media ?? []).some((m) => m.active),
          };
        }),
        totalBudget: phaseSponsors.reduce((sum, s) => {
          const budget =
            phase.key === "prematch"
              ? sponsorSectionBudgetSeconds(s, "prematch")
              : phase.key === "h1"
                ? sponsorSectionBudgetSeconds(s, "match", "FIRST_HALF")
                : phase.key === "h2"
                  ? sponsorSectionBudgetSeconds(s, "match", "SECOND_HALF")
                  : sponsorSectionBudgetSeconds(s, "halftime");
          return sum + budget;
        }, 0),
      };
    });
  }, [sponsors, match.status]);

  const activeSponsorNames = useMemo(() => {
    const section = sponsorBudgetSectionFromMatchStatus(match.status);
    const active = activeSponsorsForSection(sponsors, section, match.status);
    return active.map((s) => s.name);
  }, [sponsors, match.status]);

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Sponsor Timeline
        </h3>
        <div className="text-xs text-muted-foreground">
          <div className="mb-2">
            Fase:{" "}
            <span className="text-foreground font-medium">{currentPhase.label}</span>
          </div>
          <div>
            Actief nu:{" "}
            {activeSponsorNames.length > 0 ? (
              <span className="text-foreground font-medium">{activeSponsorNames.join(", ")}</span>
            ) : (
              <span className="text-muted-foreground italic">geen</span>
            )}
          </div>
        </div>
      </div>

      {/* Timeline visualization */}
      <div className="space-y-4">
        {timelineData.map((phaseData) => (
          <div
            key={phaseData.phase}
            className={`rounded-lg border p-3 ${
              currentPhase.key === phaseData.phase
                ? "border-primary/50 bg-primary/5"
                : "border-border/50 bg-muted/20"
            }`}
          >
            {/* Phase header */}
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-foreground">{phaseData.label}</h4>
              {phaseData.totalBudget > 0 && (
                <span className="text-xs font-mono bg-secondary/50 px-2 py-1 rounded">
                  {Math.floor(phaseData.totalBudget / 60)}m {phaseData.totalBudget % 60}s
                </span>
              )}
            </div>

            {/* Sponsors in this phase */}
            {phaseData.sponsors.length === 0 ? (
              <div className="text-[10px] text-muted-foreground italic py-2">
                Geen sponsors met budget in deze fase
              </div>
            ) : (
              <div className="space-y-2">
                {phaseData.sponsors.map((sponsor) => {
                  const widthPercent =
                    phaseData.totalBudget > 0
                      ? (sponsor.budget / phaseData.totalBudget) * 100
                      : 0;

                  return (
                    <div key={sponsor.id} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-xs truncate max-w-[120px] ${
                            sponsor.active
                              ? "font-medium text-foreground"
                              : "text-muted-foreground opacity-60"
                          }`}
                          title={sponsor.name}
                        >
                          {sponsor.name}
                        </span>
                        <span className="text-xs font-mono text-muted-foreground">
                          {Math.floor(sponsor.budget / 60)}m {sponsor.budget % 60}s
                        </span>
                      </div>

                      {/* Budget bar */}
                      <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            sponsor.hasMedia
                              ? sponsor.active
                                ? "bg-emerald-500"
                                : "bg-amber-500/70"
                              : "bg-gray-500/50"
                          }`}
                          style={{ width: `${widthPercent}%` }}
                        />
                      </div>

                      {/* Media status indicator */}
                      {!sponsor.hasMedia && (
                        <div className="text-[10px] text-red-500/80">
                          ⚠ Geen actieve media gekoppeld
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-3 border-t border-border/50 text-[10px] text-muted-foreground space-y-1">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-emerald-500" />
          <span>Sponsor actief in huidge fase</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-amber-500/70" />
          <span>Sponsor inactief</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-gray-500/50" />
          <span>Geen media gekoppeld</span>
        </div>
      </div>
    </div>
  );
}
