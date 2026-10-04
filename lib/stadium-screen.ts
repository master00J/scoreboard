/** Welke monitor het stadionscherm krijgt. De keuze hoort bij de pc, niet bij de database van de club. */

export type ScreenInfo = {
  id: number;
  /** Naam die Windows aan de monitor geeft; kan leeg zijn. */
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
};

/** Wat we van de gekozen monitor onthouden om hem na herstart of opnieuw aansluiten terug te vinden. */
export type StadiumScreenChoice = {
  id: number;
  label: string;
  width: number;
  height: number;
};

export type StadiumScreenPick = {
  screen: ScreenInfo;
  /** `choice` = de gekozen monitor, `auto` = geen keuze gemaakt, `fallback` = keuze niet aangesloten. */
  via: "choice" | "auto" | "fallback";
};

export function normalizeStadiumScreenChoice(raw: unknown): StadiumScreenChoice | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const id = Number(rec.id);
  const width = Number(rec.width);
  const height = Number(rec.height);
  if (!Number.isFinite(id) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    id,
    label: typeof rec.label === "string" ? rec.label.slice(0, 120) : "",
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function choiceFromScreen(screen: ScreenInfo): StadiumScreenChoice {
  return { id: screen.id, label: screen.label, width: screen.width, height: screen.height };
}

/** Zonder keuze: de monitor die niet het hoofdscherm is, zodat de taakbalk bij de operator blijft. */
function automaticScreen(screens: ScreenInfo[]): ScreenInfo {
  return screens.find((screen) => !screen.primary) ?? screens[0];
}

/**
 * Bepaalt de monitor voor het stadionscherm. Windows geeft een monitor soms een nieuw id (andere
 * poort, nieuwe driver); dan herkennen we hem aan naam en resolutie, mits dat er precies één is.
 */
export function pickStadiumScreen(screens: ScreenInfo[], choice: StadiumScreenChoice | null): StadiumScreenPick | null {
  if (screens.length === 0) return null;
  if (!choice) return { screen: automaticScreen(screens), via: "auto" };

  const byId = screens.find((screen) => screen.id === choice.id);
  if (byId) return { screen: byId, via: "choice" };

  const alike = screens.filter(
    (screen) =>
      screen.label !== "" &&
      screen.label === choice.label &&
      screen.width === choice.width &&
      screen.height === choice.height,
  );
  if (alike.length === 1) return { screen: alike[0], via: "choice" };

  return { screen: automaticScreen(screens), via: "fallback" };
}

/** Vaste nummering van links naar rechts, dan van boven naar onder: zo ziet de operator ze staan. */
export function numberScreens<T extends Pick<ScreenInfo, "x" | "y" | "id">>(screens: T[]): Array<T & { number: number }> {
  return [...screens]
    .sort((a, b) => a.x - b.x || a.y - b.y || a.id - b.id)
    .map((screen, index) => ({ ...screen, number: index + 1 }));
}

/** Eén monitor in de lijst van het bedieningspaneel. */
export type StadiumScreenRow = ScreenInfo & {
  number: number;
  /** Echte resolutie; `width`/`height` zijn geschaald met de Windows-zoomfactor. */
  pixelWidth: number;
  pixelHeight: number;
  /** Hier staat het stadionscherm nu. */
  active: boolean;
};

export type StadiumScreensPayload = {
  screens: StadiumScreenRow[];
  via: StadiumScreenPick["via"];
  /** Naam van de gekozen monitor als die niet is aangesloten. */
  missingLabel: string | null;
};
