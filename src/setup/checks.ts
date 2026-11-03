import { CONSENT_TEXT_VERSION, type ConsentState } from '../consent/consent';

/**
 * Setup checks for /setup. `evaluateSetupChecks` is pure: it takes injected
 * measurements plus thresholds, so tests never need a camera. The live
 * component (SetupChecks.tsx) builds the measurements from live frames.
 *
 * Boundaries are inclusive exactly like the gate: a value exactly at its
 * limit passes, using the same EPS tolerance as pose/gate.ts.
 */

export type SetupCheckId =
  | 'camera'
  | 'upper_body'
  | 'face'
  | 'lighting'
  | 'level'
  | 'speed'
  | 'calibration';

/** Checks that must pass before Start enables. Advisory checks only warn. */
export const REQUIRED_CHECKS: readonly SetupCheckId[] = [
  'camera',
  'upper_body',
  'face',
  'calibration',
];

const EPS = 1e-9;

export interface SetupThresholds {
  visMin: number;
  edgeMargin: number;
  brightnessMin: number;
  brightnessMax: number;
  tiltMaxDeg: number;
  facingTol: number;
  fpsMin: number;
}

export interface SetupMeasurements {
  cameraOn: boolean;
  upperBodyVisible: boolean;
  /** The left arm is advisory only: a hint, never required. */
  leftArmVisible: boolean;
  faceVisible: boolean;
  /** Mean picture luma, 0 to 255. Null before the first reading. */
  brightness: number | null;
  /** Shoulder-line tilt in degrees. Null when a shoulder is not visible. */
  tiltDeg: number | null;
  /** Nose offset from the shoulder midpoint, in shoulder widths. Null when missing. */
  facingOffset: number | null;
  /** Measured camera speed. Null before enough readings arrive. */
  fps: number | null;
  armCalibrated: boolean;
  /** Face step captured, or explicitly skipped with its warning. */
  faceReady: boolean;
}

export interface SetupCheckResult {
  id: SetupCheckId;
  label: string;
  pass: boolean;
  advisory: boolean;
  /** Fix line when failing; a hint when passing with a caveat; else null. */
  fix: string | null;
}

export const SETUP_CHECK_LABEL: Record<SetupCheckId, string> = {
  camera: 'Camera found',
  // "in view", not "in frame": the counters guard flags the word "frame".
  upper_body: 'Upper body in view',
  face: 'Face in view',
  lighting: 'Lighting',
  level: 'Shoulders level and facing the camera',
  speed: 'Camera speed',
  calibration: 'Calibration',
};

export const SETUP_CONTINUE_WARNING =
  'Some checks did not pass. Angles and tips may be less reliable.';

/** Which required checks are unmet. Empty means Start may proceed. */
export function startBlocked(results: readonly SetupCheckResult[]): SetupCheckId[] {
  return results
    .filter((r) => !r.advisory && !r.pass && (REQUIRED_CHECKS as readonly SetupCheckId[]).includes(r.id))
    .map((r) => r.id);
}

/**
 * Checks that must pass before a calibration capture may start: checks 1-6
 * (camera, upper body, face, lighting, level, speed). Check 7 (calibration)
 * is excluded — it is the thing being gated. Single source: the capture
 * starts consult this constant, so it can be narrowed later.
 */
export const CALIBRATION_BLOCKING_CHECKS: readonly SetupCheckId[] = [
  'camera',
  'upper_body',
  'face',
  'lighting',
  'level',
  'speed',
];

export type CalibrationBlock =
  | { kind: 'consent' }
  | { kind: 'stale' }
  | { kind: 'checks'; failing: SetupCheckResult[] };

/**
 * Pure calibration gate: camera consent ticked with current text, plus every
 * blocking check passing. Returns the blocks in notice order (consent first,
 * then the failing checks). Missing results count as failing.
 */
