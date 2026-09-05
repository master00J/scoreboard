import { describe, expect, it } from "vitest";
import { oneOffMediaHoldMs, programmedDisplayMode } from "./live-cycle-settings";

describe("programmedDisplayMode", () => {
  it("kiest scorebord + sponsors tijdens een speelhelft", () => {
    expect(programmedDisplayMode({ matchStatus: "FIRST_HALF" })).toBe("SPONSOR_ROTATION");
    expect(programmedDisplayMode({ matchStatus: "SECOND_HALF" })).toBe("SPONSOR_ROTATION");
  });

  it("kiest alleen scorebord buiten de helft of zonder licentie", () => {
    expect(programmedDisplayMode({ matchStatus: "PREMATCH" })).toBe("MATCH");
    expect(programmedDisplayMode({ matchStatus: "HALF_TIME" })).toBe("MATCH");
    expect(
      programmedDisplayMode({ matchStatus: "FIRST_HALF", automaticSponsorsAllowed: false }),
    ).toBe("MATCH");
  });

  it("kiest idle zonder wedstrijd", () => {
    expect(programmedDisplayMode({})).toBe("IDLE");
  });
});

describe("oneOffMediaHoldMs", () => {
  it("houdt een beeld de catalogustijd", () => {
    expect(oneOffMediaHoldMs({ type: "IMAGE", durationSec: 8 })).toBe(8000);
  });

  it("geeft video extra marge als ended uitblijft", () => {
    expect(oneOffMediaHoldMs({ type: "VIDEO", durationSec: 15 })).toBe(15 * 1500 + 4000);
  });
});
