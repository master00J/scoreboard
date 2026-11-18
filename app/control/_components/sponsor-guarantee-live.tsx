"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useDisplayStore } from "@/lib/store";
import { useLiveTimerSeconds } from "@/lib/use-timer";
import { useWallClockMs } from "@/lib/use-wall-clock-tick";
import { useHalftimeSponsorTimelineT } from "@/lib/use-halftime-sponsor-timeline";
import type { Match } from "@/lib/types";
import { sponsorTelemetryConsumedSec, sponsorTelemetrySegmentKey } from "@/lib/sponsor-telemetry";
import { sponsorBudgetSectionFromMatchStatus } from "@/lib/sponsor-distribution";
import { presentSeconds } from "@/lib/visible-play-clock";
import {
  liveGuaranteeView,
  phaseRemainingSec,
  planPhaseForSegment,
  GUARANTEE_SEGMENTS,
  type GuaranteeSegment,
  type SponsorGuarantee,
} from "@/lib/sponsor-guarantee";

type GuaranteePayload = {
  matchId: string;
  status: string;
  segment: GuaranteeSegment | null;
  reserveSec: number;
  sponsors: Array<{
    id: string;
    name: string;
    guarantee: SponsorGuarantee;
    bookedSec: number;
    carryInSec: number;
    deliveredSec: number;
    openFromEarlierSec: number;
    segments: Partial<Record<GuaranteeSegment, { bookedSec: number; carryInSec: number; deliveredSec: number; shortSec: number }>>;
    files: { mediaId: string; title: string; deliveredSec: number }[];
    cues: {
      cueId: string;
      title: string;
      guarantee: "window" | "fullPlay" | "none";
      triggerSec: number;
      endSec: number | null;
      deliveredSec: number;
      completed: boolean;
    }[];
  }>;
};

type PhaseShortfallBanner = {
  segment: GuaranteeSegment;
  rows: { name: string; shortSec: number; catchUpIn: string[] }[];
};

function fmt(sec: number): string {
  const t = presentSeconds(sec);
  if (t < 60) return `${t}s`;
  const m = Math.floor(t / 60);
  const s = t % 60;
  return s === 0 ? `${m}m` : `${m}m${String(s).padStart(2, "0")}s`;
}

