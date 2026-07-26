"use client";

import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useApi } from "@/lib/use-api";
import { useLiveTimerSeconds } from "@/lib/use-timer";
import { useWallClockMs } from "@/lib/use-wall-clock-tick";
import { useDisplayStore } from "@/lib/store";
import type { Match, Sponsor } from "@/lib/types";
import {
  activeSponsorsForSection,
  sponsorBudgetSectionFromMatchStatus,
  sponsorSectionBudgetSeconds,
} from "@/lib/sponsor-distribution";
import { sponsorTelemetryConsumedSec, sponsorTelemetrySegmentKey } from "@/lib/sponsor-telemetry";
import { effectiveMatchPlayRosterSeconds } from "@/lib/sponsor-roster-effective-timeline";
import {
  applyRosterBudgetCarry,
  sponsorLiveProgressFromRosterRaw,
  type RosterCarry,
} from "@/lib/sponsor-live-roster";
import { useHalftimeSponsorTimelineT } from "@/lib/use-halftime-sponsor-timeline";
import { prematchRosterClockSec } from "@/lib/prematch-spread-timing";

function formatClock(sec: number): string {
  const t = Math.max(0, Math.round(Number(sec) || 0));
  if (!t) return "0s";
  const m = Math.floor(t / 60);
  const s = t % 60;
  return s === 0 ? `${m}m` : `${m}m${s}s`;
}

function segmentHighlightForMatch(
  status: string | undefined,
): "prematch" | "h1" | "h2" | "halftime" | "none" {
  if (status === "SETUP" || status === "PREMATCH") return "prematch";
  if (status === "FIRST_HALF") return "h1";
  if (status === "SECOND_HALF" || status === "EXTRA_TIME") return "h2";
  if (status === "HALF_TIME") return "halftime";
  return "none";
}

function phaseDescription(status: string | undefined): string {
  switch (status) {
    case "SETUP":
      return "Setup";
    case "PREMATCH":
      return "Voor wedstrijd";
    case "FIRST_HALF":
      return "1e helft";
    case "HALF_TIME":
      return "Rust";
    case "SECOND_HALF":
      return "2e helft";
    case "EXTRA_TIME":
      return "Verlenging";
    case "FULL_TIME":
      return "Einde (speeltijd)";
    case "POST_MATCH":
      return "Na de wedstrijd";
    default:
      return status ?? "—";
  }
}

function sponsorHasActiveMedia(s: Sponsor): boolean {
  return (s.media ?? []).some((m) => m.active);
}

