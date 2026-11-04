import { useEffect, useState } from 'react';
import type { PoseFrame } from '../contracts';
import { boneLengths, GATE_JOINTS, type BoneBaseline } from './gate';
import { isFaceReach, type FaceReach } from './faceReach';

/** Capture window for the setup calibration step ("about 2 s"). */
export const CALIBRATION_CAPTURE_MS = 2000;

/** Outer wait while frames trickle in on slow inference. */
export const CALIBRATION_CAPTURE_TIMEOUT_MS = 30000;

/** Minimum clear views inside the capture window for a passing calibration. */
export const CALIBRATION_MIN_SAMPLES = 5;

const STORAGE_KEY = 'mirra.calibration.v1';

/**
 * Same-tab notification: `storage` events only fire in OTHER tabs, so every
 * local write also dispatches this on window for sibling hook instances
 * (SetupChecks vs CalibrationStep) on this page.
 */
export const CALIBRATION_EVENT = 'mirra:calibration';

export interface CalibrationState {
  baseline: BoneBaseline | null;
  skipped: boolean;
  /** Face-reach data from the setup face step. Null until captured (or skipped). */
  face: FaceReach | null;
  faceSkipped: boolean;
}

function isBaseline(v: unknown): v is BoneBaseline {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b['upperArm'] === 'number' &&
    Number.isFinite(b['upperArm']) &&
    (b['upperArm'] as number) > 0 &&
    typeof b['forearm'] === 'number' &&
    Number.isFinite(b['forearm']) &&
    (b['forearm'] as number) > 0 &&
    typeof b['shoulderWidth'] === 'number' &&
    Number.isFinite(b['shoulderWidth']) &&
    (b['shoulderWidth'] as number) > 0
  );
}

/** Read the stored calibration. Safe on the server and in tests: no storage, no baseline. */
export function loadCalibrationState(): CalibrationState {
  const empty: CalibrationState = { baseline: null, skipped: false, face: null, faceSkipped: false };
  try {
    if (typeof localStorage === 'undefined') return empty;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as {
      baseline?: unknown;
      skipped?: unknown;
      face?: unknown;
      faceSkipped?: unknown;
    };
    return {
      baseline: isBaseline(parsed.baseline) ? parsed.baseline : null,
      skipped: parsed.skipped === true,
      face: isFaceReach(parsed.face) ? parsed.face : null,
      faceSkipped: parsed.faceSkipped === true,
    };
  } catch {
    return empty;
  }
}

/** Read just the stored face-reach data. Null until captured (or skipped). */
export function loadFaceReach(): FaceReach | null {
  return loadCalibrationState().face;
}

function writeCalibrationState(state: CalibrationState): CalibrationState {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Private mode or quota: the in-memory state still works for this visit.
  }
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof Event !== 'undefined') {
      window.dispatchEvent(new Event(CALIBRATION_EVENT));
    }
  } catch {
    // Non-DOM test shims without Event: storage event still covers other tabs.
  }
  return state;
}

export function saveBaseline(baseline: BoneBaseline): CalibrationState {
  // A completed (re-)calibration clears the face data with it: reach checks
  // are measured against this arm, so a new arm needs a new face step.
  return writeCalibrationState({ baseline, skipped: false, face: null, faceSkipped: false });
}

/** The person chose to continue without calibrating; the gate stays less reliable. */
export function markSkipped(): CalibrationState {
  const current = loadCalibrationState();
  return writeCalibrationState({
    baseline: current.baseline,
    skipped: true,
    face: current.face,
    faceSkipped: current.faceSkipped,
  });
}

/** Starting (or retrying) a capture clears the skipped flag but keeps any baseline. */
export function beginCapture(): CalibrationState {
  const current = loadCalibrationState();
  return writeCalibrationState({
    baseline: current.baseline,
    skipped: false,
    face: current.face,
    faceSkipped: current.faceSkipped,
  });
}

export function clearCalibration(): CalibrationState {
  return writeCalibrationState({ baseline: null, skipped: false, face: null, faceSkipped: false });
}

