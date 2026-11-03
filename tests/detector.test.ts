import { describe, expect, it } from 'vitest';
import type { Joint2D, PoseFrame, System1State } from '../src/contracts';
import {
  createStateMachine,
  createSystem1Detector,
  scoreWindow,
  type DetectorOptions,
} from '../src/system1/detector';

// Literal thresholds — never config.local.json. Shoulder width 0.2,
// midpoint (0.5, 0.5). Face points: nose (0.5,0.30), eyes y 0.26,
// ears (0.40/0.60,0.28), mouth corners (0.47/0.53,0.34). touchDist 0.2,
// reach_margin 0.5, zone_min 0.25, so the zone radius is 0.3 normalised
// (0.06 image units). touchElbowDeg 70, elbow margin 20: limit 90.
const T = {
  enter_threshold: 0.7,
  exit_threshold: 0.4,
  consecutive_windows: 3,
  window_frames: 4,
  min_clean_frames: 2,
  hop_frames: 1,
  reach_window_s: 4,
  hold_s: 30,
  hold_max_s: 60,
  drop_s: 1.5,
  drop_tolerance_s: 0.5,
  drop_speed: 1.0,
  sink_weight: 0.6,
  stall_speed: 0.2,
  stall_s: 1.0,
  shoulder_hike_frac: 0.15,
  hike_hold_frames: 5,
  start_motion_deg: 5,
  start_motion_dist: 0.1,
};
const PASS_THROUGH = { hand_min_cutoff: 1e9, hand_beta: 0, shoulder_alpha: 1 };
const REAL_SMOOTHING = { hand_min_cutoff: 1.0, hand_beta: 0.05, shoulder_alpha: 0.2 };
const FACE = {
  reach_margin: 0.5,
  zone_min: 0.25,
  elbow_margin_deg: 20,
  default_touch_dist: 0.2,
  default_elbow_deg: 70,
  anchor_smooth: 0.1,
};
const STORED = {
  offsets: {
    nose: { x: 0, y: -1.0 },
    l_eye_in: { x: -0.125, y: -1.2 },
    l_eye: { x: -0.2, y: -1.2 },
    l_eye_out: { x: -0.275, y: -1.2 },
    r_eye_in: { x: 0.125, y: -1.2 },
    r_eye: { x: 0.2, y: -1.2 },
    r_eye_out: { x: 0.275, y: -1.2 },
    l_ear: { x: -0.5, y: -1.1 },
    r_ear: { x: 0.5, y: -1.1 },
    mouth_l: { x: -0.15, y: -0.8 },
    mouth_r: { x: 0.15, y: -0.8 },
  },
  touchDist: 0.2,
  touchElbowDeg: 70,
};
const OPTS: DetectorOptions = {
  struggle: T,
  face: FACE,
  smoothing: PASS_THROUGH,
  visMin: 0.5,
  cooldownMs: 60000,
  stored: STORED,
};
/** Real smoothing values for the input-smoothing tests. */
const SMOOTH: DetectorOptions = { ...OPTS, smoothing: REAL_SMOOTHING };
const RADIUS = 0.3;

function joint(x: number, y: number, conf = 0.9): Joint2D {
  return { x, y, conf };
}

function frame(
  t: number,
  opts: {
    ok?: boolean;
    elbow?: number;
    index?: { x: number; y: number };
    shoulderY?: number;
    indexConf?: number;
    face?: Record<string, Joint2D>;
  } = {},
): PoseFrame {
  const {
    ok = true,
    elbow = 150,
    index = { x: 0.5, y: 0.9 },
    shoulderY = 0.5,
    indexConf = 0.9,
    face = {},
  } = opts;
  return {
    t,
    fps: 30,
    joints: {
      r_shoulder: joint(0.6, shoulderY),
      r_elbow: joint(0.55, 0.6),
      r_wrist: joint(0.55, 0.7),
      l_shoulder: joint(0.4, shoulderY),
      nose: joint(0.5, 0.3),
      l_eye_in: joint(0.475, 0.26),
      l_eye: joint(0.46, 0.26),
      l_eye_out: joint(0.445, 0.26),
      r_eye_in: joint(0.525, 0.26),
      r_eye: joint(0.54, 0.26),
      r_eye_out: joint(0.555, 0.26),
      l_ear: joint(0.4, 0.28),
      r_ear: joint(0.6, 0.28),
      mouth_l: joint(0.47, 0.34),
      mouth_r: joint(0.53, 0.34),
      r_index: joint(index.x, index.y, indexConf),
      ...face,
    },
    angles: { r_elbow_flexion: { deg: elbow, conf: 0.9 } },
    gate: ok ? { ok: true, reasons: [] } : { ok: false, reasons: ['foreshortening'] },
  };
}

