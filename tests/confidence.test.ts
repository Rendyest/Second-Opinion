import { describe, expect, it } from 'vitest';
import { isLowConfidence } from '../src/pose/angles';
import { drawList } from '../src/components/VideoStage';
import type { PoseFrame } from '../src/contracts';

const THRESHOLD = 0.5;

function frame(): PoseFrame {
  return {
    t: 1.5,
    fps: 24,
    joints: {
      r_shoulder: { x: 0.55, y: 0.4, conf: 0.9 },
      r_elbow: { x: 0.41, y: 0.52, conf: 0.3 },
      r_wrist: { x: 0.48, y: 0.35, conf: 0.9 },
    },
    angles: {},
    gate: { ok: true, reasons: [] },
  };
}

describe('isLowConfidence', () => {
  it('flags a joint just below the threshold', () => {
    expect(isLowConfidence(0.49, THRESHOLD)).toBe(true);
  });

  it('does not flag a joint exactly at the threshold', () => {
    expect(isLowConfidence(0.5, THRESHOLD)).toBe(false);
  });

  it('does not flag a joint above the threshold', () => {
    expect(isLowConfidence(0.9, THRESHOLD)).toBe(false);
  });
});

describe('drawList', () => {
  it('keeps a flagged joint in the list, marked weak instead of dropped', () => {
    const { joints } = drawList(frame(), THRESHOLD);
    expect(joints).toHaveLength(3);
    const elbow = joints.find((j) => j.name === 'r_elbow');
    expect(elbow).toBeDefined();
    expect(elbow?.weak).toBe(true);
    expect(joints.filter((j) => !j.weak)).toHaveLength(2);
  });

  it('marks a segment weak when either endpoint is weak, without dropping it', () => {
    const { segments } = drawList(frame(), THRESHOLD);
    // r_elbow (0.3) is weak, so both arm segments are weak but present.
    expect(segments).toHaveLength(2);
    expect(segments.every((s) => s.weak)).toBe(true);
  });
});

describe('right-arm highlight', () => {
  function twoArmFrame(): PoseFrame {
    return {
      t: 1.5,
      fps: 24,
      joints: {
        l_shoulder: { x: 0.45, y: 0.4, conf: 0.9 },
        l_elbow: { x: 0.44, y: 0.6, conf: 0.9 },
        r_shoulder: { x: 0.55, y: 0.4, conf: 0.9 },
        r_elbow: { x: 0.41, y: 0.52, conf: 0.3 },
        r_wrist: { x: 0.48, y: 0.35, conf: 0.9 },
      },
      angles: {},
      gate: { ok: true, reasons: [] },
    };
  }

  it('marks only the right-arm segments highlighted', () => {
    const { segments } = drawList(twoArmFrame(), THRESHOLD);
    const flagged = new Map(segments.map((s) => [`${s.a}-${s.b}`, s.highlight]));
    expect(flagged.get('r_shoulder-r_elbow')).toBe(true);
    expect(flagged.get('r_elbow-r_wrist')).toBe(true);
    expect(flagged.get('l_shoulder-l_elbow')).toBe(false);
    expect(flagged.get('l_shoulder-r_shoulder')).toBe(false);
  });

  it('keeps highlight on weak segments while still dimming them', () => {
    // r_elbow is weak (0.3): both right-arm segments stay highlighted AND weak.
    const { segments, joints } = drawList(twoArmFrame(), THRESHOLD);
    for (const s of segments.filter((seg) => seg.highlight)) {
      expect(s.weak).toBe(true);
    }
    // The weak joint is still in the draw list.
    expect(joints.find((j) => j.name === 'r_elbow')?.weak).toBe(true);
    expect(joints).toHaveLength(5);
  });
});

describe('hidden joints', () => {
  it('leaves ear landmarks out of the draw list', () => {
    const f = frame();
    f.joints['l_ear'] = { x: 0.4, y: 0.25, conf: 0.9 };
    f.joints['r_ear'] = { x: 0.6, y: 0.25, conf: 0.9 };
    const { joints, segments } = drawList(f, THRESHOLD);
    expect(joints.find((j) => j.name === 'l_ear')).toBeUndefined();
    expect(joints.find((j) => j.name === 'r_ear')).toBeUndefined();
    expect(joints).toHaveLength(3);
    expect(segments).toHaveLength(2);
  });
});

describe('drawList stability', () => {
  it('returns the same joints when no new event arrives', () => {
    const f = frame();
    const first = drawList(f, THRESHOLD);
    const second = drawList(f, THRESHOLD);
    expect(second.joints).toEqual(first.joints);
    expect(second.segments).toEqual(first.segments);
  });
});
