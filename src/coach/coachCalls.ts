import { useSyncExternalStore } from 'react';
import type { System1StateName, TopSignal } from '../contracts';

/** How the call started: a detector escalation, or the hand-pressed button. */
export type CoachCallTrigger = 'escalation' | 'button';

/**
 * What the proxy returned. `live` means the cloud model answered through
 * server/proxy.mjs; `fallback` means the panel showed the local message.
 * Imported script tips never enter this log — they make no call at all.
 */
export type CoachCallOutcome = 'live' | 'fallback';

export interface CoachCallRecord {
  seq: number;
  trigger: CoachCallTrigger;
  state: System1StateName;
  topSignal?: TopSignal;
  outcome: CoachCallOutcome;
}

/** In-memory only: the log restarts with the page. Never persisted or sent. */
let calls: CoachCallRecord[] = [];
let nextSeq = 1;
const listeners = new Set<() => void>();

/** Append one completed attempt and notify /metrics subscribers. */
export function recordCoachCall(entry: Omit<CoachCallRecord, 'seq'>): CoachCallRecord {
  const record: CoachCallRecord = { ...entry, seq: nextSeq };
  nextSeq += 1;
  // Bounded so a long session cannot grow the list without limit.
  calls = [...calls.slice(-49), record];
  for (const fn of listeners) fn();
  return record;
}

function getSnapshot(): CoachCallRecord[] {
  return calls;
}

export function subscribeCoachCalls(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * For the reviewer log on /metrics only. Never used on participant routes:
 * session-facing modules may publish (recordCoachCall) but must not subscribe.
 * getSnapshot doubles as the server snapshot for static rendering.
 */
export function useCoachCalls(): CoachCallRecord[] {
  return useSyncExternalStore(subscribeCoachCalls, getSnapshot, getSnapshot);
}

/** Test and session reset helper. Not wired to any button. */
export function clearCoachCalls(): void {
  calls = [];
  nextSeq = 1;
  for (const fn of listeners) fn();
}