export function calibrationBlocks(
  consent: Pick<ConsentState, 'camera' | 'text_version'>,
  results: readonly SetupCheckResult[],
  blocking: readonly SetupCheckId[] = CALIBRATION_BLOCKING_CHECKS,
): CalibrationBlock[] {
  const blocks: CalibrationBlock[] = [];
  if (!consent.camera) {
    blocks.push({ kind: 'consent' });
  } else if (consent.text_version !== CONSENT_TEXT_VERSION) {
    blocks.push({ kind: 'stale' });
  }
  const failing = blocking.flatMap((id) => {
    const found = results.find((r) => r.id === id);
    if (found && found.pass) return [];
    if (found) return [found];
    return [
      {
        id,
        label: SETUP_CHECK_LABEL[id],
        pass: false,
        advisory: false,
        fix: 'Check this in the setup checks above, then try again.',
      },
    ];
  });
  if (failing.length > 0) blocks.push({ kind: 'checks', failing });
  return blocks;
}

/**
 * Capture entry seam: runs `begin` (which starts the camera and reads
 * frames) only when nothing blocks. Returns the blocks so the caller can
 * show the notice; activating a blocked button starts nothing.
 */
export function attemptCalibrationStart(
  consent: Pick<ConsentState, 'camera' | 'text_version'>,
  results: readonly SetupCheckResult[],
  begin: () => void,
  blocking: readonly SetupCheckId[] = CALIBRATION_BLOCKING_CHECKS,
): CalibrationBlock[] {
  const blocks = calibrationBlocks(consent, results, blocking);
  if (blocks.length === 0) begin();
  return blocks;
}

/** Abort a running capture when camera consent is withdrawn mid-capture. */
export function shouldAbortCapture(capturing: boolean, cameraConsented: boolean): boolean {
  return capturing && !cameraConsented;
}

/**
 * Latest debounced check results, shared with the calibration steps (same
 * publish/subscribe shape as liveStats). Null until SetupChecks publishes;
 * calibration treats missing results as failing (default-deny).
 */
let publishedChecks: SetupCheckResult[] | null = null;
const checkListeners = new Set<() => void>();

export function publishSetupChecks(results: SetupCheckResult[] | null): void {
  publishedChecks = results;
  for (const fn of checkListeners) fn();
}

export function readSetupChecks(): SetupCheckResult[] | null {
  return publishedChecks;
}

export function subscribeSetupChecks(fn: () => void): () => void {
  checkListeners.add(fn);
  return () => {
    checkListeners.delete(fn);
  };
}

export function evaluateSetupChecks(
  m: SetupMeasurements,
  t: SetupThresholds,
): SetupCheckResult[] {
  const results: SetupCheckResult[] = [];

  results.push({
    id: 'camera',
    label: SETUP_CHECK_LABEL.camera,
    pass: m.cameraOn,
    advisory: false,
    fix: m.cameraOn ? null : 'Allow camera access in your browser, then try again.',
  });

  results.push({
    id: 'upper_body',
    label: SETUP_CHECK_LABEL.upper_body,
    pass: m.upperBodyVisible,
    advisory: false,
    fix: m.upperBodyVisible
      ? m.leftArmVisible
        ? null
        : 'Your left arm is out of view. That is fine — only the right side is needed.'
      : 'Move back so both shoulders and your right arm are in view.',
  });

  results.push({
    id: 'face',
    label: SETUP_CHECK_LABEL.face,
    pass: m.faceVisible,
    advisory: false,
    fix: m.faceVisible ? null : 'Keep your face in view of the camera.',
  });

  // Mean luma alone cannot detect strong backlight: a bright window behind
  // the person can pass the mean while the face stays dark.
  let lightingFix: string | null = null;
  let lightingPass = false;
  if (m.brightness === null) {
    lightingFix = 'Hold still in front of the camera.';
  } else if (t.brightnessMin - m.brightness > EPS) {
    lightingFix = 'Add more light in front of you.';
  } else if (m.brightness - t.brightnessMax > EPS) {
    lightingFix = 'Move so bright light is not behind you.';
  } else {
    lightingPass = true;
  }
  results.push({
    id: 'lighting',
    label: SETUP_CHECK_LABEL.lighting,
    pass: lightingPass,
    advisory: true,
    fix: lightingFix,
  });

  // Honest label: this measures the shoulder line in the picture, not the
  // camera's own tilt — a tilted camera reads as tilted shoulders.
  const levelPass =
    m.tiltDeg !== null &&
    m.facingOffset !== null &&
    m.tiltDeg - t.tiltMaxDeg <= EPS &&
    Math.abs(m.facingOffset) - t.facingTol <= EPS;
  results.push({
    id: 'level',
    label: SETUP_CHECK_LABEL.level,
    pass: levelPass,
    advisory: true,
    fix: levelPass ? null : 'Sit facing the camera with your shoulders level.',
  });

  // The number and the word "fps" never reach participant copy: only the
  // Pass / Needs attention row is rendered.
  const speedPass = m.fps !== null && t.fpsMin - m.fps <= EPS;
  results.push({
    id: 'speed',
    label: SETUP_CHECK_LABEL.speed,
    pass: speedPass,
    advisory: true,
    fix: speedPass
      ? null
      : m.fps === null
        ? 'Give the camera a moment to warm up.'
        : 'Close other apps that use the camera and try again.',
  });

  const calibrationPass = m.armCalibrated && m.faceReady;
  results.push({
    id: 'calibration',
    label: SETUP_CHECK_LABEL.calibration,
    pass: calibrationPass,
    advisory: false,
    fix: calibrationPass
      ? null
      : !m.armCalibrated
        ? 'Finish the arm step above, or continue without it.'
        : 'Finish the face step above, or continue without it.',
  });

  return results;
}

