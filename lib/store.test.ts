import { describe, expect, it } from "vitest";
import type { DisplayStatePayload } from "./desktop-bridge";
import { useDisplayStore } from "./store";

/**
 * Het stadionscherm leest de opgeslagen indeling uit de gepushte state en behandelt een
 * meegestuurde `null` als "terug naar standaard". Daarvoor moet de store "nog nooit
 * meegestuurd" als `undefined` doorgeven en niet als `null`: anders leest het scherm een bron
 * die niets wist als een bewuste leegmaking, en toont het de standaardindeling terwijl het op
 * zijn eigen fetch had moeten terugvallen.
 *
 * Niet elke bron stuurt deze velden mee — de telefoon- en cloudbrug sturen een snapshot zonder.
 */

/** Oplopend, want de store gooit een state met een ouder tijdstempel weg. */
let seq = 0;
const base = (over: Partial<DisplayStatePayload> = {}): DisplayStatePayload =>
  ({ id: 1, mode: "IDLE", updatedAt: new Date(1_700_000_000_000 + ++seq * 1000).toISOString(), ...over }) as DisplayStatePayload;

function push(state: DisplayStatePayload | null): void {
  useDisplayStore.getState().setState(state);
}
const pushed = () => useDisplayStore.getState().state?.scoreboardThemeJson;

describe("gepushte schermindeling in de display-store", () => {
  it("blijft undefined als geen enkele state de indeling ooit meestuurde", () => {
    push(null);
    // Twee opeenvolgende snapshots zonder deze velden: de samenvoegtak die het misdeed.
    push(base());
    push(base());
    expect(pushed()).toBeUndefined();
  });

  it("houdt een meegestuurde indeling vast", () => {
    push(null);
    push(base({ scoreboardThemeJson: '{"layoutMode":"custom"}', themePreviewJson: null }));
    expect(pushed()).toBe('{"layoutMode":"custom"}');
  });

  it("houdt de laatst bekende indeling vast als een volgende state haar niet meestuurt", () => {
    push(null);
    push(base({ scoreboardThemeJson: '{"layoutMode":"custom"}', themePreviewJson: null }));
    push(base());
    expect(pushed()).toBe('{"layoutMode":"custom"}');
  });

  it("laat een leeggemaakte indeling echt leeg zijn in plaats van de oude te houden", () => {
    push(null);
    push(base({ scoreboardThemeJson: '{"layoutMode":"custom"}', themePreviewJson: null }));
    push(base({ scoreboardThemeJson: null, themePreviewJson: null }));
    expect(pushed()).toBeNull();
  });

  it("houdt onbekend en bewust leeg uit elkaar", () => {
    push(null);
    push(base());
    push(base());
    const neverSent = pushed();
    push(base({ scoreboardThemeJson: null, themePreviewJson: null }));
    const deliberatelyEmpty = pushed();
    expect(neverSent).toBeUndefined();
    expect(deliberatelyEmpty).toBeNull();
  });
});
