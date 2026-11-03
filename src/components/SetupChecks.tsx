import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PoseFrame } from '../contracts';
import { config } from '../config';
import { useLivePose } from '../pose/useLivePose';
import { useCalibration } from '../pose/calibration';
import { statusText } from '../pose/statusText';
import {
  createCheckDebouncer,
  evaluateSetupChecks,
  facingOffset,
  fpsOverWindow,
  insideEdges,
  SETUP_CONTINUE_WARNING,
  shoulderTiltDeg,
  startBlocked,
  type CheckDebouncer,
  type SetupCheckId,
  type SetupCheckResult,
  type SetupMeasurements,
} from '../setup/checks';

/** Joints the upper-body check needs: both shoulders, right elbow, right wrist. */
const UPPER_BODY_JOINTS = ['r_shoulder', 'l_shoulder', 'r_elbow', 'r_wrist'] as const;

function thresholds() {
  return {
    visMin: config.gate.vis_min,
    edgeMargin: config.setup.edge_margin,
    brightnessMin: config.setup.brightness_min,
    brightnessMax: config.setup.brightness_max,
    tiltMaxDeg: config.setup.tilt_max_deg,
    facingTol: config.setup.facing_tol,
    fpsMin: config.setup.fps_min,
  };
}

function buildMeasurements(
  frame: PoseFrame | null,
  cameraOn: boolean,
  brightness: number | null,
  fps: number | null,
  armCalibrated: boolean,
  faceReady: boolean,
): SetupMeasurements {
  const visMin = config.gate.vis_min;
  const edge = config.setup.edge_margin;
  const joints = frame?.joints ?? {};
  const visible = (name: string): boolean => {
    const j = joints[name];
    return !!j && j.conf >= visMin && insideEdges(j, edge);
  };
  const upperBodyVisible = UPPER_BODY_JOINTS.every(visible);
  const lElbow = joints['l_elbow'];
  const lWrist = joints['l_wrist'];
  return {
    cameraOn,
    upperBodyVisible,
    leftArmVisible: !!lElbow && !!lWrist && lElbow.conf >= visMin && lWrist.conf >= visMin,
    faceVisible: visible('nose') && visible('l_eye') && visible('r_eye'),
    brightness,
    tiltDeg: shoulderTiltDeg(joints['r_shoulder'], joints['l_shoulder'], visMin),
    facingOffset: facingOffset(joints['nose'], joints['r_shoulder'], joints['l_shoulder'], visMin),
    fps,
    armCalibrated,
    faceReady,
  };
}

/**
 * Presentational setup checklist. Takes injected (debounced) results so
 * tests can pin every combination without a camera.
 */
export function SetupCheckList({
  results,
  blocked,
  onStart,
  onContinueAnyway,
}: {
  results: SetupCheckResult[];
  blocked: SetupCheckId[];
  onStart: () => void;
  onContinueAnyway: () => void;
}) {
  const startBlockedNow = blocked.length > 0;
  return (
    <section aria-label="Setup checks">
      <h2>Setup checks</h2>
      <ul>
        {results.map((r) => (
          <li key={r.id} id={`setup-check-${r.id}`}>
            <span aria-hidden="true">{r.pass ? '✓' : '!'}</span> {r.label}:{' '}
            {r.pass ? 'Pass' : 'Needs attention'}
            {r.fix && <p>{r.fix}</p>}
          </li>
        ))}
      </ul>
      <div className="button-row">
        <button
          type="button"
          onClick={onStart}
          aria-disabled={startBlockedNow ? 'true' : undefined}
          aria-describedby={startBlockedNow ? blocked.map((id) => `setup-check-${id}`).join(' ') : undefined}
        >
          Start session
        </button>
        {startBlockedNow && (
          <button type="button" onClick={onContinueAnyway}>
            Continue anyway
          </button>
        )}
      </div>
      {startBlockedNow && <p>{SETUP_CONTINUE_WARNING}</p>}
    </section>
  );
}

