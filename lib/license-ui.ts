/** UI-events voor licentie wisselen zonder de desktop opnieuw te starten. */

export const CHANGE_LICENSE_EVENT = "arenacue:change-license";
export const LICENSE_CHANGED_EVENT = "arenacue:license-changed";

export function requestChangeLicense(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE_LICENSE_EVENT));
}

export function notifyLicenseChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LICENSE_CHANGED_EVENT));
}
