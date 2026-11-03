import { describe, expect, it } from 'vitest';
import type { Joint2D, PoseFrame } from '../src/contracts';
import { createSystem1Detector } from '../src/system1/detector';
import type { DetectorOptions } from '../src/system1/detector';

const T = {
  enter_threshold: 0.7, exit_threshold: 0.4, consecutive_windows: 3,
  window_frames: 4, min_clean_frames: 2, hop_frames: 1,
  reach_window_s: 4, hold_s: 30, hold_max_s: 60, drop_s: 1.5,
  drop_tolerance_s: 0.5, drop_speed: 1.0, sink_weight: 0.6,
  stall_speed: 0.2, stall_s: 1.0, shoulder_hike_frac: 0.15,
  hike_hold_frames: 5, start_motion_deg: 5, start_motion_dist: 0.1,
};
const FACE = { reach_margin: 0.5, zone_min: 0.25, elbow_margin_deg: 20, default_touch_dist: 0.2, default_elbow_deg: 70, anchor_smooth: 0.1 };
const SMOOTHING = { hand_min_cutoff: 1e9, hand_beta: 0, shoulder_alpha: 1 };
const STORED = {
  offsets: {
    nose: { x: 0, y: -1.0 }, l_eye_in: { x: -0.125, y: -1.2 }, l_eye: { x: -0.2, y: -1.2 },
    l_eye_out: { x: -0.275, y: -1.2 }, r_eye_in: { x: 0.125, y: -1.2 }, r_eye: { x: 0.2, y: -1.2 },
    r_eye_out: { x: 0.275, y: -1.2 }, l_ear: { x: -0.5, y: -1.1 }, r_ear: { x: 0.5, y: -1.1 },
    mouth_l: { x: -0.15, y: -0.8 }, mouth_r: { x: 0.15, y: -0.8 },
  },
  touchDist: 0.2, touchElbowDeg: 70,
};
const OPTS: DetectorOptions = { struggle: T, face: FACE, smoothing: SMOOTHING, visMin: 0.5, cooldownMs: 60000, stored: STORED };
function joint(x: number, y: number, conf = 0.9): Joint2D { return { x, y, conf }; }
function frame(t: number, opts: { ok?: boolean; elbow?: number; index?: { x: number; y: number }; shoulderY?: number } = {}): PoseFrame {
  const { ok = true, elbow = 150, index = { x: 0.5, y: 0.9 }, shoulderY = 0.5 } = opts;
  return {
    t, fps: 30,
    joints: {
      r_shoulder: joint(0.6, shoulderY), r_elbow: joint(0.55, 0.6), r_wrist: joint(0.55, 0.7),
      l_shoulder: joint(0.4, shoulderY), nose: joint(0.5, 0.3),
      l_eye_in: joint(0.475, 0.26), l_eye: joint(0.46, 0.26), l_eye_out: joint(0.445, 0.26),
      r_eye_in: joint(0.525, 0.26), r_eye: joint(0.54, 0.26), r_eye_out: joint(0.555, 0.26),
      l_ear: joint(0.4, 0.28), r_ear: joint(0.6, 0.28),
      mouth_l: joint(0.47, 0.34), mouth_r: joint(0.53, 0.34),
      r_index: joint(index.x, index.y, 0.9),
    },
    angles: { r_elbow_flexion: { deg: elbow, conf: 0.9 } },
    gate: ok ? { ok: true, reasons: [] } : { ok: false, reasons: ['foreshortening'] },
  };
}
const FAR = { x: 0.5, y: 0.9 };
const CHEEK = { x: 0.4, y: 0.31 };

function startedDetector() {
  const detector = createSystem1Detector(OPTS);
  detector.push(frame(0, { elbow: 150, index: FAR }), 0);
  detector.push(frame(1, { elbow: 150, index: FAR }), 1000);
  detector.push(frame(2, { elbow: 144, index: { x: 0.5, y: 0.6 } }), 2000);
  detector.push(frame(3, { elbow: 100, index: { x: 0.5, y: 0.5 } }), 3000);
  return detector;
}

