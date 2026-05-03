"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useDisplayStore } from "@/lib/store";
import { useLiveTimerSeconds } from "@/lib/use-timer";
import type { Match, Playlist, PlaylistSlot, Sponsor, SponsorSection } from "@/lib/types";
import {
  activeSponsorsForSection,
  buildSponsorSlotMap,
  halfWindowElapsed,
  lookupSponsorAtSecond,
  holdSecondsForSponsorPhase,
  resolveSponsorSpreadPhase,
} from "@/lib/sponsor-distribution";
import {
  hasSponsorsForSection,
  secondsUntilNextSponsorSlot,
  sectionForStatus,
  sponsorBesideShowsPanel,
  sponsorHalftimeShowsPanel,
  sponsorRotationBesideScoreboard,
} from "@/lib/sponsor-display-helpers";

export type SponsorPhaseHudModel =
  | { kind: "inactive" }
  | { kind: "playlist_only"; label: string }
  | {
      kind: "roster";
      contextLabel: string;
      phase: "scoreboard" | "sponsor";
      sponsorName: string | null;
      sponsorClipProgress: number | null;
      nextSlotEtaSec: number | null;
      clipRemainingSec: number | null;
    };

const EMPTY_PLAYLISTS: Record<PlaylistSlot, Playlist | null> = {
  IDLE: null,
  PREMATCH: null,
  HALFTIME: null,
  POSTMATCH: null,
  GOAL: null,
};

