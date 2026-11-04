import { useEffect, useRef, useState } from 'react';
import type { PoseFrame } from '../contracts';
import { config } from '../config';
import { useLivePose } from '../pose/useLivePose';
import { statusText } from '../pose/statusText';
import {
  CALIBRATION_CAPTURE_TIMEOUT_MS,
  CALIBRATION_MIN_SAMPLES,
  GATE_JOINT_LABELS,
  calibrateFrames,
  isClearCalibrationFrame,
  unclearJoints,
  useCalibration,
} from '../pose/calibration';
import { useConsent } from '../consent/consent';
import { CALIBRATION_STOPPED } from '../consentCopy';
import {
  attemptCalibrationStart,
  calibrationBlocks,
  readSetupChecks,
  shouldAbortCapture,
  subscribeSetupChecks,
  type CalibrationBlock,
  type SetupCheckResult,
} from '../setup/checks';
import { CalibrationBlockedNotice } from './CalibrationBlockedNotice';

type Phase = 'idle' | 'warming' | 'capturing';

/** Give the camera and pose model time to start before the 2 s capture begins. */
const WARMUP_TIMEOUT_MS = 30000;

/**
 * Calibration step for /setup. A ~2 s capture ("sit facing the camera,
 * arms relaxed") stores upper-arm, forearm, and shoulder-width baselines for
 * the per-frame quality gate. Pass/fail with a retry button; continuing
 * without calibration leaves a warning and a less reliable gate.
 */
