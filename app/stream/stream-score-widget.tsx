"use client";

import type { Match } from "@/lib/types";
import { mediaUrl } from "@/lib/media-url";
import { formatTime } from "@/lib/utils";
import { StableClockText } from "@/components/stable-clock-text";
import {
  widgetPanelBackground,
  widgetShapeStyle,
  widgetTeamLabel,
  type StreamScoreWidgetSettings,
} from "@/lib/stream-score-widget";
import { StreamOverlayTransform } from "@/app/stream/stream-overlay-transform";

function Logo({ path, size, alt }: { path: string | null; size: number; alt: string }) {
  if (!path) {
    return (
      <div
        className="grid shrink-0 place-items-center font-black"
        style={{ width: size, height: size, fontSize: size * 0.38, color: "rgba(255,255,255,0.55)" }}
      >
        {alt.slice(0, 1)}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={mediaUrl(path)} alt="" className="shrink-0 object-contain" style={{ width: size, height: size }} />
  );
}

export function StreamScoreWidget({
  match,
  elapsed,
  running,
  period,
  addedTime = 0,
  widget,
  interactive = false,
  onTransformChange,
}: {
  match: Match;
  elapsed: number;
  running: boolean;
  period?: string;
  addedTime?: number;
  widget: StreamScoreWidgetSettings;
  interactive?: boolean;
  onTransformChange?: (next: { xPct: number; yPct: number; scale: number }, commit: boolean) => void;
}) {
  const logo = widget.style === "minimal" || widget.style === "split" ? 22 : 28;
  const scorePx = widget.style === "minimal" ? 22 : widget.style === "banner" ? 28 : 26;
  const namePx = widget.style === "bar" || widget.style === "banner" ? 13 : 12;
  const timerPx = widget.style === "minimal" ? 16 : 15;
  const homeTint = widget.useTeamColors ? match.homeTeam.primaryColor : "transparent";
  const awayTint = widget.useTeamColors ? match.awayTeam.primaryColor : "transparent";
  const homeName = widgetTeamLabel(match.homeTeam, widget.nameMode);
  const awayName = widgetTeamLabel(match.awayTeam, widget.nameMode);
  const shape = widgetShapeStyle(widget);
  const panel = {
    background: widgetPanelBackground(widget.bgColor, widget.bgOpacity),
    color: widget.textColor,
    ...shape,
    border: widget.borderWidth > 0 ? `${widget.borderWidth}px solid ${widget.borderColor}` : undefined,
    boxShadow: `0 8px 24px rgba(0,0,0,0.45), 0 0 0 1px ${widget.accentColor}40`,
  } as const;

  return (
    <StreamOverlayTransform
      xPct={widget.xPct}
      yPct={widget.yPct}
      scale={widget.scale}
      interactive={interactive}
      onChange={onTransformChange}
    >
      {widget.style === "stacked" ? (
        <div className="flex min-w-[168px] flex-col overflow-hidden" style={{ ...panel }}>
          <TeamRow
            logoPath={widget.showLogos ? match.homeTeam.logoPath : null}
            logoSize={logo}
            name={homeName}
            score={match.homeScore}
            showName={widget.showNames}
            namePx={namePx}
            scorePx={scorePx}
            scoreColor={widget.scoreColor}
            tint={homeTint}
          />
          <ClockBlock
            showPeriod={widget.showPeriod}
            showTimer={widget.showTimer}
            period={period}
            elapsed={elapsed}
            running={running}
            timerColor={widget.timerColor}
            addedTime={addedTime}
            timerPx={timerPx}
            accent={widget.accentColor}
          />
          <TeamRow
            logoPath={widget.showLogos ? match.awayTeam.logoPath : null}
            logoSize={logo}
            name={awayName}
            score={match.awayScore}
            showName={widget.showNames}
            namePx={namePx}
            scorePx={scorePx}
            scoreColor={widget.scoreColor}
            tint={awayTint}
          />
        </div>
      ) : widget.style === "split" ? (
        <div className="flex items-center gap-2">
          <div className="overflow-hidden" style={panel}>
            <TeamBlock
              logoPath={widget.showLogos ? match.homeTeam.logoPath : null}
              logoSize={logo}
              name={homeName}
              score={match.homeScore}
              showName={widget.showNames}
              namePx={namePx}
              scorePx={scorePx}
              scoreColor={widget.scoreColor}
              tint={homeTint}
              align="left"
            />
          </div>
          {(widget.showTimer || widget.showPeriod) && (
            <div className="overflow-hidden px-2 py-1" style={panel}>
              <ClockBlock
                showPeriod={widget.showPeriod}
                showTimer={widget.showTimer}
                period={period}
                elapsed={elapsed}
                running={running}
                timerColor={widget.timerColor}
                addedTime={addedTime}
                timerPx={timerPx}
                accent={widget.accentColor}
              />
            </div>
          )}
          <div className="overflow-hidden" style={panel}>
            <TeamBlock
              logoPath={widget.showLogos ? match.awayTeam.logoPath : null}
              logoSize={logo}
              name={awayName}
              score={match.awayScore}
              showName={widget.showNames}
              namePx={namePx}
              scorePx={scorePx}
              scoreColor={widget.scoreColor}
              tint={awayTint}
              align="right"
            />
          </div>
        </div>
      ) : (
        <div
          className="flex items-center overflow-hidden"
          style={{
            ...panel,
            padding: widget.style === "banner" ? "7px 14px" : widget.style === "bar" ? "6px 10px" : "5px 8px",
            gap: widget.style === "minimal" ? 8 : 10,
            minWidth: widget.style === "banner" ? 320 : undefined,
            borderLeft: widget.style === "broadcast" ? `4px solid ${widget.accentColor}` : undefined,
          }}
        >
          <TeamBlock
            logoPath={widget.showLogos ? match.homeTeam.logoPath : null}
            logoSize={logo}
            name={homeName}
            score={match.homeScore}
            showName={widget.showNames}
            namePx={namePx}
            scorePx={scorePx}
            scoreColor={widget.scoreColor}
            tint={homeTint}
            align="left"
          />
          {(widget.showTimer || widget.showPeriod) && (
            <ClockBlock
              showPeriod={widget.showPeriod}
              showTimer={widget.showTimer}
              period={period}
              elapsed={elapsed}
              running={running}
              timerColor={widget.timerColor}
              addedTime={addedTime}
              timerPx={timerPx}
              accent={widget.accentColor}
              boxed
            />
          )}
          <TeamBlock
            logoPath={widget.showLogos ? match.awayTeam.logoPath : null}
            logoSize={logo}
            name={awayName}
            score={match.awayScore}
            showName={widget.showNames}
            namePx={namePx}
            scorePx={scorePx}
            scoreColor={widget.scoreColor}
            tint={awayTint}
            align="right"
          />
        </div>
      )}
    </StreamOverlayTransform>
  );
}

function ClockBlock({
  showPeriod,
  showTimer,
  period,
  elapsed,
  running,
  timerColor,
  addedTime,
  timerPx,
  accent,
  boxed,
}: {
  showPeriod: boolean;
  showTimer: boolean;
  period?: string;
  elapsed: number;
  running: boolean;
  timerColor: string;
  addedTime: number;
  timerPx: number;
  accent: string;
  boxed?: boolean;
}) {
  return (
    <div
      className="flex min-w-[64px] flex-col items-center justify-center px-1.5 py-1"
      style={boxed ? { borderLeft: `1px solid ${accent}33`, borderRight: `1px solid ${accent}33` } : undefined}
    >
      {showPeriod ? (
        <div className="uppercase tracking-[0.14em] opacity-60" style={{ fontSize: 9 }}>
          {period ?? "LIVE"}
        </div>
      ) : null}
      {showTimer ? (
        <StableClockText
          value={formatTime(elapsed)}
          className="font-black tabular-nums leading-none"
          style={{ fontSize: timerPx, color: running ? timerColor : "#fbbf24" }}
        />
      ) : null}
      {showTimer && addedTime > 0 ? (
        <div
          className="mt-0.5 rounded px-1 font-bold leading-none"
          style={{ fontSize: 10, background: "#fbbf24", color: "#111" }}
        >
          +{addedTime}
        </div>
      ) : null}
    </div>
  );
}

function TeamRow({
  logoPath,
  logoSize,
  name,
  score,
  showName,
  namePx,
  scorePx,
  scoreColor,
  tint,
}: {
  logoPath: string | null;
  logoSize: number;
  name: string;
  score: number;
  showName: boolean;
  namePx: number;
  scorePx: number;
  scoreColor: string;
  tint: string;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-2.5 py-1.5"
      style={{ background: tint === "transparent" ? "transparent" : `${tint}33` }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Logo path={logoPath} size={logoSize} alt={name} />
        {showName ? (
          <div className="truncate font-bold uppercase leading-none" style={{ fontSize: namePx }}>
            {name}
          </div>
        ) : null}
      </div>
      <div className="font-black tabular-nums leading-none" style={{ fontSize: scorePx, color: scoreColor }}>
        {score}
      </div>
    </div>
  );
}

function TeamBlock({
  logoPath,
  logoSize,
  name,
  score,
  showName,
  namePx,
  scorePx,
  scoreColor,
  tint,
  align,
}: {
  logoPath: string | null;
  logoSize: number;
  name: string;
  score: number;
  showName: boolean;
  namePx: number;
  scorePx: number;
  scoreColor: string;
  tint: string;
  align: "left" | "right";
}) {
  const logo = <Logo path={logoPath} size={logoSize} alt={name} />;
  const label = showName ? (
    <div
      className="max-w-[92px] truncate font-bold uppercase leading-none"
      style={{ fontSize: namePx, letterSpacing: "0.04em" }}
    >
      {name}
    </div>
  ) : null;
  const scoreEl = (
    <div
      className="min-w-[1.15em] text-center font-black tabular-nums leading-none"
      style={{ fontSize: scorePx, color: scoreColor }}
    >
      {score}
    </div>
  );
  const inner =
    align === "left" ? (
      <>
        {logo}
        {label}
        {scoreEl}
      </>
    ) : (
      <>
        {scoreEl}
        {label}
        {logo}
      </>
    );
  return (
    <div
      className="flex items-center gap-1.5 px-1.5 py-0.5"
      style={{ background: tint === "transparent" ? "transparent" : `${tint}33` }}
    >
      {inner}
    </div>
  );
}
