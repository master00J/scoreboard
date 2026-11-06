"use client";

import { useMemo, type ReactNode } from "react";
import StreamProgramPage from "@/app/stream/page";
import { activeManualPhaseLayout } from "@/lib/stream-layer-layout";
import {
  resolveStreamProgramLayout,
  type StreamProgramPhase,
} from "@/lib/stream-program-layout";
import type { LivestreamSettings, StreamLayerLayout } from "@/lib/livestream";

/**
 * Eén plek om in te stellen wát er op de stream staat en wáár.
 *
 * De bediening had dat verspreid: aanvinken wat zichtbaar is zat in een formulier, de plaats in een
 * ander blok met ankerknoppen, en slepen kon alleen in een voorbeeld dat enkel verscheen bij een
 * capture-kaart die niet live stond. De tip "sleep de widget in de preview" wees dus vaak naar iets
 * dat er niet was.
 *
 * Hier staat het beeldvlak zelf centraal: je ziet de stream zoals de kijker hem krijgt, je zet lagen
 * aan en uit naast het vlak, en je sleept de score-widget waar je hem wil. De fase kies je er zelf
 * bij, zodat je de rustindeling ook tijdens het spel kunt klaarzetten.
 */
export function StreamLayoutDesigner({
  settings,
  phase,
  onPhaseChange,
  onLayoutChange,
  onScoreWidgetChange,
  t,
}: {
  settings: LivestreamSettings;
  phase: StreamProgramPhase;
  onPhaseChange: (phase: StreamProgramPhase) => void;
  onLayoutChange: (partial: Partial<StreamLayerLayout>) => void;
  onScoreWidgetChange: (partial: Partial<LivestreamSettings["scoreWidget"]>, commit: boolean) => void;
  t: (key: string, opts?: Record<string, string | number>) => string;
}) {
  const auto = settings.layoutMode !== "manual";
  const resolved = useMemo(
    () => resolveStreamProgramLayout(settings, undefined, phase),
    [settings, phase],
  );
  // Wat de vinkjes tonen: bij automatisch de uitkomst, anders de eigen keuze voor deze fase.
  const config = auto ? null : activeManualPhaseLayout(settings, phase);
  const scoreOn = config ? config.score : resolved.showScore;
  const sponsorsOn = config ? config.sponsors : resolved.showSponsorStrip || resolved.showSponsorBreak;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-secondary/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("livestream.designerTitle")}
        </span>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary/40 p-1">
          {(["play", "break"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={phase === item}
              className={`rounded-md px-3 py-1 text-[11px] ${
                phase === item ? "bg-background font-semibold shadow-sm" : "text-muted-foreground"
              }`}
              onClick={() => onPhaseChange(item)}
            >
              {t(item === "play" ? "livestream.phasePlay" : "livestream.phaseBreak")}
            </button>
          ))}
        </div>
      </div>

      {/* Begrensd: een voorbeeld op volle breedte duwt alles eronder van het scherm. */}
      <div className="relative w-full max-w-[34rem] overflow-hidden rounded-md border border-border bg-black">
        <div className="relative aspect-video w-full">
          <StreamProgramPage
            embedded
            layoutCanvas
            phaseOverride={phase}
            settingsOverride={settings}
            onScoreWidgetChange={onScoreWidgetChange}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Toggle
          checked={scoreOn}
          onChange={(score) => onLayoutChange({ score })}
          label={t("livestream.overlay")}
        />
        <Toggle
          checked={sponsorsOn}
          onChange={(sponsors) => onLayoutChange({ sponsors })}
          label={t("livestream.sponsors")}
        />
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        {scoreOn ? t("livestream.designerDragHint") : t("livestream.designerScoreOff")}
      </p>
      {auto ? (
        <p className="text-[11px] leading-snug text-sky-300/90">{t("livestream.designerAutoHint")}</p>
      ) : null}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
