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

function stubWindow() {
  const win = new EventTarget();
  vi.stubGlobal("window", win);
  return win;
}

test("requestChangeLicense notifies the activation gate", () => {
  const win = stubWindow();
  const listener = vi.fn();
  win.addEventListener(CHANGE_LICENSE_EVENT, listener);
  requestChangeLicense();
  expect(listener).toHaveBeenCalledTimes(1);
});

test("notifyLicenseChanged refreshes license-dependent UI", () => {
  const win = stubWindow();
  const listener = vi.fn();
  win.addEventListener(LICENSE_CHANGED_EVENT, listener);
  notifyLicenseChanged();
  expect(listener).toHaveBeenCalledTimes(1);
});
