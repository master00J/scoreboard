import { describe, expect, it } from "vitest";
import {
  oneOffMediaHoldMs,
  periodStartHoldsFullScoreboard,
  programmedDisplayMode,
} from "./live-cycle-settings";

describe("programmedDisplayMode", () => {
  it("kiest scorebord + sponsors tijdens een speelhelft", () => {
    expect(programmedDisplayMode({ matchStatus: "FIRST_HALF" })).toBe("SPONSOR_ROTATION");
    expect(programmedDisplayMode({ matchStatus: "SECOND_HALF" })).toBe("SPONSOR_ROTATION");
  });

  it("keert na een clip terug naar sponsors in rust, prematch en na de wedstrijd", () => {
    expect(programmedDisplayMode({ matchStatus: "PREMATCH" })).toBe("SPONSOR_ROTATION");
    expect(programmedDisplayMode({ matchStatus: "HALF_TIME" })).toBe("SPONSOR_ROTATION");
    expect(programmedDisplayMode({ matchStatus: "FULL_TIME" })).toBe("SPONSOR_ROTATION");
    expect(programmedDisplayMode({ matchStatus: "POST_MATCH" })).toBe("SPONSOR_ROTATION");
  });

  it("kiest alleen scorebord zonder licentie of zonder voorkeur", () => {
    expect(
      programmedDisplayMode({ matchStatus: "FIRST_HALF", automaticSponsorsAllowed: false }),
    ).toBe("MATCH");
    expect(
      programmedDisplayMode({ matchStatus: "HALF_TIME", preferSponsorRotation: false }),
    ).toBe("MATCH");
  });

  it("kiest idle zonder wedstrijd", () => {
    expect(programmedDisplayMode({})).toBe("IDLE");
  });
});

describe("periodStartHoldsFullScoreboard", () => {
  it("houdt het volledige scorebord bij 00:00 stilstaande klok", () => {
    expect(
      periodStartHoldsFullScoreboard({
        matchStatus: "FIRST_HALF",
        halfElapsedSec: 0,
        timerRunning: false,
      }),
    ).toBe(true);
  });

  it("laat sponsors toe zodra de klok loopt", () => {
    expect(
      periodStartHoldsFullScoreboard({
        matchStatus: "FIRST_HALF",
        halfElapsedSec: 0,
        timerRunning: true,
      }),
    ).toBe(false);
  });

  it("houdt volleybal niet vast: set starten is de start", () => {
    expect(
      periodStartHoldsFullScoreboard({
        matchStatus: "FIRST_HALF",
        halfElapsedSec: 0,
        timerRunning: false,
        wallClockPlay: true,
      }),
    ).toBe(false);
  });

  it("houdt niet midden in de helft", () => {
    expect(
      periodStartHoldsFullScoreboard({
        matchStatus: "FIRST_HALF",
        halfElapsedSec: 120,
        timerRunning: false,
      }),
    ).toBe(false);
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