const FAR = { x: 0.5, y: 0.9 }; // normalised distance 2.8: clearly away
const CHEEK = { x: 0.4, y: 0.31 }; // nearest the left ear at 0.15

describe('scoreWindow rules', () => {
  const idle = {
    ageS: 0,
    closestDist: 3.0,
    stillS: 0,
    outS: 0,
    fallingFast: false,
    inZone: false,
    dist: 3.0,
    touchDist: 0.2,
  };

  it('scores failed_range 1.0 when the hand never enters within the window', () => {
    const rep = { ...idle, ageS: 4, closestDist: 0.6 };
    expect(scoreWindow('reach', rep, 0, RADIUS, T)).toEqual({ score: 1, topSignal: 'failed_range' });
  });

  it('scales failed_range with the closest miss', () => {
    const rep = { ...idle, ageS: 4, closestDist: 0.375 };
    const result = scoreWindow('reach', rep, 0, RADIUS, T);
    expect(result.topSignal).toBe('failed_range');
    expect(result.score).toBeCloseTo(0.25, 10);
  });

  it('scores no failed_range before the reach window elapses', () => {
    const rep = { ...idle, ageS: 3.9, closestDist: 0.6 };
    expect(scoreWindow('reach', rep, 0, RADIUS, T)).toEqual({ score: 0, topSignal: 'stall' });
  });

  it('flags a hand stopped outside the zone', () => {
    const stopped = { ...idle, ageS: 1, closestDist: 0.5, stillS: 1.0 };
    expect(scoreWindow('reach', stopped, 0, RADIUS, T)).toEqual({ score: 1, topSignal: 'stall' });
    const brief = { ...stopped, stillS: 0.5 };
    expect(scoreWindow('reach', brief, 0, RADIUS, T).score).toBeCloseTo(0.5, 10);
  });

  it('scores the shoulder hike at 1.0, 0.67 and 0.33', () => {
    expect(scoreWindow('reach', idle, 0.2, RADIUS, T)).toEqual({ score: 1, topSignal: 'compensation' });
    expect(scoreWindow('reach', idle, 0.1, RADIUS, T).score).toBeCloseTo(0.667, 3);
    expect(scoreWindow('reach', idle, 0.05, RADIUS, T).score).toBeCloseTo(0.333, 3);
  });

  it('flags compensation while the elbow is moving well', () => {
    // Approaching fast (no stall), window not elapsed (no failed range),
    // shoulder hiking: compensation still wins.
    const moving = { ...idle, ageS: 0.5, closestDist: 0.5, stillS: 0 };
    expect(scoreWindow('reach', moving, 0.2, RADIUS, T)).toEqual({
      score: 1,
      topSignal: 'compensation',
    });
  });

  it('ignores tracking blips: no drop at or below the tolerance', () => {
    const blip = { ...idle, ageS: 9, outS: 0.4, inZone: false, dist: 2.8 };
    expect(scoreWindow('hold', blip, 0, RADIUS, T)).toEqual({ score: 0, topSignal: 'drop' });
    expect(scoreWindow('hold', { ...blip, outS: 0.5 }, 0, RADIUS, T).score).toBe(0);
  });

  it('ramps drop from the tolerance to 1.0 at drop_s', () => {
    const out = { ...idle, ageS: 9, inZone: false, dist: 2.8 };
    expect(scoreWindow('hold', { ...out, outS: 0.9 }, 0, RADIUS, T)).toEqual({
      score: 0.4,
      topSignal: 'drop',
    });
    expect(scoreWindow('hold', { ...out, outS: 1.5 }, 0, RADIUS, T).score).toBe(1);
  });

  it('scores a fast fall 1.0 immediately once past the tolerance', () => {
    const fast = { ...idle, ageS: 9, inZone: false, dist: 2.8, fallingFast: true };
    expect(scoreWindow('hold', { ...fast, outS: 0.6 }, 0, RADIUS, T)).toEqual({
      score: 1,
      topSignal: 'drop',
    });
    // Inside the tolerance the blip rule wins, even when falling fast.
    expect(scoreWindow('hold', { ...fast, outS: 0.4 }, 0, RADIUS, T).score).toBe(0);
  });

  it('sinks toward the zone edge without ever reaching the enter threshold', () => {
    const sink = { ...idle, ageS: 9, inZone: true, touchDist: 0.2 };
    expect(scoreWindow('hold', { ...sink, dist: 0.2 }, 0, RADIUS, T).score).toBe(0);
    const mid = scoreWindow('hold', { ...sink, dist: 0.25 }, 0, RADIUS, T);
    expect(mid.topSignal).toBe('drop');
    expect(mid.score).toBeCloseTo(0.3, 10);
    expect(scoreWindow('hold', { ...sink, dist: 0.29 }, 0, RADIUS, T).score).toBeCloseTo(0.54, 10);
  });

  it('never emits jitter', () => {
    const reps = [
      { ...idle, ageS: 5, closestDist: 0.6, stillS: 1 },
      { ...idle, ageS: 9, outS: 2, fallingFast: true, inZone: false, dist: 2.8 },
      { ...idle, ageS: 9, inZone: true, dist: 0.25 },
    ];
    for (const rep of reps) {
      expect(scoreWindow('reach', rep, 0.2, RADIUS, T).topSignal).not.toBe('jitter');
      expect(scoreWindow('hold', rep, 0.2, RADIUS, T).topSignal).not.toBe('jitter');
    }
  });
});

