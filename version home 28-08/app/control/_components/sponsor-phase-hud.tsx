"use client";

import { useTranslation } from "react-i18next";
import type { Match } from "@/lib/types";
import { useSponsorPhaseHud } from "../_hooks/use-sponsor-phase-hud";

export function SponsorPhaseHud({ match }: { match: Match | null }) {
  const { t } = useTranslation();
  const model = useSponsorPhaseHud(match);

  if (model.kind === "inactive") {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          {t("sponsors.hudTitle")}
        </div>
        <div className="rounded-lg border border-dashed border-border bg-background/40 px-3 py-5 text-center">
          <p className="text-sm font-semibold text-foreground">
            {t("sponsors.hudInactiveTitle")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("sponsors.hudInactiveBody")}
          </p>
        </div>
      </div>
    );
  }

  if (model.kind === "playlist_only") {
    return (
      <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          {t("sponsors.hudTiming")}
        </div>
        <p>{model.label}</p>
      </div>
    );
  }

  const pct =
    model.sponsorClipProgress != null ? Math.round(model.sponsorClipProgress * 100) : null;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        {t("sponsors.hudTitle")} · {model.contextLabel}
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-lg font-semibold">
          {model.phase === "sponsor"
            ? (model.sponsorName ?? t("sponsors.hudSponsor"))
            : t("sponsors.hudScoreboard")}
        </span>
        <span className="text-xs font-mono text-muted-foreground shrink-0">
          {model.phase === "sponsor" ? t("sponsors.hudBusy") : t("sponsors.hudWait")}
        </span>
      </div>

      {model.phase === "sponsor" && model.sponsorClipProgress != null && (
        <div className="space-y-1">
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-200 ease-linear"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t("sponsors.clipProgress")}</span>
            {model.clipRemainingSec != null && (
              <span>{t("sponsors.clipRemaining", { sec: model.clipRemainingSec.toFixed(1) })}</span>
            )}
          </div>
        </div>
      )}

      {model.phase === "scoreboard" && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {model.prematchWindowOpensInSec != null
            ? t("sponsors.prematchWindowOpensIn", {
                sec: formatHudSeconds(model.prematchWindowOpensInSec),
              })
            : model.prematchTimelineComplete
              ? t("sponsors.prematchTimelineDone")
              : model.nextSlotEtaSec != null
                ? t("sponsors.nextIn", { sec: model.nextSlotEtaSec.toFixed(1) })
                : t("sponsors.noNext")}
        </p>
      )}
    </div>
  );
}

function formatHudSeconds(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  if (s < 60) return `${s}`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${m}:00`;
}
