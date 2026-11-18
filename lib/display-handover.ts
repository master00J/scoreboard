/**
 * Naadloze overgangen op het stadionscherm: het vorige beeld blijft staan tot het volgende er is.
 *
 * Een losse clip (quick button) en de sponsors uit het programma staan in aparte lagen. Wisselde
 * het scherm van laag zodra het commando binnenkwam, dan zag het publiek tussendoor wat eronder
 * lag: het volledige scorebord, of een leeg zwart vak.
 */

/**
 * De modus die het scherm nu toont. Een losse clip begint pas als het scherm weet welk bestand
 * erbij hoort; tot dan blijft het vorige beeld staan. Vindt het scherm het bestand niet, dan
 * geldt de gevraagde modus alsnog.
 */
export function displayModeToShow<M extends string>(opts: {
  /** Modus volgens de laatste stand van de bediening. */
  mode: M;
  /** Media die bij die stand hoort, of null. */
  activeMediaId: string | null | undefined;
  /** Media-id waarvoor het opzoeken klaar is (gevonden of niet). */
  settledMediaId: string | null;
  /** Modus die nu op het scherm staat; null zolang er nog niets stond. */
  shownMode: M | null;
}): M {
  if (opts.mode !== "SPONSOR" || !opts.activeMediaId || opts.shownMode == null) return opts.mode;
  return opts.settledMediaId === opts.activeMediaId ? opts.mode : opts.shownMode;
}

/**
 * Prematch/rust/na de wedstrijd: het scorebord blijft getekend; media komt eroverheen.
 * Unmount van de media-laag onthult het bord — geen zwart tussenframe.
 */
export function spreadShowsMedia(phase: "scoreboard" | "sponsor"): boolean {
  return phase === "sponsor";
}

/** Zo lang na het verdwijnen van een beeld mag zijn opvolger in hetzelfde vak er nog op aansluiten. */
export const HELD_IMAGE_HANDOVER_MS = 100;

export type HeldImageMemory = {
  src: string;
  /** Wanneer het beeld van het scherm ging; null zolang het er nog staat. */
  leftAtMs: number | null;
};

/**
 * Het beeld waar een nieuw beeld in hetzelfde vak op aansluit, of null als het vak leeg was.
 * Alleen een beeld dat er nog staat of net verdween telt: na een echte pauze begint het vak leeg.
 */
export function heldImageToContinue(memory: HeldImageMemory | undefined, nowMs: number): string | null {
  if (!memory || !memory.src) return null;
  if (memory.leftAtMs == null) return memory.src;
  const gone = nowMs - memory.leftAtMs;
  return gone >= 0 && gone <= HELD_IMAGE_HANDOVER_MS ? memory.src : null;
}
