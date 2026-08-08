"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useApi } from "@/lib/use-api";
import { isElectron } from "@/lib/electron";
import { useLicenseFeatures } from "@/lib/use-license-features";
import type { Match, Sponsor } from "@/lib/types";
import {
  buildProofOfPlayPdf,
  buildProofOfPlayXlsx,
  downloadProofOfPlayFile,
  formatDateTimeLocale,
  formatSecForExport,
  formatSegmentKey,
  proofOfPlayLabelsFromT,
  uint8ArrayToBase64,
  type ProofOfPlayExportMeta,
  type ProofOfPlayRow,
  type ProofOfPlaySummaryRow,
} from "@/lib/proof-of-play-export";

export function ProofOfPlayPanel() {
  const { t, i18n } = useTranslation();
  const dateLocale =
    i18n.language === "fr" ? "fr-BE" : i18n.language === "en" ? "en-GB" : "nl-BE";
  const exportLabels = useMemo(() => proofOfPlayLabelsFromT(t), [t]);

  const { data: matches } = useApi<Match[]>("/api/matches");
  const { data: sponsors } = useApi<Sponsor[]>("/api/sponsors");
  const { isFeatureAllowed, planLabel } = useLicenseFeatures();
  const exportAllowed = isFeatureAllowed("proof_of_play_export");

  const SEGMENT_OPTIONS = useMemo(
    () => [
      { value: "", label: t("reports.filterAll") },
      { value: "prematch", label: t("phases.prematch") },
      { value: "FIRST_HALF", label: t("phases.FIRST_HALF") },
      { value: "halftime", label: t("phases.halftime") },
      { value: "SECOND_HALF", label: t("phases.SECOND_HALF") },
      { value: "EXTRA_TIME", label: t("phases.EXTRA_TIME") },
    ],
    [t],
  );

  const [matchId, setMatchId] = useState("");
  const [sponsorId, setSponsorId] = useState("");
  const [segmentKey, setSegmentKey] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [rows, setRows] = useState<ProofOfPlayRow[]>([]);
  const [summary, setSummary] = useState<ProofOfPlaySummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exportBusyRef = useRef(false);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (matchId) p.set("matchId", matchId);
    if (sponsorId) p.set("sponsorId", sponsorId);
    if (segmentKey) p.set("segmentKey", segmentKey);
    if (from) p.set("from", new Date(from).toISOString());
    if (to) {
      const d = new Date(to);
      d.setHours(23, 59, 59, 999);
      p.set("to", d.toISOString());
    }
    return p.toString();
  }, [matchId, sponsorId, segmentKey, from, to]);

  const filterLabel = useMemo(() => {
    const parts: string[] = [];
    if (matchId && matches?.length) {
      const m = matches.find((x) => x.id === matchId);
      parts.push(
        m
          ? `${t("reports.filterMatch")}: ${m.homeTeam?.name ?? "?"} ${t("common.vs")} ${m.awayTeam?.name ?? "?"}`
          : t("reports.matchId", { id: matchId }),
      );
    } else {
      parts.push(t("reports.filterAll"));
    }
    if (sponsorId && sponsors?.length) {
      const sp = sponsors.find((x) => x.id === sponsorId);
      parts.push(
        sp
          ? t("reports.sponsorFilter", { name: sp.name })
          : t("reports.sponsorId", { id: sponsorId }),
      );
    } else {
      parts.push(t("reports.allSponsors"));
    }
    const seg =
      SEGMENT_OPTIONS.find((o) => o.value === segmentKey)?.label ?? t("reports.filterAll");
    parts.push(t("reports.phaseFilter", { phase: seg }));
    if (from) parts.push(t("reports.fromFilter", { date: from }));
    if (to) parts.push(t("reports.toFilter", { date: to }));
    return parts.join(" · ");
  }, [matchId, sponsorId, segmentKey, from, to, matches, sponsors, SEGMENT_OPTIONS, t]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listRes, sumRes] = await Promise.all([
        fetch(`/api/sponsor-plays?${queryString}`),
        fetch(`/api/sponsor-plays/summary?${queryString}`),
      ]);
      if (!listRes.ok) throw new Error(t("reports.listError", { status: listRes.status }));
      if (!sumRes.ok) throw new Error(t("reports.summaryError", { status: sumRes.status }));
      const listJson = (await listRes.json()) as { rows: ProofOfPlayRow[] };
      const sumJson = (await sumRes.json()) as { rows: ProofOfPlaySummaryRow[] };
      setRows(listJson.rows ?? []);
      setSummary(sumJson.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [queryString, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runExport = useCallback(
    async (format: "pdf" | "xlsx") => {
      if (exportBusyRef.current) return;
      if (!exportAllowed) {
        setError(t("reports.licenseOff"));
        return;
      }
      exportBusyRef.current = true;
      setExporting(true);
      setError(null);
      try {
        const [listRes, sumRes] = await Promise.all([
          fetch(`/api/sponsor-plays?${queryString}`),
          fetch(`/api/sponsor-plays/summary?${queryString}`),
        ]);
        if (!listRes.ok) throw new Error(t("reports.listError", { status: listRes.status }));
        if (!sumRes.ok) throw new Error(t("reports.summaryError", { status: sumRes.status }));
        const listJson = (await listRes.json()) as { rows: ProofOfPlayRow[] };
        const sumJson = (await sumRes.json()) as { rows: ProofOfPlaySummaryRow[] };
        const exportRows = listJson.rows ?? [];
        const exportSummary = sumJson.rows ?? [];
        const totalPlays = exportRows.length;
        const totalActualSec = exportRows.reduce((acc, r) => acc + r.actualSec, 0);
        const totalExpectedSec = exportRows.reduce((acc, r) => acc + r.expectedSec, 0);
        const avgFulfillment =
          totalExpectedSec > 0
            ? Math.round((totalActualSec / totalExpectedSec) * 100)
            : 0;
        const meta: ProofOfPlayExportMeta = {
          generatedAtIso: new Date().toISOString(),
          filterLabel,
          totalPlays,
          totalActualSec,
          totalExpectedSec,
          avgFulfillmentPercent: avgFulfillment,
        };
        const bytes =
          format === "xlsx"
            ? await buildProofOfPlayXlsx(exportRows, exportSummary, meta, exportLabels, dateLocale)
            : buildProofOfPlayPdf(exportRows, exportSummary, meta, exportLabels, dateLocale);
        const stamp = new Date().toISOString().slice(0, 10);
        const ext = format === "xlsx" ? "xlsx" : "pdf";
        const fileName = `proof-of-play-${stamp}.${ext}`;
        const mime =
          format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/pdf";
        if (isElectron && window.electronAPI?.saveProofOfPlayExport) {
          const saved = await window.electronAPI.saveProofOfPlayExport({
            base64: uint8ArrayToBase64(bytes),
            defaultFileName: fileName,
            format,
          });
          if (saved.error) throw new Error(saved.error);
        } else {
          downloadProofOfPlayFile(bytes, mime, fileName);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        exportBusyRef.current = false;
        setExporting(false);
      }
    },
    [queryString, filterLabel, exportAllowed, t, exportLabels, dateLocale],
  );

  const totalPlays = rows.length;
  const totalActualSec = rows.reduce((acc, r) => acc + r.actualSec, 0);
  const totalExpectedSec = rows.reduce((acc, r) => acc + r.expectedSec, 0);
  const avgFulfillment =
    totalExpectedSec > 0
      ? Math.round((totalActualSec / totalExpectedSec) * 100)
      : 0;

  return (
    <div className="space-y-4">
      <section className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("reports.title")}</h2>
            <p className="text-xs text-muted-foreground">{t("reports.intro")}</p>
            {!exportAllowed && (
              <p className="mt-2 text-[11px] text-amber-700/90 dark:text-amber-400/90 leading-snug rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                {t("reports.licenseOff")}
                {planLabel ? ` (${planLabel})` : ""}
              </p>
            )}
            {totalPlays === 0 && !loading && (
              <p className="mt-2 text-[11px] text-amber-700/90 dark:text-amber-400/90 leading-snug rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                {t("reports.whyZero", { all: t("reports.filterAll") })}
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            {t("reports.refresh")}
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <Label>{t("reports.filterMatch")}</Label>
            <Select value={matchId} onChange={(e) => setMatchId(e.target.value)}>
              <option value="">{t("reports.filterAll")}</option>
              {(matches ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.homeTeam?.name ?? "?"} {t("common.vs")} {m.awayTeam?.name ?? "?"}
                  {m.closedAt ? ` ${t("reports.closed")}` : ""}
                  {m.kickoffAt
                    ? ` — ${new Date(m.kickoffAt).toLocaleDateString(dateLocale)}`
                    : ""}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>{t("reports.filterSponsor")}</Label>
            <Select value={sponsorId} onChange={(e) => setSponsorId(e.target.value)}>
              <option value="">{t("reports.allSponsors")}</option>
              {(sponsors ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>{t("reports.filterPhase")}</Label>
            <Select value={segmentKey} onChange={(e) => setSegmentKey(e.target.value)}>
              {SEGMENT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>{t("reports.from")}</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label>{t("reports.to")}</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 items-center">
          <Button
            disabled={exporting || !exportAllowed}
            onClick={() => void runExport("xlsx")}
          >
            {exporting ? t("common.loading") : t("reports.exportCsv")}
          </Button>
          <Button
            variant="secondary"
            disabled={exporting || !exportAllowed}
            onClick={() => void runExport("pdf")}
          >
            {t("reports.exportPdf")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setMatchId("");
              setSponsorId("");
              setSegmentKey("");
              setFrom("");
              setTo("");
            }}
          >
            {t("common.clear")}
          </Button>
        </div>

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label={t("reports.statPlays")} value={String(totalPlays)} />
          <Stat
            label={t("reports.statScreenTime")}
            value={formatSecForExport(totalActualSec)}
            hint={t("reports.statScreenTimeHint")}
          />
          <Stat
            label={t("reports.statExpected")}
            value={formatSecForExport(totalExpectedSec)}
            hint={t("reports.statExpectedHint")}
          />
          <Stat
            label={t("reports.statFulfillment")}
            value={`${avgFulfillment}%`}
            hint={t("reports.statFulfillmentHint")}
          />
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-base font-semibold mb-3">{t("reports.perSponsor")}</h3>
        {summary.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {loading ? t("common.loading") : t("reports.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">{t("reports.colSponsor")}</th>
                  <th className="py-2 pr-3 text-right">{t("reports.colPlays")}</th>
                  <th className="py-2 pr-3 text-right">{t("reports.colActual")}</th>
                  <th className="py-2 pr-3 text-right">{t("reports.colExpected")}</th>
                  <th className="py-2 pr-3 text-right">{t("reports.colFulfillment")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.map((s) => (
                  <tr key={s.sponsorId ?? s.sponsorName}>
                    <td className="py-2 pr-3 font-medium">{s.sponsorName}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{s.plays}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatSecForExport(s.actualSec)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatSecForExport(s.expectedSec)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {s.expectedSec > 0
                        ? `${Math.round((s.actualSec / s.expectedSec) * 100)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-base font-semibold mb-3">
          {t("reports.detailTitle", { count: rows.length })}
        </h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {loading ? t("common.loading") : t("reports.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="text-left uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">{t("reports.colTime")}</th>
                  <th className="py-2 pr-3">{t("reports.colSponsor")}</th>
                  <th className="py-2 pr-3">{t("reports.colMedia")}</th>
                  <th className="py-2 pr-3">{t("reports.colMatch")}</th>
                  <th className="py-2 pr-3">{t("reports.colPhase")}</th>
                  <th className="py-2 pr-3 text-right">{t("reports.colExpectedShort")}</th>
                  <th className="py-2 pr-3 text-right">{t("reports.colActualShort")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {formatDateTimeLocale(r.endedAt, dateLocale)}
                    </td>
                    <td className="py-1.5 pr-3 font-medium">{r.sponsorName}</td>
                    <td className="py-1.5 pr-3">{r.mediaTitle}</td>
                    <td className="py-1.5 pr-3">
                      {r.match
                        ? `${r.match.homeTeam.shortName ?? r.match.homeTeam.name} – ${r.match.awayTeam.shortName ?? r.match.awayTeam.name}`
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-3">
                      {formatSegmentKey(r.segmentKey, exportLabels)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.expectedSec}s</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.actualSec}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md bg-secondary/40 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