describe('debug', () => {
  it('trace hold timing', () => {
    const detector = startedDetector();
    for (let t = 4; t <= 33; t++) {
      const out = detector.push(frame(t, { elbow: 65, index: CHEEK }), t * 1000);
      if (t >= 31) console.log('t=' + t, JSON.stringify(detector.snapshot().phase), JSON.stringify(out));
    }
    console.log('FINAL phase=' + detector.snapshot().phase);
    expect(true).toBe(true);
  });
  it('trace never-arrives scores', () => {
    const detector = startedDetector();
    const spots = [
      [4, 100, { x: 0.72, y: 0.28 }], [4.5, 100, { x: 0.68, y: 0.28 }],
      [5, 100, { x: 0.72, y: 0.28 }], [5.5, 100, { x: 0.68, y: 0.28 }],
      [6, 100, { x: 0.72, y: 0.28 }], [6.5, 100, { x: 0.68, y: 0.28 }],
      [7, 100, { x: 0.72, y: 0.28 }], [7.5, 100, { x: 0.68, y: 0.28 }],
      [8, 100, { x: 0.72, y: 0.28 }],
    ] as Array<[number, number, { x: number; y: number }]>;
    for (const [t, elbow, index] of spots) {
      const out = detector.push(frame(t, { elbow, index }), t * 1000);
      if (out) console.log('t=' + t, 'dist?=snap', detector.snapshot().lastDist, JSON.stringify(out));
      else console.log('t=' + t, 'null, lastDist=', detector.snapshot().lastDist);
    }
    expect(true).toBe(true);
  });
  it('trace close-miss scores', () => {
    const detector = startedDetector();
    for (let i = 0; i < 13; i++) {
      const t = 4 + i * 0.5;
      const x = i % 2 === 0 ? 0.325 : 0.345;
      const out = detector.push(frame(t, { elbow: 100, index: { x, y: 0.28 } }), t * 1000);
      if (out) console.log('t=' + t, 'x=' + x, 'lastDist=', detector.snapshot().lastDist, JSON.stringify(out));
      else console.log('t=' + t, 'null lastDist=', detector.snapshot().lastDist);
    }
    expect(true).toBe(true);
  });
  it('trace hops config', () => {
    const hop = { ...OPTS, struggle: { ...T, window_frames: 4, min_clean_frames: 4, hop_frames: 2, consecutive_windows: 3 } };
    const detector = createSystem1Detector(hop);
    const spots = [
      [0, 150, FAR], [0.5, 150, FAR], [1, 144, { x: 0.7, y: 0.3 }], [1.5, 100, { x: 0.7, y: 0.3 }],
      [2, 100, { x: 0.7, y: 0.3 }], [2.5, 100, { x: 0.7, y: 0.3 }], [3, 100, { x: 0.7, y: 0.3 }],
      [3.5, 100, { x: 0.7, y: 0.3 }], [4, 100, { x: 0.7, y: 0.3 }], [4.5, 100, { x: 0.7, y: 0.3 }],
    ] as Array<[number, number, { x: number; y: number }]>;
    for (const [t, elbow, index] of spots) {
      const out = detector.push(frame(t, { elbow, index }), t * 1000);
      console.log('t=' + t, out ? JSON.stringify(out) : 'null', 'phase=', detector.snapshot().phase);
    }
    expect(true).toBe(true);
  });
  it('trace shoulder hike', () => {
    const detector = startedDetector();
    const spots = [
      [4, 120, { x: 0.5, y: 0.5 }, 0.46], [4.5, 120, { x: 0.5, y: 0.5 }, 0.46], [5, 120, { x: 0.5, y: 0.5 }, 0.46],
    ] as Array<[number, number, { x: number; y: number }, number]>;
    for (const [t, elbow, index, sy] of spots) {
      const out = detector.push(frame(t, { elbow, index, shoulderY: sy }), t * 1000);
      console.log('t=' + t, out ? JSON.stringify(out) : 'null', 'lastDist=', detector.snapshot().lastDist);
    }
    expect(true).toBe(true);
  });
});
