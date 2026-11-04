import { describe, expect, it } from 'vitest';
import {
  addFrameToStats,
  buildCoachSummary,
  canRequestCoach,
  cooldownActive,
  nextEscalation,
  requestCoachMessage,
  wristBelowShoulder,
} from '../src/coach/summary';
import type { Joint2D, PoseFrame } from '../src/contracts';

function joint(x: number, y: number, conf = 0.9): Joint2D {
  return { x, y, conf };
}

function frame(t: number, ok: boolean, deg = 90): PoseFrame {
  return {
    t,
    fps: 24,
    joints: {},
    angles: { r_elbow_flexion: { deg, conf: 0.9 } },
    gate: ok ? { ok: true, reasons: [] } : { ok: false, reasons: ['foreshortening'] },
  };
}

/** Frame with a full face and a hand: midpoint (0.5,0.5), width 0.2. */
function faceFrame(t: number, index: { x: number; y: number }, elbow = 65): PoseFrame {
  return {
    t,
    fps: 24,
    joints: {
      r_shoulder: joint(0.6, 0.5),
      l_shoulder: joint(0.4, 0.5),
      r_wrist: joint(0.55, 0.7),
      r_index: joint(index.x, index.y),
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
    },
    angles: { r_elbow_flexion: { deg: elbow, conf: 0.9 } },
    gate: { ok: true, reasons: [] },
  };
}

describe('addFrameToStats', () => {
  it('ignores null and gate-flagged frames', () => {
    expect(addFrameToStats(null, null)).toBeNull();
    expect(addFrameToStats(null, frame(1, false))).toBeNull();
  });

  it('accumulates min, max, and duration over clean frames only', () => {
    let stats = addFrameToStats(null, frame(1, true, 80));
    stats = addFrameToStats(stats, frame(2, false, 10));
    stats = addFrameToStats(stats, frame(3, true, 100));
    expect(stats?.count).toBe(2);
    expect(stats?.angles['r_elbow_flexion']).toEqual({ min: 80, max: 100, sum: 180, count: 2 });
    expect(stats?.firstT).toBe(1);
    expect(stats?.lastT).toBe(3);
  });

  it('never mutates its input: the same prev can be reused', () => {
    const prev = addFrameToStats(null, frame(1, true, 80));
    const before = JSON.stringify(prev);
    addFrameToStats(prev, frame(3, true, 100));
    expect(JSON.stringify(prev)).toBe(before);
    const again = addFrameToStats(prev, frame(3, true, 100));
    expect(again?.angles['r_elbow_flexion']).toEqual({ min: 80, max: 100, sum: 180, count: 2 });
  });

  it('keeps only the recent window of clean frames', () => {
    let stats = addFrameToStats(null, frame(0, true, 50), 10);
    stats = addFrameToStats(stats, frame(5, true, 60), 10);
    stats = addFrameToStats(stats, frame(11, true, 100), 10);
    // The t=0 sample falls outside the 10 s window ending at t=11.
    expect(stats?.count).toBe(2);
    expect(stats?.firstT).toBe(5);
    expect(stats?.lastT).toBe(11);
    expect(stats?.angles['r_elbow_flexion']).toEqual({ min: 60, max: 100, sum: 160, count: 2 });
    const summary = buildCoachSummary('wash your face with the cloth', stats, 'hesitating', 'stall');
    expect(summary?.duration_s).toBe(6);
    expect(summary?.angles['r_elbow_flexion']).toEqual({ min: 60, max: 100, mean: 80 });
  });
});

describe('nextEscalation', () => {
  it('returns the new id once, then nothing until the next escalation', () => {
    expect(nextEscalation(0, 0)).toBeNull();
    expect(nextEscalation(1, 0)).toBe(1);
    expect(nextEscalation(1, 1)).toBeNull();
    expect(nextEscalation(2, 1)).toBe(2);
  });

  it('one escalation causes exactly one request, recorded even when blocked', () => {
    // Simulate the panel flow: record first, ask once, ignore repeats.
    let lastHandled = 0;
    let requests = 0;
    const handle = (escalationId: number, blocked: boolean) => {
      const next = nextEscalation(escalationId, lastHandled);
      if (next === null) return;
      lastHandled = next;
      if (!blocked) requests += 1;
    };
    handle(1, false);
    handle(1, false);
    handle(1, false);
    expect(requests).toBe(1);
    // A blocked escalation is recorded, never re-fired after the block lifts.
    handle(2, true);
    expect(lastHandled).toBe(2);
    handle(2, false);
    expect(requests).toBe(1);
  });
});

