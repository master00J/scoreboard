import { describe, expect, it } from "vitest";
import {
  checkAckResponse,
  CloudAckError,
  relayCloudCommands,
  sendAckWithRetry,
  type CloudAck,
} from "./cloud-command-relay";

const noSleep = async () => undefined;

describe("checkAckResponse", () => {
  it("aanvaardt alleen 2xx met { ok: true }", () => {
    expect(() => checkAckResponse(200, { ok: true })).not.toThrow();
    expect(() => checkAckResponse(200, { ok: false })).toThrow(CloudAckError);
    expect(() => checkAckResponse(200, null)).toThrow(CloudAckError);
    expect(() => checkAckResponse(502, { ok: false, message: "Command ack mislukt (500)." })).toThrow(/502.*ack mislukt/);
  });

  it("probeert opnieuw bij 5xx, 429 en 408, niet bij 401", () => {
    const retryable = (status: number) => {
      try {
        checkAckResponse(status, { ok: false });
      } catch (err) {
        return (err as CloudAckError).retryable;
      }
      return null;
    };
    expect(retryable(503)).toBe(true);
    expect(retryable(429)).toBe(true);
    expect(retryable(408)).toBe(true);
    expect(retryable(401)).toBe(false);
    expect(retryable(422)).toBe(false);
  });
});

describe("sendAckWithRetry", () => {
  it("herhaalt alleen de bevestiging, met oplopende wachttijd", async () => {
    let attempts = 0;
    const waits: number[] = [];
    const ok = await sendAckWithRetry(
      "c1",
      { ok: true },
      {
        postAck: async () => {
          attempts += 1;
          if (attempts < 3) throw new Error("fetch failed");
        },
        log: () => undefined,
        sleep: async (ms) => {
          waits.push(ms);
        },
        ackRetryDelaysMs: [100, 400, 900],
      },
    );
    expect(ok).toBe(true);
    expect(attempts).toBe(3);
    expect(waits).toEqual([100, 400]);
  });

  it("stopt meteen bij een weigering die een nieuwe poging niet oplost", async () => {
    let attempts = 0;
    const ok = await sendAckWithRetry(
      "c1",
      { ok: true },
      {
        postAck: async () => {
          attempts += 1;
          throw new CloudAckError("bevestiging geweigerd (401)", false);
        },
        log: () => undefined,
        sleep: noSleep,
      },
    );
    expect(ok).toBe(false);
    expect(attempts).toBe(1);
  });
});

describe("relayCloudCommands", () => {
  it("voert elk commando één keer uit, ook als de bevestiging blijft mislukken", async () => {
    const applied: string[] = [];
    const posted: Array<{ id: string; ack: CloudAck }> = [];
    const marked: string[] = [];
    await relayCloudCommands([{ id: "a", command: { type: "x" } }, { id: "", command: {} }, { command: {} }], {
      apply: async (id) => {
        applied.push(id);
        return { ack: { ok: true }, duplicate: false };
      },
      postAck: async (id, ack) => {
        posted.push({ id, ack });
        throw new Error("network down");
      },
      markAcked: async (id) => {
        marked.push(id);
      },
      log: () => undefined,
      sleep: noSleep,
      ackRetryDelaysMs: [1, 1],
    });
    expect(applied).toEqual(["a"]);
    expect(posted).toHaveLength(3);
    expect(marked).toEqual([]);
  });

  it("bevestigt een herhaalde levering met de oorspronkelijke uitkomst", async () => {
    const posted: Array<{ id: string; ack: CloudAck }> = [];
    const marked: string[] = [];
    await relayCloudCommands([{ id: "dup", command: {} }], {
      apply: async () => ({ ack: { ok: false, error: "matchOverSets" }, duplicate: true }),
      postAck: async (id, ack) => {
        posted.push({ id, ack });
      },
      markAcked: async (id) => {
        marked.push(id);
      },
      log: () => undefined,
      sleep: noSleep,
    });
    expect(posted).toEqual([{ id: "dup", ack: { ok: false, error: "matchOverSets", result: undefined } }]);
    expect(marked).toEqual(["dup"]);
  });

  it("bevestigt een mislukking als het uitvoeren zelf een fout gooit", async () => {
    const posted: CloudAck[] = [];
    await relayCloudCommands([{ id: "boom", command: {} }], {
      apply: async () => {
        throw new Error("database bezet");
      },
      postAck: async (_id, ack) => {
        posted.push(ack);
      },
      markAcked: async () => undefined,
      log: () => undefined,
      sleep: noSleep,
    });
    expect(posted).toEqual([{ ok: false, error: "database bezet" }]);
  });
});
