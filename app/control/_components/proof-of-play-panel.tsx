"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useApi } from "@/lib/use-api";
import { isElectron, selectFilesViaDialog } from "@/lib/electron";
import { mediaUrl } from "@/lib/media-url";
import { useLicenseFeatures } from "@/lib/use-license-features";
import type { AppSettings, Match, Sponsor, Team } from "@/lib/types";
import {
  brandFromHomeTeam,
  contrastingTextHex,
  parseProofOfPlayBrand,
  serializeProofOfPlayBrand,
  type ProofOfPlayBrand,
} from "@/lib/proof-of-play-brand";
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
    i18n.language === "it"
      ? "it-IT"
      : i18n.language === "fr"
        ? "fr-BE"
        : i18n.language === "en"
          ? "en-GB"
          : "nl-BE";
  const exportLabels = useMemo(() => proofOfPlayLabelsFromT(t), [t]);

  const { data: matches } = useApi<Match[]>("/api/matches");
  const { data: sponsors } = useApi<Sponsor[]>("/api/sponsors");
  const { data: settings, reload: reloadSettings } = useApi<AppSettings>("/api/settings");
  const { data: teams } = useApi<Team[]>("/api/teams");
  const { isFeatureAllowed, planLabel } = useLicenseFeatures();
  const exportAllowed = isFeatureAllowed("proof_of_play_export");
  const [brand, setBrand] = useState<ProofOfPlayBrand>(() => parseProofOfPlayBrand(null));
  const [savingBrand, setSavingBrand] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const brandHydrated = useRef(false);

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

  useEffect(() => {
    if (brandHydrated.current || !settings) return;
    brandHydrated.current = true;
    setBrand(parseProofOfPlayBrand(settings.proofOfPlayBrandJson));
  }, [settings]);

  const homeTeam = useMemo(() => {
    if (settings?.homeTeamId && teams?.length) {
      return teams.find((team) => team.id === settings.homeTeamId) ?? null;
    }
    if (settings?.homeTeamBranding) {
      return {
        name: settings.homeTeamBranding.name,
        logoPath: settings.homeTeamBranding.logoPath,
        primaryColor: settings.homeTeamBranding.primaryColor ?? "#2563eb",
        secondaryColor: settings.homeTeamBranding.secondaryColor ?? "#ffffff",
      };
    }
    return null;
  }, [settings, teams]);

  const patchBrand = useCallback((partial: Partial<ProofOfPlayBrand>) => {
    setBrand((prev) => {
      const next = { ...prev, ...partial };
      if (partial.accentHex && !partial.headerTextHex && /^#[0-9a-fA-F]{6}$/.test(partial.accentHex)) {
        next.headerTextHex = contrastingTextHex(partial.accentHex);
      }
      return next;
    });
  }, []);

  const persistBrand = useCallback(async (next: ProofOfPlayBrand) => {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofOfPlayBrandJson: serializeProofOfPlayBrand(next) }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || t("reports.brandSaveFailed"));
    }
    reloadSettings();
  }, [reloadSettings, t]);

  async function applyHomeTeamBrand() {
    if (!homeTeam) return;
    let next = brandFromHomeTeam(homeTeam);
    if (next.logoPath) {
      const dataUrl = await storedLogoToDataUrl(next.logoPath);
      next = { ...next, logoDataUrl: dataUrl };
    }
    setBrand(next);
  }

  async function onBrandLogo(file?: File, localPath?: string) {
    setLogoBusy(true);
    try {
      if (localPath) {
        const dataUrl = await storedLogoToDataUrl(localPath);
        patchBrand({ logoPath: localPath, logoDataUrl: dataUrl });
        return;
      }
      if (!file) return;
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      if (!r.ok) {
        toast({ title: t("reports.logoFailed"), variant: "error" });
        return;
      }
      const data = (await r.json()) as { path?: string };
      const path = data.path ?? null;
      const dataUrl = await fileToPngDataUrl(file);
      patchBrand({ logoPath: path, logoDataUrl: dataUrl });
    } finally {
      setLogoBusy(false);
    }
  }

  async function onBrandLogoElectron() {
    const paths = await selectFilesViaDialog({
      title: t("setup.selectTeamLogo"),
      filters: [{ name: t("setup.filterImage"), extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (paths[0]) await onBrandLogo(undefined, paths[0]);
  }

  async function saveBrand() {
    if (savingBrand) return;
    setSavingBrand(true);
    try {
      await persistBrand(brand);
      toast({ title: t("reports.brandSaved"), variant: "success" });
    } catch (e) {
      toast({
        title: t("reports.brandSaveFailed"),
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    } finally {
      setSavingBrand(false);
    }
  }

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
        const resolvedBrand = parseProofOfPlayBrand(JSON.stringify(brand));
        if (format === "pdf") {
          try {
            await persistBrand(resolvedBrand);
          } catch {
            /* export mag doorgaan als bewaren faalt */
          }
        }
        const bytes =
          format === "xlsx"
            ? await buildProofOfPlayXlsx(exportRows, exportSummary, meta, exportLabels, dateLocale)
            : buildProofOfPlayPdf(exportRows, exportSummary, meta, exportLabels, dateLocale, {
                brand: resolvedBrand,
                logoDataUrl: resolvedBrand.logoDataUrl,
              });
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
    [queryString, filterLabel, exportAllowed, t, exportLabels, dateLocale, brand, persistBrand],
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

        <section className="mt-5 rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">{t("reports.brandTitle")}</h3>
            <p className="text-xs text-muted-foreground">{t("reports.brandIntro")}</p>
          </div>
          <div
            className="flex items-center gap-3 rounded-md px-3 py-2 min-h-[52px]"
            style={{ background: brand.accentHex, color: brand.headerTextHex }}
          >
            {(brand.logoPath || brand.logoDataUrl) && (
              <img
                src={brand.logoDataUrl || mediaUrl(brand.logoPath)}
                alt=""
                className="h-10 w-10 rounded bg-white/90 object-contain p-0.5"
              />
            )}
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest opacity-80">
                {t("reports.brandPreview")}
              </div>
              <div className="text-sm font-semibold truncate">
                {brand.reportTitle.trim() || t("reports.export.title")}
              </div>
              {brand.clubName && (
                <div className="text-xs truncate opacity-90">{brand.clubName}</div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <Label>{t("reports.clubName")}</Label>
              <Input
                value={brand.clubName}
                placeholder={t("reports.clubNamePlaceholder")}
                onChange={(e) => patchBrand({ clubName: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("reports.reportTitle")}</Label>
              <Input
                value={brand.reportTitle}
                placeholder={t("reports.reportTitlePlaceholder")}
                onChange={(e) => patchBrand({ reportTitle: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("reports.footer")}</Label>
              <Input
                value={brand.footer}
                placeholder={t("reports.footerPlaceholder")}
                onChange={(e) => patchBrand({ footer: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("reports.accentColor")}</Label>
              <div className="flex gap-2">
                <Input
                  value={brand.accentHex}
                  onChange={(e) => patchBrand({ accentHex: e.target.value })}
                />
                <input
                  type="color"
                  value={colorInputValue(brand.accentHex, "#2563eb")}
                  onChange={(e) => patchBrand({ accentHex: e.target.value })}
                  className="w-12 h-10 rounded border"
                />
              </div>
            </div>
            <div>
              <Label>{t("reports.headerTextColor")}</Label>
              <div className="flex gap-2">
                <Input
                  value={brand.headerTextHex}
                  onChange={(e) => patchBrand({ headerTextHex: e.target.value })}
                />
                <input
                  type="color"
                  value={colorInputValue(brand.headerTextHex, "#ffffff")}
                  onChange={(e) => patchBrand({ headerTextHex: e.target.value })}
                  className="w-12 h-10 rounded border"
                />
              </div>
            </div>
            <div>
              <Label>{t("setup.logo")}</Label>
              <div className="flex items-center gap-2 flex-wrap">
                {isElectron ? (
                  <Button variant="outline" size="sm" onClick={() => void onBrandLogoElectron()}>
                    {t("common.chooseFile")}
                  </Button>
                ) : (
                  <Input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onBrandLogo(f);
                    }}
                  />
                )}
                {logoBusy && <span className="text-xs">{t("common.loading")}</span>}
                {(brand.logoPath || brand.logoDataUrl) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => patchBrand({ logoPath: null, logoDataUrl: null })}
                  >
                    {t("common.remove")}
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!homeTeam}
              onClick={() => void applyHomeTeamBrand()}
            >
              {t("reports.useHomeTeam")}
            </Button>
            <Button size="sm" disabled={savingBrand} onClick={() => void saveBrand()}>
              {savingBrand ? t("common.saving") : t("reports.saveBrand")}
            </Button>
          </div>
        </section>

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

async function storedLogoToDataUrl(storedPath: string | null): Promise<string | null> {
  if (!storedPath) return null;
  try {
    const res = await fetch(`/api/proof-of-play-logo?path=${encodeURIComponent(storedPath)}`);
    if (res.ok) {
      const data = (await res.json()) as { dataUrl?: string };
      if (data.dataUrl?.startsWith("data:image/")) {
        return (await imageSrcToPngDataUrl(data.dataUrl)) ?? data.dataUrl;
      }
    }
  } catch {
    /* canvas-fallback hieronder */
  }
  return imageSrcToPngDataUrl(mediaUrl(storedPath));
}

function colorInputValue(hex: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex.trim()) ? hex.trim() : fallback;
}

async function imageSrcToPngDataUrl(src: string): Promise<string | null> {
  if (!src) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 256;
      const w = img.naturalWidth || 1;
      const h = img.naturalHeight || 1;
      const scale = Math.min(1, max / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function fileToPngDataUrl(file: File): Promise<string | null> {
  const local = URL.createObjectURL(file);
  try {
    return await imageSrcToPngDataUrl(local);
  } finally {
    URL.revokeObjectURL(local);
  }
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
