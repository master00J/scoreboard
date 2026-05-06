"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useApi } from "@/lib/use-api";
import { isElectron } from "@/lib/electron";
import type { Match, Sponsor } from "@/lib/types";

type PlayRow = {
  id: string;
  matchId: string | null;
  sponsorId: string | null;
  sponsorName: string;
  mediaTitle: string;
  segmentKey: string;
  matchStatus: string | null;
  expectedSec: number;
  actualSec: number;
  startedAt: string;
  endedAt: string;
  clipSessionId: string;
  match: {
    id: string;
    kickoffAt: string | null;
    homeTeam: { name: string; shortName: string };
    awayTeam: { name: string; shortName: string };
  } | null;
};

type SummaryRow = {
  sponsorId: string | null;
  sponsorName: string;
  plays: number;
  actualSec: number;
  expectedSec: number;
};

const SEGMENT_OPTIONS = [
  { value: "", label: "Alle fases" },
  { value: "prematch", label: "Voor wedstrijd" },
  { value: "FIRST_HALF", label: "1e helft" },
  { value: "halftime", label: "Rust" },
  { value: "SECOND_HALF", label: "2e helft" },
  { value: "EXTRA_TIME", label: "Verlenging" },
];

function formatSec(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return "0s";
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function formatDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  return d.toLocaleString("nl-BE", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatSegment(key: string): string {
  if (key.includes(":prematch")) return "Voor wedstrijd";
  if (key.includes(":halftime")) return "Rust";
  if (key.includes(":FIRST_HALF")) return "1e helft";
  if (key.includes(":SECOND_HALF")) return "2e helft";
  if (key.includes(":EXTRA_TIME")) return "Verlenging";
  return key;
}

export function ProofOfPlayPanel() {
  const { data: matches } = useApi<Match[]>("/api/matches");
  const { data: sponsors } = useApi<Sponsor[]>("/api/sponsors");

  const [matchId, setMatchId] = useState("");
  const [sponsorId, setSponsorId] = useState("");
  const [segmentKey, setSegmentKey] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [rows, setRows] = useState<PlayRow[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const listJson = (await listRes.json()) as { rows: PlayRow[] };
      const sumJson = (await sumRes.json()) as { rows: SummaryRow[] };
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

  const exportCsv = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.exportSponsorPlays) {
      // Browser fallback
      window.open(`/api/sponsor-plays/export.csv?${queryString}`, "_blank");
      return;
    }
    await window.electronAPI.exportSponsorPlays({ queryString });
  }, [queryString]);

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
              Filter en exporteer naar CSV om aan adverteerders te bezorgen of
              voor facturatie.
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

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void exportCsv()}>Exporteer CSV</Button>
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
            value={formatSec(totalActualSec)}
            hint="werkelijk afgespeeld"
          />
          <Stat
            label="Verwachte schermtijd"
            value={formatSec(totalExpectedSec)}
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
                      {formatSec(s.actualSec)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatSec(s.expectedSec)}
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
                      {formatDateTime(r.endedAt)}
                    </td>
                    <td className="py-1.5 pr-3 font-medium">{r.sponsorName}</td>
                    <td className="py-1.5 pr-3">{r.mediaTitle}</td>
                    <td className="py-1.5 pr-3">
                      {r.match
                        ? `${r.match.homeTeam.shortName ?? r.match.homeTeam.name} – ${r.match.awayTeam.shortName ?? r.match.awayTeam.name}`
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-3">{formatSegment(r.segmentKey)}</td>
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
