import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPoseFrame } from '../src/contracts';
import { buildPoseFrame, coco17ToBlaze } from '../src/pose/poseFrame';
import type { Point2D } from '../src/pose/poseFrame';

// Fixed fake landmarks (Blaze index slots). Hand-checkable:
// R_SHOULDER(12)=(0,0), R_ELBOW(14)=(1,0), R_WRIST(16)=(1,1) -> flexion 90;
// R_HIP(24)=(0,1) -> elevation of (1,0) against (0,1) is 90.
// Face: NOSE(0), L/R_EYE(1-6), L/R_EAR(7/8), MOUTH_L(9), MOUTH_R(10),
// R_INDEX(20).
function fakeLandmarks(): Point2D[] {
  const pts: Point2D[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  pts[12] = { x: 0, y: 0, visibility: 0.9 };
  pts[14] = { x: 1, y: 0, visibility: 0.9 };
  pts[16] = { x: 1, y: 1, visibility: 0.9 };
  pts[24] = { x: 0, y: 1, visibility: 0.9 };
  pts[11] = { x: -0.5, y: 0, visibility: 0.9 };
  pts[13] = { x: -1, y: 0.2, visibility: 0.9 };
  pts[15] = { x: -1, y: 1, visibility: 0.9 };
  pts[0] = { x: 0.5, y: 0.22, visibility: 0.9 };
  pts[1] = { x: 0.47, y: 0.24, visibility: 0.9 };
  pts[2] = { x: 0.45, y: 0.24, visibility: 0.9 };
  pts[3] = { x: 0.43, y: 0.24, visibility: 0.9 };
  pts[4] = { x: 0.53, y: 0.24, visibility: 0.9 };
  pts[5] = { x: 0.55, y: 0.24, visibility: 0.9 };
  pts[6] = { x: 0.57, y: 0.24, visibility: 0.9 };
  pts[7] = { x: 0.4, y: 0.27, visibility: 0.9 };
  pts[8] = { x: 0.6, y: 0.27, visibility: 0.9 };
  pts[9] = { x: 0.48, y: 0.26, visibility: 0.9 };
  pts[10] = { x: 0.52, y: 0.26, visibility: 0.9 };
  pts[20] = { x: 1, y: 1.1, visibility: 0.9 };
  return pts;
}

describe('buildPoseFrame', () => {
  it('produces output the mock-stream validator accepts', () => {
    expect(isPoseFrame(buildPoseFrame(fakeLandmarks(), 1.5, 24))).toBe(true);
  });

  it('computes the hand-checkable angles (90 and 90, conf 0.9)', () => {
    const frame = buildPoseFrame(fakeLandmarks(), 1.5, 24);
    expect(frame.angles['r_elbow_flexion']).toEqual({ deg: 90, conf: 0.9 });
    expect(frame.angles['r_shoulder_elevation']).toEqual({ deg: 90, conf: 0.9 });
  });

  it('has the same top-level keys as a mock pose_frame, with gate ok', () => {
    const raw = readFileSync(new URL('../public/mock-stream.json', import.meta.url), 'utf-8');
    const mock = (JSON.parse(raw) as { events: { kind: string; data: object }[] }).events.find(
      (e) => e.kind === 'pose_frame',
    )?.data as Record<string, unknown>;
    const live = buildPoseFrame(fakeLandmarks(), 1.5, 24) as unknown as Record<string, unknown>;
    expect(Object.keys(live).sort()).toEqual(Object.keys(mock).sort());
    // Live emits more joints (both arms); every mock joint/angle key is present.
    for (const key of Object.keys(mock['joints'] as object)) {
      expect(live['joints'] as object).toHaveProperty(key);
    }
    for (const key of Object.keys(mock['angles'] as object)) {
      expect(live['angles'] as object).toHaveProperty(key);
    }
    expect(live['gate']).toEqual({ ok: true, reasons: [] });
  });

  it('degrades missing points to conf 0 instead of throwing', () => {
    const frame = buildPoseFrame([], 0, 0);
    expect(isPoseFrame(frame)).toBe(true);
    expect(frame.joints['r_elbow']?.conf).toBe(0);
  });

  it('emits the face joints the reach detector needs, from the pinned indices', () => {
    const frame = buildPoseFrame(fakeLandmarks(), 1.5, 24);
    expect(frame.joints['nose']).toEqual({ x: 0.5, y: 0.22, conf: 0.9 });
    expect(frame.joints['l_eye_in']).toEqual({ x: 0.47, y: 0.24, conf: 0.9 });
    expect(frame.joints['l_eye']).toEqual({ x: 0.45, y: 0.24, conf: 0.9 });
    expect(frame.joints['l_eye_out']).toEqual({ x: 0.43, y: 0.24, conf: 0.9 });
    expect(frame.joints['r_eye_in']).toEqual({ x: 0.53, y: 0.24, conf: 0.9 });
    expect(frame.joints['r_eye']).toEqual({ x: 0.55, y: 0.24, conf: 0.9 });
    expect(frame.joints['r_eye_out']).toEqual({ x: 0.57, y: 0.24, conf: 0.9 });
    expect(frame.joints['l_ear']).toEqual({ x: 0.4, y: 0.27, conf: 0.9 });
    expect(frame.joints['r_ear']).toEqual({ x: 0.6, y: 0.27, conf: 0.9 });
    expect(frame.joints['mouth_l']).toEqual({ x: 0.48, y: 0.26, conf: 0.9 });
    expect(frame.joints['mouth_r']).toEqual({ x: 0.52, y: 0.26, conf: 0.9 });
    expect(frame.joints['r_index']).toEqual({ x: 1, y: 1.1, conf: 0.9 });
  });
});

describe('coco17ToBlaze', () => {
  function fakeCoco(): Point2D[] {
    const pts: Point2D[] = Array.from({ length: 17 }, () => ({ x: 0, y: 0, visibility: 0 }));
    pts[0] = { x: 0.5, y: 0.2, visibility: 0.8 };
    pts[1] = { x: 0.45, y: 0.22, visibility: 0.8 };
    pts[2] = { x: 0.55, y: 0.22, visibility: 0.8 };
    pts[3] = { x: 0.4, y: 0.25, visibility: 0.8 };
    pts[4] = { x: 0.6, y: 0.25, visibility: 0.8 };
    pts[5] = { x: 0.4, y: 0.4, visibility: 0.9 };
    pts[6] = { x: 0.6, y: 0.4, visibility: 0.9 };
    pts[7] = { x: 0.35, y: 0.6, visibility: 0.9 };
    pts[8] = { x: 0.65, y: 0.6, visibility: 0.9 };
    pts[9] = { x: 0.3, y: 0.8, visibility: 0.9 };
    pts[10] = { x: 0.7, y: 0.8, visibility: 0.9 };
    pts[11] = { x: 0.42, y: 0.9, visibility: 0.7 };
    pts[12] = { x: 0.58, y: 0.9, visibility: 0.7 };
    return pts;
  }

  it('maps arm and hip joints to the Blaze slots buildPoseFrame reads', () => {
    const blaze = coco17ToBlaze(fakeCoco());
    expect(blaze[12]).toEqual({ x: 0.6, y: 0.4, visibility: 0.9 });
    expect(blaze[14]).toEqual({ x: 0.65, y: 0.6, visibility: 0.9 });
    expect(blaze[16]).toEqual({ x: 0.7, y: 0.8, visibility: 0.9 });
    expect(blaze[24]).toEqual({ x: 0.58, y: 0.9, visibility: 0.7 });
  });

  it('fans the single COCO eye out to the in/eye/out slots', () => {
    const blaze = coco17ToBlaze(fakeCoco());
    expect(blaze[1]).toEqual(blaze[2]);
    expect(blaze[2]).toEqual(blaze[3]);
    expect(blaze[2]).toEqual({ x: 0.45, y: 0.22, visibility: 0.8 });
  });

  it('leaves mouth and index at conf 0 and still validates as a frame', () => {
    const frame = buildPoseFrame(coco17ToBlaze(fakeCoco()), 2.0, 24);
    expect(isPoseFrame(frame)).toBe(true);
    expect(frame.joints['mouth_l']?.conf).toBe(0);
    expect(frame.joints['r_index']?.conf).toBe(0);
    expect(frame.angles['r_elbow_flexion']?.conf).toBe(0.9);
  });

  it('degrades a missing person to conf 0 instead of throwing', () => {
    const frame = buildPoseFrame(coco17ToBlaze([]), 0, 0);
    expect(isPoseFrame(frame)).toBe(true);
    expect(frame.joints['r_elbow']?.conf).toBe(0);
  });
});
