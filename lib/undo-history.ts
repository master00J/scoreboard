/** Ongedaan maken / opnieuw voor een editor: zuivere functies over een onveranderlijke geschiedenis. */

export type History<T> = {
  past: T[];
  present: T;
  future: T[];
};

export const HISTORY_LIMIT = 100;

export function historyOf<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Nieuwe stap: de huidige stand gaat naar het verleden, "opnieuw" vervalt. */
export function historyPush<T>(history: History<T>, next: T): History<T> {
  if (Object.is(next, history.present)) return history;
  const past = [...history.past, history.present];
  return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, present: next, future: [] };
}

/** Tussenstand tijdens slepen of typen: vervangt de huidige stand zonder een stap te maken. */
export function historyReplace<T>(history: History<T>, next: T): History<T> {
  return Object.is(next, history.present) ? history : { ...history, present: next };
}

/**
 * Sluit een gebaar af dat met `historyReplace` liep: `start` (de stand vóór het gebaar) wordt één
 * stap in het verleden. Is er niets veranderd, dan komt er geen stap bij.
 */
export function historyCommitGesture<T>(history: History<T>, start: T): History<T> {
  if (Object.is(start, history.present)) return history;
  const past = [...history.past, start];
  return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, present: history.present, future: [] };
}

export function historyUndo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function historyRedo<T>(history: History<T>): History<T> {
  const next = history.future[0];
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}
