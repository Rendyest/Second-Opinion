import { useEffect, useRef, useState } from 'react';
import type { PoseFrame, System1StateName, TopSignal } from '../contracts';
import { config } from '../config';
import {
  AUTO_TIPS_NOTE,
  AUTO_TIPS_OFF,
  AUTO_TIPS_ON,
  CHECKING_IN,
  COACH_BUTTON_LABEL,
  COACH_IMPORTED_HEADING,
  COACH_IMPORT_BAD_FILE,
  COACH_IMPORT_LABEL,
  COACH_PAIN_NOTE,
  COACH_SAFETY_NOTE,
  LIVE_TIP_NOTE,
  LOCAL_FALLBACK,
  READ_ALOUD_NOTE,
  READ_ALOUD_OFF,
  READ_ALOUD_ON,
  SPARK_ENABLE_LABEL,
  TASK_NAME,
} from '../copy';
import { loadAutoTips, saveAutoTips } from '../coach/autoTips';
import { cancelSpeech, loadSpeakTips, saveSpeakTips, speakTip } from '../coach/speech';
import { recordCoachCall, type CoachCallTrigger } from '../coach/coachCalls';
import { validateCoachingTip, type CoachingTip } from '../coach/coachingImport';
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
  /**
   * Opt-in handler: pressing it ticks the cloud-summary choice itself, so it
   * is an explicit enable. Without it the panel shows the tips-off note.
   */
  onEnableSpark?: () => void;
}

type CoachStatus = 'idle' | 'escalating' | 'delivered' | 'fallback';

