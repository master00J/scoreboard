"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  announcementVisible,
  formatCountdown,
  kickoffCountdownSeconds,
  type AnnouncementPosition,
  type AnnouncementTone,
  type CountdownPosition,
  type DisplayExtras,
} from "@/lib/display-extras";
import { sportStartEventVars } from "@/lib/i18n/t-phase";
import type { Match } from "@/lib/types";
import { useWallClockMs } from "@/lib/use-wall-clock-tick";

/**
 * Eén "eenheid" = 1% van de hoogte van een 16:9-vlak dat in het canvas past. Zo blijven de
 * aftelklok en de mededeling leesbaar op een smalle LED-strook én op een vierkant scherm.
 */
function canvasUnit(canvasWidth: number, canvasHeight: number): number {
  return Math.max(3, Math.min(canvasHeight, (canvasWidth * 9) / 16) / 100);
}

/** Hoogte van de band met de mededeling; de aftelklok houdt er rekening mee. */
function announcementBandHeight(canvasWidth: number, canvasHeight: number): number {
  return canvasUnit(canvasWidth, canvasHeight) * 10;
}

/** Aftelklok naar de geplande start, boven op wat het scherm op dat moment toont. */
export function KickoffCountdownOverlay({
  seconds,
  label,
  position,
  canvasWidth,
  canvasHeight,
  marginPx,
  edgeInsetPx = 0,
}: {
  seconds: number;
  label: string;
  position: CountdownPosition;
  canvasWidth: number;
  canvasHeight: number;
  marginPx: number;
  /** Ruimte die aan de boven- of onderrand al bezet is (de mededeling). */
  edgeInsetPx?: number;
}) {
  const u = canvasUnit(canvasWidth, canvasHeight);
  const center = position === "center";
  const margin = Math.max(marginPx, u * 3);
  const place: CSSProperties = center
    ? { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
    : {
        ...(position.startsWith("top") ? { top: margin + edgeInsetPx } : { bottom: margin + edgeInsetPx }),
        ...(position.endsWith("left") ? { left: margin } : { right: margin }),
      };

  return (
    <div
      className="pointer-events-none absolute z-[60] flex flex-col items-center text-white"
      data-kickoff-countdown
      style={{
        ...place,
        padding: center ? `${u * 3}px ${u * 6}px` : `${u * 1.4}px ${u * 2.8}px`,
        borderRadius: u * (center ? 3 : 1.8),
        background: "rgba(5, 6, 7, 0.78)",
        border: "1px solid rgba(255, 255, 255, 0.22)",
        boxShadow: "0 12px 40px rgba(0, 0, 0, 0.45)",
      }}
    >
      <span
        className="font-semibold uppercase leading-none text-white/75"
        style={{ fontSize: u * (center ? 4.2 : 2.3), letterSpacing: "0.18em" }}
      >
        {label}
      </span>
      <span
        className="font-black tabular-nums leading-none"
        style={{ fontSize: u * (center ? 17 : 7), marginTop: u * (center ? 2 : 0.9) }}
      >
        {formatCountdown(seconds)}
      </span>
    </div>
  );
}

/**
 * Mededeling van de operator: een band over de volle breedte. Past de tekst, dan staat hij stil in
 * het midden; is hij te lang, dan loopt hij als lichtkrant door het beeld.
 */
export function AnnouncementOverlay({
  text,
  position,
  tone,
  canvasWidth,
  canvasHeight,
}: {
  text: string;
  position: AnnouncementPosition;
  tone: AnnouncementTone;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const u = canvasUnit(canvasWidth, canvasHeight);
  const bandHeight = announcementBandHeight(canvasWidth, canvasHeight);
  const padding = u * 3;
  const textRef = useRef<HTMLSpanElement>(null);
  const [textWidth, setTextWidth] = useState(0);

  useLayoutEffect(() => {
    setTextWidth(textRef.current?.offsetWidth ?? 0);
  }, [text, canvasWidth, canvasHeight]);

  const scrolls = textWidth > canvasWidth - padding * 2;
  // Vaste leessnelheid: het scherm is in ongeveer negen seconden overgestoken.
  const speed = Math.max(120, canvasWidth * 0.11);
  const alert = tone === "alert";

  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 z-[61] overflow-hidden"
      data-announcement={scrolls ? "ticker" : "static"}
      initial={{ y: position === "top" ? -bandHeight : bandHeight, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: position === "top" ? -bandHeight : bandHeight, opacity: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      style={{
        ...(position === "top" ? { top: 0 } : { bottom: 0 }),
        height: bandHeight,
        background: alert ? "#b91c1c" : "rgba(9, 9, 11, 0.93)",
        [position === "top" ? "borderBottom" : "borderTop"]: `${Math.max(2, u * 0.4)}px solid ${
          alert ? "#fecaca" : "rgba(255, 255, 255, 0.3)"
        }`,
      }}
    >
      <motion.span
        key={`${text}:${scrolls ? "ticker" : "static"}:${canvasWidth}`}
        ref={textRef}
        className="absolute top-0 flex h-full items-center whitespace-nowrap font-bold text-white"
        style={{
          fontSize: u * 5,
          ...(scrolls ? { left: 0 } : { left: "50%", translateX: "-50%" }),
        }}
        {...(scrolls
          ? {
              initial: { x: canvasWidth },
              animate: { x: -textWidth },
              transition: {
                duration: (canvasWidth + textWidth) / speed,
                ease: "linear" as const,
                repeat: Infinity,
              },
            }
          : {})}
      >
        {text}
      </motion.span>
    </motion.div>
  );
}

/** Schermstanden waarin de aftelklok mag staan; niet over een spelersvoorstelling of zwart beeld. */
const COUNTDOWN_MODES = new Set(["IDLE", "MATCH", "SPONSOR", "SPONSOR_ROTATION"]);

/**
 * Aftelklok en mededeling boven op het stadionbeeld. Heeft een eigen klok, zodat alleen deze laag
 * elke halve seconde opnieuw tekent en niet het hele scherm.
 */
export function DisplayExtrasLayer({
  extras,
  match,
  mode,
  canvasWidth,
  canvasHeight,
  marginPx,
}: {
  extras: DisplayExtras;
  match: Match | null;
  mode: string;
  canvasWidth: number;
  canvasHeight: number;
  marginPx: number;
}) {
  const { t } = useTranslation();
  const now = useWallClockMs(500);
  const seconds =
    match && COUNTDOWN_MODES.has(mode)
      ? kickoffCountdownSeconds({
          settings: extras.kickoffCountdown,
          kickoffAt: match.kickoffAt,
          status: match.status,
          closedAt: match.closedAt,
          now,
        })
      : null;
  const showAnnouncement = mode !== "BLACKOUT" && announcementVisible(extras.announcement, now);
  // Staan beide aan dezelfde rand, dan schuift de klok onder of boven de band.
  const sameEdge = showAnnouncement && extras.kickoffCountdown.position.startsWith(extras.announcement.position);

  return (
    <>
      {seconds != null && match ? (
        <KickoffCountdownOverlay
          seconds={seconds}
          label={t("displayExtras.countdownLabel", sportStartEventVars(t, match.sport))}
          position={extras.kickoffCountdown.position}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          marginPx={marginPx}
          edgeInsetPx={sameEdge ? announcementBandHeight(canvasWidth, canvasHeight) : 0}
        />
      ) : null}
      <AnimatePresence>
        {showAnnouncement ? (
          <AnnouncementOverlay
            key="announcement"
            text={extras.announcement.text}
            position={extras.announcement.position}
            tone={extras.announcement.tone}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}
