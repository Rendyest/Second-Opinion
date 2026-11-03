import { STATE_LABEL, TOP_SIGNAL_WHY } from '../copy';
import { useCoachCalls } from '../coach/coachCalls';
import {
  COACH_CALLS_EMPTY,
  COACH_CALLS_FALLBACK,
  COACH_CALLS_LIVE,
  COACH_CALLS_SECTION_TITLE,
  COACH_CALLS_TRIGGER_BUTTON,
  COACH_CALLS_TRIGGER_ESCALATION,
} from '../metricsCopy';

/**
 * Reviewer log of System 2 attempts on /metrics: every completed proxy call
 * shows whether the tip came from the live cloud model or the local
 * fallback, what System 1 state triggered it, and how it started.
 * Imported script tips never appear here — they make no call.
 */
export function CoachCallLog() {
  const calls = useCoachCalls();
  return (
    <section aria-label={COACH_CALLS_SECTION_TITLE}>
      <h2>{COACH_CALLS_SECTION_TITLE}</h2>
      {calls.length === 0 ? (
        <p>{COACH_CALLS_EMPTY}</p>
      ) : (
        <ul>
          {calls.map((call) => (
            <li key={call.seq}>
              {call.outcome === 'live' ? COACH_CALLS_LIVE : COACH_CALLS_FALLBACK} —{' '}
              {STATE_LABEL[call.state]}
              {call.topSignal ? ` (${TOP_SIGNAL_WHY[call.topSignal]})` : ''} —{' '}
              {call.trigger === 'escalation' ? COACH_CALLS_TRIGGER_ESCALATION : COACH_CALLS_TRIGGER_BUTTON}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
