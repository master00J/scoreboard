import { describe, expect, it } from "vitest";
import { STREAM_MEDIA_RETRIES, streamMediaFailureAction } from "./stream-media-retry";

describe("streamMediaFailureAction", () => {
  it("probeert een haperend bestand eerst opnieuw", () => {
    expect(STREAM_MEDIA_RETRIES).toBe(1);
    expect(streamMediaFailureAction(1)).toBe("retry");
  });

  it("slaat het bestand pas over als ook de nieuwe poging hapert", () => {
    expect(streamMediaFailureAction(2)).toBe("skip");
    expect(streamMediaFailureAction(5)).toBe("skip");
  });
});
