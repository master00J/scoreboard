import { programmedDisplayMode } from "./live-cycle-settings";

const TRANSIENT_OVERLAY_MODES = new Set([
  "GOAL",
  "GOAL_INTRO_VIDEO",
  "GOAL_PLAYER_VIDEO",
  "CARD",
  "PLAYER_INTRO",
  "TEAM_INTRO",
  "SUBSTITUTION",
  "HALFTIME",
  "FULLTIME",
  "CUSTOM",
]);

/** DisplayState-velden die bij app-start mogen worden teruggedraaid. */
export type StartupDisplayState = {
  matchId: string | null;
  mode: string;
  activeMediaId: string | null;
  preferSponsorRotation?: boolean | number | null;
  matchStatus?: string | null;
};

export type StartupDisplayPatch = {
  mode: string;
  activeMediaId: null;
};

/**
 * Bij opstart geen eenmalige clips of overlays hervatten. Scorebord + sponsors
 * vs. alleen scorebord volgt de laatste operatorvoorkeur in élke wedstrijdfase
 * (ook rust / prematch), zodat highlights de rotatie niet uitzetten.
 */
export function startupDisplayStatePatch(
  state: StartupDisplayState,
): StartupDisplayPatch | null {
  if (!state.matchId) {
    const mode = state.mode === "BLACKOUT" ? "BLACKOUT" : "IDLE";
    if (state.mode === mode && !state.activeMediaId) return null;
    return { mode, activeMediaId: null };
  }

  const wanted = programmedDisplayMode({
    matchStatus: state.matchStatus,
    preferSponsorRotation: state.preferSponsorRotation,
  });

  if (state.mode === "SPONSOR" || TRANSIENT_OVERLAY_MODES.has(state.mode)) {
    return { mode: wanted, activeMediaId: null };
  }

  if (state.mode === "SPONSOR_ROTATION" || state.mode === "MATCH") {
    if (state.mode === wanted && !state.activeMediaId) return null;
    return { mode: wanted, activeMediaId: null };
  }

  return null;
}
