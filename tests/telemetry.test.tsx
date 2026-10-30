import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { Joint2D } from '../src/contracts';
import { buildClip } from '../src/pipeline/clip';
import { runReplay, runReplayWithTelemetry, type ReplayOptions } from '../src/pipeline/replay';
import type { PipelineThresholds } from '../src/pipeline/run';
import { summaryToCsv } from '../src/components/LoopMetricsPanel';
import { TelemetryPlayer } from '../src/components/TelemetryPlayer';

const BASELINE = { upperArm: 0.1, forearm: 0.20615528128088306, shoulderWidth: 0.2 };

function joints(): Record<string, Joint2D> {
  return {
    r_shoulder: { x: 0.6, y: 0.5, conf: 0.9 },
    l_shoulder: { x: 0.4, y: 0.5, conf: 0.9 },
    r_elbow: { x: 0.5, y: 0.5, conf: 0.9 },
    r_wrist: { x: 0.55, y: 0.7, conf: 0.9 },
    r_index: { x: 0.5, y: 0.9, conf: 0.9 },
  };
}

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
  storedFace: null,
};

const OPTS: ReplayOptions = { intervalS: 2, coverageWindowS: 3 };

function sixFrameClip() {
  return buildClip({
    name: 'P1',
    fps: 24,
    samples: Array.from({ length: 6 }, (_, i) => ({ t: (i / 24), joints: joints() })),
    baseline: BASELINE,
    face: null,
    thresholds: {},
    labels: [],
    source: 'recorded',
  });
}

describe('telemetry export', () => {
  it('emits one record per frame in clip order with matching ok flags', () => {
    const clip = sixFrameClip();
    const { summary, telemetry } = runReplayWithTelemetry(clip, T, OPTS);
    expect(telemetry).toHaveLength(6);
    expect(telemetry.map((f) => f.t)).toEqual(clip.frames.map((f) => f.t));
    expect(telemetry.filter((f) => !f.ok)).toHaveLength(summary.flaggedFrames);
    for (const f of telemetry) {
      expect(f.reasons).toEqual(expect.any(Array));
      expect(typeof f.elbowDeg).toBe('number');
      expect(typeof f.shoulderDeg).toBe('number');
    }
  });

  it('leaves the summary identical to runReplay', () => {
    const clip = sixFrameClip();
    const { summary } = runReplayWithTelemetry(clip, T, OPTS);
    expect(summary).toEqual(runReplay(clip, T, OPTS));
  });

  it('never enters exports: summary JSON and CSV carry no per-frame data', () => {
    const clip = sixFrameClip();
    const { summary } = runReplayWithTelemetry(clip, T, OPTS);
    const json = JSON.stringify(summary);
    expect(json).not.toContain('telemetry');
    expect(json).not.toContain('joints');
    const csv = summaryToCsv(summary);
    expect(csv).not.toContain('telemetry');
  });
});

describe('telemetry player', () => {
  it('renders controls, readout and skeleton with no storage or network', () => {
    const clip = sixFrameClip();
    const { telemetry } = runReplayWithTelemetry(clip, T, OPTS);
    const html = renderToStaticMarkup(<TelemetryPlayer clip={clip} telemetry={telemetry} />);
    expect(html).toContain('Play');
    expect(html).toContain('Step back');
    expect(html).toContain('Seek');
    expect(html).toContain('Clip time:');
    expect(html).toContain('Signal good');
    expect(html).not.toContain('NaN');
    const src = readFileSync(new URL('../src/components/TelemetryPlayer.tsx', import.meta.url), 'utf-8');
    for (const banned of ['localStorage', 'sessionStorage', 'fetch(', 'XMLHttpRequest', 'sendBeacon']) {
      expect(src, `player must not touch ${banned}`).not.toContain(banned);
    }
  });
});
