import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { Joint2D, ReviewClip } from '../contracts';
import { elbowFlexion, shoulderElevation } from '../pose/angles';
import { createPipeline } from '../pipeline/run';
import { config } from '../config';
import { SkeletonSvg } from '../review/skeletonSvg';
import {
  computeReviewStatus,
  ERROR_TYPE_IDS,
  validateReviewLabel,
  validateReviewNote,
  type ReviewLabel,
  type ReviewMode,
  type Severity,
  type StoredReview,
} from '../review/labels';
import {
  ERROR_TYPE_LABEL,
  museLabelText,
  REVIEW_BACK_LABEL,
  REVIEW_CONFIRM_LABEL,
  REVIEW_CORRECT_LABEL,
  REVIEW_LOCK_LABEL,
  REVIEW_NOTE_WARNING,
  REVIEW_NOTE_TOO_LONG,
  REVIEW_POINTS_ONLY,
  REVIEW_RECORDED_NOTE,
  REVIEW_SAVE_CORRECTION_LABEL,
  REVIEW_SKIP_LABEL,
  REVIEW_STATUS_LABEL,
  REVIEW_UNUSABLE_LABEL,
  REVIEWER_REQUIRED_NOTE,
} from '../reviewCopy';

const ZERO: Joint2D = { x: 0, y: 0, conf: 0 };

/**
 * Review card for one clip. Player (seek/step/speeds, keyboard only when
 * focused), angle traces with flagged-span shading, Muse label, and the
 * label controls. Blind mode locks the reviewer's label before revealing
 * Muse; assist mode pre-fills from Muse. Status always comes from the final
 * labels, never from which button was pressed.
 */