export function SponsorLiveOverview({ activeMatch }: { activeMatch: Match | null }) {
  const displayStateUpdatedAt = useDisplayStore((s) => s.state?.updatedAt);
  const { data: sponsorsRaw, reload: reloadSponsors } = useApi<Sponsor[]>("/api/sponsors");
  const sponsors = sponsorsRaw ?? [];
  const elapsedSec = useLiveTimerSeconds();
  const wallTelemetryMs = useWallClockMs(250);
  const displayMode = useDisplayStore((s) => s.state?.mode);
  const sponsorLedger = useDisplayStore((s) => s.sponsorLedger);
  const matchRosterFreezeRef = useRef(0);
  const halftimeT = useHalftimeSponsorTimelineT(
    activeMatch?.status,
    activeMatch?.halfBreakSec ?? 900,
  );

  const carryMapRef = useRef<Map<string, MutableRefObject<RosterCarry | null>>>(new Map());

  useEffect(() => {
    carryMapRef.current.clear();
  }, [activeMatch?.id]);

  /**
   * Server reset de sponsor-ledger bij fase-/timer-resets (zie `electron/runtime.ts`).
   * Wanneer de ledger naar `null` springt, ook de lokale roster-carry leegmaken zodat
   * de "schermtijd verbruikt" weer op 0 begint i.p.v. opgespaarde waarden te tonen.
   */
  useEffect(() => {
    if (sponsorLedger === null) {
      carryMapRef.current.clear();
      matchRosterFreezeRef.current = 0;
    }
  }, [sponsorLedger]);

  useEffect(() => {
    matchRosterFreezeRef.current = 0;
  }, [activeMatch?.id, activeMatch?.status]);

  /** Zelfde bron als Sponsor-HUD: na sponsorwijziging (API) bump’t Electron `displayState.updatedAt`. */
  const lastSponsorReloadAtRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const at = displayStateUpdatedAt;
    if (at == null) return;
    if (lastSponsorReloadAtRef.current === at) return;
    lastSponsorReloadAtRef.current = at;
    reloadSponsors();
  }, [displayStateUpdatedAt, reloadSponsors]);

  function carryRefFor(id: string): MutableRefObject<RosterCarry | null> {
    const m = carryMapRef.current;
    if (!m.has(id)) m.set(id, { current: null });
    return m.get(id)!;
  }

  const section = sponsorBudgetSectionFromMatchStatus(activeMatch?.status);
  const highlightCol = segmentHighlightForMatch(activeMatch?.status);

  const activeInLoop = useMemo(() => {
    if (!activeMatch) return [] as Sponsor[];
    return activeSponsorsForSection(sponsors, section, activeMatch.status);
  }, [sponsors, section, activeMatch?.status, activeMatch]);

  const sortedWithMedia = useMemo(() => {
    const list = sponsors.filter(sponsorHasActiveMedia).slice();
    list.sort((a, b) => a.name.localeCompare(b.name, "nl"));
    return list;
  }, [sponsors]);

  const matchPlayRosterSeconds =
    activeMatch != null
      ? effectiveMatchPlayRosterSeconds(
          elapsedSec,
          activeMatch.status,
          activeMatch.halfDurationSec,
          displayMode,
          matchRosterFreezeRef,
        )
      : 0;

  const telemetrySegmentKey =
    activeMatch != null ? sponsorTelemetrySegmentKey(activeMatch.id, activeMatch.status, section) : null;
  const ledgerMatchesSegment =
    !!sponsorLedger &&
    !!activeMatch &&
    telemetrySegmentKey != null &&
    sponsorLedger.matchId === activeMatch.id &&
    sponsorLedger.segmentKey === telemetrySegmentKey;
  const telemetryNowMs = wallTelemetryMs;

  function computeRow(sponsor: Sponsor) {
    const prematchB = sponsorSectionBudgetSeconds(sponsor, "prematch");
    const h1B = sponsorSectionBudgetSeconds(sponsor, "match", "FIRST_HALF");
    const h2B = sponsorSectionBudgetSeconds(sponsor, "match", "SECOND_HALF");
    const rustB = sponsorSectionBudgetSeconds(sponsor, "halftime");

    let live: {
      label: string;
      consumed: number;
      budget: number;
      remaining: number;
    } | null = null;

    if (activeMatch && sponsor.active) {
      const raw = sponsorLiveProgressFromRosterRaw(
        sponsor,
        sponsors,
        activeMatch,
        matchPlayRosterSeconds,
        halftimeT,
        prematchRosterClockSec(activeMatch, sponsors, telemetryNowMs, null, elapsedSec),
      );
        if (raw) {
          const st = activeMatch.status;
          let tClock = prematchRosterClockSec(activeMatch, sponsors, telemetryNowMs, null, elapsedSec);
          if (st === "FIRST_HALF" || st === "SECOND_HALF" || st === "EXTRA_TIME") {
            tClock = matchPlayRosterSeconds;
          } else if (st === "HALF_TIME") {
            const Hh = Math.max(60, activeMatch.halfBreakSec);
            tClock = halftimeT % Hh;
          }
          let slotsUsedForCarry = raw.slotsUsed;
          let labelOut = raw.label;
          let carryKey = raw.carryKey;
          if (ledgerMatchesSegment && sponsorLedger) {
            slotsUsedForCarry = Math.round(
              sponsorTelemetryConsumedSec(sponsorLedger, sponsor.id, telemetryNowMs),
            );
            labelOut = `${raw.label} · gemeten op scherm`;
            /** Los van rooster-carry: anders blijft `consumedFloor` van het slotrooster boven telemetry hangen. */
            carryKey = `${raw.carryKey}|ledger`;
          }
          const { consumed, budget } = applyRosterBudgetCarry(
            carryRefFor(sponsor.id),
            { ...raw, slotsUsed: slotsUsedForCarry, carryKey, matchId: activeMatch.id },
            tClock,
          );
        live = {
          label: labelOut,
          consumed,
          budget,
          remaining: Math.max(0, budget - consumed),
        };
      }
    }

    return { sponsor, prematchB, h1B, h2B, rustB, live };
  }

  const activeNames = activeInLoop.map((s) => s.name).join(", ");

  function cellClass(seg: "prematch" | "h1" | "h2" | "halftime"): string {
    const hit =
      (seg === "prematch" && highlightCol === "prematch") ||
      (seg === "h1" && highlightCol === "h1") ||
      (seg === "h2" && highlightCol === "h2") ||
      (seg === "halftime" && highlightCol === "halftime");
    return hit ? "bg-primary/15 font-medium text-foreground" : "text-muted-foreground";
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Sponsors live
          </h2>
          {activeMatch ? (
            <p className="text-xs text-muted-foreground mt-1">
              Wedstrijdfase:{" "}
              <span className="text-foreground font-medium">{phaseDescription(activeMatch.status)}</span>
              {" · "}segment rooster:{" "}
              <span className="text-foreground font-medium">
                {section === "prematch"
                  ? "voor wedstrijd"
                  : section === "halftime"
                    ? "rust"
                    : "speelhelft"}
              </span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1">Geen actieve wedstrijd — alleen budgets.</p>
          )}
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] leading-snug">
        <span className="font-medium text-foreground">Actieve loops nu: </span>
        {activeInLoop.length === 0 ? (
          <span className="text-muted-foreground">
            geen (geen sponsor met budget + media in dit segment, of fase zonder rooster).
          </span>
        ) : (
          <span className="text-foreground">{activeNames}</span>
        )}
      </div>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-[11px] border-collapse min-w-[520px]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-2 font-medium">Sponsor</th>
              <th className={`py-2 px-1 font-medium ${cellClass("prematch")}`}>Voor</th>
              <th className={`py-2 px-1 font-medium ${cellClass("h1")}`}>1e</th>
              <th className={`py-2 px-1 font-medium ${cellClass("h2")}`}>2e</th>
              <th className={`py-2 px-1 font-medium ${cellClass("halftime")}`}>Rust</th>
              <th className="py-2 pl-2 font-medium text-foreground">Nu (rest / budget)</th>
            </tr>
          </thead>
          <tbody>
            {sortedWithMedia.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-muted-foreground italic">
                  Geen sponsors met gekoppelde actieve media. Zie Media → Sponsors.
                </td>
              </tr>
            )}
            {sortedWithMedia.map((sponsor) => {
              const { prematchB, h1B, h2B, rustB, live } = computeRow(sponsor);
              return (
                <tr
                  key={sponsor.id}
                  className={`border-b border-border/60 ${sponsor.active ? "" : "opacity-50"}`}
                >
                  <td className="py-2 pr-2 font-medium truncate max-w-[140px]" title={sponsor.name}>
                    {sponsor.name}
                    {!sponsor.active && (
                      <span className="block text-[10px] font-normal text-muted-foreground">(uit)</span>
                    )}
                  </td>
                  <td className={`py-2 px-1 tabular-nums ${cellClass("prematch")}`}>
                    {formatClock(prematchB)}
                  </td>
                  <td className={`py-2 px-1 tabular-nums ${cellClass("h1")}`}>{formatClock(h1B)}</td>
                  <td className={`py-2 px-1 tabular-nums ${cellClass("h2")}`}>{formatClock(h2B)}</td>
                  <td className={`py-2 px-1 tabular-nums ${cellClass("halftime")}`}>
                    {formatClock(rustB)}
                  </td>
                  <td className="py-2 pl-2 text-foreground leading-tight">
                    {live ? (
                      <>
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          {formatClock(live.remaining)}
                        </span>
                        <span className="text-muted-foreground"> / {formatClock(live.budget)}</span>
                        <span className="block text-[10px] text-muted-foreground truncate">
                          {live.label} · schermtijd verbruikt {formatClock(live.consumed)}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-muted-foreground leading-snug">
        Voor = voor wedstrijd; 1e/2e = speelhelft-budget; Rust = pauze. De gemarkeerde kolom hoort bij de huidige
        fase. <strong className="text-foreground/90">Nu</strong> toont rest / budget (afgerond op seconden). Zolang het
        stadionscherm verbonden is, komt verbruik uit <strong>werkelijke afgespeelde clips</strong> (label “gemeten op
        scherm”); anders uit het rooster als schatting. Rostertijd voor die schatting loopt alleen tijdens{" "}
        <strong>scorebord + sponsors</strong>, niet bij “alleen scorebord” of andere interrupt-modi.
      </p>
    </div>
  );
}
