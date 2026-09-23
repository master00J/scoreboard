const HEAVY_PREVIEW_MODES = new Set([
  "GOAL",
  "GOAL_INTRO_VIDEO",
  "GOAL_PLAYER_VIDEO",
  "SUBSTITUTION",
  "CARD",
]);

/** JPEG-capture van het LED tijdens deze modes laat de control-HUD haperen. */
export function shouldPauseDisplayPreviewCapture(mode: string | undefined | null): boolean {
  return !!mode && HEAVY_PREVIEW_MODES.has(mode);
}
