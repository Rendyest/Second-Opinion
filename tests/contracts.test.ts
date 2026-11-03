import { describe, expect, it } from 'vitest';
import {
  isCoachEvent,
  isPoseFrame,
  isRecordedClip,
  isReplayEvent,
  isSystem1State,
  parseRecordedClip,
  parseReplayFile,
} from '../src/contracts';

const GOOD_POSE = {
  t: 12.384,
  fps: 24,
  joints: { r_elbow: { x: 0.41, y: 0.52, conf: 0.93 } },
  angles: {
    r_elbow_flexion: { deg: 87.2, conf: 0.91 },
    r_shoulder_elevation: { deg: 64.0, conf: 0.88 },
  },
  gate: { ok: true, reasons: [] },
};

const GOOD_STATE = { t: 12.4, state: 'hesitating', score: 0.58, top_signal: 'stall', escalate: false };

const GOOD_COACH = {
  t: 14.1,
  trigger: 'struggling_sustained',
  latency_ms: 1320,
  ok: true,
  message: 'Take your time. Try slowing down.',
  inputs: 'angle_summary',
};

describe('contracts', () => {
  it('accepts a well-formed pose_frame with the brief’s example numbers', () => {
    expect(isPoseFrame(GOOD_POSE)).toBe(true);
  });

  it('rejects a pose_frame with an unknown gate reason', () => {
    expect(isPoseFrame({ ...GOOD_POSE, gate: { ok: false, reasons: ['mystery'] } })).toBe(false);
  });

  it('rejects a pose_frame missing the gate', () => {
    const { gate: _gate, ...rest } = GOOD_POSE;
    void _gate;
    expect(isPoseFrame(rest)).toBe(false);
  });

  it('accepts a well-formed system1_state and rejects an unknown state', () => {
    expect(isSystem1State(GOOD_STATE)).toBe(true);
    expect(isSystem1State({ ...GOOD_STATE, state: 'confused' })).toBe(false);
  });

  it('accepts moving_well with a missing or empty top_signal', () => {
    const movingWell = { t: 1.0, state: 'moving_well', score: 0.12, escalate: false };
    expect(isSystem1State({ ...movingWell, top_signal: 'stall' })).toBe(true);
    expect(isSystem1State(movingWell)).toBe(true);
    expect(isSystem1State({ ...movingWell, top_signal: '' })).toBe(true);
  });

  it('keeps top_signal required for hesitating and struggling', () => {
    const { top_signal: _dropped, ...hesitating } = GOOD_STATE;
    void _dropped;
    expect(isSystem1State(hesitating)).toBe(false);
    expect(isSystem1State({ ...GOOD_STATE, state: 'struggling' })).toBe(true);
    expect(isSystem1State({ ...GOOD_STATE, state: 'struggling', top_signal: undefined })).toBe(false);
  });

  it('accepts the drop signal for hesitating and struggling', () => {
    expect(isSystem1State({ ...GOOD_STATE, top_signal: 'drop' })).toBe(true);
    expect(isSystem1State({ ...GOOD_STATE, state: 'struggling', top_signal: 'drop' })).toBe(true);
    expect(isSystem1State({ ...GOOD_STATE, state: 'cant_see_you', top_signal: 'drop' })).toBe(true);
    expect(isSystem1State({ ...GOOD_STATE, top_signal: 'jitter' })).toBe(true);
  });

  it('accepts a well-formed coach_event', () => {
    expect(isCoachEvent(GOOD_COACH)).toBe(true);
  });

  it('parses a replay file and keeps file order', () => {
    const events = parseReplayFile({
      events: [
        { kind: 'pose_frame', at_ms: 0, data: GOOD_POSE },
        { kind: 'system1_state', at_ms: 1000, data: GOOD_STATE },
        { kind: 'coach_event', at_ms: 3100, data: GOOD_COACH },
      ],
    });
    expect(events.map((e) => e.kind)).toEqual(['pose_frame', 'system1_state', 'coach_event']);
  });

  it('names the first bad entry when a replay file is invalid', () => {
    expect(() =>
      parseReplayFile({
        events: [
          { kind: 'pose_frame', at_ms: 0, data: GOOD_POSE },
          { kind: 'pose_frame', at_ms: 500, data: { t: 'soon' } },
        ],
      }),
    ).toThrow('event 1');
  });

  it('rejects a replay event with a negative timestamp', () => {
    expect(isReplayEvent({ kind: 'pose_frame', at_ms: -5, data: GOOD_POSE })).toBe(false);
  });

  it('accepts a well-formed recorded clip', () => {
    const clip = {
      version: 1,
      source: 'recorded',
      name: 'P1',
      fps: 24,
      frames: [{ t: 0, joints: { r_shoulder: { x: 0.6, y: 0.5, conf: 0.9 } } }],
      baseline: { upperArm: 0.1, forearm: 0.2, shoulderWidth: 0.2 },
      face: {
        offsets: { nose: { x: 0, y: -1 } },
        touchDist: 0.2,
        touchElbowDeg: 70,
      },
      config_used: { vis_min: 0.5 },
      labels: [{ start_s: 0, end_s: 1 }],
    };
    expect(isRecordedClip(clip)).toBe(true);
    expect(parseRecordedClip(clip)).toBe(clip);
    expect(isRecordedClip({ ...clip, baseline: null, face: null })).toBe(true);
    expect(isRecordedClip({ ...clip, labels: undefined })).toBe(true);
  });

  it('accepts point marks and rejects bad ones, staying strict otherwise', () => {
    const clip = {
      version: 1,
      source: 'recorded',
      name: 'P1',
      fps: 24,
      frames: [{ t: 0, joints: { r_shoulder: { x: 0.6, y: 0.5, conf: 0.9 } } }],
      baseline: null,
      face: null,
      config_used: {},
      marks: [1.5, 3],
    };
    expect(isRecordedClip(clip)).toBe(true);
    expect(isRecordedClip({ ...clip, marks: undefined })).toBe(true);
    expect(isRecordedClip({ ...clip, marks: [] })).toBe(true);
    expect(isRecordedClip({ ...clip, marks: [-1] })).toBe(false);
    expect(isRecordedClip({ ...clip, marks: ['soon'] })).toBe(false);
    expect(isRecordedClip({ ...clip, marks: [NaN] })).toBe(false);
  });

  it('rejects clips with unknown fields, bad versions, or image-like values', () => {
    const clip = {
      version: 1,
      source: 'recorded',
      name: 'P1',
      fps: 24,
      frames: [{ t: 0, joints: { r_shoulder: { x: 0.6, y: 0.5, conf: 0.9 } } }],
      baseline: null,
      face: null,
      config_used: {},
    };
    expect(isRecordedClip({ ...clip, extra: true })).toBe(false);
    expect(isRecordedClip({ ...clip, version: 0 })).toBe(false);
    expect(isRecordedClip({ ...clip, source: 'live' })).toBe(false);
    expect(isRecordedClip({ ...clip, frames: [{ t: 0 }] })).toBe(false);
    expect(isRecordedClip({ ...clip, config_used: { img: `data:image/png;base64,${'A'.repeat(10)}` } })).toBe(false);
    expect(isRecordedClip({ ...clip, config_used: { img: 'B'.repeat(300) } })).toBe(false);
    expect(() => parseRecordedClip({ ...clip, extra: true })).toThrow();
  });
});
