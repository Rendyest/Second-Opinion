import { useSyncExternalStore } from 'react';
import type { PoseFrame, System1State, TopSignal } from '../contracts';
import type { CoachCallTrigger } from '../coach/coachCalls';

export type SessionCoachOutcome = 'live' | 'fallback' | 'local' | 'cancelled';
export const SESSION_ANGLES = {
  r_elbow_flexion: 'Right elbow flexion',
  r_shoulder_elevation: 'Right shoulder elevation',
};

type Angle = keyof typeof SESSION_ANGLES;
type AngleStats = { count: number; min: number; max: number; sum: number };
type CoachingCounts = Record<CoachCallTrigger, Record<SessionCoachOutcome, number>>;

export function createSessionSummary() {
  let activeSince: number | null = null;
  let durationMs = 0;
  let windows = 0;
  let struggling = false;
  let episodes = 0;
  let escalations = 0;
  const signals: Partial<Record<TopSignal, number>> = {};
  const angles: Partial<Record<Angle, AngleStats>> = {};
  const coaching: CoachingCounts = {
    button: { live: 0, fallback: 0, local: 0, cancelled: 0 },
    escalation: { live: 0, fallback: 0, local: 0, cancelled: 0 },
  };

  return {
    setRunning(running: boolean, now: number) {
      if (running) {
        activeSince ??= now;
      } else if (activeSince !== null) {
        durationMs += Math.max(0, now - activeSince);
        activeSince = null;
        struggling = false;
      }
    },
    trackingGap() {
      struggling = false;
    },
    observe(frame: PoseFrame, state: System1State | null, minConfidence: number) {
      if (activeSince === null) return;
      if (frame.gate.ok) {
        for (const key of Object.keys(SESSION_ANGLES) as Angle[]) {
          const reading = frame.angles[key];
          if (!reading || !Number.isFinite(reading.deg) || !(reading.conf >= minConfidence)) continue;
          const stats = angles[key] ?? { count: 0, min: reading.deg, max: reading.deg, sum: 0 };
          stats.count++;
          stats.min = Math.min(stats.min, reading.deg);
          stats.max = Math.max(stats.max, reading.deg);
          stats.sum += reading.deg;
          angles[key] = stats;
        }
      }
      if (!frame.gate.ok || !state) return;
      windows++;
      if (state.state === 'struggling' && !struggling) {
        episodes++;
        if (state.top_signal) signals[state.top_signal] = (signals[state.top_signal] ?? 0) + 1;
      }
      struggling = state.state === 'struggling';
      if (state.escalate) escalations++;
    },
    recordCoaching(trigger: CoachCallTrigger, outcome: SessionCoachOutcome) {
      coaching[trigger][outcome]++;
    },
    snapshot() {
      return {
        durationMs, windows, episodes, escalations, signals: { ...signals },
        angles: Object.fromEntries(Object.entries(angles).map(([key, value]) => [key, { ...value }])) as typeof angles,
        coaching: { button: { ...coaching.button }, escalation: { ...coaching.escalation } },
      };
    },
  };
}

export type CompletedSessionSummary = ReturnType<ReturnType<typeof createSessionSummary>['snapshot']>;
let completed: CompletedSessionSummary | null = null;
const listeners = new Set<() => void>();

export function publishCompletedSession(summary: CompletedSessionSummary | null) {
  if (completed === summary) return;
  completed = summary;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useCompletedSession() {
  return useSyncExternalStore(subscribe, getCompletedSession, getCompletedSession);
}

export function getCompletedSession() {
  return completed;
}