/** Live setup checks for /setup: camera preview, debounced rows, gated Start. */
export function SetupChecks() {
  const live = useLivePose();
  const { state: calibration } = useCalibration();
  const navigate = useNavigate();

  const debouncersRef = useRef<Record<SetupCheckId, CheckDebouncer> | null>(null);
  if (debouncersRef.current === null) {
    const make = () => createCheckDebouncer(config.setup.check_enter_frames, config.setup.check_exit_frames);
    debouncersRef.current = {
      camera: make(),
      upper_body: make(),
      face: make(),
      lighting: make(),
      level: make(),
      speed: make(),
      calibration: make(),
    };
  }

  // Brightness and speed feed the measurements through refs: the frame
  // effect below reads them fresh on every frame, so no state churn.
  const brightnessRef = useRef<number | null>(null);
  const stampsRef = useRef<number[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [results, setResults] = useState<SetupCheckResult[]>(() =>
    evaluateSetupChecks(
      buildMeasurements(null, false, null, null, false, false),
      thresholds(),
    ),
  );

  // Frame effect: rebuild measurements, feed each check's debouncer, and
  // keep only the debounced values in state so Start gating is stable.
  useEffect(() => {
    const frame = live.frame;
    if (frame) {
      const now = performance.now();
      const stamps = stampsRef.current;
      stamps.push(now);
      const cutoff = now - config.setup.fps_window_s * 1000;
      while (stamps.length > 0 && (stamps[0] as number) <= cutoff) stamps.shift();
    }
    const raw = evaluateSetupChecks(
      buildMeasurements(
        frame,
        live.status === 'live',
        brightnessRef.current,
        fpsOverWindow(stampsRef.current, performance.now(), config.setup.fps_window_s),
        calibration.baseline !== null,
        calibration.face !== null || calibration.faceSkipped,
      ),
      thresholds(),
    );
    setResults((prev) => {
      const debounced = raw.map((r, i) => {
        const stable = (debouncersRef.current as Record<SetupCheckId, CheckDebouncer>)[r.id].push(r.pass);
        if (stable === r.pass) return r;
        // Mid-transition keep the stable side: a passing row shows no fix,
        // a failing row keeps its last fix line, never a bare failure.
        if (stable) return { ...r, pass: true, fix: null };
        const prevFix = prev[i]?.fix ?? r.fix;
        return { ...r, pass: false, fix: prevFix };
      });
      const same =
        prev.length === debounced.length &&
        prev.every((p, i) => {
          const d = debounced[i] as SetupCheckResult;
          return p.id === d.id && p.pass === d.pass && p.fix === d.fix;
        });
      return same ? prev : debounced;
    });
    // Debounced values only; brightness arrives through its ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.frame, live.status, calibration.baseline, calibration.face, calibration.faceSkipped]);

  // Lighting: mean luma of a small in-memory canvas frame, discarded at once.
  // Never stored, never sent — only the mean feeds the advisory check.
  useEffect(() => {
    if (live.status !== 'live') return;
    const timer = window.setInterval(() => {
      const video = live.videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
        canvasRef.current.width = 64;
        canvasRef.current.height = 36;
      }
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, 64, 36);
      const pixels = ctx.getImageData(0, 0, 64, 36).data;
      let sum = 0;
      const count = pixels.length / 4;
      for (let i = 0; i < pixels.length; i += 4) {
        sum += 0.299 * (pixels[i] as number) + 0.587 * (pixels[i + 1] as number) + 0.114 * (pixels[i + 2] as number);
      }
      const mean = Math.round(sum / count);
      brightnessRef.current = mean;
    }, 500);
    return () => window.clearInterval(timer);
  }, [live.status, live.videoRef]);

  const blocked = startBlocked(results);
  const start = () => {
    if (startBlocked(results).length > 0) return;
    navigate('/session');
  };
  const continued = () => navigate('/session');

  return (
    <div>
      {live.status !== 'live' && (
        <div className="button-row">
          <button
            type="button"
            onClick={live.start}
            disabled={live.status === 'loading'}
          >
            Turn on camera
          </button>
        </div>
      )}
      {live.status !== 'idle' && <p aria-live="polite">{statusText(live.status)}</p>}
      {live.error && <p role="alert">{live.error}</p>}
      <video
        ref={live.videoRef}
        className="calibration-preview"
        muted
        playsInline
        aria-label="Setup camera preview"
      />
      <SetupCheckList results={results} blocked={blocked} onStart={start} onContinueAnyway={continued} />
    </div>
  );
}
