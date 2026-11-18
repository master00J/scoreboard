import { describe, expect, it } from "vitest";
import { formatSecForExport } from "./proof-of-play-export";

describe("formatSecForExport", () => {
  it("rounds the total once, so 119.6 s shows as 2m 00s and not 1m 60s", () => {
    expect(formatSecForExport(119.6)).toBe("2m 00s");
    expect(formatSecForExport(59.6)).toBe("1m 00s");
    expect(formatSecForExport(3.4)).toBe("3s");
    expect(formatSecForExport(0)).toBe("0s");
  });
});
