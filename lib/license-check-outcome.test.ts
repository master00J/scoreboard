import { describe, expect, it } from "vitest";
import { licenseServerUnavailable } from "./license-check-outcome";

describe("licenseServerUnavailable", () => {
  it("telt geen verbinding als onbereikbaar", () => {
    expect(licenseServerUnavailable({ kind: "network" })).toBe(true);
  });

  it("telt een serverfout zonder reden als onbereikbaar", () => {
    expect(licenseServerUnavailable({ kind: "error", message: "Serverfout." })).toBe(true);
    expect(licenseServerUnavailable({ kind: "error", message: "Te veel aanvragen.", reason: "" })).toBe(true);
  });

  it("laat een echte weigering van de licentie staan", () => {
    for (const reason of ["unknown_key", "revoked", "expired"]) {
      expect(licenseServerUnavailable({ kind: "error", message: "Licentie ongeldig.", reason })).toBe(false);
    }
  });

  it("telt een geslaagde controle niet als onbereikbaar", () => {
    expect(licenseServerUnavailable({ kind: "ok" })).toBe(false);
  });
});
