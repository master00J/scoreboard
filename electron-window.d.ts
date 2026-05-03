/** Augments `window` for the Electron preload bridge (used from renderer code). */

import type { ElectronBridge } from "./lib/desktop-bridge";

export {};

declare global {
  interface Window {
    electronAPI?: ElectronBridge;
  }
}
