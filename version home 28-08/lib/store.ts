"use client";

import { create } from "zustand";
import type { DisplayStatePayload, TickPayload } from "./desktop-bridge";
import type { SponsorLedgerPayload } from "./sponsor-telemetry";

type Store = {
  state: DisplayStatePayload | null;
  tick: TickPayload | null;
  sponsorLedger: SponsorLedgerPayload | null;
  connected: boolean;
  setState: (s: DisplayStatePayload | null) => void;
  setTick: (t: TickPayload | null) => void;
  setSponsorLedger: (l: SponsorLedgerPayload | null) => void;
  setConnected: (c: boolean) => void;
};

export const useDisplayStore = create<Store>((set) => ({
  state: null,
  tick: null,
  sponsorLedger: null,
  connected: false,
  setState: (s) => set({ state: s }),
  setTick: (t) => set({ tick: t }),
  setSponsorLedger: (l) => set({ sponsorLedger: l }),
  setConnected: (c) => set({ connected: c }),
}));
