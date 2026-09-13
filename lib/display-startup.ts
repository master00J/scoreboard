/** DisplayState-velden die bij app-start mogen worden teruggedraaid. */
export type StartupDisplayState = {
  matchId: string | null;
  mode: string;
  activeMediaId: string | null;
};

export type StartupDisplayPatch = {
  mode: string;
  activeMediaId: null;
};

/**
 * Bij opstart nooit automatisch opnieuw sponsorclips of andere media starten
 * uit de vorige sessie. Zonder wedstrijd blijft alleen IDLE of BLACKOUT staan.
 */
export function startupDisplayStatePatch(
  state: StartupDisplayState,
): StartupDisplayPatch | null {
  if (!state.matchId) {
    const mode = state.mode === "BLACKOUT" ? "BLACKOUT" : "IDLE";
    if (state.mode === mode && !state.activeMediaId) return null;
    return { mode, activeMediaId: null };
  }
  if (state.mode === "SPONSOR_ROTATION" || state.mode === "SPONSOR") {
    return { mode: "MATCH", activeMediaId: null };
  }
  return null;
}
