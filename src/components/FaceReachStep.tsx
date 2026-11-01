import { useEffect, useRef, useState } from 'react';
import type { PoseFrame } from '../contracts';
import { config } from '../config';
import { useLivePose } from '../pose/useLivePose';
import { statusText } from '../pose/statusText';
import { useCalibration } from '../pose/calibration';
import { capturePointOffsets, minHandDistance, measureTouch, type FaceReach } from '../pose/faceReach';
import {
  FACE_ANCHOR_FAIL,
  FACE_HOLD_FAIL,
  FACE_HOLD_LABEL,
  FACE_HOLD_PROMPT,
  FACE_NO_POSE_FAIL,
  FACE_PASS,
  FACE_RETRY_LABEL,
  FACE_SKIP_LABEL,
  FACE_SKIPPED_NOTE,
  FACE_START_LABEL,
  FACE_STEP_INTRO,
  FACE_STEP_TITLE,
} from '../copy';

type Phase = 'idle' | 'warming' | 'anchor' | 'holdReady' | 'hold';

/** Anchor capture (~1 s relaxed, hand away) and hold capture (~2 s at face). */
const FACE_ANCHOR_CAPTURE_MS = 1200;
const FACE_HOLD_CAPTURE_MS = 2200;
/** Same camera/model warm-up budget as the calibration step. */
const WARMUP_TIMEOUT_MS = 30000;

/**
 * Face step for /setup, after the calibration step. First the camera watches
 * a relaxed, hand-away pose to learn where the face sits relative to the
 * shoulders; then the person brings the hand to the face and holds it so the
 * reach zone can be measured. Pass/fail with retry; continuing without the
 * step leaves a warning and the detector falls back to standard values.
 * Only derived numbers are stored — no frames, no images.
 */
