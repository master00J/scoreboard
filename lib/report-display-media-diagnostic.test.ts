import { afterEach, describe, expect, it, vi } from "vitest";
import { reportDisplayMediaDiagnostic } from "./report-display-media-diagnostic";

describe("reportDisplayMediaDiagnostic", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("roept electronAPI aan wanneer window en bridge bestaan", () => {
    const fn = vi.fn();
    vi.stubGlobal("window", { electronAPI: { reportDisplayMediaDiagnostic: fn } });
    reportDisplayMediaDiagnostic(
      { source: "single-media", event: "error", mediaId: "m1", atMs: 1 },
      0,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throttelt herhaalde stalled voor dezelfde mediaId", () => {
    const fn = vi.fn();
    vi.stubGlobal("window", { electronAPI: { reportDisplayMediaDiagnostic: fn } });
    reportDisplayMediaDiagnostic(
      { source: "sponsor-rotation", event: "stalled", mediaId: "same", atMs: 1 },
      10_000,
    );
    reportDisplayMediaDiagnostic(
      { source: "sponsor-rotation", event: "stalled", mediaId: "same", atMs: 2 },
      10_000,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
