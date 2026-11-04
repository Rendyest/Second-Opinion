import { describe, expect, it } from 'vitest';
import type { Joint2D, PoseFrame } from '../src/contracts';
import { buildConfig } from '../src/config';
import defaults from '../src/config/config.default.json';
import {
  applyGate,
  boneLengths,
  checkGate,
  createGateTracker,
  emptyHistories,
  median,
  type BoneBaseline,
  type GateHistories,
  type GateResult,
  type GateThresholds,
  type GateTracker,
} from '../src/pose/gate';
import { CALIBRATION_MIN_SAMPLES, calibrateFrames, unclearJoints } from '../src/pose/calibration';

// Literal thresholds matching config.default.json; the first test pins the link.
const T: GateThresholds = {
  vis_min: 0.5,
  bone_length_tol: 0.3,
  foreshortening_min: 0.5,
  smooth_frames: 5,
  history_frames: 15,
  cant_see_enter_frames: 3,
  cant_see_exit_frames: 5,
};
const BASELINE_100: BoneBaseline = { upperArm: 100, forearm: 100, shoulderWidth: 100 };

function jointsFor(
  upperArm: number,
  forearm: number,
  shoulderWidth: number,
  conf = 0.9,
): Record<string, Joint2D> {
  return {
    r_shoulder: { x: 0, y: 0, conf },
    r_elbow: { x: upperArm, y: 0, conf },
    r_wrist: { x: upperArm + forearm, y: 0, conf },
    l_shoulder: { x: shoulderWidth, y: 0, conf },
    r_hip: { x: 0, y: -1, conf },
  };
}

function frameFor(
  upperArm: number,
  forearm: number,
  shoulderWidth: number,
  conf = 0.9,
): PoseFrame {
  return {
    t: 1.0,
    fps: 24,
    joints: jointsFor(upperArm, forearm, shoulderWidth, conf),
    angles: {
      r_elbow_flexion: { deg: 90, conf },
      r_shoulder_elevation: { deg: 90, conf },
    },
    gate: { ok: true, reasons: [] },
  };
}

/** Histories full of one value: a settled tracker. */
function fullHist(value: number): GateHistories {
  const ratios = Array(T.smooth_frames).fill(value) as number[];
  const norms = Array(T.history_frames).fill(value) as number[];
  return {
    upperArmRatios: [...ratios],
    forearmRatios: [...ratios],
    upperArmNorms: [...norms],
    forearmNorms: [...norms],
  };
}

/** A tracker preloaded with `n` steady frames at the given lengths. */
function steadyTracker(n: number, upperArm = 100, forearm = 100, shoulderWidth = 100): GateTracker {
  const tracker = createGateTracker(T);
  for (let i = 0; i < n; i++) {
    tracker.push(jointsFor(upperArm, forearm, shoulderWidth), BASELINE_100);
  }
  return tracker;
}

describe('gate thresholds live in config', () => {
  it('matches the committed defaults', () => {
    // Pinned to config.default.json, not the merged runtime config: local
    // tuning in gitignored config.local.json must not red the suite.
    expect(buildConfig(defaults).gate).toEqual(T);
  });
});

describe('median', () => {
  it('returns null when empty', () => {
    expect(median([])).toBeNull();
  });

  it('takes the middle of an odd count', () => {
    expect(median([1, 0.4, 1, 0.4, 0.4])).toBe(0.4);
  });

  it('averages the middle two of an even count', () => {
    expect(median([1, 1, 0.4, 0.4])).toBe(0.7);
  });
});

describe('low_visibility check', () => {
  it('passes a frame exactly at the threshold', () => {
    const result = checkGate(jointsFor(100, 100, 100, 0.5), null, T, emptyHistories());
    expect(result).toEqual({ ok: true, reasons: [] });
  });

  it('passes a frame just above the threshold', () => {
    const result = checkGate(jointsFor(100, 100, 100, 0.51), null, T, emptyHistories());
    expect(result).toEqual({ ok: true, reasons: [] });
  });

  it('flags a frame just below the threshold', () => {
    const joints = jointsFor(100, 100, 100, 0.9);
    joints['r_elbow'] = { x: 100, y: 0, conf: 0.49 };
    expect(checkGate(joints, null, T, emptyHistories())).toEqual({
      ok: false,
      reasons: ['low_visibility'],
    });
  });

  it('flags a missing gate joint', () => {
    const joints = jointsFor(100, 100, 100);
    delete joints['r_wrist'];
    expect(checkGate(joints, null, T, emptyHistories())).toEqual({
      ok: false,
      reasons: ['low_visibility'],
    });
  });

  it('flags an unclear left shoulder even without arm problems', () => {
    const joints = jointsFor(100, 100, 100, 0.9);
    joints['l_shoulder'] = { x: 100, y: 0, conf: 0.3 };
    const result = checkGate(joints, BASELINE_100, T, fullHist(1));
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(['low_visibility']);
    expect(result.scale).toBeUndefined();
  });

  it('ignores a missing hip', () => {
    const joints = jointsFor(100, 100, 100);
    delete joints['r_hip'];
    expect(checkGate(joints, null, T, emptyHistories())).toEqual({ ok: true, reasons: [] });
  });
});