/** Store the face-step result next to the arm calibration. Derived numbers only. */
export function saveFaceReach(face: FaceReach): CalibrationState {
  const current = loadCalibrationState();
  return writeCalibrationState({
    baseline: current.baseline,
    skipped: current.skipped,
    face,
    faceSkipped: false,
  });
}

/** The person chose to continue without the face step; reach checks use standard values. */
export function skipFaceReach(): CalibrationState {
  const current = loadCalibrationState();
  return writeCalibrationState({
    baseline: current.baseline,
    skipped: current.skipped,
    face: current.face,
    faceSkipped: true,
  });
}

/** Clearing the face data never clears the arm calibration. */
export function clearFaceReach(): CalibrationState {
  const current = loadCalibrationState();
  return writeCalibrationState({
    baseline: current.baseline,
    skipped: current.skipped,
    face: null,
    faceSkipped: false,
  });
}

/** Every joint calibration needs: the working arm plus the left shoulder that anchors scale. */
export const CALIBRATION_JOINTS: readonly string[] = [...GATE_JOINTS, 'l_shoulder'];

/** True when every calibration joint is clear in this frame. */
export function isClearCalibrationFrame(frame: PoseFrame, visMin: number): boolean {
  return CALIBRATION_JOINTS.every((name) => {
    const joint = frame.joints[name];
    return !!joint && joint.conf >= visMin;
  });
}

/**
 * Average the bone lengths over the clear views in a capture: every needed
 * joint visible (exactly at the threshold counts) and measurable bones. Null
 * when too few views are clear — the caller reports a failed calibration.
 */
export function calibrateFrames(frames: PoseFrame[], visMin: number): BoneBaseline | null {
  const samples: BoneBaseline[] = [];
  for (const frame of frames) {
    let visible = true;
    for (const name of CALIBRATION_JOINTS) {
      const joint = frame.joints[name];
      if (!joint || !(joint.conf >= visMin)) {
        visible = false;
        break;
      }
    }
    if (!visible) continue;
    const bones = boneLengths(frame.joints);
    if (bones) samples.push(bones);
  }
  if (samples.length < CALIBRATION_MIN_SAMPLES) return null;
  const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
  return {
    upperArm: mean(samples.map((s) => s.upperArm)),
    forearm: mean(samples.map((s) => s.forearm)),
    shoulderWidth: mean(samples.map((s) => s.shoulderWidth)),
  };
}

export const GATE_JOINT_LABELS: Record<string, string> = {
  r_shoulder: 'right shoulder',
  r_elbow: 'right elbow',
  r_wrist: 'right wrist',
  l_shoulder: 'left shoulder',
};

/**
 * Joints that are unclear in most of the captured samples. Used to tell
 * the person what to fix (usually framing or lighting on the shoulders
 * and working arm).
 */
export function unclearJoints(frames: PoseFrame[], visMin: number): string[] {
  if (frames.length === 0) return [...CALIBRATION_JOINTS];
  return CALIBRATION_JOINTS.filter((name) => {
    const clear = frames.filter((frame) => {
      const joint = frame.joints[name];
      return !!joint && joint.conf >= visMin;
    }).length;
    return clear < frames.length / 2;
  });
}

/** Shared calibration state for /setup (writes) and /session (reads the baseline). */
export function useCalibration() {
  const [state, setState] = useState<CalibrationState>(() => loadCalibrationState());

  useEffect(() => {
    const refresh = () => setState(loadCalibrationState());
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === STORAGE_KEY) refresh();
    };
    const onLocal = () => refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener(CALIBRATION_EVENT, onLocal);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CALIBRATION_EVENT, onLocal);
    };
  }, []);

  return {
    state,
    save: (baseline: BoneBaseline) => setState(saveBaseline(baseline)),
    skip: () => setState(markSkipped()),
    begin: () => setState(beginCapture()),
    clear: () => setState(clearCalibration()),
    saveFace: (face: FaceReach) => setState(saveFaceReach(face)),
    skipFace: () => setState(skipFaceReach()),
    clearFace: () => setState(clearFaceReach()),
    refresh: () => setState(loadCalibrationState()),
  };
}
