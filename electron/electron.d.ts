import type { ElectronBridge } from "../lib/desktop-bridge";

declare global {
  interface Window {
    electronAPI?: ElectronBridge;
  }
}

export {};