export function useSponsorPhaseHud(match: Match | null): SponsorPhaseHudModel {
  const state = useDisplayStore((s) => s.state);
  const mode = state?.mode ?? "IDLE";
  const elapsed = useLiveTimerSeconds();

  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [playlists, setPlaylists] =
    useState<Record<PlaylistSlot, Playlist | null>>(EMPTY_PLAYLISTS);

  useEffect(() => {
    fetch("/api/sponsors")
      .then((r) => r.json())
      .then((list: Sponsor[]) => setSponsors(list ?? []))
      .catch(() => setSponsors([]));
  }, [state?.updatedAt]);

  useEffect(() => {
    fetch("/api/playlists")
      .then((r) => r.json())
      .then((list: Playlist[]) => {
        const map: Record<PlaylistSlot, Playlist | null> = { ...EMPTY_PLAYLISTS };
        for (const p of list) {
          map[p.slot as PlaylistSlot] = p;
        }
        setPlaylists(map);
      })
      .catch(() => setPlaylists(EMPTY_PLAYLISTS));
  }, [state?.updatedAt]);

  const liveAutoBeside = useMemo(
    () =>
      !!match &&
      !!state &&
      mode === "SPONSOR_ROTATION" &&
      sponsorRotationBesideScoreboard(match.status) &&
      sponsorBesideShowsPanel(match, sponsors, playlists),
    [match, state, mode, sponsors, playlists],
  );

  const liveAutoHalftime = useMemo(
    () =>
      !!match &&
      !!state &&
      mode === "SPONSOR_ROTATION" &&
      match.status === "HALF_TIME" &&
      sponsorHalftimeShowsPanel(match, sponsors, playlists),
    [match, state, mode, sponsors, playlists],
  );

  const prematchSpreadActive = useMemo(() => {
    if (!state) return false;
    if (activeSponsorsForSection(sponsors, "prematch").length === 0) return false;
    if (mode === "IDLE") return true;
    return !!(
      mode === "SPONSOR_ROTATION" &&
      match &&
      !sponsorRotationBesideScoreboard(match.status) &&
      !liveAutoHalftime &&
      sectionForStatus(match.status) === "prematch"
    );
  }, [state, mode, match, sponsors, liveAutoHalftime]);

  const rustEpochRef = useRef<number | null>(null);
  useEffect(() => {
    if (match?.status === "HALF_TIME" && liveAutoHalftime) {
      if (rustEpochRef.current == null) rustEpochRef.current = Date.now();
    } else {
      rustEpochRef.current = null;
    }
  }, [match?.status, liveAutoHalftime]);

  const [phaseTick, setPhaseTick] = useState(0);
  useEffect(() => {
    if (!liveAutoBeside && !liveAutoHalftime && !prematchSpreadActive) return;
    const id = setInterval(() => setPhaseTick((n) => n + 1), 400);
    return () => clearInterval(id);
  }, [liveAutoBeside, liveAutoHalftime, prematchSpreadActive]);

  const sponsorSlotMapMatch = useMemo(() => {
    if (!match) return [] as (string | null)[];
    const active = activeSponsorsForSection(sponsors, "match", match.status);
    const H = Math.max(60, match.halfDurationSec);
    return buildSponsorSlotMap(active, "match", H, match.status);
  }, [match?.id, match?.status, match?.halfDurationSec, sponsors]);

  const sponsorSlotMapHalftime = useMemo(() => {
    if (!match) return [] as (string | null)[];
    const active = activeSponsorsForSection(sponsors, "halftime");
    const H = Math.max(60, match.halfBreakSec);
    return buildSponsorSlotMap(active, "halftime", H);
  }, [match?.id, match?.halfBreakSec, sponsors]);

  const sponsorSlotMapPrematch = useMemo(() => {
    const active = activeSponsorsForSection(sponsors, "prematch");
    const budgetTotal = active.reduce((a, s) => a + Math.max(0, s.prematchSeconds), 0);
    const H = Math.max(60, budgetTotal);
    return buildSponsorSlotMap(active, "prematch", H);
  }, [sponsors]);

  const tInterruptFrozen = useRef(0);
  const sponsorPhaseHangRef = useRef<{ sponsorId: string; untilMs: number } | null>(null);
  const prematchPhaseHangRef = useRef<{ sponsorId: string; untilMs: number } | null>(null);
  const prematchOriginRef = useRef<number | null>(null);

  useEffect(() => {
    sponsorPhaseHangRef.current = null;
    prematchPhaseHangRef.current = null;
    prematchOriginRef.current = null;
  }, [match?.id]);

  useEffect(() => {
    if (!prematchSpreadActive) {
      prematchOriginRef.current = null;
      prematchPhaseHangRef.current = null;
    }
  }, [prematchSpreadActive]);

  useEffect(() => {
    if (prematchSpreadActive && prematchOriginRef.current == null) {
      prematchOriginRef.current = Date.now();
    }
  }, [prematchSpreadActive]);

  const sponsorDistView = useMemo(() => {
    const now = Date.now();

    if (liveAutoBeside && match) {
      const tLive = halfWindowElapsed(elapsed, match.status, match.halfDurationSec);
      if (mode === "SPONSOR_ROTATION") {
        tInterruptFrozen.current = tLive;
      }
      const t = mode === "SPONSOR_ROTATION" ? tLive : tInterruptFrozen.current;
      const v = lookupSponsorAtSecond(sponsorSlotMapMatch, t);
      const section = sectionForStatus(match.status);
      return resolveSponsorSpreadPhase(v, sponsors, section, match.status, now, sponsorPhaseHangRef, {
        unifiedRotation: true,
      });
    }
    if (liveAutoHalftime && match && rustEpochRef.current != null) {
      const H = Math.max(60, match.halfBreakSec);
      const t = ((Date.now() - rustEpochRef.current) / 1000) % H;
      const v = lookupSponsorAtSecond(sponsorSlotMapHalftime, t);
      return resolveSponsorSpreadPhase(v, sponsors, "halftime", undefined, now, sponsorPhaseHangRef, {
        unifiedRotation: true,
      });
    }
    sponsorPhaseHangRef.current = null;
    return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
  }, [
    liveAutoBeside,
    liveAutoHalftime,
    match,
    sponsors,
    elapsed,
    mode,
    sponsorSlotMapMatch,
    sponsorSlotMapHalftime,
    phaseTick,
  ]);

  const prematchDistView = useMemo(() => {
    const now = Date.now();
    if (!prematchSpreadActive || prematchOriginRef.current == null) {
      return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
    }
    const H = Math.max(1, sponsorSlotMapPrematch.length);
    const t = ((now - prematchOriginRef.current) / 1000) % H;
    const v = lookupSponsorAtSecond(sponsorSlotMapPrematch, t);
    return resolveSponsorSpreadPhase(v, sponsors, "prematch", undefined, now, prematchPhaseHangRef, {
      unifiedRotation: true,
    });
  }, [prematchSpreadActive, sponsorSlotMapPrematch, sponsors, phaseTick]);

  return useMemo(() => {
    const now = Date.now();

    if (
      liveAutoBeside &&
      match &&
      sponsorBesideShowsPanel(match, sponsors, playlists) &&
      !hasSponsorsForSection(sponsors, sectionForStatus(match.status), match.status)
    ) {
      return {
        kind: "playlist_only" as const,
        label: "Speelhelft: sponsorronde draait op playlist (geen budget-rooster om te tonen).",
      };
    }

    if (
      liveAutoHalftime &&
      match &&
      sponsorHalftimeShowsPanel(match, sponsors, playlists) &&
      !hasSponsorsForSection(sponsors, "halftime")
    ) {
      return {
        kind: "playlist_only" as const,
        label: "Rust: sponsorronde draait op playlist (geen budget-rooster om te tonen).",
      };
    }

    function rosterFrom(
      contextLabel: string,
      section: SponsorSection,
      matchStatus: string | undefined,
      dist: { phase: "scoreboard" | "sponsor"; sponsorFilterId: string | null },
      slotMap: (string | null)[],
      t: number,
      hangRef: MutableRefObject<{ sponsorId: string; untilMs: number } | null>,
    ): SponsorPhaseHudModel {
      const holdSec = holdSecondsForSponsorPhase(sponsors, section, matchStatus, dist.sponsorFilterId);
      const name =
        dist.phase === "sponsor" && dist.sponsorFilterId == null
          ? "Alle sponsors"
          : dist.sponsorFilterId != null
            ? (sponsors.find((s) => s.id === dist.sponsorFilterId)?.name ?? dist.sponsorFilterId)
            : null;

      let sponsorClipProgress: number | null = null;
      let clipRemainingSec: number | null = null;
      let nextSlotEtaSec: number | null = null;

      const hang = hangRef.current;
      if (dist.phase === "sponsor" && hang && now < hang.untilMs) {
        const totalMs = holdSec * 1000;
        const elapsedMs = totalMs - (hang.untilMs - now);
        sponsorClipProgress = Math.min(1, Math.max(0, elapsedMs / totalMs));
        clipRemainingSec = Math.max(0, (hang.untilMs - now) / 1000);
      }
      if (dist.phase === "scoreboard") {
        nextSlotEtaSec = secondsUntilNextSponsorSlot(slotMap, t);
      }

      return {
        kind: "roster" as const,
        contextLabel,
        phase: dist.phase,
        sponsorName: name,
        sponsorClipProgress,
        nextSlotEtaSec,
        clipRemainingSec,
      };
    }

    if (liveAutoBeside && match && hasSponsorsForSection(sponsors, sectionForStatus(match.status), match.status)) {
      const tLive = halfWindowElapsed(elapsed, match.status, match.halfDurationSec);
      const t = mode === "SPONSOR_ROTATION" ? tLive : tInterruptFrozen.current;
      const section = sectionForStatus(match.status);
      const label =
        match.status === "FIRST_HALF"
          ? "1e helft"
          : match.status === "SECOND_HALF"
            ? "2e helft"
            : "Verlenging";
      return rosterFrom(
        label,
        section,
        match.status,
        sponsorDistView,
        sponsorSlotMapMatch,
        t,
        sponsorPhaseHangRef,
      );
    }

    if (
      liveAutoHalftime &&
      match &&
      rustEpochRef.current != null &&
      hasSponsorsForSection(sponsors, "halftime")
    ) {
      const H = Math.max(60, match.halfBreakSec);
      const t = ((Date.now() - rustEpochRef.current) / 1000) % H;
      return rosterFrom(
        "Rust",
        "halftime",
        undefined,
        sponsorDistView,
        sponsorSlotMapHalftime,
        t,
        sponsorPhaseHangRef,
      );
    }

    if (
      prematchSpreadActive &&
      prematchOriginRef.current != null &&
      hasSponsorsForSection(sponsors, "prematch")
    ) {
      const H = Math.max(1, sponsorSlotMapPrematch.length);
      const t = ((now - prematchOriginRef.current) / 1000) % H;
      return rosterFrom(
        "Voor wedstrijd",
        "prematch",
        undefined,
        prematchDistView,
        sponsorSlotMapPrematch,
        t,
        prematchPhaseHangRef,
      );
    }

    return { kind: "inactive" as const };
  }, [
    liveAutoBeside,
    liveAutoHalftime,
    prematchSpreadActive,
    match,
    sponsors,
    playlists,
    elapsed,
    mode,
    sponsorDistView,
    prematchDistView,
    sponsorSlotMapMatch,
    sponsorSlotMapHalftime,
    sponsorSlotMapPrematch,
    phaseTick,
  ]);
}