export function FaceReachStep() {
  const { state, saveFace, skipFace: skipFaceStored, begin } = useCalibration();
  const live = useLivePose();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<PoseFrame | null>(null);
  frameRef.current = live.frame;
  const anchorRef = useRef<FaceReach['offsets'] | null>(null);
  const warmTargetRef = useRef<'anchor' | 'hold'>('anchor');

  // Warm up: wait until the camera is live and frames are arriving before the
  // timed capture begins.
  useEffect(() => {
    if (phase !== 'warming') return;
    if (live.frame) {
      setPhase(warmTargetRef.current === 'anchor' ? 'anchor' : 'hold');
      return;
    }
    if (live.status === 'denied' || live.status === 'error') {
      const detail = live.error ?? 'the camera did not start';
      live.stop();
      setPhase('idle');
      setError(
        `Face step failed: ${detail} Check permissions and connection, then try again, or continue without the face step.`,
      );
      return;
    }
    const timer = window.setTimeout(() => {
      live.stop();
      setPhase('idle');
      setError(
        'Face step failed: no pose detected. Move into view so your face, shoulders and hand are visible, then try again.',
      );
    }, WARMUP_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
    // Runs on every frame/status change while warming.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, live.frame, live.status]);

  // Anchor capture: relaxed, hand away. Median over the clear frames.
  useEffect(() => {
    if (phase !== 'anchor') return;
    const samples: PoseFrame[] = [];
    const sampler = window.setInterval(() => {
      const latest = frameRef.current;
      if (latest) samples.push(latest);
    }, 100);
    const timer = window.setTimeout(() => {
      window.clearInterval(sampler);
      live.stop();
      setPhase('idle');
      if (samples.length === 0) {
        setError(FACE_NO_POSE_FAIL);
        return;
      }
      const offsets = capturePointOffsets(samples, config.gate.vis_min);
      if (!offsets) {
        setError(FACE_ANCHOR_FAIL);
        return;
      }
      anchorRef.current = offsets;
      setError(null);
      setPhase('holdReady');
    }, FACE_ANCHOR_CAPTURE_MS);
    return () => {
      window.clearInterval(sampler);
      window.clearTimeout(timer);
    };
    // The capture runs once per start; frameRef always holds the latest frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Hold capture: hand at the face. Median nearest-point distance and elbow.
  useEffect(() => {
    if (phase !== 'hold') return;
    const offsets = anchorRef.current;
    const samples: { dist: number; elbowDeg: number }[] = [];
    const sampler = window.setInterval(() => {
      const latest = frameRef.current;
      if (!latest || !offsets) return;
      const d = minHandDistance(latest.joints, offsets, config.gate.vis_min);
      const elbow = latest.angles['r_elbow_flexion']?.deg;
      if (!d || typeof elbow !== 'number' || !Number.isFinite(elbow)) return;
      samples.push({ dist: d.dist, elbowDeg: elbow });
    }, 100);
    const timer = window.setTimeout(() => {
      window.clearInterval(sampler);
      live.stop();
      setPhase('idle');
      if (!offsets) {
        setError(FACE_ANCHOR_FAIL);
        return;
      }
      if (samples.length === 0) {
        setError(FACE_NO_POSE_FAIL);
        return;
      }
      const touch = measureTouch(samples);
      if (!touch) {
        setError(FACE_HOLD_FAIL);
        return;
      }
      saveFace({ offsets, touchDist: touch.touchDist, touchElbowDeg: touch.touchElbowDeg });
      setError(null);
    }, FACE_HOLD_CAPTURE_MS);
    return () => {
      window.clearInterval(sampler);
      window.clearTimeout(timer);
    };
    // The capture runs once per start; frameRef always holds the latest frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const startAnchor = () => {
    begin();
    anchorRef.current = null;
    setError(null);
    warmTargetRef.current = 'anchor';
    setPhase('warming');
    live.start();
  };

  const startHold = () => {
    setError(null);
    warmTargetRef.current = 'hold';
    setPhase('warming');
    live.start();
  };

  const skipStep = () => {
    live.stop();
    setPhase('idle');
    skipFaceStored();
  };

  const passed = state.face !== null && error === null;
  const busy = phase === 'warming' || phase === 'anchor' || phase === 'hold';

  return (
    <section aria-label="Face step">
      <h2>{FACE_STEP_TITLE}</h2>
      <p>{FACE_STEP_INTRO}</p>
      {passed && state.face && <p>{FACE_PASS}</p>}
      {error && <p role="alert">{error}</p>}
      {state.faceSkipped && state.face === null && !busy && (
        <p>
          <strong>Warning:</strong> {FACE_SKIPPED_NOTE}
        </p>
      )}
      {phase === 'warming' && <p aria-live="polite">Starting camera… sit facing the camera.</p>}
      {phase === 'anchor' && (
        <p aria-live="polite">Watching… keep your arm relaxed with your hand away from your face.</p>
      )}
      {phase === 'holdReady' && (
        <>
          <p aria-live="polite">{FACE_HOLD_PROMPT}</p>
          <div className="button-row">
            <button type="button" onClick={startHold}>
              {FACE_HOLD_LABEL}
            </button>
            {!state.face && !state.faceSkipped && (
              <button type="button" onClick={skipStep}>
                {FACE_SKIP_LABEL}
              </button>
            )}
          </div>
        </>
      )}
      {phase === 'hold' && <p aria-live="polite">Holding… keep your hand at your face.</p>}
      {!busy && phase !== 'holdReady' && (
        <div className="button-row">
          <button type="button" onClick={startAnchor}>
            {passed || error ? FACE_RETRY_LABEL : FACE_START_LABEL}
          </button>
          {!state.face && !state.faceSkipped && (
            <button type="button" onClick={skipStep}>
              {FACE_SKIP_LABEL}
            </button>
          )}
        </div>
      )}
      <video
        ref={live.videoRef}
        className="calibration-preview"
        muted
        playsInline
        aria-label="Face step camera preview"
      />
      {live.status !== 'idle' && <p aria-live="polite">{statusText(live.status)}</p>}
      {live.error && <p role="alert">{live.error}</p>}
    </section>
  );
}
