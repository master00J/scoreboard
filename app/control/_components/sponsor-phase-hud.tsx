"use client";

import type { Match } from "@/lib/types";
import { useSponsorPhaseHud } from "../_hooks/use-sponsor-phase-hud";

export function SponsorPhaseHud({ match }: { match: Match | null }) {
  const model = useSponsorPhaseHud(match);

  if (model.kind === "inactive") {
    return null;
  }

  if (model.kind === "playlist_only") {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          Sponsor-timing
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
        Sponsor op scherm · {model.contextLabel}
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-lg font-semibold">
          {model.phase === "sponsor" ? (model.sponsorName ?? "Sponsor") : "Scorebord"}
        </span>
        <span className="text-xs font-mono text-muted-foreground shrink-0">
          {model.phase === "sponsor" ? "Bezig" : "Wacht"}
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
            <span>Clip voortgang</span>
            {model.clipRemainingSec != null && (
              <span>{model.clipRemainingSec.toFixed(1)} s resterend</span>
            )}
          </div>
        </div>
      )}

      {model.phase === "scoreboard" && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {model.nextSlotEtaSec != null ? (
            <>
              Volgende sponsor in beeld over <strong>{model.nextSlotEtaSec.toFixed(1)} s</strong>
            </>
          ) : (
            <>Geen volgende sponsor-slot meer in dit blok.</>
          )}
        </p>
      )}
    </div>
  );
}