function fmtClock(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * Garanties tijdens de wedstrijd: per sponsor (en per bestand met een eigen afspraak) wat hij in
 * deze fase nog tegoed heeft tegenover de tijd die de fase nog heeft na de reserve voor
 * onderbrekingen. Bij elke fasewissel staat er wat van de vorige fase nog open is.
 *
 * Alleen weergave: een goal, kaart of wissel gaat altijd meteen op het scherm, wat hier ook staat.
 */
export function SponsorGuaranteeLive({ activeMatch }: { activeMatch: Match | null }) {
  const { t } = useTranslation();
  const elapsedSec = useLiveTimerSeconds();
  const nowMs = useWallClockMs(500);
  const sponsorLedger = useDisplayStore((s) => s.sponsorLedger);
  const halftimeT = useHalftimeSponsorTimelineT(activeMatch?.status, activeMatch?.halfBreakSec ?? 900);
  const [payload, setPayload] = useState<GuaranteePayload | null>(null);
  const [banner, setBanner] = useState<PhaseShortfallBanner | null>(null);
  const lastSegmentRef = useRef<{ matchId: string; segment: GuaranteeSegment | null } | null>(null);

  const matchId = activeMatch?.id ?? null;
  const status = activeMatch?.status ?? null;

  useEffect(() => {
    if (!matchId) {
      setPayload(null);
      return;
    }
    let cancelled = false;
    const load = () =>
      fetch(`/api/sponsor-guarantees?matchId=${encodeURIComponent(matchId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((p: GuaranteePayload | null) => {
          if (!cancelled && p) setPayload(p);
        })
        .catch(() => {});
    void load();
    const id = window.setInterval(load, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [matchId, status]);

  // Fasewissel: toon wat van de vorige fase nog niet geleverd is.
  useEffect(() => {
    if (!payload || payload.matchId !== matchId) return;
    const prev = lastSegmentRef.current;
    lastSegmentRef.current = { matchId: payload.matchId, segment: payload.segment };
    if (!prev || prev.matchId !== payload.matchId || !prev.segment || prev.segment === payload.segment) return;
    const ended = prev.segment;
    const endedIdx = GUARANTEE_SEGMENTS.indexOf(ended);
    const rows = payload.sponsors
      .map((s) => ({
        name: s.name,
        shortSec: s.segments[ended]?.shortSec ?? 0,
        catchUpIn: s.guarantee.catchUpIn.filter(
          (p) => GUARANTEE_SEGMENTS.findIndex((seg) => planPhaseForSegment(seg) === p) > endedIdx,
        ),
      }))
      .filter((r) => r.shortSec >= 0.5);
    setBanner({ segment: ended, rows });
  }, [payload, matchId]);

  const segmentKey =
    activeMatch != null
      ? sponsorTelemetrySegmentKey(activeMatch.id, activeMatch.status, sponsorBudgetSectionFromMatchStatus(activeMatch.status))
      : null;
  const ledgerLive =
    !!sponsorLedger && !!activeMatch && sponsorLedger.matchId === activeMatch.id && sponsorLedger.segmentKey === segmentKey;

  const view = useMemo(() => {
    if (!payload || !activeMatch || payload.matchId !== activeMatch.id) return null;
    const remaining = phaseRemainingSec({
      status: activeMatch.status,
      elapsedSec,
      halfDurationSec: activeMatch.halfDurationSec,
      halfBreakSec: activeMatch.halfBreakSec,
      halftimeElapsedSec: activeMatch.status === "HALF_TIME" ? halftimeT % Math.max(60, activeMatch.halfBreakSec) : null,
      kickoffAtMs: activeMatch.kickoffAt ? new Date(activeMatch.kickoffAt).valueOf() : null,
      nowMs,
    });
    const sponsors = payload.sponsors
      .filter((s) => s.bookedSec + s.carryInSec > 0)
      .map((s) => {
        // Seconden: de lopende clip telt live mee (ledger); volledige vertoningen: alleen bewaarde volledige clips.
        const live =
          ledgerLive && sponsorLedger && s.guarantee.kind === "seconds"
            ? sponsorTelemetryConsumedSec(sponsorLedger, s.id, nowMs)
            : 0;
        return {
          id: s.id,
          name: s.name,
          bookedSec: s.bookedSec,
          carryInSec: s.carryInSec,
          deliveredSec: Math.max(s.deliveredSec, live),
        };
      });
    return liveGuaranteeView({ sponsors, phaseRemainingSec: remaining, reserveSec: payload.reserveSec });
  }, [payload, activeMatch, elapsedSec, halftimeT, nowMs, ledgerLive, sponsorLedger]);

  if (!activeMatch) return null;
  const byId = new Map((payload?.sponsors ?? []).map((s) => [s.id, s]));

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("sponsors.guaranteeTitle")}
        </h3>
        {view && payload ? (
          <span className="text-[11px] text-muted-foreground">
            {view.availableSec == null
              ? t("sponsors.guaranteeNoEnd")
              : t("sponsors.guaranteeAvailable", {
                  available: fmt(view.availableSec),
                  reserve: fmt(payload.reserveSec),
                })}
          </span>
        ) : null}
      </div>

      {banner ? (
        <div
          className={`relative rounded-md border px-3 py-2 pr-8 text-[11px] leading-snug ${
            banner.rows.length > 0 ? "border-amber-500/50 bg-amber-500/10" : "border-emerald-500/40 bg-emerald-500/10"
          }`}
          role="status"
        >
          <button
            type="button"
            className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground hover:bg-accent"
            title={t("common.close")}
            onClick={() => setBanner(null)}
          >
            <X className="size-3.5" />
          </button>
          {banner.rows.length === 0 ? (
            t("sponsors.phaseShortfallNone", { phase: t(`phases.${banner.segment}`) })
          ) : (
            <>
              <span className="font-medium text-foreground">
                {t("sponsors.phaseShortfallTitle", { phase: t(`phases.${banner.segment}`) })}
              </span>
              <ul className="mt-1 space-y-0.5">
                {banner.rows.map((r) => (
                  <li key={r.name}>
                    {r.name}: <span className="font-semibold tabular-nums">{fmt(r.shortSec)}</span>{" "}
                    <span className="text-muted-foreground">
                      {r.catchUpIn.length > 0
                        ? t("sponsors.phaseShortfallCatchUp", {
                            phases: r.catchUpIn.map((p) => t(`seasonPlan.phaseShort_${p}`)).join(", "),
                          })
                        : t("sponsors.phaseShortfallOpen")}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}

      {view && view.overbooked ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {t("sponsors.guaranteeOverbooked", { owed: fmt(view.totalOwedSec) })}
        </p>
      ) : null}

      {!view || view.rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t("sponsors.guaranteeNone")}</p>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1 pr-2 font-medium">{t("sponsors.colSponsor")}</th>
              <th className="px-1 py-1 text-right font-medium">{t("sponsors.guaranteeColBooked")}</th>
              <th className="px-1 py-1 text-right font-medium">{t("sponsors.guaranteeColDelivered")}</th>
              <th className="py-1 pl-1 text-right font-medium">{t("sponsors.guaranteeColOwed")}</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => {
              const s = byId.get(r.id);
              return (
                <tr key={r.id} className="border-b border-border/60 align-top">
                  <td className="py-1 pr-2">
                    <span className="font-medium">{r.name}</span>
                    {s?.guarantee.kind === "plays" ? (
                      <span className="block text-[10px] text-muted-foreground">{t("sponsors.guaranteeKindPlays")}</span>
                    ) : null}
                    {s && s.openFromEarlierSec >= 0.5 ? (
                      <span className="block text-[10px] text-amber-600 dark:text-amber-400">
                        {t("sponsors.guaranteeOpenEarlier", { sec: fmt(s.openFromEarlierSec) })}
                      </span>
                    ) : null}
                    {s?.files.map((f) => (
                      <span key={f.mediaId} className="block truncate text-[10px] text-muted-foreground" title={f.title}>
                        {f.title}: {fmt(f.deliveredSec)}
                      </span>
                    ))}
                    {s?.cues
                      .filter((c) => c.guarantee !== "none")
                      .map((c) => (
                        <span key={c.cueId} className="block truncate text-[10px] text-muted-foreground">
                          {fmtClock(c.triggerSec)}
                          {c.endSec != null ? `–${fmtClock(c.endSec)}` : ""} {c.title}:{" "}
                          {c.guarantee === "fullPlay"
                            ? c.completed
                              ? t("sponsors.guaranteeCuePlayed")
                              : t("sponsors.guaranteeCueOwed")
                            : fmt(c.deliveredSec)}
                        </span>
                      ))}
                  </td>
                  <td className="px-1 py-1 text-right tabular-nums">
                    {fmt(r.bookedSec)}
                    {r.carryInSec >= 0.5 ? (
                      <span className="block text-[10px] text-muted-foreground">
                        {t("sponsors.guaranteeCarry", { sec: fmt(r.carryInSec) })}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-1 py-1 text-right tabular-nums">{fmt(r.deliveredSec)}</td>
                  <td
                    className={`py-1 pl-1 text-right font-semibold tabular-nums ${
                      r.owedSec < 0.5
                        ? "text-emerald-600 dark:text-emerald-400"
                        : r.atRisk
                          ? "text-destructive"
                          : "text-foreground"
                    }`}
                  >
                    {r.owedSec < 0.5 ? t("sponsors.guaranteeDone") : fmt(r.owedSec)}
                    {r.atRisk ? (
                      <span className="block text-[10px] font-normal">{t("sponsors.guaranteeAtRisk")}</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