/**
 * Participant coaching panel. Idle, escalating ("Checking in..."), delivered,
 * or local fallback, with a cooldown after every call. Automatic tips are on
 * by default: struggle escalations fetch on their own, and the toggle leaves
 * only the hand-pressed button. Shown tips are read aloud unless sound is
 * turned off. The request body is
 * only the aggregate summary (task, per-angle min/max/mean, duration, System 1
 * state) — never joints, frames, or images. Failures and timeouts fall back
 * to a local message and are logged to the console only, without the summary
 * values, and never block the session. Every completed attempt is recorded
 * in the coach call log for the reviewer page; a delivered tip also carries
 * a short note naming it as a live cloud-model tip.
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
  onEnableSpark,
}: CoachPanelProps) {
  const summaryOn = consent === undefined ? true : canSendSummary(consent);
  const summaryOnRef = useRef(summaryOn);
  summaryOnRef.current = summaryOn;
  // Automatic coaching is the default: struggle escalations fetch a tip on
  // their own. Turning it off leaves only the hand-pressed button.
  const [autoTips, setAutoTips] = useState(loadAutoTips);
  const autoTipsRef = useRef(autoTips);
  autoTipsRef.current = autoTips;
  const toggleAutoTips = () => {
    setAutoTips((prev) => {
      const next = !prev;
      saveAutoTips(next);
      return next;
    });
  };
  // Spoken coaching is the default: sound on unless turned off.
  const [speakTips, setSpeakTips] = useState(loadSpeakTips);
  const toggleSpeech = () => {
    setSpeakTips((prev) => {
      const next = !prev;
      saveSpeakTips(next);
      if (!next) cancelSpeech();
      return next;
    });
  };
  const [stats, setStats] = useState<AngleStats | null>(null);
  const [status, setStatus] = useState<CoachStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  // Imported script tip: playback only. It never requests, never cools
  // down, and never enters the System 2 counts.
  const [imported, setImported] = useState<CoachingTip | null>(null);
  const [importProblem, setImportProblem] = useState<string | null>(null);
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

  const request = async (trigger: CoachCallTrigger) => {
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
    // Every completed attempt enters the reviewer log on /metrics: a proxy
    // success is a live cloud-model tip, anything else is the local fallback.
    recordCoachCall({ trigger, state: systemState, topSignal, outcome: result.ok ? 'live' : 'fallback' });
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
  // While paused, or with automatic tips off, the id is still recorded,
  // but no request goes out.
  useEffect(() => {
    const next = nextEscalation(escalationId, lastHandledEscalation.current);
    if (next === null) return;
    lastHandledEscalation.current = next;
    if (paused || !autoTipsRef.current) return;
    void request('escalation');
    // Runs every render on purpose: the id change, not the inputs, triggers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  const dismiss = () => {
    setStatus('idle');
    setMessage(null);
  };

  // Spoken coaching: every shown tip is read aloud unless sound is off.
  // Cleanup stops the voice on dismiss, a new request, or unmount — speech
  // never blocks the session. Imported script tips are not spoken.
  useEffect(() => {
    if (!speakTips) return;
    if (status === 'delivered' && message !== null) speakTip(message);
    else if (status === 'fallback') speakTip(LOCAL_FALLBACK);
    return () => cancelSpeech();
  }, [status, message, speakTips]);

  const blocked = cantSeeYouActive || cooling || paused;

  return (
    <section aria-label="Coaching">
      <h2>Coaching</h2>
      {status === 'escalating' && <p aria-live="polite">{CHECKING_IN}</p>}
      {status === 'delivered' && message !== null && (
        <>
          <p className="coach-message">{message}</p>
          <p>{LIVE_TIP_NOTE}</p>
        </>
      )}
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
        <button type="button" onClick={toggleAutoTips} aria-pressed={autoTips}>
          {autoTips ? AUTO_TIPS_ON : AUTO_TIPS_OFF}
        </button>
      </div>
      {autoTips && <p>{AUTO_TIPS_NOTE}</p>}
      <div className="button-row">
        <button type="button" onClick={toggleSpeech} aria-pressed={speakTips}>
          {speakTips ? READ_ALOUD_ON : READ_ALOUD_OFF}
        </button>
      </div>
      {speakTips && <p>{READ_ALOUD_NOTE}</p>}
      <div className="button-row">
        {summaryOn ? (
          <button type="button" onClick={() => void request('button')} disabled={blocked || status === 'escalating'}>
            {COACH_BUTTON_LABEL}
          </button>
        ) : onEnableSpark ? (
          <button type="button" onClick={onEnableSpark}>
            {SPARK_ENABLE_LABEL}
          </button>
        ) : (
          <button type="button" onClick={() => void request('button')} disabled={blocked || status === 'escalating'}>
            {CONSENT_TIPS_OFF_NOTE}
          </button>
        )}
      </div>
      <div>
        <label>
          {COACH_IMPORT_LABEL}{' '}
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setImportProblem(null);
              void file.text().then(
                (text) => {
                  try {
                    setImported(validateCoachingTip(JSON.parse(text) as unknown));
                  } catch {
                    setImportProblem(COACH_IMPORT_BAD_FILE);
                  }
                },
                () => setImportProblem(COACH_IMPORT_BAD_FILE),
              );
            }}
          />
        </label>
      </div>
      {importProblem && <p role="alert">{importProblem}</p>}
      {imported && <ImportedTipView tip={imported} onDismiss={() => setImported(null)} />}
    </section>
  );
}

/** Playback of one offline script tip. No requests, no cooldown, no counts. */
export function ImportedTipView({ tip, onDismiss }: { tip: CoachingTip; onDismiss: () => void }) {
  return (
    <section aria-label={COACH_IMPORTED_HEADING}>
      <h3>{COACH_IMPORTED_HEADING}</h3>
      <p className="coach-message">{tip.cue_text}</p>
      <p>{`Struggling: ${tip.struggling ? 'yes' : 'no'}`}</p>
      <p>{`Signal: ${tip.signal}`}</p>
      <p>{`Severity: ${tip.severity}`}</p>
      {tip.safety_concern && <p>{COACH_SAFETY_NOTE}</p>}
      {tip.ask_pain_check && <p>{COACH_PAIN_NOTE}</p>}
      <div className="button-row">
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </section>
  );
}
