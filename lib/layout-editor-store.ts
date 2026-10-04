import { create } from "zustand";
import type { LayoutRule } from "./scoreboard-elements";
import type { ResolvedScoreboardTheme } from "./scoreboard-theme";
import {
  historyCommitGesture,
  historyOf,
  historyPush,
  historyRedo,
  historyReplace,
  historyUndo,
  type History,
} from "./undo-history";

/**
 * Het concept van de indelingseditor leeft buiten het tabblad Voorbereiden. Zo blijven
 * niet-opgeslagen wijzigingen staan als de operator even naar Live of Media gaat.
 */
export type LayoutEditorDraft = {
  theme: ResolvedScoreboardTheme;
  rules: LayoutRule[];
  repeatSponsorBudgetCycles: boolean;
};

/** Opeenvolgende wijzigingen van hetzelfde veld binnen deze tijd tellen als één stap. */
export const COALESCE_MS = 900;

type LayoutEditorState = {
  /** De opgeslagen thema-JSON waarop het concept gebaseerd is; `undefined` = nog niet geladen. */
  baseKey: string | undefined;
  base: LayoutEditorDraft | null;
  history: History<LayoutEditorDraft> | null;
  /** Laatste wijziging met een samenvoegsleutel (typen, kleur kiezen, pijltje ingedrukt houden). */
  coalesce: { key: string; at: number } | null;
  /** Begint opnieuw vanaf de opgeslagen instellingen (eerste keer, of na opslaan / herladen). */
  reset: (baseKey: string, draft: LayoutEditorDraft) => void;
  /** Eén stap in de geschiedenis. Met `coalesceKey` smelt een reeks snelle wijzigingen samen tot één stap. */
  push: (next: LayoutEditorDraft, coalesceKey?: string) => void;
  /** Tussenstand tijdens slepen; sluit af met `commitGesture`. */
  replace: (next: LayoutEditorDraft) => void;
  commitGesture: (start: LayoutEditorDraft) => void;
  undo: () => void;
  redo: () => void;
  /** Gooit alle wijzigingen weg en keert terug naar wat opgeslagen is. */
  discard: () => void;
  /** Na opslaan: de huidige stand is nu de opgeslagen stand; ongedaan maken blijft mogelijk. */
  markSaved: (baseKey: string) => void;
};

export const useLayoutEditorStore = create<LayoutEditorState>((set) => ({
  baseKey: undefined,
  base: null,
  history: null,
  coalesce: null,
  reset: (baseKey, draft) => set({ baseKey, base: draft, history: historyOf(draft), coalesce: null }),
  push: (next, coalesceKey) =>
    set((state) => {
      if (!state.history) return state;
      const now = Date.now();
      const merge =
        coalesceKey !== undefined && state.coalesce?.key === coalesceKey && now - state.coalesce.at < COALESCE_MS;
      return {
        history: merge ? historyReplace(state.history, next) : historyPush(state.history, next),
        coalesce: coalesceKey !== undefined ? { key: coalesceKey, at: now } : null,
      };
    }),
  replace: (next) =>
    set((state) => (state.history ? { history: historyReplace(state.history, next), coalesce: null } : state)),
  commitGesture: (start) =>
    set((state) =>
      state.history ? { history: historyCommitGesture(state.history, start), coalesce: null } : state,
    ),
  undo: () => set((state) => (state.history ? { history: historyUndo(state.history), coalesce: null } : state)),
  redo: () => set((state) => (state.history ? { history: historyRedo(state.history), coalesce: null } : state)),
  discard: () => set((state) => (state.base ? { history: historyOf(state.base), coalesce: null } : state)),
  markSaved: (baseKey) =>
    set((state) => (state.history ? { baseKey, base: state.history.present, coalesce: null } : state)),
}));

/** Zijn er wijzigingen die nog niet opgeslagen zijn? */
export function layoutDraftIsDirty(base: LayoutEditorDraft | null, present: LayoutEditorDraft | null): boolean {
  if (!base || !present) return false;
  if (base === present) return false;
  return JSON.stringify(base) !== JSON.stringify(present);
}
