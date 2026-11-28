"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { taperClipPath, type LayoutElement } from "@/lib/scoreboard-elements";
import { slotStyle, type ResolvedScoreboardTheme } from "@/lib/scoreboard-theme";
import type { Match } from "@/lib/types";
import { mediaUrl } from "@/lib/media-url";
import { clubBrandAsset } from "@/lib/club-brand/assets";
import { SportTeamExtras } from "./sport-score-extras";
import { FitText, fitOrigin } from "@/components/fit-text";

/** Laag van een element: de volgorde in de lijst, boven achtergrondbeeld en teamgloed. */
export function elementLayer(index: number): number {
  return 10 + index;
}

/** Plek, laag en vlakkleur van een element op het canvas. */
export function elementBoxStyle(element: LayoutElement, index: number): CSSProperties {
  return {
    ...slotStyle(element),
    zIndex: elementLayer(index),
    ...(element.style?.background ? { background: element.style.background } : {}),
    ...(element.style?.taper ? { clipPath: taperClipPath(element.style.taper) } : {}),
  };
}

/** Schaduw achter tekst, tenzij het thema een vlakke stijl zonder schaduw vraagt. */
export function themeTextShadow(theme: ResolvedScoreboardTheme, shadow: string): string | undefined {
  return theme.textShadows ? shadow : undefined;
}

/**
 * Eigen schaal en uitlijning voor de inhoud van een element. Zonder eigen opmaak komt er
 * `undefined` terug, zodat een bestaande indeling exact hetzelfde blijft renderen.
 */
export function elementInnerStyle(element: LayoutElement): CSSProperties | undefined {
  const style: CSSProperties = {};
  const align = element.style?.align;
  const scale = element.style?.fontScale;
  if (scale && scale !== 1) {
    style.transform = `scale(${scale})`;
    style.transformOrigin = align === "left" ? "left center" : align === "right" ? "right center" : "center";
  }
  if (align === "left") {
    style.alignItems = "flex-start";
    style.textAlign = "left";
  } else if (align === "right") {
    style.alignItems = "flex-end";
    style.textAlign = "right";
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

/** Lettergrootte waarmee één regel tekst van deze lengte in het vak past (hoogte én breedte). */
function fitFontSize(text: string, heightShare = 62): string {
  const length = Math.max(1, text.length);
  const perChar = Math.min(60, Math.max(3, 160 / length));
  return `min(${heightShare}cqh, ${perChar.toFixed(1)}cqw)`;
}

function useClockMinute(): string {
  const format = () =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const [now, setNow] = useState(format);
  useEffect(() => {
    const id = window.setInterval(() => setNow(format()), 5_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function TimeOfDay({
  style,
  boost,
  origin,
}: {
  style: CSSProperties;
  boost: number;
  origin: CSSProperties["transformOrigin"];
}) {
  const now = useClockMinute();
  return (
    <FitText
      boost={boost}
      origin={origin}
      className="font-black tabular-nums leading-none"
      style={{ ...style, fontSize: fitFontSize("00:00", 70) }}
    >
      {now}
    </FitText>
  );
}

/**
 * Een vrij toegevoegd element: clubnaam, extra's (sets/time-outs/fouten), periode, kloktijd,
 * vrije tekst of een beeld. De klassieke vakken tekent het scorebord zelf.
 */
export function ExtraElement({
  element,
  index,
  match,
  period,
  theme,
}: {
  element: LayoutElement;
  index: number;
  match: Match;
  period: string;
  theme: ResolvedScoreboardTheme;
}) {
  const team = element.side === "away" ? match.awayTeam : match.homeTeam;
  const align = element.style?.align ?? "center";
  const justify = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
  const scale = element.style?.fontScale;
  const origin = fitOrigin(align);
  const text: CSSProperties = {
    color: element.style?.color,
    textTransform: element.style?.uppercase ? "uppercase" : undefined,
    whiteSpace: "nowrap",
  };

  let content: React.ReactNode = null;
  switch (element.type) {
    case "teamName": {
      const name = team.name || team.shortName;
      content = (
        <FitText
          boost={scale ?? 1}
          origin={origin}
          className="font-bold leading-none"
          style={{ ...text, color: text.color ?? theme.teamNameColor, fontSize: fitFontSize(name) }}
        >
          {name}
        </FitText>
      );
      break;
    }
    case "teamExtras":
      content = (
        <div className="w-full min-w-0" style={{ color: text.color, whiteSpace: "nowrap" }}>
          <SportTeamExtras match={match} side={element.side === "away" ? "away" : "home"} />
        </div>
      );
      break;
    case "period":
      content = (
        <FitText
          boost={scale ?? 1}
          origin={origin}
          className="font-semibold uppercase leading-none tracking-[0.2em]"
          style={{ ...text, color: text.color ?? "rgba(255,255,255,0.6)", fontSize: fitFontSize(`${period}  `) }}
        >
          {period}
        </FitText>
      );
      break;
    case "timeOfDay":
      content = <TimeOfDay style={{ ...text, color: text.color ?? "#ffffff" }} boost={scale ?? 1} origin={origin} />;
      break;
    case "text": {
      const value = element.text ?? "";
      content = value ? (
        <FitText
          boost={scale ?? 1}
          origin={origin}
          className="font-bold leading-none"
          style={{ ...text, color: text.color ?? "#ffffff", fontSize: fitFontSize(value) }}
        >
          {value}
        </FitText>
      ) : null;
      break;
    }
    case "scoreLine": {
      const line = `${match.homeScore}-${match.awayScore}`;
      content = (
        <FitText
          boost={scale ?? 1}
          origin={origin}
          className="font-black leading-none"
          style={{
            ...text,
            color: text.color ?? theme.scoreColor,
            fontSize: fitFontSize(line),
            textShadow: themeTextShadow(theme, "0 8px 40px rgba(0,0,0,0.55)"),
          }}
        >
          {line}
        </FitText>
      );
      break;
    }
    case "shape":
      // Alleen het vlak zelf: kleur en vorm zitten in de stijl van het vak.
      break;
    case "image": {
      const raw = element.src ?? "";
      const src = raw.startsWith("brand:") ? clubBrandAsset(raw) : mediaUrl(raw);
      content = src ? <img src={src} alt="" className="h-full w-full object-contain" /> : null;
      break;
    }
    default:
      return null;
  }

  return (
    <div
      className="absolute box-border overflow-hidden"
      style={{ ...elementBoxStyle(element, index), containerType: "size" }}
      data-layout-element={element.id}
      data-fit-box
    >
      <div
        className="flex h-full w-full items-center"
        style={{
          justifyContent: justify,
          padding: element.type === "image" ? 0 : "0 3cqw",
          ...(scale && scale !== 1
            ? { transform: `scale(${scale})`, transformOrigin: `${align === "center" ? "center" : align} center` }
            : {}),
        }}
      >
        {content}
      </div>
    </div>
  );
}
