import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPONSOR_RESERVE_SEC,
  parseSponsorGuaranteeSettings,
  serializeSponsorGuaranteeSettings,
} from "./sponsor-guarantee-settings";

describe("sponsor guarantee settings", () => {
  it("defaults to not counting manual plays and a 60 s reserve", () => {
    expect(parseSponsorGuaranteeSettings(null)).toEqual({
      countManualPlays: false,
      reserveSec: DEFAULT_SPONSOR_RESERVE_SEC,
    });
    expect(parseSponsorGuaranteeSettings("not json").countManualPlays).toBe(false);
  });

  it("round-trips and clamps the reserve", () => {
    const raw = serializeSponsorGuaranteeSettings({ countManualPlays: true, reserveSec: 99999 });
    expect(parseSponsorGuaranteeSettings(raw)).toEqual({ countManualPlays: true, reserveSec: 900 });
    expect(parseSponsorGuaranteeSettings('{"reserveSec":-5}').reserveSec).toBe(0);
  });
});
