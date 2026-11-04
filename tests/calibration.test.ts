import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginCapture,
  CALIBRATION_EVENT,
  clearFaceReach,
  isClearCalibrationFrame,
  loadCalibrationState,
  loadFaceReach,
  markSkipped,
  saveBaseline,
  saveFaceReach,
  skipFaceReach,
} from '../src/pose/calibration';
import type { PoseFrame } from '../src/contracts';

/** calibration.ts guards on typeof localStorage; node tests stub it here. */
function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASELINE = { upperArm: 1, forearm: 1, shoulderWidth: 1 };
const FACE = {
  offsets: {
    nose: { x: 0, y: -1.0 },
    l_eye: { x: -0.2, y: -1.2 },
    mouth_l: { x: -0.15, y: -0.8 },
  },
  touchDist: 0.2,
  touchElbowDeg: 70,
};

describe('isClearCalibrationFrame', () => {
  const frame = (conf: number): PoseFrame => ({
    t: 0,
    fps: 30,
    joints: {
      r_shoulder: { x: 0.6, y: 0.4, conf },
      r_elbow: { x: 0.65, y: 0.6, conf },
      r_wrist: { x: 0.7, y: 0.8, conf },
      l_shoulder: { x: 0.4, y: 0.4, conf },
    },
    angles: {},
    gate: { ok: true, reasons: [] },
  });

  it('passes a fully clear frame at the threshold', () => {
    expect(isClearCalibrationFrame(frame(0.3), 0.3)).toBe(true);
  });

  it('fails when one joint is missing or below the bar', () => {
    const unclear = frame(0.9);
    unclear.joints['r_wrist'] = { x: 0.7, y: 0.8, conf: 0 };
    expect(isClearCalibrationFrame(unclear, 0.3)).toBe(false);
    const sparse = frame(0.9) as unknown as Record<string, unknown>;
    delete (sparse['joints'] as Record<string, unknown>)['l_shoulder'];
    expect(isClearCalibrationFrame(sparse as unknown as PoseFrame, 0.3)).toBe(false);
  });
});

describe('same-tab notification', () => {
  it('dispatches the calibration event on window for every write', () => {
    stubStorage();
    vi.stubGlobal('window', new EventTarget());
    const seen: string[] = [];
    (window as unknown as EventTarget).addEventListener(CALIBRATION_EVENT, () => seen.push('x'));
    saveBaseline(BASELINE);
    markSkipped();
    expect(seen).toEqual(['x', 'x']);
  });
});

describe('face-reach storage', () => {
  it('stores and reloads the derived numbers only', () => {
    stubStorage();
    saveBaseline(BASELINE);
    saveFaceReach(FACE);
    expect(loadFaceReach()).toEqual(FACE);
    expect(loadCalibrationState().face).toEqual(FACE);
    expect(loadCalibrationState().faceSkipped).toBe(false);
  });

  it('re-running calibration clears the face data', () => {
    stubStorage();
    saveBaseline(BASELINE);
    saveFaceReach(FACE);
    saveBaseline(BASELINE);
    expect(loadCalibrationState().baseline).toEqual(BASELINE);
    expect(loadFaceReach()).toBeNull();
  });

  it('clearing the face data does not clear the arm calibration', () => {
    stubStorage();
    saveBaseline(BASELINE);
    saveFaceReach(FACE);
    clearFaceReach();
    expect(loadCalibrationState().baseline).toEqual(BASELINE);
    expect(loadFaceReach()).toBeNull();
  });

  it('skipping the face step keeps the arm calibration and marks the skip', () => {
    stubStorage();
    saveBaseline(BASELINE);
    skipFaceReach();
    const state = loadCalibrationState();
    expect(state.baseline).toEqual(BASELINE);
    expect(state.face).toBeNull();
    expect(state.faceSkipped).toBe(true);
  });

  it('rejects the retired single-anchor shape', () => {
    stubStorage();
    saveBaseline(BASELINE);
    const retired = { anchorOffset: { x: 0, y: -0.5 }, touchDist: 0.2, touchElbowDeg: 70 };
    saveFaceReach(retired as never);
    expect(loadFaceReach()).toBeNull();
    expect(loadCalibrationState().baseline).toEqual(BASELINE);
  });

  it('begin and skip preserve stored face data', () => {
    stubStorage();
    saveBaseline(BASELINE);
    saveFaceReach(FACE);
    beginCapture();
    expect(loadFaceReach()).toEqual(FACE);
    markSkipped();
    expect(loadFaceReach()).toEqual(FACE);
  });
});
