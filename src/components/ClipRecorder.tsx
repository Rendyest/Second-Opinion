import { useEffect, useRef, useState } from 'react';
import { buildClip, type ClipSample } from '../pipeline/clip';
import { config } from '../config';
import { useLivePose } from '../pose/useLivePose';
import { statusText } from '../pose/statusText';
import { useCalibration } from '../pose/calibration';
import { canRecord, canSendClip, useConsent } from '../consent/consent';
import { CONSENT_RECORDING_NEED } from '../consentCopy';
import {
  RECORDER_CLIPS_NEED,
  RECORDER_CONSENT,
  RECORDER_DISCARD_LABEL,
  RECORDER_DONE_NOTE,
  RECORDER_DOWNLOAD_LABEL,
  RECORDER_LABEL_PROMPT,
  RECORDER_MARK_END_LABEL,
  RECORDER_MARK_START_LABEL,
  RECORDER_RECORDING_NOTE,
  RECORDER_SECTION_TITLE,
  RECORDER_START_LABEL,
  RECORDER_STOP_LABEL,
} from '../metricsCopy';

/** The only export path: a Blob download the person clicks. */
export function downloadJsonFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type RecorderPhase = 'idle' | 'recording' | 'recorded';

/**
 * Dev-only clip recorder for /metrics (never on /session). Reuses the live
 * pose hook; keeps samples in memory only. Nothing is stored or sent: the
 * clip leaves memory solely through the Download button.
 */
export function ClipRecorder({ enabled }: { enabled: boolean }) {
  const live = useLivePose();
  const { state: calibration } = useCalibration();
  const { consent } = useConsent();
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [label, setLabel] = useState('P1');
  const [consented, setConsented] = useState(false);
  const [markOpen, setMarkOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const samplesRef = useRef<ClipSample[]>([]);
  const labelsRef = useRef<Array<{ start_s: number; end_s: number }>>([]);
  const openLabelRef = useRef<number | null>(null);
  const t0Ref = useRef(0);
  const baseRef = useRef(calibration);
  baseRef.current = calibration;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const finish = (finalT: number) => {
    live.stop();
    const samples = samplesRef.current;
    if (openLabelRef.current !== null) {
      labelsRef.current.push({ start_s: openLabelRef.current, end_s: finalT });
      openLabelRef.current = null;
      setMarkOpen(false);
    }
    if (samples.length === 0) {
      setError('No frames were recorded. Try again with the camera on.');
      setPhase('idle');
      return;
    }
    setPhase('recorded');
  };

  // Sample every live frame while recording; stop by itself at the limit.
  useEffect(() => {
    if (phaseRef.current !== 'recording' || !live.frame) return;
    const frame = live.frame;
    if (samplesRef.current.length === 0) t0Ref.current = frame.t;
    const t = frame.t - t0Ref.current;
    samplesRef.current.push({ t, joints: { ...frame.joints } });
    if (t >= config.metrics.record_max_s) finish(t);
    // Runs on every live frame while recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.frame]);

  if (!enabled) return null;

  const start = () => {
    if (!canRecord(consent)) {
      setError(CONSENT_RECORDING_NEED);
      return;
    }
    setError(null);
    samplesRef.current = [];
    labelsRef.current = [];
    openLabelRef.current = null;
    setMarkOpen(false);
    setPhase('recording');
    live.start();
  };

  const stop = () => {
    const samples = samplesRef.current;
    finish(samples.length > 0 ? samples[samples.length - 1].t : 0);
  };

  const markStart = () => {
    const samples = samplesRef.current;
    if (samples.length === 0 || openLabelRef.current !== null) return;
    openLabelRef.current = samples[samples.length - 1].t;
    setMarkOpen(true);
  };

  const markEnd = () => {
    const samples = samplesRef.current;
    if (openLabelRef.current === null || samples.length === 0) return;
    labelsRef.current.push({ start_s: openLabelRef.current, end_s: samples[samples.length - 1].t });
    openLabelRef.current = null;
    setMarkOpen(false);
  };

  const download = () => {
    // Every export goes through the clip gate: recording AND face-masked
    // clips choices, both ticked.
    if (!canSendClip(consent)) {
      setError(RECORDER_CLIPS_NEED);
      return;
    }
    const cal = baseRef.current;
    const clip = buildClip({
      name: label.trim() === '' ? 'P1' : label.trim(),
      fps: live.fps > 0 ? live.fps : 30,
      samples: samplesRef.current,
      baseline: cal.baseline,
      face: cal.face,
      thresholds: {
        gate: config.gate,
        struggle: config.struggle,
        face: config.face,
        smoothing: config.smoothing,
      },
      labels: labelsRef.current,
      source: 'recorded',
    });
    downloadJsonFile(`${clip.name}.clip.json`, JSON.stringify(clip));
    setPhase('idle');
  };

  const discard = () => {
    live.stop();
    setPhase('idle');
    setError(null);
  };

  return (
    <section aria-label="Record a clip (dev)">
      <h2>{RECORDER_SECTION_TITLE}</h2>
      {phase === 'idle' && (
        <>
          <p>
            <label>
              {RECORDER_LABEL_PROMPT}{' '}
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={24}
              />
            </label>
          </p>
          <p>
            <label>
              <input
                type="checkbox"
                checked={consented}
                onChange={(e) => setConsented(e.target.checked)}
              />{' '}
              {RECORDER_CONSENT}
            </label>
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="button-row">
            <button type="button" onClick={start} disabled={!consented}>
              {RECORDER_START_LABEL}
            </button>
          </div>
        </>
      )}
      {phase === 'recording' && (
        <>
          <p aria-live="polite">{RECORDER_RECORDING_NOTE}</p>
          <p aria-live="polite">{statusText(live.status)}</p>
          {live.error && <p role="alert">{live.error}</p>}
          <div className="button-row">
            <button type="button" onClick={markStart} disabled={markOpen}>
              {RECORDER_MARK_START_LABEL}
            </button>
            <button type="button" onClick={markEnd} disabled={!markOpen}>
              {RECORDER_MARK_END_LABEL}
            </button>
            <button type="button" onClick={stop}>
              {RECORDER_STOP_LABEL}
            </button>
          </div>
          <video
            ref={live.videoRef}
            className="calibration-preview"
            muted
            playsInline
            aria-label="Clip recording preview"
          />
        </>
      )}
      {phase === 'recorded' && (
        <>
          <p>{RECORDER_DONE_NOTE}</p>
          {error && <p role="alert">{error}</p>}
          <div className="button-row">
            <button type="button" onClick={download}>
              {RECORDER_DOWNLOAD_LABEL}
            </button>
            <button type="button" onClick={discard}>
              {RECORDER_DISCARD_LABEL}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
