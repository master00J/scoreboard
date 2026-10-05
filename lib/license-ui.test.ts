import { afterEach, expect, test, vi } from "vitest";
import {
  CHANGE_LICENSE_EVENT,
  LICENSE_CHANGED_EVENT,
  notifyLicenseChanged,
  requestChangeLicense,
} from "./license-ui";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("requestChangeLicense notifies the activation gate", () => {
  const listener = vi.fn();
  window.addEventListener(CHANGE_LICENSE_EVENT, listener);
  requestChangeLicense();
  expect(listener).toHaveBeenCalledTimes(1);
  window.removeEventListener(CHANGE_LICENSE_EVENT, listener);
});

test("notifyLicenseChanged refreshes license-dependent UI", () => {
  const listener = vi.fn();
  window.addEventListener(LICENSE_CHANGED_EVENT, listener);
  notifyLicenseChanged();
  expect(listener).toHaveBeenCalledTimes(1);
  window.removeEventListener(LICENSE_CHANGED_EVENT, listener);
});