describe('hysteresis', () => {
  function machine() {
    return createStateMachine({
      enterThreshold: 0.7,
      exitThreshold: 0.4,
      consecutiveWindows: 3,
      cooldownMs: 60000,
    });
  }

  it('enters Struggling only on the fourth window for scores [0.2, 0.7, 0.7, 0.7]', () => {
    const m = machine();
    const states = [0.2, 0.7, 0.7, 0.7].map(
      (score, i) => m.push(i * 1000, { score, topSignal: 'stall' })?.state,
    );
    expect(states).toEqual(['moving_well', 'hesitating', 'hesitating', 'struggling']);
  });

  it('leaves Struggling only below the lower threshold', () => {
    const staying = machine();
    [0.7, 0.7, 0.7].forEach((score, i) => staying.push(i * 1000, { score, topSignal: 'stall' }));
    expect(staying.push(3000, { score: 0.5, topSignal: 'stall' })?.state).toBe('struggling');

    const leaving = machine();
    [0.7, 0.7, 0.7].forEach((score, i) => leaving.push(i * 1000, { score, topSignal: 'stall' }));
    expect(leaving.push(3000, { score: 0.39, topSignal: 'stall' })?.state).toBe('moving_well');
  });

  it('holds the state when a window yields no score', () => {
    const m = machine();
    expect(m.push(0, null)).toBeNull();
    m.push(1000, { score: 0.7, topSignal: 'stall' });
    expect(m.push(2000, null)).toBeNull();
    expect(m.push(3000, { score: 0.7, topSignal: 'stall' })?.state).toBe('hesitating');
  });

  it('omits top_signal for moving_well', () => {
    const m = machine();
    expect(m.push(0, { score: 0.1, topSignal: 'stall' })).toEqual({
      state: 'moving_well',
      score: 0.1,
      topSignal: undefined,
      escalate: false,
    });
  });
});

describe('escalation cooldown', () => {
  function struggling() {
    const m = createStateMachine({
      enterThreshold: 0.7,
      exitThreshold: 0.4,
      consecutiveWindows: 3,
      cooldownMs: 60000,
    });
    [0.7, 0.7, 0.7].forEach((score, i) => m.push(i * 1000, { score, topSignal: 'stall' }));
    return m;
  }

  it('does not escalate twice within the cooldown', () => {
    const m = struggling();
    // The entering window already escalated, so a window 1 s later stays quiet.
    expect(m.push(3000, { score: 0.9, topSignal: 'stall' })?.escalate).toBe(false);
  });

  it('escalates again after the cooldown passes', () => {
    const m = struggling();
    expect(m.push(65000, { score: 0.9, topSignal: 'stall' })?.escalate).toBe(true);
  });
});