describe('buildCoachSummary', () => {
  it('returns null with no statistics', () => {
    expect(buildCoachSummary('wash your face with the cloth', null, 'moving_well', undefined)).toBeNull();
  });

  it('builds only the summary object: task, angles, duration, system1', () => {
    let stats = addFrameToStats(null, frame(1, true, 80));
    stats = addFrameToStats(stats, frame(3, true, 100));
    const summary = buildCoachSummary('wash your face with the cloth', stats, 'hesitating', 'stall');
    expect(summary).toEqual({
      task: 'wash your face with the cloth',
      angles: { r_elbow_flexion: { min: 80, max: 100, mean: 90 } },
      duration_s: 2,
      reached: false,
      held_s: 0,
      system1: { state: 'hesitating', top_signal: 'stall' },
    });
  });

  it('reports reached once the hand is at the face, with held seconds', () => {
    let stats = addFrameToStats(null, faceFrame(1, { x: 0.4, y: 0.31 }));
    stats = addFrameToStats(stats, faceFrame(2, { x: 0.4, y: 0.31 }));
    expect(stats?.reached).toBe(true);
    expect(stats?.heldS).toBe(1);
    const summary = buildCoachSummary('wash your face with the cloth', stats, 'moving_well', undefined);
    expect(summary?.reached).toBe(true);
    expect(summary?.held_s).toBe(1);
  });

  it('forgets a reach that falls out of the window', () => {
    let stats = addFrameToStats(null, faceFrame(0, { x: 0.4, y: 0.31 }), 10);
    stats = addFrameToStats(stats, faceFrame(5, { x: 0.5, y: 0.9 }), 10);
    stats = addFrameToStats(stats, faceFrame(11, { x: 0.5, y: 0.9 }), 10);
    // The t=0 in-zone sample is evicted; only out-of-zone samples remain.
    expect(stats?.reached).toBe(false);
    expect(stats?.heldS).toBe(0);
  });

  it('omits a missing top_signal for moving_well', () => {
    const stats = addFrameToStats(null, frame(1, true, 80));
    const summary = buildCoachSummary('wash your face with the cloth', stats, 'moving_well', undefined);
    expect(summary?.system1).toEqual({ state: 'moving_well' });
  });

  it('carries no image data: only short strings and finite numbers', () => {
    let stats = addFrameToStats(null, frame(1, true, 80));
    stats = addFrameToStats(stats, frame(3, true, 100));
    const body = JSON.stringify(buildCoachSummary('wash your face with the cloth', stats, 'struggling', 'stall'));
    expect(body).not.toMatch(/data:|base64/i);
    expect(body.length).toBeLessThan(2000);
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      'angles',
      'duration_s',
      'held_s',
      'reached',
      'system1',
      'task',
    ]);
  });
});

describe('wristBelowShoulder', () => {
  const armFrame = (wrist: { x: number; y: number; conf: number }, shoulder: { x: number; y: number; conf: number }): PoseFrame => ({
    t: 1,
    fps: 24,
    joints: {
      r_wrist: { ...wrist },
      r_shoulder: { ...shoulder },
    },
    angles: {},
    gate: { ok: false, reasons: ['low_visibility'] },
  });

  it('is true when the working wrist sits below the shoulder line', () => {
    expect(
      wristBelowShoulder(armFrame({ x: 0.6, y: 0.7, conf: 0.4 }, { x: 0.6, y: 0.4, conf: 0.4 })),
    ).toBe(true);
  });

  it('is false when the wrist is level with or above the shoulder', () => {
    expect(
      wristBelowShoulder(armFrame({ x: 0.6, y: 0.4, conf: 0.9 }, { x: 0.6, y: 0.4, conf: 0.9 })),
    ).toBe(false);
    expect(
      wristBelowShoulder(armFrame({ x: 0.6, y: 0.2, conf: 0.9 }, { x: 0.6, y: 0.4, conf: 0.9 })),
    ).toBe(false);
  });

  it('is false without joints, with missing joints, or on zero-confidence defaults', () => {
    expect(wristBelowShoulder(null)).toBe(false);
    expect(wristBelowShoulder(frame(1, false))).toBe(false);
    expect(
      wristBelowShoulder(armFrame({ x: 0, y: 0, conf: 0 }, { x: 0, y: 0, conf: 0 })),
    ).toBe(false);
  });
});

describe('cooldown and request guard', () => {
  it('cooldown is active until its timestamp passes', () => {
    expect(cooldownActive(1000, 999)).toBe(true);
    expect(cooldownActive(1000, 1000)).toBe(false);
    expect(cooldownActive(1000, 1001)).toBe(false);
  });

  it("never requests while Can't see you is active or cooling down", () => {
    expect(canRequestCoach(false, false)).toBe(true);
    expect(canRequestCoach(true, false)).toBe(false);
    expect(canRequestCoach(false, true)).toBe(false);
    expect(canRequestCoach(true, true)).toBe(false);
  });
});

describe('requestCoachMessage', () => {
  const summary = {
    task: 'wash your face with the cloth',
    angles: { r_elbow_flexion: { min: 80, max: 100, mean: 90 } },
    duration_s: 2,
    reached: false,
    held_s: 0,
    system1: { state: 'hesitating' as const, top_signal: 'stall' as const },
  };

  it('returns the delivered message on success', async () => {
    const result = await requestCoachMessage(summary, {
      fetchImpl: (async () => ({ ok: true, json: async () => ({ message: 'Take your time.' }) })) as unknown as typeof fetch,
      timeoutMs: 5000,
    });
    expect(result).toEqual({ ok: true, message: 'Take your time.' });
  });

  it('returns the fallback on a proxy failure without throwing', async () => {
    const failing = async () => {
      throw new Error('offline');
    };
    await expect(
      requestCoachMessage(summary, {
        fetchImpl: failing as unknown as typeof fetch,
        timeoutMs: 5000,
      }),
    ).resolves.toEqual({ ok: false });
  });

  it('returns the fallback on a bad status or a body without a message', async () => {
    const badStatus = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(requestCoachMessage(summary, { fetchImpl: badStatus, timeoutMs: 5000 })).resolves.toEqual({
      ok: false,
    });
    const noMessage = (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(requestCoachMessage(summary, { fetchImpl: noMessage, timeoutMs: 5000 })).resolves.toEqual({
      ok: false,
    });
  });
});
