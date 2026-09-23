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
  const clipLabel = hudClipLabel(model.sponsorName, model.mediaTitle, model.mediaFileName);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        {t("sponsors.hudTitle")} · {model.contextLabel}
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="text-lg font-semibold">
            {model.phase === "sponsor"
              ? (model.sponsorName ?? t("sponsors.hudSponsor"))
              : t("sponsors.hudScoreboard")}
          </span>
          {model.phase === "sponsor" && clipLabel ? (
            <p
              className="mt-0.5 truncate text-sm font-medium text-foreground/85"
              title={
                model.mediaFileName && model.mediaFileName !== clipLabel
                  ? `${clipLabel} (${model.mediaFileName})`
                  : clipLabel
              }
            >
              <span className="text-[11px] font-normal uppercase tracking-wide text-muted-foreground">
                {model.hasLiveClip ? t("sponsors.hudMedia") : t("sponsors.hudMediaPlanned")}
                {": "}
              </span>
              {clipLabel}
            </p>
          ) : null}
        </div>
        <span
          className={`text-xs font-mono shrink-0 ${
            model.phase === "sponsor" && model.playbackUnconfirmed
              ? "text-amber-500"
              : "text-muted-foreground"
          }`}
        >
          {model.phase === "sponsor"
            ? model.playbackUnconfirmed
              ? t("sponsors.hudUnconfirmed")
              : t("sponsors.hudBusy")
            : t("sponsors.hudWait")}
        </span>
      </div>

      {model.coveredByCapture && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-600/90">
          {t("sponsors.hudCapturePaused")}
        </p>
      )}

      {model.phase === "sponsor" && model.playbackUnconfirmed && !model.coveredByCapture && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-600/90">
          {t("sponsors.hudUnconfirmedHint")}
        </p>
      )}

      {model.phase === "sponsor" && !model.playbackUnconfirmed && model.sponsorClipProgress != null && (
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

function hudClipLabel(
  sponsorName: string | null,
  mediaTitle: string | null,
  mediaFileName: string | null,
): string | null {
  const title = mediaTitle?.trim() || null;
  const file = mediaFileName?.trim() || null;
  if (title && file && title !== file) {
    return title === sponsorName ? file : title;
  }
  return title ?? file;
}