export function ReviewCard({
  clip,
  existingReview,
  reviewer,
  blindDefault,
  noteMaxChars,
  onSubmit,
  onClose,
}: {
  clip: ReviewClip;
  existingReview: StoredReview | null;
  reviewer: string;
  blindDefault: boolean;
  noteMaxChars: number;
  onSubmit: (review: StoredReview) => void;
  onClose: () => void;
}) {
  const frames = clip.frames;
  const muse = clip.muse ?? null;
  const [mode, setMode] = useState<ReviewMode>(blindDefault ? 'blind' : 'assist');
  const [editing, setEditing] = useState(!muse);
  const [struggling, setStruggling] = useState(existingReview?.struggling ?? muse?.struggling ?? false);
  const [severity, setSeverity] = useState<Severity>(
    existingReview?.severity ?? muse?.severity ?? 'none',
  );
  const [errorTypes, setErrorTypes] = useState<string[]>(existingReview?.error_types ?? []);
  const [note, setNote] = useState(existingReview?.note ?? '');
  const [unusable, setUnusable] = useState(existingReview?.unusable ?? false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  // Per-frame gate flags recomputed with the shared pipeline; angle traces
  // recomputed from the joints with the shared angle math.
  const analysis = useMemo(() => {
    const pipe = createPipeline({
      gate: config.gate,
      struggle: config.struggle,
      face: config.face,
      smoothing: config.smoothing,
      visMin: config.gate.vis_min,
      cooldownMs: config.coach.cooldown_ms,
      storedFace: clip.face,
    });
    return clip.frames.map((f) => {
      const gate = pipe.push(f, clip.baseline, f.t * 1000, false).gate;
      const shoulder = f.joints['r_shoulder'] ?? ZERO;
      const elbow = f.joints['r_elbow'] ?? ZERO;
      const wrist = f.joints['r_wrist'] ?? ZERO;
      return {
        flexDeg: elbowFlexion(shoulder, elbow, wrist).deg,
        elevDeg: shoulderElevation(shoulder, elbow).deg,
        gateOk: gate.ok,
      };
    });
  }, [clip]);

  useEffect(() => {
    if (!playing) return;
    if (idx >= frames.length - 1) {
      setPlaying(false);
      return;
    }
    const ms = Math.max(16, 1000 / clip.fps / speed);
    const timer = window.setTimeout(() => setIdx(idx + 1), ms);
    return () => window.clearTimeout(timer);
  }, [playing, speed, idx, frames.length, clip.fps]);

  const frame = frames[idx] ?? frames[0];
  const durationS = frames.length > 0 ? frames[frames.length - 1]?.t ?? 0 : 0;

  const onPlayerKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === ' ') {
      e.preventDefault();
      setPlaying((p) => !p);
    } else if (e.key === 'ArrowRight') {
      setIdx((i) => Math.min(i + 1, frames.length - 1));
    } else if (e.key === 'ArrowLeft') {
      setIdx((i) => Math.max(i - 1, 0));
    }
  };

  const toggleErrorType = (id: string) => {
    setErrorTypes((prev) => (prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]));
  };

  const pickStruggling = (v: boolean) => {
    setStruggling(v);
    if (!v) {
      setSeverity('none');
      setErrorTypes([]);
    }
  };

  const reviewerOk = reviewer.trim().length > 0;
  const noteOk = validateReviewNote(note, noteMaxChars);

  function submit(status: StoredReview['status'], opts: { skipped?: boolean } = {}): boolean {
    const errors: string[] = [];
    if (!reviewerOk) errors.push(REVIEWER_REQUIRED_NOTE);
    if (!noteOk) errors.push(REVIEW_NOTE_TOO_LONG);
    if (!unusable && !opts.skipped) errors.push(...validateReviewLabel({ struggling, severity, errorTypes }));
    setFormErrors(errors);
    if (errors.length > 0) return false;
    onSubmit({
      clip_id: clip.clip_id,
      status,
      mode,
      struggling,
      severity,
      error_types: [...errorTypes],
      note,
      reviewer: reviewer.trim(),
      reviewed_at: new Date().toISOString(),
      muse: muse ? { ...muse } : null,
      ...(opts.skipped ? { skipped: true } : {}),
      ...(unusable ? { unusable: true } : {}),
    });
    return true;
  }

  const lockMine = () => {
    if (unusable) {
      submit('flagged');
      return;
    }
    const label: ReviewLabel = { struggling, severity, errorTypes };
    submit(computeReviewStatus(muse, label));
  };

  const confirmMuse = () => {
    if (!muse) return;
    setStruggling(muse.struggling);
    setSeverity(muse.severity);
    setErrorTypes([...muse.error_types]);
    submit(computeReviewStatus(muse, { struggling: muse.struggling, severity: muse.severity, errorTypes: muse.error_types }));
  };

  if (existingReview) {
    return (
      <section aria-label="Review card">
        <h2>Review card</h2>
        <p>{REVIEW_RECORDED_NOTE}</p>
        <p>
          {`${REVIEW_STATUS_LABEL[existingReview.status]} (${existingReview.mode === 'blind' ? 'blind' : 'assist'})`}
        </p>
        <p>{`Muse label: ${museLabelText(existingReview.muse)}`}</p>
        {existingReview.muse && <p>{`Muse reason: ${existingReview.muse.reason}`}</p>}
        <div className="button-row">
          <button type="button" onClick={onClose}>
            {REVIEW_BACK_LABEL}
          </button>
        </div>
      </section>
    );
  }

  const form = (
    <>
      <fieldset>
        <legend>Struggling</legend>
        <label>
          <input type="radio" name={`struggling-${clip.clip_id}`} checked={struggling} onChange={() => pickStruggling(true)} />
          Yes
        </label>
        <label>
          <input type="radio" name={`struggling-${clip.clip_id}`} checked={!struggling} onChange={() => pickStruggling(false)} />
          No
        </label>
      </fieldset>
      <fieldset>
        <legend>Severity</legend>
        {(['none', 'mild', 'moderate', 'severe'] as Severity[]).map((s) => (
          <label key={s}>
            <input
              type="radio"
              name={`severity-${clip.clip_id}`}
              checked={severity === s}
              disabled={!struggling}
              onChange={() => setSeverity(s)}
            />
            {s}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Error types</legend>
        {ERROR_TYPE_IDS.map((id) => (
          <label key={id}>
            <input type="checkbox" checked={errorTypes.includes(id)} disabled={!struggling} onChange={() => toggleErrorType(id)} />
            {ERROR_TYPE_LABEL[id]}
          </label>
        ))}
      </fieldset>
      <div>
        <label>
          Note (optional)
          <textarea value={note} maxLength={noteMaxChars} onChange={(e) => setNote(e.target.value)} rows={3} />
        </label>
        <p>{REVIEW_NOTE_WARNING}</p>
      </div>
      <label>
        <input type="checkbox" checked={unusable} onChange={(e) => setUnusable(e.target.checked)} />
        {REVIEW_UNUSABLE_LABEL}
      </label>
    </>
  );

  return (
    <section aria-label="Review card">
      <h2>Review card</h2>
      <p>{REVIEW_POINTS_ONLY}</p>
      <div
        tabIndex={0}
        role="group"
        aria-label={`Clip player ${clip.clip_id}. Space plays or pauses. Left and right arrows step.`}
        onKeyDown={onPlayerKey}
      >
        {frame && (
          <SkeletonSvg frame={frame} dimBelowConf={config.gate.vis_min} label={`Frame at ${frame.t.toFixed(2)} seconds`} />
        )}
        <p>{`Clip time: ${(frames[idx]?.t ?? 0).toFixed(2)} s of ${durationS.toFixed(2)} s`}</p>
        <div className="button-row">
          <button type="button" onClick={() => setPlaying((p) => !p)}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={() => setIdx((i) => Math.max(i - 1, 0))}>
            Step back
          </button>
          <button type="button" onClick={() => setIdx((i) => Math.min(i + 1, frames.length - 1))}>
            Step forward
          </button>
          {[0.5, 1, 2].map((s) => (
            <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
              {s}x
            </button>
          ))}
        </div>
        <label>
          Seek
          <input
            type="range"
            min={0}
            max={Math.max(frames.length - 1, 0)}
            value={idx}
            onChange={(e) => setIdx(Number(e.target.value))}
          />
        </label>
      </div>
      <AngleTraces analysis={analysis} idx={idx} marks={mode === 'assist' ? (clip.marks ?? null) : null} durationS={durationS} />
      {mode === 'assist' && (
        <>
          <p>{`Muse label: ${museLabelText(muse)}`}</p>
          {muse && <p>{`Muse reason: ${muse.reason}`}</p>}
        </>
      )}
      <div className="button-row">
        <button type="button" aria-pressed={mode === 'blind'} onClick={() => setMode('blind')}>
          Blind
        </button>
        <button type="button" aria-pressed={mode === 'assist'} onClick={() => setMode('assist')}>
          Assist
        </button>
      </div>
      {mode === 'blind' && (
        <>
          {form}
          <div className="button-row">
            <button type="button" onClick={lockMine}>
              {REVIEW_LOCK_LABEL}
            </button>
            <button type="button" onClick={() => submit('unreviewed', { skipped: true })}>
              {REVIEW_SKIP_LABEL}
            </button>
          </div>
        </>
      )}
      {mode === 'assist' && !editing && muse && (
        <div className="button-row">
          <button type="button" onClick={confirmMuse}>
            {REVIEW_CONFIRM_LABEL}
          </button>
          <button type="button" onClick={() => setEditing(true)}>
            {REVIEW_CORRECT_LABEL}
          </button>
          <button type="button" onClick={() => submit('unreviewed', { skipped: true })}>
            {REVIEW_SKIP_LABEL}
          </button>
        </div>
      )}
      {mode === 'assist' && (editing || !muse) && (
        <>
          {form}
          <div className="button-row">
            <button type="button" onClick={() => submit(computeReviewStatus(muse, { struggling, severity, errorTypes }))}>
              {REVIEW_SAVE_CORRECTION_LABEL}
            </button>
            <button type="button" onClick={() => submit('unreviewed', { skipped: true })}>
              {REVIEW_SKIP_LABEL}
            </button>
          </div>
        </>
      )}
      {!reviewerOk && <p>{REVIEWER_REQUIRED_NOTE}</p>}
      {formErrors.length > 0 && (
        <div role="alert">
          <ul>
            {formErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="button-row">
        <button type="button" onClick={onClose}>
          {REVIEW_BACK_LABEL}
        </button>
      </div>
    </section>
  );
}

function AngleTraces({
  analysis,
  idx,
  marks,
  durationS,
}: {
  analysis: Array<{ flexDeg: number; elevDeg: number; gateOk: boolean }>;
  idx: number;
  marks: number[] | null;
  durationS: number;
}) {
  const W = 300;
  const H = 64;
  const n = analysis.length;
  const x = (i: number): number => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (deg: number): number => {
    const d = Number.isFinite(deg) ? Math.max(0, Math.min(180, deg)) : 0;
    return H - (d / 180) * H;
  };
  const line = (pick: (a: (typeof analysis)[number]) => number): string =>
    analysis.map((a, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pick(a)).toFixed(1)}`).join(' ');
  // Contiguous flagged spans, shaded with a hatch pattern (never colour alone).
  const spans: Array<[number, number]> = [];
  let open: number | null = null;
  for (let i = 0; i <= n; i += 1) {
    const flagged = i < n && !analysis[i]?.gateOk;
    if (flagged && open === null) open = i;
    if (!flagged && open !== null) {
      spans.push([open, i - 1]);
      open = null;
    }
  }
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Angle traces with flagged signal spans shaded">
        <defs>
          <pattern id="review-flag-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" stroke="#666" strokeWidth="1" />
          </pattern>
        </defs>
        {spans.map(([a, b]) => (
          <rect key={`${a}-${b}`} x={x(a)} y={0} width={Math.max(x(b) - x(a), 1)} height={H} fill="url(#review-flag-hatch)" />
        ))}
        <path d={line((a) => a.flexDeg)} fill="none" stroke="#111" strokeWidth={1.6} />
        <path d={line((a) => a.elevDeg)} fill="none" stroke="#111" strokeWidth={1.2} strokeDasharray="4 2" />
        {marks?.map((t) => (
          <line
            key={t}
            x1={durationS > 0 ? (t / durationS) * W : 0}
            y1={0}
            x2={durationS > 0 ? (t / durationS) * W : 0}
            y2={H}
            stroke="#111"
            strokeWidth={1.4}
          />
        ))}
        <line x1={x(idx)} y1={0} x2={x(idx)} y2={H} stroke="#b36b00" strokeWidth={1.6} />
      </svg>
      <p>
        Solid line: elbow flexion. Dashed line: shoulder elevation. Shaded spans: signal flagged.
        {marks ? ' Ticks: recorder marks.' : ''}
      </p>
    </div>
  );
}