describe('scale normalisation', () => {
  it('passes a normal pose at the calibration distance with scale 1', () => {
    const result = checkGate(jointsFor(100, 100, 100), BASELINE_100, T, fullHist(1));
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.scale).toBe(1);
  });

  it('passes everything scaled 1.38 closer to the camera', () => {
    const result = checkGate(jointsFor(138, 138, 138), BASELINE_100, T, fullHist(1));
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.scale).toBeCloseTo(1.38, 10);
  });

  it('passes everything scaled 0.7 farther away', () => {
    const result = checkGate(jointsFor(70, 70, 70), BASELINE_100, T, fullHist(1));
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.scale).toBeCloseTo(0.7, 10);
  });
});

describe('table pose does not flag drift', () => {
  it('passes a constant forearm normLen of 1.4 against an adapted history', () => {
    const hist = fullHist(1);
    hist.forearmNorms = Array(T.history_frames).fill(1.4);
    hist.forearmRatios = Array(T.smooth_frames).fill(1.4);
    const result = checkGate(jointsFor(100, 140, 100), BASELINE_100, T, hist);
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });
});

describe('gradual change never flags drift', () => {
  it('holds ok while forearm normLen rises 1.0 to 1.4 in steps of 0.02', () => {
    const tracker = createGateTracker(T);
    for (let i = 0; i < 20; i++) {
      const forearm = 100 * (1 + 0.02 * i);
      const result = tracker.push(jointsFor(100, forearm, 100), BASELINE_100);
      expect(result.reasons).not.toContain('bone_length_drift');
    }
  });
});

describe('sudden jump flags drift', () => {
  it('passes a 29 percent jump', () => {
    const result = steadyTracker(15).push(jointsFor(100, 129, 100), BASELINE_100);
    expect(result.reasons).not.toContain('bone_length_drift');
  });

  it('passes exactly at the 30 percent limit', () => {
    const result = steadyTracker(15).push(jointsFor(100, 130, 100), BASELINE_100);
    expect(result.reasons).not.toContain('bone_length_drift');
  });

  it('flags a 31 percent jump', () => {
    const result = steadyTracker(15).push(jointsFor(100, 131, 100), BASELINE_100);
    expect(result.reasons).toContain('bone_length_drift');
  });

  it('passes a 29 percent drop', () => {
    const result = steadyTracker(15).push(jointsFor(100, 71, 100), BASELINE_100);
    expect(result.reasons).not.toContain('bone_length_drift');
  });

  it('flags a 31 percent drop', () => {
    const result = steadyTracker(15).push(jointsFor(100, 69, 100), BASELINE_100);
    expect(result.reasons).toContain('bone_length_drift');
  });
});

describe('drift needs history', () => {
  it('never flags with fewer than 3 history values', () => {
    const tracker = createGateTracker(T);
    tracker.push(jointsFor(100, 100, 100), BASELINE_100);
    tracker.push(jointsFor(100, 100, 100), BASELINE_100);
    const result = tracker.push(jointsFor(100, 300, 100), BASELINE_100);
    expect(result.reasons).not.toContain('bone_length_drift');
  });
});

