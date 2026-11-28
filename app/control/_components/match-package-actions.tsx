"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { MatchPackageErrorCode, MatchPackageImportPlan } from "@/lib/desktop-bridge";
import { applyMatchPackage, discardMatchPackage, exportMatchPackage, isElectron, openMatchPackage } from "@/lib/electron";

function errorText(t: TFunction, code: MatchPackageErrorCode | undefined, version?: string): string {
  switch (code) {
    case "busy":
      return t("matchPackage.errorBusy");
    case "unpack_failed":
      return t("matchPackage.errorUnpack");
    case "not_a_match_package":
      return t("matchPackage.errorNotPackage");
    case "newer_version":
      return t("matchPackage.errorNewerVersion", { version: version ?? "?" });
    case "match_in_play":
      return t("matchPackage.errorInPlay");
    case "not_found":
      return t("matchPackage.errorNotFound");
    default:
      return t("matchPackage.errorFailed");
  }
}

/** Wat de operator bevestigt: welke wedstrijd, welke teams nieuw zijn en welke worden bijgewerkt. */
export function matchPackageConfirmText(t: TFunction, plan: MatchPackageImportPlan, locale: string): string {
  const lines = [t("matchPackage.confirmTitle", { home: plan.homeName, away: plan.awayName })];
  if (plan.kickoffAt) {
    lines.push(
      new Date(plan.kickoffAt).toLocaleString(locale, {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  }
  lines.push("");
  lines.push(plan.matchExists ? t("matchPackage.confirmMatchUpdate") : t("matchPackage.confirmMatchNew"));
  for (const team of plan.teams) {
    lines.push(
      team.action === "create"
        ? `• ${t("matchPackage.confirmTeamNew", { name: team.name, count: team.playersNew })}`
        : `• ${t("matchPackage.confirmTeamUpdate", { name: team.name, added: team.playersNew, updated: team.playersUpdated })}`,
    );
  }
  if (plan.files > 0) lines.push(`• ${t("matchPackage.confirmFiles", { count: plan.files })}`);
  lines.push("");
  lines.push(t("matchPackage.confirmKeep"));
  return lines.join("\n");
}

/** "Wedstrijd inlezen…": kiest een pakket, toont wat er verandert en voegt het na bevestiging samen. */
export function MatchPackageImportButton({ onImported }: { onImported: () => void }) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (!isElectron) return null;

  async function run() {
    const opened = await openMatchPackage();
    if (opened.canceled) return;
    if (!opened.ok || !opened.token || !opened.plan) {
      toast({
        title: t("matchPackage.importFailed"),
        description: errorText(t, opened.errorCode, opened.packageVersion),
        variant: "error",
      });
      return;
    }
    if (!window.confirm(matchPackageConfirmText(t, opened.plan, i18n.language))) {
      await discardMatchPackage(opened.token);
      return;
    }
    const applied = await applyMatchPackage(opened.token);
    if (!applied.ok || !applied.result) {
      toast({ title: t("matchPackage.importFailed"), description: errorText(t, applied.errorCode), variant: "error" });
      return;
    }
    toast({
      title: t("matchPackage.imported"),
      description: t("matchPackage.importedDetail", {
        home: opened.plan.homeName,
        away: opened.plan.awayName,
        added: applied.result.playersCreated,
        updated: applied.result.playersUpdated,
      }),
      variant: "success",
    });
    onImported();
  }

  return (
    <Button
      variant="outline"
      disabled={busy}
      title={t("matchPackage.importHint")}
      onClick={() => {
        setBusy(true);
        void run().finally(() => setBusy(false));
      }}
    >
      {t("matchPackage.importButton")}
    </Button>
  );
}

/** Zet één wedstrijd met beide teams, spelers en media in een ZIP voor een andere pc. */
export function MatchPackageExportButton({ matchId }: { matchId: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (!isElectron) return null;

  async function run() {
    const r = await exportMatchPackage(matchId);
    if (r.canceled) return;
    if (!r.ok) {
      toast({ title: t("matchPackage.exportFailed"), description: errorText(t, r.errorCode), variant: "error" });
      return;
    }
    const skipped = r.skipped?.length ?? 0;
    toast({
      title: t("matchPackage.saved"),
      description: skipped > 0 ? `${r.filePath ?? ""} ${t("matchPackage.skipped", { count: skipped })}` : (r.filePath ?? ""),
      variant: skipped > 0 ? "warning" : "success",
    });
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      title={t("matchPackage.exportHint")}
      onClick={() => {
        setBusy(true);
        void run().finally(() => setBusy(false));
      }}
    >
      {t("matchPackage.exportButton")}
    </Button>
  );
}
