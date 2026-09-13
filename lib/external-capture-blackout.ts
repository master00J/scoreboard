/**
 * BLACKOUT is een pauze voor externe capture, geen stop: wat live stond komt erna terug.
 * Gedeeld door de Electron-handlers en de web-bridge zodat beide paden gelijk blijven.
 */

export type CaptureBlackoutState = {
  externalCaptureSourceId: string | null;
  externalCaptureToDisplay: boolean;
  blackoutResumeCapture: boolean;
};

export type CaptureBlackoutPatch = {
  externalCaptureToDisplay: boolean;
  blackoutResumeCapture: boolean;
};

/** Blackout aan: capture van het scherm halen, maar onthouden dat die live stond. */
export function captureOnBlackoutEnter(state: CaptureBlackoutState): CaptureBlackoutPatch {
  return {
    externalCaptureToDisplay: false,
    blackoutResumeCapture: state.externalCaptureToDisplay,
  };
}

/** Blackout uit: capture terugzetten, maar alleen als er nog een geldige bron is. */
export function captureOnBlackoutExit(state: CaptureBlackoutState): CaptureBlackoutPatch {
  return {
    externalCaptureToDisplay:
      state.blackoutResumeCapture && !!state.externalCaptureSourceId,
    blackoutResumeCapture: false,
  };
}