export function CalibrationStep() {
  const { state, save, skip, begin } = useCalibration();
  const { consent } = useConsent();
  const live = useLivePose();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [blockNotice, setBlockNotice] = useState<CalibrationBlock[]>([]);
  const frameRef = useRef<PoseFrame | null>(null);
  frameRef.current = live.frame;
  // Debounced setup-check results, shared by the SetupChecks section.
  // Missing results count as failing: calibration starts blocked.
  const [checkResults, setCheckResults] = useState<SetupCheckResult[] | null>(() => readSetupChecks());
  useEffect(() => subscribeSetupChecks(() => setCheckResults(readSetupChecks())), []);
  const blocksNow = calibrationBlocks(consent, checkResults ?? []);

  // Withdrawing camera consent mid-capture aborts it: the camera stops
  // (below), the partial samples are discarded, and nothing is stored.
  useEffect(() => {
    if (shouldAbortCapture(phase === 'warming' || phase === 'capturing', consent.camera)) {
      live.stop();
      setPhase('idle');
      setError(CALIBRATION_STOPPED);
    }
  }, [phase, consent.camera, live.stop]);

  // Warm up: wait until the camera is live and frames are arriving before the
  // timed capture starts. The model download alone takes longer than 2 s.
  useEffect(() => {
    if (phase !== 'warming') return;
    if (live.frame) {
      setPhase('capturing');
      return;
    }
    if (live.status === 'denied' || live.status === 'error') {
      const detail = live.error ?? 'the camera did not start';
      live.stop();
      setPhase('idle');
      setError(
        `Calibration failed: ${detail} Check permissions and connection, then try again, or continue without calibration.`,
      );
      return;
    }
    const timer = window.setTimeout(() => {
      live.stop();
      setPhase('idle');
      setError(
        'Calibration failed: no pose detected. Step into view so your shoulders, elbows, and wrists are visible, then try again.',
      );
    }, WARMUP_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
    // Runs on every frame/status change while warming.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, live.frame, live.status]);

  // Capture: collect distinct live frames until enough clear views arrive,
  // then pass or fail. Fixed 2 s windows starve on slow inference (frames
  // arrive seconds apart), so this waits up to an outer timeout instead.
  useEffect(() => {
    if (phase !== 'capturing') return;
    const samples: PoseFrame[] = [];
    const startedAt = Date.now();
    const finish = () => {
      window.clearInterval(sampler);
      live.stop();
      setPhase('idle');
      const baseline = calibrateFrames(samples, config.gate.vis_min);
      if (baseline) {
        save(baseline);
        setError(null);
      } else if (samples.length === 0) {
        setError(
          'Calibration failed: no pose detected. Step into view and try again.',
        );
      } else {
        const names = unclearJoints(samples, config.gate.vis_min).map(
          (name) => GATE_JOINT_LABELS[name] ?? name,
        );
        setError(
          `Calibration failed: ${names.join(', ')} unclear. Move so your shoulders and arms are all visible, then try again.`,
        );
      }
    };
    const sampler = window.setInterval(() => {
      const latest = frameRef.current;
      if (latest && latest !== samples[samples.length - 1]) samples.push(latest);
      // Finish on enough CLEAR frames, not just frames: borderline scores
      // mean most frames filter out, so count what survives the filter.
      const clear = samples.filter((s) => isClearCalibrationFrame(s, config.gate.vis_min)).length;
      if (clear >= CALIBRATION_MIN_SAMPLES || Date.now() - startedAt >= CALIBRATION_CAPTURE_TIMEOUT_MS) {
        finish();
      }
    }, 250);
    return () => {
      window.clearInterval(sampler);
    };
    // The capture runs once per start; frameRef always holds the latest frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Gated entry: without camera consent and passing checks 1-6 the
  // camera never starts and no frame is read; the notice names the fix.
  const start = () => {
    const blocks = attemptCalibrationStart(consent, checkResults ?? [], () => {
      begin();
      setError(null);
      setBlockNotice([]);
      setPhase('warming');
      live.start();
    });
    setBlockNotice(blocks);
  };

  const skipCalibration = () => {
    live.stop();
    setPhase('idle');
    skip();
  };

  const passed = state.baseline !== null && error === null;
  const busy = phase !== 'idle';

  return (
    <section aria-label="Calibration">
      <h2>Arm Calibration</h2>
      <p>
        Sit facing the camera, arms relaxed. Ensure your shoulder, elbows and wrists are in view. We measure your upper arm, forearm, and shoulder
        width, holding still until enough clear views arrive.
      </p>
      {passed && state.baseline && (
        <p>
          Calibration passed: upper arm {state.baseline.upperArm.toFixed(3)}, forearm{' '}
          {state.baseline.forearm.toFixed(3)}, shoulder width{' '}
          {state.baseline.shoulderWidth.toFixed(3)}.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {state.skipped && state.baseline === null && !busy && (
        <p>
          <strong>Warning:</strong> you continued without calibration. The signal check is less
          reliable.
        </p>
      )}
      {phase === 'warming' && (
        <p aria-live="polite">Starting camera… sit facing the camera, arms relaxed.</p>
      )}
      {phase === 'capturing' && (
        <p aria-live="polite">Capturing… sit facing the camera, arms relaxed.</p>
      )}
      {!busy && (
        <div className="button-row">
          <button
            type="button"
            onClick={start}
            aria-disabled={blocksNow.length > 0 ? 'true' : undefined}
            aria-describedby={blocksNow.length > 0 ? 'calibration-blocked-notice' : undefined}
          >
            {passed || error ? 'Retry calibration' : 'Start calibration'}
          </button>
          {!state.baseline && !state.skipped && (
            <button type="button" onClick={skipCalibration}>
              Continue without calibration
            </button>
          )}
        </div>
      )}
      <div aria-live="polite" id="calibration-blocked-notice">
        <CalibrationBlockedNotice blocks={blockNotice} />
      </div>
      {/* The live-pose hook plays the camera stream into this element; without
          it the camera can never start ("video element not ready"). Doubling as
          a preview so the person can frame themselves. */}
      <video
        ref={live.videoRef}
        className="calibration-preview"
        muted
        playsInline
        aria-label="Calibration camera preview"
      />
      {live.status !== 'idle' && <p aria-live="polite">{statusText(live.status)}</p>}
      {live.error && <p role="alert">{live.error}</p>}
    </section>
  );
}
