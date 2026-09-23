import { describe, expect, it } from "vitest";
import {
  FULL_PROFILE_ID,
  SIMPLE_PROFILE_ID,
  activeInterfaceProfile,
  parseInterfaceProfileStore,
} from "./interface-profiles";

describe("interface profiles", () => {
  it("offers music in presets and preserves explicit visibility in custom profiles", () => {
    const saved = parseInterfaceProfileStore(JSON.stringify({ activeId: "with-music", profiles: [
      { id: "with-music", name: "Music", tabs: ["match"], panels: ["music", "timer"] },
      { id: "without-music", name: "Score", tabs: ["match"], panels: ["timer"] },
    ] }));
    expect(saved.profiles.find((p) => p.id === FULL_PROFILE_ID)?.panels).toContain("music");
    expect(saved.profiles.find((p) => p.id === SIMPLE_PROFILE_ID)?.panels).toContain("music");
    expect(activeInterfaceProfile(saved).panels).toContain("music");
    expect(saved.profiles.find((p) => p.id === "without-music")?.panels).not.toContain("music");
  });
  it("starts on the full interface", () => {
    const store = parseInterfaceProfileStore(null);
    expect(store.activeId).toBe(FULL_PROFILE_ID);
    expect(activeInterfaceProfile(store).tabs).toContain("media");
  });

  it("keeps the simple preset and a saved custom view", () => {
    const store = parseInterfaceProfileStore(
      JSON.stringify({
        activeId: "p_custom",
        profiles: [
          { id: "full", builtin: true, tabs: ["match"], panels: ["timer"] },
          {
            id: "p_custom",
            name: "Kantine",
            tabs: ["match", "reports"],
            panels: ["timer", "preview"],
          },
        ],
      }),
    );
    const full = store.profiles.find((profile) => profile.id === FULL_PROFILE_ID);
    const custom = store.profiles.find((profile) => profile.id === "p_custom");
    expect(full?.tabs).toContain("livestream");
    expect(store.profiles.some((profile) => profile.id === SIMPLE_PROFILE_ID)).toBe(true);
    expect(custom?.panels).toEqual(["timer", "preview"]);
    expect(activeInterfaceProfile(store).name).toBe("Kantine");
  });
});
