import { describe, expect, it } from "vitest";
import { uiLocaleFromSearch } from "./locales";

describe("uiLocaleFromSearch", () => {
  it("leest lang uit de website-iframe query", () => {
    expect(uiLocaleFromSearch("?view=control&lang=en")).toBe("en");
    expect(uiLocaleFromSearch("?lang=fr")).toBe("fr");
    expect(uiLocaleFromSearch("locale=it")).toBe("it");
    expect(uiLocaleFromSearch("?lang=de")).toBe("de");
  });

  it("negeert ongeldige of ontbrekende talen", () => {
    expect(uiLocaleFromSearch("?view=control")).toBeNull();
    expect(uiLocaleFromSearch("?lang=es")).toBeNull();
    expect(uiLocaleFromSearch("?lang=en%26view=display")).toBeNull();
  });
});
