import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Joint2D, PoseFrame } from '../src/contracts';
import { isRecordedClip } from '../src/contracts';
import { elbowFlexion, shoulderElevation } from '../src/pose/angles';
import { createPipeline, type PipelineThresholds } from '../src/pipeline/run';
import { buildClip } from '../src/pipeline/clip';
import { labelCoverage, runReplay } from '../src/pipeline/replay';
import {
  everyFrameCalls,
  fixedIntervalCalls,
  gatedTriggerCalls,
  percentile,
  savedFigure,
} from '../src/pipeline/policies';
import { summaryToCsv } from '../src/components/LoopMetricsPanel';

// Literal thresholds — never config.local.json. Mirror the committed
// defaults; smoothing is real here to prove replay under smoothing.
const STORED_FACE = {
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

const T: PipelineThresholds = {
  gate: {
    vis_min: 0.5,
    bone_length_tol: 0.3,
    foreshortening_min: 0.5,
    smooth_frames: 5,
    history_frames: 15,
    cant_see_enter_frames: 3,
    cant_see_exit_frames: 5,
  },
  struggle: {
    enter_threshold: 0.7,
    exit_threshold: 0.4,
    consecutive_windows: 3,
    window_frames: 30,
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
  },
  face: {
    reach_margin: 0.5,
    zone_min: 0.25,
    elbow_margin_deg: 20,
    default_touch_dist: 0.2,
    default_elbow_deg: 70,
    anchor_smooth: 0.1,
  },
  smoothing: { hand_min_cutoff: 1.0, hand_beta: 0.05, shoulder_alpha: 0.2 },
  visMin: 0.5,
  cooldownMs: 5000,
  storedFace: STORED_FACE,
};

/**
 * Replay runs the real gate tracker, so bones must stay constant across
 * frames (only the hand moves); otherwise drift would flag and nothing
 * would score. The rep starts on hand approach, not elbow motion.
 */
function jointsAt(index: { x: number; y: number }, shoulderY = 0.5): Record<string, Joint2D> {
  return {
    r_shoulder: { x: 0.6, y: shoulderY, conf: 0.9 },
    l_shoulder: { x: 0.4, y: shoulderY, conf: 0.9 },
    r_elbow: { x: 0.5, y: 0.5, conf: 0.9 },
    r_wrist: { x: 0.55, y: 0.7, conf: 0.9 },
    r_index: { ...index, conf: 0.9 },
  };
}

const FAR = { x: 0.5, y: 0.9 };
const STALL_SPOT = { x: 0.325, y: 0.28 };

const BASELINE = { upperArm: 0.1, forearm: 0.20615528128088306, shoulderWidth: 0.2 };

function poseFrame(t: number, joints: Record<string, Joint2D>): PoseFrame {
  const j = joints;
  return {
    t,
    fps: 24,
    joints: j,
    angles: {
      r_elbow_flexion: elbowFlexion(j['r_shoulder'], j['r_elbow'], j['r_wrist']),
      r_shoulder_elevation: shoulderElevation(j['r_shoulder'], j['r_elbow']),
    },
    gate: { ok: true, reasons: [] },
  };
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** Stall fixture: 12 rest frames, then the hand stops outside the zone. */
function stallJoints(): Array<{ t: number; joints: Record<string, Joint2D> }> {
  const out: Array<{ t: number; joints: Record<string, Joint2D> }> = [];
  for (let i = 0; i < 48; i++) {
    out.push({ t: round4(i / 24), joints: jointsAt(i < 12 ? FAR : STALL_SPOT) });
  }
  return out;
}

describe('call-counting policies', () => {
  const times240 = Array.from({ length: 240 }, (_, i) => (i / 24) * 1000);

  it('every_frame calls once per frame: 240 frames -> 240 calls', () => {
    expect(everyFrameCalls(times240)).toHaveLength(240);
  });

  it('fixed 2 s on a 10 s clip calls at 0, 2, 4, 6, 8 (10 excluded)', () => {
    expect(fixedIntervalCalls(times240, 2)).toEqual([0, 2000, 4000, 6000, 8000]);
  });

  it('gated trigger counts one call per escalation with the cooldown applied once', () => {
    expect(gatedTriggerCalls([0, 8000], 5000, [])).toEqual([0, 8000]);
    expect(gatedTriggerCalls([0, 3000], 5000, [])).toEqual([0]);
    expect(gatedTriggerCalls([0, 5000], 5000, [])).toEqual([0, 5000]);
  });

  it('gated trigger skips escalations while tracking is lost', () => {
    const blocked = [{ startMs: 1000, endMs: 4000 }];
    expect(gatedTriggerCalls([0, 2000, 9000], 5000, blocked)).toEqual([0, 9000]);
  });

  it('calls saved is baseline minus ours; baseline 0 is n/a; negative shows plainly', () => {
    const save = savedFigure(10, 3);
    expect(save.saved).toBe(7);
    expect(save.reductionPct).toBeCloseTo(0.7, 10);
    expect(save.text).toContain('saved 7 of 10');
    const none = savedFigure(0, 5);
    expect(none.reductionPct).toBeNull();
    expect(none.text).toContain('n/a');
    expect(savedFigure(2, 5).saved).toBe(-3);
  });

  it('nearest-rank percentiles: median 300 and p95 500 of five values', () => {
    expect(percentile([100, 200, 300, 400, 500], 50)).toBe(300);
    expect(percentile([100, 200, 300, 400, 500], 95)).toBe(500);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('labelled coverage', () => {
  const labels = [{ start_s: 2, end_s: 9 }];
  it('counts a call before, inside, and after the window', () => {
    expect(labelCoverage(labels, [500], 3)).toEqual({ covered: 0, total: 1 });
    expect(labelCoverage(labels, [2500], 3)).toEqual({ covered: 1, total: 1 });
    expect(labelCoverage(labels, [6000], 3)).toEqual({ covered: 0, total: 1 });
  });

  it('reports zero of zero with no labels', () => {
    expect(labelCoverage([], [1000], 3)).toEqual({ covered: 0, total: 0 });
  });
});

describe('replay summary', () => {
  it('counts inferences and escalations from a short literal fixture', () => {
    const clip = buildClip({
      name: 'P1',
      fps: 24,
      samples: stallJoints().map((f) => ({ t: f.t, joints: f.joints })),
      baseline: BASELINE,
      face: STORED_FACE,
      thresholds: { gate: T.gate, struggle: T.struggle },
      labels: [],
      source: 'recorded',
    });
    const summary = runReplay(clip, T, { intervalS: 2, coverageWindowS: 3 });
    expect(summary.frames).toBe(48);
    expect(summary.inferences).toBe(36);
    expect(summary.escalations).toBe(1);
    expect(summary.escalationTimesMs).toHaveLength(1);
  });

  it('gate flag rate: 6 flagged of 24 frames -> 0.25', () => {
    const joints = jointsAt(FAR);
    const flagged = { ...joints, r_wrist: { ...joints['r_wrist'], conf: 0.1 } };
    const samples = Array.from({ length: 24 }, (_, i) => ({
      t: round4(i / 24),
      joints: i < 6 ? flagged : joints,
    }));
    const clip = buildClip({
      name: 'P1',
      fps: 24,
      samples,
      baseline: BASELINE,
      face: STORED_FACE,
      thresholds: {},
      labels: [],
      source: 'recorded',
    });
    const summary = runReplay(clip, T, { intervalS: 2, coverageWindowS: 3 });
    expect(summary.flaggedFrames).toBe(6);
    expect(summary.flagRate).toBe(0.25);
    expect(summary.inferences).toBe(0);
  });

  it('marks uncalibrated replay when baseline and face are missing', () => {
    const clip = buildClip({
      name: 'P1',
      fps: 24,
      samples: stallJoints()
        .slice(0, 12)
        .map((f) => ({ t: f.t, joints: f.joints })),
      baseline: null,
      face: null,
      thresholds: {},
      labels: [],
      source: 'recorded',
    });
    const summary = runReplay(clip, T, { intervalS: 2, coverageWindowS: 3 });
    expect(summary.calibrated).toBe(false);
    expect(summary.frames).toBe(12);
  });
});

describe('shared pipeline', () => {
  it('session path and replay path produce identical states on the same frames', () => {
    const frames = stallJoints();
    const direct = createPipeline(T);
    const directStates: Array<unknown> = [];
    let directInferences = 0;
    let directEscalations = 0;
    let directFlagged = 0;
    for (const f of frames) {
      const r = direct.push(poseFrame(f.t, f.joints), BASELINE, f.t * 1000, true);
      if (!r.gate.ok) directFlagged += 1;
      if (r.system1 !== null) {
        directInferences += 1;
        directStates.push(r.system1);
        if (r.system1.escalate) directEscalations += 1;
      }
    }
    const clip = buildClip({
      name: 'P1',
      fps: 24,
      samples: frames.map((f) => ({ t: f.t, joints: f.joints })),
      baseline: BASELINE,
      face: STORED_FACE,
      thresholds: {},
      labels: [],
      source: 'recorded',
    });
    const replayed = runReplay(clip, T, { intervalS: 2, coverageWindowS: 3 });
    expect(replayed.inferences).toBe(directInferences);
    expect(replayed.escalations).toBe(directEscalations);
    expect(replayed.flaggedFrames).toBe(directFlagged);
    expect(replayed.escalationTimesMs).toHaveLength(
      directStates.filter((s) => (s as { escalate: boolean }).escalate).length,
    );
  });

  it('SessionPage runs the shared pipeline module', () => {
    const src = readFileSync(new URL('../src/pages/SessionPage.tsx', import.meta.url), 'utf-8');
    expect(src).toContain('pipeline/run');
  });
});

describe('replay exports', () => {
  function replayedSummary() {
    const clip = buildClip({
      name: 'P1',
      fps: 24,
      samples: stallJoints().map((f) => ({ t: f.t, joints: f.joints })),
      baseline: BASELINE,
      face: STORED_FACE,
      thresholds: {},
      labels: [{ start_s: 1, end_s: 2 }],
      source: 'recorded',
    });
    return runReplay(clip, T, { intervalS: 2, coverageWindowS: 3 });
  }

  it('exported JSON contains aggregates only: no joints, angles, or images', () => {
    const text = JSON.stringify(replayedSummary());
    expect(text).not.toContain('joints');
    expect(text).not.toContain('angles');
    expect(text).not.toContain('data:');
    expect(isRecordedClip(JSON.parse(text))).toBe(false);
  });

  it('exported CSV rows carry policy, baseline, calls, saved, and reduction', () => {
    const csv = summaryToCsv(replayedSummary());
    const lines = csv.split('\n');
    expect(lines[0]).toBe('policy,baseline_calls,calls,saved,reduction_pct');
    expect(csv).toContain('every_frame,48,1,47,');
    expect(csv).toContain('fixed_interval,1,1,0,');
    expect(csv).toContain('metric,value');
    expect(csv).toContain('system1_samples,36');
    expect(csv).not.toContain('joints');
  });
});
