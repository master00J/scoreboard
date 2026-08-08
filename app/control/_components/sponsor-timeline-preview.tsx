"use client";

import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Match, Sponsor, SponsorSection } from "@/lib/types";
import { useDisplayStore } from "@/lib/store";
import { useApi } from "@/lib/use-api";
import {
  activeSponsorsForSection,
  sponsorBudgetSectionFromMatchStatus,
  sponsorSectionBudgetSeconds,
} from "@/lib/sponsor-distribution";

type PhaseKey = "prematch" | "h1" | "h2" | "halftime";

const PHASES: Array<{ key: PhaseKey; status: string[]; phaseStatusKey: string }> = [
  { key: "prematch", status: ["SETUP", "PREMATCH"], phaseStatusKey: "PREMATCH" },
  { key: "h1", status: ["FIRST_HALF"], phaseStatusKey: "FIRST_HALF" },
  { key: "h2", status: ["SECOND_HALF", "EXTRA_TIME"], phaseStatusKey: "SECOND_HALF" },
  { key: "halftime", status: ["HALF_TIME"], phaseStatusKey: "HALF_TIME" },
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
  const { t } = useTranslation();
  const displayStateUpdatedAt = useDisplayStore((s) => s.state?.updatedAt);
  // useApi start met null — default `= []` vangt dat niet op (alleen undefined).
  const { data: sponsorsData } = useApi<Sponsor[]>("/api/sponsors");
  const sponsors = Array.isArray(sponsorsData) ? sponsorsData : [];

  useEffect(() => {
    displayStateUpdatedAt;
  }, [displayStateUpdatedAt]);

  const matchStatus = match?.status;

  const currentPhase = useMemo(() => {
    if (!matchStatus) return PHASES[0];
    return PHASES.find((p) => p.status.includes(matchStatus)) || PHASES[0];
  }, [matchStatus]);

  const timelineData = useMemo(() => {
    if (!matchStatus || sponsors.length === 0) return [];
    return PHASES.map((phase) => {
      const section = sectionForPhase(phase.key);
      const phaseStatus =
        phase.key === "h1" ? "FIRST_HALF" : phase.key === "h2" ? "SECOND_HALF" : matchStatus;
      const phaseSponsors = activeSponsorsForSection(sponsors, section, phaseStatus);

      return {
        phase: phase.key,
        phaseStatusKey: phase.phaseStatusKey,
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
    if (!matchStatus || sponsors.length === 0) return [];
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
          {t("sponsors.timelineTitle")}
        </h3>
        <div className="text-xs text-muted-foreground">
          <div className="mb-2">
            {t("sponsors.phaseLabel")}{" "}
            <span className="text-foreground font-medium">
              {t(`phases.${currentPhase.phaseStatusKey}`)}
            </span>
          </div>
          <div>
            {t("sponsors.activeNow")}{" "}
            {activeSponsorNames.length > 0 ? (
              <span className="text-foreground font-medium">{activeSponsorNames.join(", ")}</span>
            ) : (
              <span className="text-muted-foreground italic">{t("common.none").toLowerCase()}</span>
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
              <h4 className="text-xs font-semibold text-foreground">
                {t(`phases.${phaseData.phaseStatusKey}`)}
              </h4>
              {phaseData.totalBudget > 0 && (
                <span className="text-xs font-mono bg-secondary/50 px-2 py-1 rounded">
                  {Math.floor(phaseData.totalBudget / 60)}m {phaseData.totalBudget % 60}s
                </span>
              )}
            </div>

            {phaseData.sponsors.length === 0 ? (
              <div className="text-[10px] text-muted-foreground italic py-2">
                {t("sponsors.noBudgetInPhase")}
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
                          {t("sponsors.noActiveMedia")}
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
          <span>{t("sponsors.legendActive")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-amber-500/70" />
          <span>{t("sponsors.legendInactive")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-gray-500/50" />
          <span>{t("sponsors.legendNoMedia")}</span>
        </div>
      </div>
    </div>
  );
}