/**
 * Per-check debounce, same enter/exit pattern as the can't-see-you tracker:
 * stable-fail only after `enterFrames` consecutive failing evaluations,
 * stable-pass only after `exitFrames` consecutive passing ones.
 */
export interface CheckDebouncer {
  push(pass: boolean): boolean;
  reset(): void;
}

export function createCheckDebouncer(enterFrames: number, exitFrames: number): CheckDebouncer {
  let stable = false;
  let failStreak = 0;
  let passStreak = 0;
  return {
    push(pass: boolean) {
      if (pass) {
        passStreak += 1;
        failStreak = 0;
        if (!stable && passStreak >= exitFrames) stable = true;
      } else {
        failStreak += 1;
        passStreak = 0;
        if (stable && failStreak >= enterFrames) stable = false;
      }
      return stable;
    },
    reset() {
      stable = false;
      failStreak = 0;
      passStreak = 0;
    },
  };
}

/** Joint helpers the live component uses to build measurements. */

export interface XYConf {
  x: number;
  y: number;
  conf: number;
}

/** Shoulder-line tilt in degrees, or null when a shoulder is not visible. */
export function shoulderTiltDeg(
  rShoulder: XYConf | undefined,
  lShoulder: XYConf | undefined,
  visMin: number,
): number | null {
  if (!rShoulder || !lShoulder) return null;
  if (rShoulder.conf < visMin || lShoulder.conf < visMin) return null;
  const dx = lShoulder.x - rShoulder.x;
  const dy = lShoulder.y - rShoulder.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return null;
  return Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
}

/**
 * Signed nose offset from the shoulder midpoint, in shoulder widths.
 * Null when the nose or a shoulder is not visible, or shoulders coincide.
 */
export function facingOffset(
  nose: XYConf | undefined,
  rShoulder: XYConf | undefined,
  lShoulder: XYConf | undefined,
  visMin: number,
): number | null {
  if (!nose || !rShoulder || !lShoulder) return null;
  if (nose.conf < visMin || rShoulder.conf < visMin || lShoulder.conf < visMin) return null;
  const width = Math.hypot(lShoulder.x - rShoulder.x, lShoulder.y - rShoulder.y);
  if (width < 1e-9) return null;
  const midX = (rShoulder.x + lShoulder.x) / 2;
  return (nose.x - midX) / width;
}

/** Inside the picture edges by `margin` on every side (joints are 0..1). */
export function insideEdges(j: XYConf | undefined, margin: number): boolean {
  if (!j) return false;
  return j.x >= margin && j.x <= 1 - margin && j.y >= margin && j.y <= 1 - margin;
}

/**
 * Camera speed from frame arrival stamps: frames seen inside the trailing
 * window, divided by the window length. Null with fewer than two stamps.
 */
export function fpsOverWindow(stamps: readonly number[], nowMs: number, windowS: number): number | null {
  const cutoff = nowMs - windowS * 1000;
  const recent = stamps.filter((s) => s > cutoff && s <= nowMs);
  if (recent.length < 2) return null;
  return recent.length / windowS;
}
