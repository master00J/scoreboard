"use client";

import { useTranslation } from "react-i18next";
import type { Match } from "@/lib/types";
import { useSponsorPhaseHud } from "../_hooks/use-sponsor-phase-hud";

export function SponsorPhaseHud({ match }: { match: Match | null }) {
  const { t } = useTranslation();
  const model = useSponsorPhaseHud(match);

  if (model.kind === "inactive") {
    return null;
  }

  if (model.kind === "playlist_only") {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
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
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
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

      {model.phase === "sponsor" && (model.mediaTitle || model.mediaFileName) ? (
        <div className="min-w-0 rounded-md border border-border/70 bg-secondary/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {model.hasLiveClip ? t("sponsors.hudMedia") : t("sponsors.hudMediaPlanned")}
          </div>
          {model.mediaTitle ? (
            <div className="truncate text-sm font-medium">{model.mediaTitle}</div>
          ) : null}
          {model.mediaFileName && model.mediaFileName !== model.mediaTitle ? (
            <div className="truncate text-xs text-muted-foreground">{model.mediaFileName}</div>
          ) : null}
        </div>
      ) : null}

      {model.phase === "sponsor" && !model.hasLiveClip && !model.mediaTitle && !model.mediaFileName ? (
        <p className="text-xs text-amber-400/90 leading-relaxed">{t("sponsors.hudNoLiveClip")}</p>
      ) : null}

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
