import { describe, expect, it } from "vitest";
import {
  addShootoutKick,
  createShootout,
  parseShootout,
  serializeShootout,
  shootoutIsSuddenDeath,
  shootoutMarks,
  shootoutNextSide,
  shootoutTally,
  shootoutWinner,
  sportSupportsShootout,
  undoShootoutKick,
  type PenaltyShootout,
  type ShootoutSide,
} from "./penalty-shootout";

/** Trapt een reeks af: "H+" = thuis raak, "A-" = uit mis. */
function play(shootout: PenaltyShootout, kicks: string[]): PenaltyShootout {
  let current = shootout;
  for (const code of kicks) {
    const side: ShootoutSide = code[0] === "H" ? "home" : "away";
    const result = addShootoutKick(current, side, code[1] === "+");
    if (!result.ok) throw new Error(`${code}: ${result.reason}`);
    current = result.shootout;
  }
  return current;
}

describe("penalty shootout", () => {
  it("alternates A-B-A-B starting with the chosen team", () => {
    let s = createShootout("away");
    expect(shootoutNextSide(s)).toBe("away");
    s = play(s, ["A+"]);
    expect(shootoutNextSide(s)).toBe("home");
    s = play(s, ["H-"]);
    expect(shootoutNextSide(s)).toBe("away");
  });

  it("refuses a kick by the team that is not up", () => {
    const s = createShootout("home");
    expect(addShootoutKick(s, "away", true)).toEqual({ ok: false, reason: "wrongSide" });
  });

  it("stops as soon as the other team can no longer catch up", () => {
    // 3–0 na drie rondes thuis, uit heeft nog maar twee trappen: beslist na A3.
    let s = play(createShootout("home"), ["H+", "A-", "H+", "A-", "H+"]);
    expect(shootoutWinner(s)).toBeNull();
    s = play(s, ["A-"]);
    expect(shootoutWinner(s)).toBe("home");
    expect(shootoutNextSide(s)).toBeNull();
    expect(addShootoutKick(s, "home", true)).toEqual({ ok: false, reason: "decided" });
  });

  it("can be decided by the first kicker before the second team kicks", () => {
    // Na 4 rondes 3–2. Thuis scoort de 5e: 4–2, uit kan met één trap niet meer gelijk komen.
    const before = play(createShootout("home"), ["H+", "A+", "H+", "A+", "H+", "A-", "H-", "A-"]);
    expect(shootoutWinner(before)).toBeNull();
    const s = play(before, ["H+"]);
    expect(shootoutTally(s)).toMatchObject({ homeScored: 4, awayScored: 2, awayTaken: 4 });
    expect(shootoutWinner(s)).toBe("home");
  });

  it("goes to sudden death after a level regular series and ends on the first full round with a difference", () => {
    let s = play(createShootout("home"), ["H+", "A+", "H+", "A+", "H+", "A+", "H+", "A+", "H+", "A+"]);
    expect(shootoutWinner(s)).toBeNull();
    expect(shootoutIsSuddenDeath(s)).toBe(true);
    s = play(s, ["H-"]);
    // Uit heeft de trap nog: niet beslist.
    expect(shootoutWinner(s)).toBeNull();
    expect(shootoutNextSide(s)).toBe("away");
    s = play(s, ["A+"]);
    expect(shootoutWinner(s)).toBe("away");
  });

  it("keeps going in sudden death while both teams score", () => {
    const s = play(createShootout("home", 3), ["H+", "A+", "H-", "A-", "H+", "A+", "H+", "A+", "H-", "A-"]);
    expect(shootoutWinner(s)).toBeNull();
    expect(shootoutNextSide(s)).toBe("home");
  });

  it("undo removes the last kick and reopens a decided shootout", () => {
    const decided = play(createShootout("home", 1), ["H+", "A-"]);
    expect(shootoutWinner(decided)).toBe("home");
    const undone = undoShootoutKick(decided);
    expect(shootoutWinner(undone)).toBeNull();
    expect(shootoutNextSide(undone)).toBe("away");
    expect(undoShootoutKick(createShootout("home")).kicks).toEqual([]);
  });

  it("shows the regular rounds as dots and grows in sudden death", () => {
    const s = play(createShootout("home", 3), ["H+", "A-"]);
    expect(shootoutMarks(s)).toEqual({
      home: ["scored", "pending", "pending"],
      away: ["missed", "pending", "pending"],
    });
    const sudden = play(createShootout("home", 1), ["H+", "A+", "H-"]);
    expect(shootoutMarks(sudden)).toEqual({ home: ["scored", "missed"], away: ["scored", "pending"] });
    expect(shootoutMarks(sudden, 1)).toEqual({ home: ["missed"], away: ["pending"] });
  });

  it("round-trips through JSON and tolerates broken data", () => {
    const s = { ...play(createShootout("away", 5), ["A+", "H-"]), onScreen: false };
    expect(parseShootout(serializeShootout(s))).toEqual(s);
    expect(serializeShootout(null)).toBeNull();
    expect(parseShootout(null)).toBeNull();
    expect(parseShootout("")).toBeNull();
    expect(parseShootout("{nope")).toBeNull();
    expect(parseShootout('{"firstSide":"left"}')).toBeNull();
    expect(parseShootout('{"firstSide":"home","rounds":99}')?.rounds).toBe(10);
    // Een trap buiten de beurt kapt de rest af in plaats van een onmogelijke stand te tonen.
    const broken = parseShootout(
      JSON.stringify({ firstSide: "home", kicks: [{ side: "home", scored: true }, { side: "home", scored: true }] }),
    );
    expect(broken?.kicks).toEqual([{ side: "home", scored: true }]);
    expect(broken?.onScreen).toBe(true);
  });

  it("is offered for football, futsal and hockey only", () => {
    expect(sportSupportsShootout("FOOTBALL")).toBe(true);
    expect(sportSupportsShootout("FUTSAL")).toBe(true);
    expect(sportSupportsShootout("HOCKEY")).toBe(true);
    expect(sportSupportsShootout("BASKETBALL")).toBe(false);
    expect(sportSupportsShootout("VOLLEYBALL")).toBe(false);
  });
});
