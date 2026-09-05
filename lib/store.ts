"use client";

import { create } from "zustand";
import type { DisplayStatePayload, TickPayload } from "./desktop-bridge";
import type { SponsorLedgerPayload } from "./sponsor-telemetry";

type Store = {
  state: DisplayStatePayload | null;
  tick: TickPayload | null;
  sponsorLedger: SponsorLedgerPayload | null;
  connected: boolean;
  goalPickerSide: "home" | "away" | null;
  goalPickerDismissed: boolean;
  setState: (s: DisplayStatePayload | null) => void;
  setTick: (t: TickPayload | null) => void;
  setSponsorLedger: (l: SponsorLedgerPayload | null) => void;
  setConnected: (c: boolean) => void;
  setGoalPickerSide: (side: "home" | "away" | null) => void;
};

export const useDisplayStore = create<Store>((set) => ({
  state: null,
  tick: null,
  sponsorLedger: null,
  connected: false,
  goalPickerSide: null,
  goalPickerDismissed: false,
  setState: (s) =>
    set((prev) => ({
      state: s,
      goalPickerDismissed:
        prev.state?.mode === "GOAL_INTRO_VIDEO" && s?.mode !== "GOAL_INTRO_VIDEO"
          ? false
          : prev.goalPickerDismissed,
    })),
  setTick: (t) => set({ tick: t }),
  setSponsorLedger: (l) => set({ sponsorLedger: l }),
  setConnected: (c) => set({ connected: c }),
  setGoalPickerSide: (side) =>
    set({
      goalPickerSide: side,
      goalPickerDismissed: side === null,
    }),
}));
