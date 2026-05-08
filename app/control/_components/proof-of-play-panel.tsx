"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useApi } from "@/lib/use-api";
import { isElectron } from "@/lib/electron";
import type { Match, Sponsor } from "@/lib/types";
import {
  buildProofOfPlayPdf,
  buildProofOfPlayXlsx,
  downloadProofOfPlayFile,
  formatDateTimeNl,
  formatSecForExport,
  formatSegmentNl,
  uint8ArrayToBase64,
  type ProofOfPlayExportMeta,
  type ProofOfPlayRow,
  type ProofOfPlaySummaryRow,
} from "@/lib/proof-of-play-export";

const SEGMENT_OPTIONS = [
  { value: "", label: "Alle fases" },
  { value: "prematch", label: "Voor wedstrijd" },
  { value: "FIRST_HALF", label: "1e helft" },
  { value: "halftime", label: "Rust" },
  { value: "SECOND_HALF", label: "2e helft" },
  { value: "EXTRA_TIME", label: "Verlenging" },
];

export function ProofOfPlayPanel() {
  const { data: matches } = useApi<Match[]>("/api/matches");
  const { data: sponsors } = useApi<Sponsor[]>("/api/sponsors");

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
      // einde van de dag
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
          ? `Wedstrijd: ${m.homeTeam?.name ?? "?"} vs ${m.awayTeam?.name ?? "?"}`
          : `Wedstrijd-id: ${matchId}`,
      );
    } else {
      parts.push("Alle wedstrijden");
    }
    if (sponsorId && sponsors?.length) {
      const s = sponsors.find((x) => x.id === sponsorId);
      parts.push(s ? `Sponsor: ${s.name}` : `Sponsor-id: ${sponsorId}`);
    } else {
      parts.push("Alle sponsors");
    }
    const seg =
      SEGMENT_OPTIONS.find((o) => o.value === segmentKey)?.label ?? "Alle fases";
    parts.push(`Fase: ${seg}`);
    if (from) parts.push(`Vanaf: ${from}`);
    if (to) parts.push(`Tot en met: ${to}`);
    return parts.join(" · ");
  }, [matchId, sponsorId, segmentKey, from, to, matches, sponsors]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listRes, sumRes] = await Promise.all([
        fetch(`/api/sponsor-plays?${queryString}`),
        fetch(`/api/sponsor-plays/summary?${queryString}`),
      ]);
      if (!listRes.ok) throw new Error(`Lijst: ${listRes.status}`);
      if (!sumRes.ok) throw new Error(`Samenvatting: ${sumRes.status}`);
      const listJson = (await listRes.json()) as { rows: ProofOfPlayRow[] };
      const sumJson = (await sumRes.json()) as { rows: ProofOfPlaySummaryRow[] };
      setRows(listJson.rows ?? []);
      setSummary(sumJson.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runExport = useCallback(
    async (format: "pdf" | "xlsx") => {
      if (exportBusyRef.current) return;
      exportBusyRef.current = true;
      setExporting(true);
      setError(null);
      try {
        const [listRes, sumRes] = await Promise.all([
          fetch(`/api/sponsor-plays?${queryString}`),
          fetch(`/api/sponsor-plays/summary?${queryString}`),
        ]);
        if (!listRes.ok) throw new Error(`Lijst: ${listRes.status}`);
        if (!sumRes.ok) throw new Error(`Samenvatting: ${sumRes.status}`);
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
            ? buildProofOfPlayXlsx(exportRows, exportSummary, meta)
            : buildProofOfPlayPdf(exportRows, exportSummary, meta);
        const stamp = new Date().toISOString().slice(0, 10);
        const ext = format === "xlsx" ? "xlsx" : "pdf";
        const fileName = `proof-of-play-${stamp}.${ext}`;
        const mime =
          format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/pdf";
        if (isElectron && window.electronAPI?.saveProofOfPlayExport) {
          await window.electronAPI.saveProofOfPlayExport({
            base64: uint8ArrayToBase64(bytes),
            defaultFileName: fileName,
            format,
          });
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
    [queryString, filterLabel],
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
            <h2 className="text-lg font-semibold">Proof-of-play rapporten</h2>
            <p className="text-xs text-muted-foreground">
              Elke voltooide sponsor-clipweergave wordt automatisch gelogd.
              Filter en exporteer naar Excel of PDF voor adverteerders of
              facturatie.
            </p>
            {totalPlays === 0 && !loading && (
              <p className="mt-2 text-[11px] text-amber-700/90 dark:text-amber-400/90 leading-snug rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                <strong>Waarom staat alles op 0?</strong> De totalen hieronder zijn de som van{" "}
                <em>werkelijk afgeronde</em> sponsorclips op het stadiondisplay — niet je
                geconfigureerde sponsor-seconden in Media. Zolang er in deze filter nog geen clip
                is afgelopen (of je filter sluit die logs uit), blijven aantal, schermtijd en
                realisatiegraad 0. Laat sponsors draaien op het display tot een clip eindigt, of
                wijd het datumbereik uit en kies eventueel “Alle wedstrijden”.
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            Vernieuwen
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <Label>Wedstrijd</Label>
            <Select
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
            >
              <option value="">Alle wedstrijden</option>
              {(matches ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.homeTeam?.name ?? "?"} vs {m.awayTeam?.name ?? "?"}
                  {m.closedAt ? " (afgesloten)" : ""}
                  {m.kickoffAt
                    ? ` — ${new Date(m.kickoffAt).toLocaleDateString("nl-BE")}`
                    : ""}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Sponsor</Label>
            <Select
              value={sponsorId}
              onChange={(e) => setSponsorId(e.target.value)}
            >
              <option value="">Alle sponsors</option>
              {(sponsors ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Match-fase</Label>
            <Select
              value={segmentKey}
              onChange={(e) => setSegmentKey(e.target.value)}
            >
              {SEGMENT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Vanaf</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <Label>Tot en met</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 items-center">
          <Button
            disabled={exporting}
            onClick={() => void runExport("xlsx")}
          >
            {exporting ? "Exporteren…" : "Exporteer Excel"}
          </Button>
          <Button
            variant="secondary"
            disabled={exporting}
            onClick={() => void runExport("pdf")}
          >
            Exporteer PDF
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
            Filters wissen
          </Button>
        </div>

        {error && (
          <p className="mt-3 text-xs text-destructive">{error}</p>
        )}

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Aantal afspeelbeurten" value={String(totalPlays)} />
          <Stat
            label="Totale schermtijd"
            value={formatSecForExport(totalActualSec)}
            hint="werkelijk afgespeeld"
          />
          <Stat
            label="Verwachte schermtijd"
            value={formatSecForExport(totalExpectedSec)}
            hint="per gelogde clip, niet je sponsor-budget"
          />
          <Stat
            label="Realisatiegraad"
            value={`${avgFulfillment}%`}
            hint="werkelijk ÷ verwacht (logs)"
          />
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-base font-semibold mb-3">Per sponsor</h3>
        {summary.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {loading ? "Laden…" : "Nog geen afspeelbeurten in deze filter."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Sponsor</th>
                  <th className="py-2 pr-3 text-right">Afspeelbeurten</th>
                  <th className="py-2 pr-3 text-right">Werkelijke tijd</th>
                  <th className="py-2 pr-3 text-right">Verwachte tijd</th>
                  <th className="py-2 pr-3 text-right">Realisatie</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.map((s) => (
                  <tr key={s.sponsorId ?? s.sponsorName}>
                    <td className="py-2 pr-3 font-medium">{s.sponsorName}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {s.plays}
                    </td>
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
          Detail (laatste {rows.length} afspeelbeurten)
        </h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {loading ? "Laden…" : "Geen rijen voor deze filter."}
          </p>
        ) : (
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="text-left uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Tijd</th>
                  <th className="py-2 pr-3">Sponsor</th>
                  <th className="py-2 pr-3">Media</th>
                  <th className="py-2 pr-3">Wedstrijd</th>
                  <th className="py-2 pr-3">Fase</th>
                  <th className="py-2 pr-3 text-right">Verwacht</th>
                  <th className="py-2 pr-3 text-right">Werkelijk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {formatDateTimeNl(r.endedAt)}
                    </td>
                    <td className="py-1.5 pr-3 font-medium">{r.sponsorName}</td>
                    <td className="py-1.5 pr-3">{r.mediaTitle}</td>
                    <td className="py-1.5 pr-3">
                      {r.match
                        ? `${r.match.homeTeam.shortName ?? r.match.homeTeam.name} – ${r.match.awayTeam.shortName ?? r.match.awayTeam.name}`
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-3">{formatSegmentNl(r.segmentKey)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {r.expectedSec}s
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {r.actualSec}s
                    </td>
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
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {hint && (
        <div className="text-[10px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}