describe('foreshortening uses the smoothed median', () => {
  function foreRatios(value: number): GateHistories {
    const hist = fullHist(1);
    hist.forearmRatios = Array(T.smooth_frames).fill(value);
    hist.forearmNorms = Array(T.history_frames).fill(value);
    return hist;
  }

  it('flags the literal 100 to 40 case', () => {
    const result = checkGate(jointsFor(100, 40, 100), BASELINE_100, T, foreRatios(0.4));
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(['foreshortening']);
  });

  it('flags a median just below the threshold', () => {
    const result = checkGate(jointsFor(100, 49.9, 100), BASELINE_100, T, foreRatios(0.499));
    expect(result.reasons).toEqual(['foreshortening']);
  });

  it('passes a median exactly at the threshold', () => {
    const result = checkGate(jointsFor(100, 50, 100), BASELINE_100, T, foreRatios(0.5));
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('passes a median just above the threshold', () => {
    const result = checkGate(jointsFor(100, 50.1, 100), BASELINE_100, T, foreRatios(0.501));
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });
});

describe('single glitchy frame does not flip foreshortening', () => {
  it('holds foreshortening off but flags the drift jump', () => {
    const tracker = steadyTracker(4);
    const result = tracker.push(jointsFor(100, 40, 100), BASELINE_100);
    expect(result.reasons).not.toContain('foreshortening');
    expect(result.reasons).toContain('bone_length_drift');
  });
});

describe('sustained foreshortening flags', () => {
  it('flags once 3 of the last 5 ratios sit at 0.4', () => {
    const hist = fullHist(1);
    hist.forearmRatios = [1, 1, 0.4, 0.4, 0.4];
    hist.forearmNorms = Array(T.history_frames).fill(0.4);
    const result = checkGate(jointsFor(100, 40, 100), BASELINE_100, T, hist);
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(['foreshortening']);
  });
});

describe('multiple reasons together', () => {
  it('reports low visibility and foreshortening on one frame', () => {
    const hist = fullHist(1);
    hist.forearmRatios = Array(T.smooth_frames).fill(0.4);
    hist.forearmNorms = Array(T.history_frames).fill(0.4);
    const joints = jointsFor(100, 40, 100, 0.9);
    joints['r_wrist'] = { x: 140, y: 0, conf: 0.3 };
    const result = checkGate(joints, BASELINE_100, T, hist);
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(['low_visibility', 'foreshortening']);
  });
});

describe('low_visibility frames stay out of the history', () => {
  it('leaves every history array untouched', () => {
    const tracker = steadyTracker(5);
    const before = tracker.snapshot();
    const joints = jointsFor(100, 100, 100, 0.9);
    joints['r_elbow'] = { x: 100, y: 0, conf: 0.1 };
    const result = tracker.push(joints, BASELINE_100);
    expect(result.reasons).toEqual(['low_visibility']);
    expect(tracker.snapshot()).toEqual(before);
  });
});

describe('no baseline', () => {
  it('runs only visibility and drift: a forearm of 40 does not flag', () => {
    const result = checkGate(jointsFor(100, 40, 100), null, T, emptyHistories());
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.scale).toBeUndefined();
  });

  it('flags a drift jump without any baseline', () => {
    const tracker = createGateTracker(T);
    for (let i = 0; i < 15; i++) {
      tracker.push(jointsFor(100, 100, 100), null);
    }
    const result = tracker.push(jointsFor(100, 131, 100), null);
    expect(result.reasons).toEqual(['bone_length_drift']);
  });
});

describe('hips stay out of the gate', () => {
  function variants(): GateResult[] {
    const hist = fullHist(1);
    hist.forearmRatios = Array(T.smooth_frames).fill(0.4);
    hist.forearmNorms = Array(T.history_frames).fill(0.4);
    const present = checkGate(jointsFor(100, 40, 100), BASELINE_100, T, hist);
    const absentJoints = jointsFor(100, 40, 100);
    delete absentJoints['r_hip'];
    const absent = checkGate(absentJoints, BASELINE_100, T, { ...hist });
    const lowJoints = jointsFor(100, 40, 100);
    lowJoints['r_hip'] = { x: 0, y: -1, conf: 0.1 };
    const lowHip = checkGate(lowJoints, BASELINE_100, T, { ...hist });
    return [present, absent, lowHip];
  }

  it('gives identical results with hips absent, unclear, or present', () => {
    const [present, absent, lowHip] = variants();
    expect(absent).toEqual(present);
    expect(lowHip).toEqual(present);
    expect(present.reasons).toEqual(['foreshortening']);
  });
});

describe('face points stay out of the gate', () => {
  it('gives identical results with face joints absent or low-visibility', () => {
    const hist = fullHist(1);
    const clean = checkGate(jointsFor(100, 100, 100), BASELINE_100, T, hist);
    expect(clean).toEqual({ ok: true, reasons: [], scale: 1 });
    const withFace = jointsFor(100, 100, 100);
    withFace['nose'] = { x: 50, y: 50, conf: 0 };
    withFace['l_eye'] = { x: 46, y: 48, conf: 0.1 };
    withFace['r_eye'] = { x: 54, y: 48, conf: 0.1 };
    withFace['l_ear'] = { x: 40, y: 52, conf: 0.1 };
    withFace['mouth_l'] = { x: 48, y: 52, conf: 0.1 };
    withFace['mouth_r'] = { x: 52, y: 52, conf: 0.1 };
    withFace['r_index'] = { x: 0, y: 0, conf: 0 };
    expect(checkGate(withFace, BASELINE_100, T, { ...hist })).toEqual(clean);
    const noFace = jointsFor(100, 100, 100);
    expect(checkGate(noFace, BASELINE_100, T, { ...hist })).toEqual(clean);
  });
});

describe('tracker reset', () => {
  it('clears every history array', () => {
    const tracker = steadyTracker(5);
    expect(tracker.snapshot().forearmNorms.length).toBeGreaterThan(0);
    tracker.reset();
    expect(tracker.snapshot()).toEqual(emptyHistories());
  });
});

describe('applyGate', () => {
  it('keeps a clean frame untouched', () => {
    const frame = frameFor(100, 100, 100);
    expect(applyGate(frame, null, T)).toBe(frame);
  });

  it('adds computed reasons without dropping the pipeline ones', () => {
    const frame: PoseFrame = {
      ...frameFor(100, 100, 100, 0.49),
      gate: { ok: false, reasons: ['foreshortening'] },
    };
    const merged = applyGate(frame, null, T);
    expect(merged.gate).toEqual({ ok: false, reasons: ['foreshortening', 'low_visibility'] });
  });
});

describe('boneLengths', () => {
  it('measures a 3-4-5 upper arm, a 6-8-10 forearm, and a width of 2', () => {
    const joints: Record<string, Joint2D> = {
      r_shoulder: { x: 0, y: 0, conf: 0.9 },
      r_elbow: { x: 3, y: 4, conf: 0.9 },
      r_wrist: { x: 9, y: 12, conf: 0.9 },
      l_shoulder: { x: 2, y: 0, conf: 0.9 },
      r_hip: { x: 0, y: -1, conf: 0.9 },
    };
    expect(boneLengths(joints)).toEqual({ upperArm: 5, forearm: 10, shoulderWidth: 2 });
  });

  it('returns null when an endpoint is missing or a bone collapses', () => {
    const joints = jointsFor(100, 100, 100);
    delete joints['l_shoulder'];
    expect(boneLengths(joints)).toBeNull();
    expect(boneLengths(jointsFor(0, 100, 100))).toBeNull();
  });
});

describe('calibrateFrames', () => {
  function samples(n: number, upperArm = 100, forearm = 100, width = 100, conf = 0.9): PoseFrame[] {
    return Array.from({ length: n }, (_, i) => ({ ...frameFor(upperArm, forearm, width, conf), t: i }));
  }

  it('averages the bone lengths over the clear views', () => {
    const frames = [...samples(3, 100, 100, 100), ...samples(2, 110, 120, 90)];
    expect(calibrateFrames(frames, T.vis_min)).toEqual({ upperArm: 104, forearm: 108, shoulderWidth: 96 });
  });

  it('treats frames exactly at the visibility threshold as clear', () => {
    expect(calibrateFrames(samples(CALIBRATION_MIN_SAMPLES, 100, 100, 100, 0.5), T.vis_min)).toEqual(
      BASELINE_100,
    );
  });

  it('returns null with too few clear views', () => {
    expect(calibrateFrames(samples(CALIBRATION_MIN_SAMPLES - 1), T.vis_min)).toBeNull();
  });

  it('skips low-visibility views instead of failing', () => {
    const frames = [...samples(CALIBRATION_MIN_SAMPLES), ...samples(3, 100, 100, 100, 0.1)];
    expect(calibrateFrames(frames, T.vis_min)).toEqual(BASELINE_100);
  });

  it('returns null when every view is unclear', () => {
    expect(calibrateFrames(samples(CALIBRATION_MIN_SAMPLES, 100, 100, 100, 0.1), T.vis_min)).toBeNull();
  });

  it('requires a clear left shoulder for the scale anchor', () => {
    const frames = samples(CALIBRATION_MIN_SAMPLES).map((frame, i) => ({
      ...frame,
      t: i,
      joints: { ...frame.joints, l_shoulder: { x: 100, y: 0, conf: 0.1 } },
    }));
    expect(calibrateFrames(frames, T.vis_min)).toBeNull();
  });
});

describe('unclearJoints', () => {
  it('reports nothing when every needed joint is clear', () => {
    const frames = Array.from({ length: 5 }, (_, i) => ({ ...frameFor(100, 100, 100), t: i }));
    expect(unclearJoints(frames, T.vis_min)).toEqual([]);
  });

  it('names the joint that is unclear in most samples', () => {
    const frames = Array.from({ length: 5 }, (_, i) => {
      const frame = frameFor(100, 100, 100);
      if (i < 4) frame.joints['r_elbow'] = { x: 100, y: 0, conf: 0.1 };
      return { ...frame, t: i };
    });
    expect(unclearJoints(frames, T.vis_min)).toEqual(['r_elbow']);
  });

  it('names the left shoulder that anchors scale', () => {
    const frames = Array.from({ length: 5 }, (_, i) => {
      const frame = frameFor(100, 100, 100);
      if (i < 4) frame.joints['l_shoulder'] = { x: 100, y: 0, conf: 0.1 };
      return { ...frame, t: i };
    });
    expect(unclearJoints(frames, T.vis_min)).toEqual(['l_shoulder']);
  });

  it('names every needed joint when no pose was captured', () => {
    expect(unclearJoints([], T.vis_min)).toEqual(['r_shoulder', 'r_elbow', 'r_wrist', 'l_shoulder']);
  });
});
