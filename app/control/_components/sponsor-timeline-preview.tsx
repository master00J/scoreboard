"use client";

import { useEffect, useMemo } from "react";
import type { Match, Sponsor, SponsorSection } from "@/lib/types";
import { useDisplayStore } from "@/lib/store";
import { useApi } from "@/lib/use-api";
import {
  activeSponsorsForSection,
  sponsorBudgetSectionFromMatchStatus,
  sponsorSectionBudgetSeconds,
} from "@/lib/sponsor-distribution";

type PhaseKey = "prematch" | "h1" | "h2" | "halftime";

const PHASES: Array<{ key: PhaseKey; label: string; status: string[] }> = [
  { key: "prematch", label: "Voorkant", status: ["SETUP", "PREMATCH"] },
  { key: "h1", label: "1e helft", status: ["FIRST_HALF"] },
  { key: "h2", label: "2e helft", status: ["SECOND_HALF", "EXTRA_TIME"] },
  { key: "halftime", label: "Rust", status: ["HALF_TIME"] },
];

function sectionForPhase(phase: PhaseKey): SponsorSection {
  if (phase === "prematch") return "prematch";
  if (phase === "halftime") return "halftime";
  return "match";
}

function budgetForPhase(sponsor: Sponsor, phase: PhaseKey): number {
  const section = sectionForPhase(phase);
  if (section === "match") {
    const status = phase === "h1" ? "FIRST_HALF" : "SECOND_HALF";
    return sponsorSectionBudgetSeconds(sponsor, section, status);
  }
  return sponsorSectionBudgetSeconds(sponsor, section);
}

/**
 * Visual timeline/preview of sponsor rotation schedule across match phases.
 */
export function SponsorTimelinePreview({
  match,
}: {
  match: Match | null;
}) {
  const displayStateUpdatedAt = useDisplayStore((s) => s.state?.updatedAt);
  const { data: sponsors = [] } = useApi<Sponsor[]>("/api/sponsors");

  useEffect(() => {
    displayStateUpdatedAt;
  }, [displayStateUpdatedAt]);

  const matchStatus = match?.status;

  const currentPhase = useMemo(() => {
    if (!matchStatus) return PHASES[0];
    return PHASES.find((p) => p.status.includes(matchStatus)) || PHASES[0];
  }, [matchStatus]);

  const timelineData = useMemo(() => {
    if (!matchStatus || !sponsors || sponsors.length === 0) return [];
    return PHASES.map((phase) => {
      const section = sectionForPhase(phase.key);
      const phaseSponsors = activeSponsorsForSection(sponsors, section, matchStatus);

      return {
        phase: phase.key,
        label: phase.label,
        sponsors: phaseSponsors.map((s) => ({
          id: s.id,
          name: s.name,
          active: s.active,
          budget: budgetForPhase(s, phase.key),
          hasMedia: (s.media ?? []).some((m) => m.active),
        })),
        totalBudget: phaseSponsors.reduce(
          (sum, s) => sum + budgetForPhase(s, phase.key),
          0,
        ),
      };
    });
  }, [sponsors, matchStatus]);

  const activeSponsorNames = useMemo(() => {
    if (!matchStatus || !sponsors || sponsors.length === 0) return [];
    const section = sponsorBudgetSectionFromMatchStatus(matchStatus);
    const active = activeSponsorsForSection(sponsors, section, matchStatus);
    return active.map((s) => s.name);
  }, [sponsors, matchStatus]);

  if (!match || sponsors.length === 0) {
    return null;
  }

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
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-foreground">{phaseData.label}</h4>
              {phaseData.totalBudget > 0 && (
                <span className="text-xs font-mono bg-secondary/50 px-2 py-1 rounded">
                  {Math.floor(phaseData.totalBudget / 60)}m {phaseData.totalBudget % 60}s
                </span>
              )}
            </div>

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

                      {!sponsor.hasMedia && (
                        <div className="text-[10px] text-red-500/80">
                          Geen actieve media gekoppeld
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

      <div className="mt-4 pt-3 border-t border-border/50 text-[10px] text-muted-foreground space-y-1">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-emerald-500" />
          <span>Sponsor actief in huidige fase</span>
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
