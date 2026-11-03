import type { System1StateName, TopSignal } from '../contracts';
import { config } from '../config';
import { STATE_LABEL, TOP_SIGNAL_WHY } from '../copy';

export type Steadiness = 'steady' | 'unsteady' | 'very unsteady';

/** Bucket a 0–1 score using the struggle hysteresis thresholds. */
export function scoreLevel(score: number, enter: number, exit: number): Steadiness {
  if (score < exit) return 'steady';
  if (score < enter) return 'unsteady';
  return 'very unsteady';
}

interface StruggleIndicatorProps {
  state: System1StateName;
  /**
   * Null when too few clean frames remain in the window: no bar, except that
   * moving_well still shows an empty steady bar rather than hiding the meter.
   */
  score: number | null;
  /** Fix line shown under "Can't see you" instead of a why line. */
  fixLine?: string | null;
  /** Why line, shown only for hesitating and struggling, from the top signal. */
  topSignal?: TopSignal;
}

/**
 * Participant-facing System 1 readout: the state label is primary, with a
 * thin score bar and a one-line why (from the top signal, hesitating and
 * struggling only) or the fix line for Can't see you. No digits, no percent,
 * no "x of y" — never colour alone, never numbers.
 */
export function StruggleIndicator({ state, score, fixLine, topSignal }: StruggleIndicatorProps) {
  // An unscored moving_well reads as steady-and-empty; every other unscored
  // state keeps no bar.
  const shownScore = score ?? (state === 'moving_well' ? 0 : null);
  const level =
    shownScore === null
      ? null
      : scoreLevel(shownScore, config.struggle.enter_threshold, config.struggle.exit_threshold);
  const line =
    state === 'cant_see_you'
      ? (fixLine ?? 'Try moving back into view of the camera.')
      : topSignal !== undefined && (state === 'hesitating' || state === 'struggling')
        ? TOP_SIGNAL_WHY[topSignal]
        : null;
  return (
    <section aria-label="How the session is going">
      <h2>{STATE_LABEL[state]}</h2>
      {line !== null && <p>{line}</p>}
      {level !== null && shownScore !== null && (
        <div className="score-bar" role="img" aria-label={`Steadiness: ${level}`}>
          <div
            className={`score-fill score-fill-${level.replace(' ', '-')}`}
            style={{ width: `${Math.round(Math.min(1, Math.max(0, shownScore)) * 100)}%` }}
            aria-hidden="true"
          />
        </div>
      )}
    </section>
  );
}