describe('reach-and-hold detector', () => {
  it('skips flagged frames: 40 flagged frames yield no state', () => {
    const detector = createSystem1Detector(OPTS);
    for (let i = 0; i < 40; i++) {
      expect(detector.push(frame(i, { ok: false }), i * 33)).toBeNull();
    }
  });

  it('a still arm at rest for 10 s never scores and never escalates', () => {
    const detector = createSystem1Detector(OPTS);
    for (let i = 0; i < 20; i++) {
      expect(detector.push(frame(i * 0.5, { elbow: 150, index: FAR }), i * 500)).toBeNull();
    }
    expect(detector.snapshot().phase).toBe('rest');
  });

  /** Rest, rep start, one approach frame; the probe frame decides. */
  function startedDetector(opts: DetectorOptions = OPTS): ReturnType<typeof createSystem1Detector> {
    const detector = createSystem1Detector(opts);
    detector.push(frame(0, { elbow: 150, index: FAR }), 0);
    detector.push(frame(1, { elbow: 150, index: FAR }), 1000);
    detector.push(frame(2, { elbow: 144, index: { x: 0.5, y: 0.6 } }), 2000);
    detector.push(frame(3, { elbow: 100, index: { x: 0.5, y: 0.5 } }), 3000);
    return detector;
  }

  it('forehead: a hand exactly at the radius counts as at face', () => {
    const detector = startedDetector();
    // Directly above the left eye: 0.06 image units -> 0.3 normalised.
    detector.push(frame(4, { elbow: 65, index: { x: 0.46, y: 0.2 } }), 4000);
    expect(detector.snapshot().phase).toBe('hold');
  });

  it('forehead: just inside and just outside the radius', () => {
    const inside = startedDetector();
    inside.push(frame(4, { elbow: 65, index: { x: 0.46, y: 0.201 } }), 4000);
    expect(inside.snapshot().phase).toBe('hold');
    const outside = startedDetector();
    outside.push(frame(4, { elbow: 65, index: { x: 0.46, y: 0.199 } }), 4000);
    expect(outside.snapshot().phase).toBe('reach');
  });

  it('cheek: the nearest point is the left ear', () => {
    const detector = startedDetector();
    detector.push(frame(4, { elbow: 65, index: { x: 0.4, y: 0.31 } }), 4000);
    expect(detector.snapshot().phase).toBe('hold');
  });

  it('mouth region: a hand below the mouth is at face', () => {
    const detector = startedDetector();
    detector.push(frame(4, { elbow: 65, index: { x: 0.5, y: 0.36 } }), 4000);
    expect(detector.snapshot().phase).toBe('hold');
  });

  it('far away: a hand at the shoulder midpoint height is not at face', () => {
    const detector = startedDetector();
    detector.push(frame(4, { elbow: 65, index: { x: 0.5, y: 0.5 } }), 4000);
    expect(detector.snapshot().phase).toBe('reach');
  });

  it('a hand over the face with a straight arm never counts as at face', () => {
    const detector = createSystem1Detector(OPTS);
    const overMouth = { x: 0.5, y: 0.34 };
    for (let i = 0; i < 20; i++) {
      expect(detector.push(frame(i * 0.5, { elbow: 150, index: overMouth }), i * 500)).toBeNull();
    }
    expect(detector.snapshot().phase).toBe('rest');
  });

  it('reaching and holding to 30 s reports moving_well with no signal', () => {
    const detector = startedDetector();
    let latest = null;
    for (let t = 4; t <= 33; t++) {
      latest = detector.push(frame(t, { elbow: 65, index: CHEEK }), t * 1000) ?? latest;
    }
    expect(detector.snapshot().phase).toBe('done');
    expect(latest?.state).toBe('moving_well');
    expect(latest && 'top_signal' in latest).toBe(false);
  });

  it('29.9 s in the zone is not yet a success', () => {
    const detector = startedDetector();
    for (let t = 4; t <= 32; t++) {
      detector.push(frame(t, { elbow: 65, index: CHEEK }), t * 1000);
    }
    detector.push(frame(32.9, { elbow: 65, index: CHEEK }), 32900);
    expect(detector.snapshot().phase).toBe('hold');
  });

  it('60 s of timing ends the rep as a success', () => {
    const detector = startedDetector();
    let latest: System1State | null = null;
    // A 1 s out-of-zone blip every 11 s: holdS never reaches 30, but the
    // total hold time still ends the rep at 60.
    for (let t = 4; t <= 63; t++) {
      const out = t % 11 === 2;
      const next: System1State | null =
        detector.push(frame(t, { elbow: 65, index: out ? FAR : CHEEK }), t * 1000) ?? latest;
      if (next) latest = next;
    }
    expect(detector.snapshot().phase).toBe('done');
    expect(latest?.state).toBe('moving_well');
  });

  it('a blip out of the zone scores no drop and still succeeds', () => {
    const detector = startedDetector();
    const seen: string[] = [];
    let latest: System1State | null = null;
    const track = (t: number, elbow: number, index: { x: number; y: number }): System1State | null => {
      const next: System1State | null = detector.push(frame(t, { elbow, index }), t * 1000);
      if (next) seen.push(next.state);
      return next;
    };
    let step = track(4, 65, CHEEK);
    if (step) latest = step;
    step = track(4.4, 65, FAR);
    if (step) latest = step;
    for (let t = 5; t <= 35; t++) {
      step = track(t, 65, CHEEK);
      if (step) latest = step;
    }
    expect(seen).not.toContain('struggling');
    expect(latest?.state).toBe('moving_well');
  });

  it('a fast fall out of hold escalates with drop', () => {
    const detector = startedDetector();
    let latest = null;
    const spots = [
      [3, 65, CHEEK],
      [3.5, 65, { x: 0.5, y: 0.45 }],
      [4, 65, FAR],
      [4.5, 65, FAR],
      [5, 65, FAR],
      [5.5, 65, FAR],
    ] as Array<[number, number, { x: number; y: number }]>;
    for (const [t, elbow, index] of spots) {
      latest = detector.push(frame(t, { elbow, index }), t * 1000) ?? latest;
    }
    expect(latest?.state).toBe('struggling');
    expect(latest?.top_signal).toBe('drop');
  });

  it('sinking halfway to the edge scores 0.3 and never struggles', () => {
    const detector = startedDetector();
    let latest = null;
    // 0.05 left of the left ear: normalised 0.25, halfway to the edge.
    const sink = { x: 0.35, y: 0.28 };
    for (let i = 0; i < 10; i++) {
      const t = 4 + i * 0.5;
      latest = detector.push(frame(t, { elbow: 65, index: sink }), t * 1000) ?? latest;
    }
    expect(latest).not.toBeNull();
    expect(latest?.score).toBeCloseTo(0.3, 10);
    expect(latest?.state).not.toBe('struggling');
  });

  it('a hand that never arrives escalates with failed_range', () => {
    const detector = startedDetector();
    let latest = null;
    // Oscillate at normalised distances 0.6/0.8 from the right ear: fast
    // enough to never count as stalled, closest 0.6.
    const spots = [
      [4, 100, { x: 0.72, y: 0.28 }],
      [4.5, 100, { x: 0.76, y: 0.28 }],
      [5, 100, { x: 0.72, y: 0.28 }],
      [5.5, 100, { x: 0.76, y: 0.28 }],
      [6, 100, { x: 0.72, y: 0.28 }],
      [6.5, 100, { x: 0.76, y: 0.28 }],
      [7, 100, { x: 0.72, y: 0.28 }],
      [7.5, 100, { x: 0.76, y: 0.28 }],
      [8, 100, { x: 0.72, y: 0.28 }],
    ] as Array<[number, number, { x: number; y: number }]>;
    for (const [t, elbow, index] of spots) {
      latest = detector.push(frame(t, { elbow, index }), t * 1000) ?? latest;
    }
    expect(latest?.state).toBe('struggling');
    expect(latest?.top_signal).toBe('failed_range');
  });

  it('a close miss scores 0.25 and never struggles', () => {
    const detector = startedDetector();
    let latest = null;
    // Oscillate at normalised distances 0.375/0.5 left of the left ear: fast
    // enough to never stall, closest 0.375.
    for (let i = 0; i < 13; i++) {
      const t = 4 + i * 0.5;
      const x = i % 2 === 0 ? 0.325 : 0.3;
      latest = detector.push(frame(t, { elbow: 100, index: { x, y: 0.28 } }), t * 1000) ?? latest;
    }
    expect(latest).not.toBeNull();
    expect(latest?.score).toBeCloseTo(0.25, 10);
    expect(latest?.state).not.toBe('struggling');
  });

  it('a hand stopped outside the zone escalates with stall', () => {
    const detector = startedDetector();
    let latest = null;
    const stop = { x: 0.7, y: 0.3 };
    for (let i = 7; i <= 13; i++) {
      const t = i * 0.5;
      latest = detector.push(frame(t, { elbow: 100, index: stop }), t * 1000) ?? latest;
    }
    expect(latest?.state).toBe('struggling');
    expect(latest?.top_signal).toBe('stall');
  });

  it('needs three separate hops, not three consecutive frames, to struggle', () => {
    const hop = {
      ...OPTS,
      struggle: { ...T, window_frames: 4, min_clean_frames: 4, hop_frames: 2, consecutive_windows: 3 },
    };
    const detector = createSystem1Detector(hop);
    let latest = null;
    const spots = [
      [0, 150, FAR],
      [0.5, 150, FAR],
      [1, 144, { x: 0.7, y: 0.3 }],
      [1.5, 100, { x: 0.7, y: 0.3 }],
      [2, 100, { x: 0.7, y: 0.3 }],
      [2.5, 100, { x: 0.7, y: 0.3 }],
      [3, 100, { x: 0.7, y: 0.3 }],
      [3.5, 100, { x: 0.7, y: 0.3 }],
      [4, 100, { x: 0.7, y: 0.3 }],
      [4.5, 100, { x: 0.7, y: 0.3 }],
    ] as Array<[number, number, { x: number; y: number }]>;
    // Frames score only on every second clean frame past the minimum four:
    // t=3 is the second scored hop, still hesitating.
    for (const [t, elbow, index] of spots.slice(0, 7)) {
      latest = detector.push(frame(t, { elbow, index }), t * 1000) ?? latest;
    }
    expect(latest?.state).toBe('hesitating');
    for (const [t, elbow, index] of spots.slice(7)) {
      latest = detector.push(frame(t, { elbow, index }), t * 1000) ?? latest;
    }
    expect(latest?.state).toBe('struggling');
  });

  it('a shoulder hike during the reach escalates with compensation', () => {
    const detector = startedDetector();
    let latest = null;
    // Moving hand (never stalled), shoulder held high: compensation needs
    // hike_hold_frames consecutive scored hops before it scores above 0.
    const spots = [
      [4, 120, { x: 0.325, y: 0.28 }, 0.46],
      [4.5, 120, { x: 0.3, y: 0.28 }, 0.46],
      [5, 120, { x: 0.325, y: 0.28 }, 0.46],
      [5.5, 120, { x: 0.3, y: 0.28 }, 0.46],
      [6, 120, { x: 0.325, y: 0.28 }, 0.46],
      [6.5, 120, { x: 0.3, y: 0.28 }, 0.46],
      [7, 120, { x: 0.325, y: 0.28 }, 0.46],
      [7.5, 120, { x: 0.3, y: 0.28 }, 0.46],
    ] as Array<[number, number, { x: number; y: number }, number]>;
    for (const [t, elbow, index, sy] of spots) {
      latest = detector.push(frame(t, { elbow, index, shoulderY: sy }), t * 1000) ?? latest;
    }
    expect(latest?.state).toBe('struggling');
    expect(latest?.top_signal).toBe('compensation');
  });

  it('hand jitter around a fixed point never changes the at-face result', () => {
    const detector = startedDetector(SMOOTH);
    const states: string[] = [];
    for (let i = 0; i < 20; i++) {
      const t = 4 + i * 0.5;
      const y = i % 2 === 0 ? 0.305 : 0.315;
      const next = detector.push(frame(t, { elbow: 65, index: { x: 0.4, y } }), t * 1000);
      if (next) states.push(next.state);
    }
    // Raw distances swing 0.125..0.175 around the 0.15 cheek distance; the
    // smoothed distance stays within 0.02 of it and never leaves the zone.
    expect(detector.snapshot().phase).toBe('hold');
    expect(Math.abs((detector.snapshot().lastDist ?? NaN) - 0.15)).toBeLessThan(0.02);
    expect(states).not.toContain('struggling');
  });

  it('a real 0.1 move passes through smoothing within a few frames', () => {
    const detector = createSystem1Detector(SMOOTH);
    detector.push(frame(0, { elbow: 150, index: { x: 0.5, y: 0.9 } }), 0);
    detector.push(frame(1, { elbow: 150, index: { x: 0.5, y: 0.9 } }), 1000);
    detector.push(frame(2, { elbow: 150, index: { x: 0.5, y: 0.9 } }), 2000);
    const before = detector.snapshot();
    detector.push(frame(3, { elbow: 150, index: { x: 0.5, y: 0.8 } }), 3000);
    detector.push(frame(4, { elbow: 150, index: { x: 0.5, y: 0.8 } }), 4000);
    const after = detector.snapshot();
    const step = Math.abs((after.rawDist ?? NaN) - (before.lastDist ?? NaN));
    expect(step).toBeGreaterThan(0);
    expect(Math.abs((after.lastDist ?? NaN) - (after.rawDist ?? NaN))).toBeLessThan(0.15 * step);
  });

  it('one shoulder blip never scores compensation, a sustained rise does', () => {
    const detector = startedDetector(SMOOTH);
    const tops: Array<string | undefined> = [];
    let latest = null;
    const spots = [
      [4, 0.5],
      [4.5, 0.5],
      [5, 0.45],
      [5.5, 0.5],
      [6, 0.5],
      [6.5, 0.5],
    ] as Array<[number, number]>;
    for (const [t, sy] of spots) {
      // Wide oscillation: smoothed hand speed stays above the stall band.
      const x = t % 1 === 0 ? 0.25 : 0.35;
      latest =
        detector.push(frame(t, { elbow: 120, index: { x, y: 0.28 }, shoulderY: sy }), t * 1000) ??
        latest;
      if (latest?.top_signal !== undefined) tops.push(latest.top_signal);
    }
    expect(tops).not.toContain('compensation');
    expect(latest?.state).not.toBe('struggling');

    const sustained = startedDetector(SMOOTH);
    let held: System1State | null = null;
    for (let i = 0; i < 14; i++) {
      const t = 4 + i * 0.25;
      // Wide oscillation: smoothed hand speed stays above the stall band.
      const x = i % 2 === 0 ? 0.25 : 0.35;
      held =
        sustained.push(frame(t, { elbow: 120, index: { x, y: 0.28 }, shoulderY: 0.46 }), t * 1000) ??
        held;
    }
    expect(held?.state).toBe('struggling');
    expect(held?.top_signal).toBe('compensation');
  });

  it('smoothing resets after a tracking gap', () => {
    const detector = createSystem1Detector(SMOOTH);
    detector.push(frame(0, { elbow: 150, index: { x: 0.5, y: 0.9 } }), 0);
    detector.push(frame(0.5, { elbow: 150, index: { x: 0.5, y: 0.8 } }), 500);
    const lagging = detector.snapshot();
    // The smoothed point trails the raw point after a fast move.
    expect(lagging.lastDist).not.toBe(lagging.rawDist);
    detector.resetWindow();
    expect(detector.snapshot().phase).toBe('rest');
    expect(detector.snapshot().lastDist).toBeNull();
    detector.push(frame(1, { elbow: 150, index: { x: 0.5, y: 0.8 } }), 1000);
    const fresh = detector.snapshot();
    // Fresh smoothing starts exactly on the raw point: no lag.
    expect(fresh.lastDist).toBe(fresh.rawDist);
  });

  it('yields no score until the minimum clean frames arrive', () => {
    const detector = createSystem1Detector({ ...OPTS, struggle: { ...T, min_clean_frames: 10 } });
    expect(detector.push(frame(0, { elbow: 150, index: FAR }), 0)).toBeNull();
    expect(detector.push(frame(0.5, { elbow: 150, index: FAR }), 500)).toBeNull();
    expect(detector.push(frame(1, { elbow: 144, index: { x: 0.5, y: 0.6 } }), 1000)).toBeNull();
    for (let i = 2; i <= 6; i++) {
      expect(
        detector.push(frame(i * 0.5, { elbow: 100, index: { x: 0.5, y: 0.5 } }), i * 500),
      ).toBeNull();
    }
  });

  it('keeps the stored offsets while the hand is near the face', () => {
    const detector = startedDetector();
    const near = { x: 0.46, y: 0.2 };
    const before = detector.snapshot().offsets;
    // Eyes missing, then one eye jumping across the image: no refresh.
    detector.push(frame(4, { elbow: 65, index: near, face: { l_ear: joint(0.4, 0.28, 0) } }), 4000);
    detector.push(
      frame(4.5, {
        elbow: 65,
        index: near,
        face: {
          l_eye: joint(0.46, 0.26, 0),
          r_eye: joint(0.9, 0.9, 0.9),
        },
      }),
      4500,
    );
    expect(detector.snapshot().offsets).toEqual(before);
  });

  it('refreshes the stored offsets with the hand clear and valid points', () => {
    const detector = startedDetector();
    detector.push(frame(4, { elbow: 65, index: FAR, face: { l_eye: joint(0.48, 0.26) } }), 4000);
    const moved = detector.snapshot().offsets;
    expect(moved?.['l_eye']?.x).toBeCloseTo(-0.19, 10);
    expect(moved?.['l_eye']?.y).toBeCloseTo(-1.2, 10);
    expect(moved?.['nose']?.x).toBeCloseTo(0, 10);
    expect(moved?.['nose']?.y).toBeCloseTo(-1.0, 10);
  });

  it('a body shift moves every face point by the same amount', () => {
    const detector = startedDetector();
    detector.push(frame(4, { elbow: 65, index: CHEEK }), 4000);
    const before = detector.snapshot().lastDist;
    const beforeOffsets = detector.snapshot().offsets;
    // Everything (shoulders, hand, face) shifts +0.1 in x.
    const shifted: PoseFrame = {
      t: 4.5,
      fps: 30,
      joints: {
        r_shoulder: joint(0.7, 0.5),
        r_elbow: joint(0.65, 0.6),
        r_wrist: joint(0.65, 0.7),
        l_shoulder: joint(0.5, 0.5),
        nose: joint(0.6, 0.3),
        l_eye_in: joint(0.575, 0.26),
        l_eye: joint(0.56, 0.26),
        l_eye_out: joint(0.545, 0.26),
        r_eye_in: joint(0.625, 0.26),
        r_eye: joint(0.64, 0.26),
        r_eye_out: joint(0.655, 0.26),
        l_ear: joint(0.5, 0.28),
        r_ear: joint(0.7, 0.28),
        mouth_l: joint(0.57, 0.34),
        mouth_r: joint(0.63, 0.34),
        r_index: joint(0.5, 0.31),
      },
      angles: { r_elbow_flexion: { deg: 65, conf: 0.9 } },
      gate: { ok: true, reasons: [] },
    };
    detector.push(shifted, 4500);
    expect(detector.snapshot().lastDist).toBeCloseTo(before ?? NaN, 10);
    expect(detector.snapshot().offsets).toEqual(beforeOffsets);
  });

  it('resetWindow drops the rep so a new rep starts clean', () => {
    const detector = startedDetector();
    let latest = null;
    const stop = { x: 0.7, y: 0.3 };
    for (let i = 7; i <= 13; i++) {
      const t = i * 0.5;
      latest = detector.push(frame(t, { elbow: 100, index: stop }), t * 1000) ?? latest;
    }
    expect(latest?.state).toBe('struggling');
    detector.resetWindow();
    expect(detector.snapshot().phase).toBe('rest');
    // A fresh rep with a moving hand scores low again — no stale stall.
    latest = null;
    const fresh = [
      [7, 150, FAR],
      [7.5, 150, FAR],
      [8, 144, { x: 0.72, y: 0.28 }],
      [8.5, 100, { x: 0.68, y: 0.28 }],
      [9, 100, { x: 0.72, y: 0.28 }],
      [9.5, 100, { x: 0.68, y: 0.28 }],
    ] as Array<[number, number, { x: number; y: number }]>;
    for (const [t, elbow, index] of fresh) {
      latest = detector.push(frame(t, { elbow, index }), t * 1000) ?? latest;
    }
    expect(latest?.state).toBe('moving_well');
  });
});
