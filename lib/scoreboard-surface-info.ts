import type { ElementSurface } from "./scoreboard-elements";

/**
 * Waar en wanneer een vlak uit de indeling-editor echt te zien is.
 *
 * De vier tabs zien er in de editor hetzelfde uit, maar ze gaan naar twee verschillende apparaten
 * en verschijnen op verschillende momenten. Een club ontwierp in "Scorebord + sponsoring", drukte
 * op "Probeer op scherm" — die toont de tab die je bewerkt, dus het zag er goed uit — en zag
 * tijdens de wedstrijd iets anders, want dan tekent het scherm "Volledig scorebord".
 *
 * Deze tabel staat op één plek zodat de tabs, de uitleg eronder en de proefmelding niet uit elkaar
 * kunnen lopen.
 */
export type SurfaceDevice = "wall" | "stream";

export type SurfaceInfo = {
  /** Het stadionscherm of de livestream-overlay. */
  device: SurfaceDevice;
  /** Korte naam van de tab. */
  labelKey: string;
  /** Wanneer dit vlak echt in beeld komt; staat onder de tab en in de proefmelding. */
  whenKey: string;
};

const INFO: Record<ElementSurface, SurfaceInfo> = {
  full: {
    device: "wall",
    labelKey: "setup.themeSurfaceFull",
    whenKey: "setup.themeSurfaceWhenFull",
  },
  sponsor: {
    device: "wall",
    labelKey: "setup.themeSurfaceSponsor",
    whenKey: "setup.themeSurfaceWhenSponsor",
  },
  stream: {
    device: "stream",
    labelKey: "setup.themeSurfaceStream",
    whenKey: "setup.themeSurfaceWhenStream",
  },
  streamBreak: {
    device: "stream",
    labelKey: "setup.themeSurfaceStreamBreak",
    whenKey: "setup.themeSurfaceWhenStreamBreak",
  },
};

export function surfaceInfo(surface: ElementSurface): SurfaceInfo {
  return INFO[surface];
}

/**
 * Toont "Probeer op scherm" dit vlak zoals het echt op het stadionscherm komt?
 *
 * De proef dwingt het vlak af dat je bewerkt. Voor `full` klopt dat met wat de wand tijdens een
 * gewone wedstrijd doet. Voor de andere drie niet: `sponsor` komt alleen met een clip ernaast, en
 * de twee stream-vlakken horen helemaal niet op de wand. Dan moet de proef dat zeggen, anders
 * bevestigt hij een indeling die de kijker nooit zo ziet.
 */
export function tryOnScreenMatchesReality(surface: ElementSurface): boolean {
  return surface === "full";
}

/** Vlakken van hetzelfde apparaat, voor het groeperen van de tabs. */
export function surfacesForDevice(
  surfaces: readonly ElementSurface[],
  device: SurfaceDevice,
): ElementSurface[] {
  return surfaces.filter((surface) => INFO[surface].device === device);
}
