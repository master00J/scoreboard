/** localStorage: laatst “gekende” app-publicatie op het klantportaal /portal (semver-string). */
export const LICENTIE_PORTAL_RELEASE_SEEN_KEY = "arenacue-licentie-release-seen";

export function seedLicentieReleaseSeenIfEmpty(version: string) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const v = version.trim();
    if (!v) return;
    if (!localStorage.getItem(LICENTIE_PORTAL_RELEASE_SEEN_KEY)) {
      localStorage.setItem(LICENTIE_PORTAL_RELEASE_SEEN_KEY, v);
    }
  } catch {
    /* private mode / blocked */
  }
}
