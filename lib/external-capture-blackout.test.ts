import { describe, expect, it } from "vitest";
import {
  captureOnBlackoutEnter,
  captureOnBlackoutExit,
  type CaptureBlackoutState,
} from "./external-capture-blackout";

function state(over: Partial<CaptureBlackoutState> = {}): CaptureBlackoutState {
  return {
    externalCaptureSourceId: null,
    externalCaptureToDisplay: false,
    blackoutResumeCapture: false,
    ...over,
  };
}

describe("externe capture rond BLACKOUT", () => {
  it("haalt live capture van het scherm en onthoudt dat", () => {
    const patch = captureOnBlackoutEnter(
      state({ externalCaptureSourceId: "window:1", externalCaptureToDisplay: true }),
    );
    expect(patch).toEqual({ externalCaptureToDisplay: false, blackoutResumeCapture: true });
  });

  it("onthoudt niets als capture niet live stond", () => {
    const patch = captureOnBlackoutEnter(state({ externalCaptureSourceId: "window:1" }));
    expect(patch).toEqual({ externalCaptureToDisplay: false, blackoutResumeCapture: false });
  });

  it("zet capture terug na de blackout", () => {
    const patch = captureOnBlackoutExit(
      state({ externalCaptureSourceId: "window:1", blackoutResumeCapture: true }),
    );
    expect(patch).toEqual({ externalCaptureToDisplay: true, blackoutResumeCapture: false });
  });

  it("zet niets terug als capture er vóór de blackout ook niet was", () => {
    const patch = captureOnBlackoutExit(state({ externalCaptureSourceId: "window:1" }));
    expect(patch).toEqual({ externalCaptureToDisplay: false, blackoutResumeCapture: false });
  });

  it("zet niets terug als de bron intussen gewist is", () => {
    const patch = captureOnBlackoutExit(state({ blackoutResumeCapture: true }));
    expect(patch).toEqual({ externalCaptureToDisplay: false, blackoutResumeCapture: false });
  });

  it("blijft stabiel over een volledige blackout-cyclus", () => {
    const live = state({ externalCaptureSourceId: "window:1", externalCaptureToDisplay: true });
    const during = { ...live, ...captureOnBlackoutEnter(live) };
    expect(during.externalCaptureToDisplay).toBe(false);
    const after = { ...during, ...captureOnBlackoutExit(during) };
    expect(after.externalCaptureToDisplay).toBe(true);
    expect(after.blackoutResumeCapture).toBe(false);
  });
});
