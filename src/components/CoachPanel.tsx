import { useEffect, useRef, useState } from 'react';
import type { PoseFrame, System1StateName, TopSignal } from '../contracts';
import { config } from '../config';
import { CHECKING_IN, COACH_BUTTON_LABEL, LOCAL_FALLBACK, TASK_NAME } from '../copy';
import { canSendSummary, type ConsentChoices } from '../consent/consent';
import { CONSENT_TIPS_OFF_NOTE } from '../consentCopy';
import {
  addFrameToStats,
  buildCoachSummary,
  canRequestCoach,
  cooldownActive,
  nextEscalation,
  requestCoachMessage,
  type AngleStats,
} from '../coach/summary';

interface CoachPanelProps {
  /** Latest merged frame; statistics accumulate only from clean frames. */
  frame: PoseFrame | null;
  systemState: System1StateName;
  topSignal?: TopSignal;
  cantSeeYouActive: boolean;
  /** Monotonic escalation counter: the panel asks once per new id. */
  escalationId: number;
  /** Bumps whenever stats must restart (source/camera change, Can't-see-you end). */
  statsEpoch: string;
  /** Cloud-summary consent. Without it the panel shows the local fallback only, never fetches. */
  consent?: ConsentChoices;
  /** While paused nothing is sent: requests are skipped, never queued. */
  paused?: boolean;
}

type CoachStatus = 'idle' | 'escalating' | 'delivered' | 'fallback';

/**
 * Participant coaching panel. Idle, escalating ("Checking in..."), delivered,
 * or local fallback, with a cooldown after every call. The request body is
 * only the aggregate summary (task, per-angle min/max/mean, duration, System 1
 * state) — never joints, frames, or images. Failures and timeouts fall back
 * to a local message and are logged to the console only, without the summary
 * values, and never block the session.
 */
export function CoachPanel({
  frame,
  systemState,
  topSignal,
  cantSeeYouActive,
  escalationId,
  statsEpoch,
  consent,
  paused = false,
}: CoachPanelProps) {
  const summaryOn = consent === undefined ? true : canSendSummary(consent);
  const summaryOnRef = useRef(summaryOn);
  summaryOnRef.current = summaryOn;
  const [stats, setStats] = useState<AngleStats | null>(null);
  const [status, setStatus] = useState<CoachStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [cooledUntil, setCooledUntil] = useState(0);
  const coolingTimer = useRef(0);
  const lastHandledEscalation = useRef(0);

  useEffect(() => {
    setStats((prev) => addFrameToStats(prev, frame, config.coach.summary_window_s));
  }, [frame]);

  useEffect(() => {
    setStats(null);
  }, [statsEpoch]);

  useEffect(
    () => () => {
      window.clearTimeout(coolingTimer.current);
    },
    [],
  );

  const cooling = cooldownActive(cooledUntil, Date.now());

  // Withdrawing the summary choice stops tips at once, including any
  // request already in flight: its response is ignored when it lands.
  useEffect(() => {
    if (!summaryOn) {
      setStatus('idle');
      setMessage(null);
    }
  }, [summaryOn]);

  const request = async () => {
    if (paused || status === 'escalating' || !canRequestCoach(cantSeeYouActive, cooling)) return;
    if (!summaryOnRef.current) {
      setStatus('fallback');
      return;
    }
    const summary = buildCoachSummary(TASK_NAME, stats, systemState, topSignal);
    if (!summary) return;
    setStatus('escalating');
    setMessage(null);
    const result = await requestCoachMessage(summary, { timeoutMs: config.coach.timeout_ms });
    if (!summaryOnRef.current) {
      setStatus('idle');
      return;
    }
    if (result.ok) {
      setMessage(result.message);
      setHistory((prev) => [...prev.slice(-4), result.message]);
      setStatus('delivered');
    } else {
      console.info({ event: 'coach_fallback', reason: 'unreachable' });
      setStatus('fallback');
    }
    setCooledUntil(Date.now() + config.coach.cooldown_ms);
    coolingTimer.current = window.setTimeout(() => setCooledUntil(0), config.coach.cooldown_ms);
  };

  // An escalation asks once per new id, even when blocked (the id is
  // recorded first, so a blocked escalation never re-fires later). A
  // tracking gap never starts one: the button stays disabled instead.
  // While paused the id is still recorded, but no request goes out.
  useEffect(() => {
    const next = nextEscalation(escalationId, lastHandledEscalation.current);
    if (next === null) return;
    lastHandledEscalation.current = next;
    if (paused) return;
    void request();
    // Runs every render on purpose: the id change, not the inputs, triggers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  const dismiss = () => {
    setStatus('idle');
    setMessage(null);
  };

  const blocked = cantSeeYouActive || cooling || paused;

  return (
    <section aria-label="Coaching">
      <h2>Coaching</h2>
      {status === 'escalating' && <p aria-live="polite">{CHECKING_IN}</p>}
      {status === 'delivered' && message !== null && <p className="coach-message">{message}</p>}
      {status === 'fallback' && <p>{LOCAL_FALLBACK}</p>}
      {(status === 'delivered' || status === 'fallback') && (
        <div className="button-row">
          <button type="button" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      )}
      {history.length > 0 && (
        <section aria-label="Earlier tips">
          <h3>Earlier tips</h3>
          <ul>
            {history.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="button-row">
        <button type="button" onClick={request} disabled={blocked || status === 'escalating'}>
          {summaryOn ? COACH_BUTTON_LABEL : CONSENT_TIPS_OFF_NOTE}
        </button>
      </div>
    </section>
  );
}
