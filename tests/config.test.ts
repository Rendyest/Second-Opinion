import { describe, expect, it } from 'vitest';
import { buildConfig, deepMerge, isAppConfig } from '../src/config';
import defaults from '../src/config/config.default.json';

const GOOD_CONFIG = {
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
    min_clean_frames: 10,
    hop_frames: 15,
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
  smoothing: { hand_min_cutoff: 1.0, hand_beta: 0.05, shoulder_alpha: 0.2 },
  face: {
    reach_margin: 0.5,
    zone_min: 0.25,
    elbow_margin_deg: 20,
    default_touch_dist: 0.2,
    default_elbow_deg: 70,
    anchor_smooth: 0.1,
  },
  coach: { timeout_ms: 10000, cooldown_ms: 60000, max_reply_chars: 300, summary_window_s: 10 },
  metrics: { interval_s: 2, coverage_window_s: 3, record_max_s: 120 },
  setup: {
    check_enter_frames: 3,
    check_exit_frames: 5,
    edge_margin: 0.05,
    brightness_min: 50,
    brightness_max: 200,
    tilt_max_deg: 10,
    facing_tol: 0.25,
    fps_window_s: 2,
    fps_min: 15,
  },
  baseline: { fixed_interval_s: 2 },
  ui: { readout_hz: 5, live_emit_hz: 30, dev_controls: false },
};

describe('config validation', () => {
  it('accepts the placeholder config shape', () => {
    expect(isAppConfig(GOOD_CONFIG)).toBe(true);
  });

  it('rejects a config missing the baseline section', () => {
    const { baseline: _baseline, ...rest } = GOOD_CONFIG;
    void _baseline;
    expect(isAppConfig(rest)).toBe(false);
  });

  it('rejects a non-numeric threshold', () => {
    expect(isAppConfig({ ...GOOD_CONFIG, coach: { timeout_ms: 'soon', cooldown_ms: 60000 } })).toBe(false);
  });

  it('rejects an exit threshold at or above the enter threshold', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, struggle: { ...GOOD_CONFIG.struggle, exit_threshold: 0.7 } }),
    ).toBe(false);
  });

  it('rejects a missing reach window', () => {
    const { reach_window_s: _dropped, ...struggle } = GOOD_CONFIG.struggle;
    void _dropped;
    expect(isAppConfig({ ...GOOD_CONFIG, struggle })).toBe(false);
  });

  it('rejects a non-positive drop window', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, struggle: { ...GOOD_CONFIG.struggle, drop_s: 0 } }),
    ).toBe(false);
  });

  it('rejects a hold window longer than the hold cap', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, struggle: { ...GOOD_CONFIG.struggle, hold_s: 61 } }),
    ).toBe(false);
  });

  it('rejects a drop tolerance at or past the drop window', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, struggle: { ...GOOD_CONFIG.struggle, drop_tolerance_s: 1.5 } }),
    ).toBe(false);
  });

  it('rejects a sink weight above one', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, struggle: { ...GOOD_CONFIG.struggle, sink_weight: 1.5 } }),
    ).toBe(false);
  });

  it('rejects a negative motion distance', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, struggle: { ...GOOD_CONFIG.struggle, start_motion_dist: -0.1 } }),
    ).toBe(false);
  });

  it('rejects a missing detector window size', () => {
    const { window_frames: _dropped, ...struggle } = GOOD_CONFIG.struggle;
    void _dropped;
    expect(isAppConfig({ ...GOOD_CONFIG, struggle })).toBe(false);
  });

  it('rejects null and non-objects', () => {
    expect(isAppConfig(null)).toBe(false);
    expect(isAppConfig('config.json')).toBe(false);
  });

  it('rejects a non-integer hike hold count', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, struggle: { ...GOOD_CONFIG.struggle, hike_hold_frames: 2.5 } }),
    ).toBe(false);
  });

  it('rejects a missing hike hold count', () => {
    const { hike_hold_frames: _dropped, ...struggle } = GOOD_CONFIG.struggle;
    void _dropped;
    expect(isAppConfig({ ...GOOD_CONFIG, struggle })).toBe(false);
  });
});

describe('config face section', () => {
  it('rejects a config missing the face section', () => {
    const { face: _face, ...rest } = GOOD_CONFIG;
    void _face;
    expect(isAppConfig(rest)).toBe(false);
  });

  it('rejects a zero zone minimum', () => {
    expect(isAppConfig({ ...GOOD_CONFIG, face: { ...GOOD_CONFIG.face, zone_min: 0 } })).toBe(false);
  });

  it('rejects a non-positive default touch distance', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, face: { ...GOOD_CONFIG.face, default_touch_dist: -0.2 } }),
    ).toBe(false);
  });

  it('rejects a negative elbow margin', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, face: { ...GOOD_CONFIG.face, elbow_margin_deg: -1 } }),
    ).toBe(false);
  });

  it('rejects an anchor smoothing factor above one', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, face: { ...GOOD_CONFIG.face, anchor_smooth: 1.5 } }),
    ).toBe(false);
  });

  it('rejects a missing anchor smoothing factor', () => {
    const { anchor_smooth: _dropped, ...face } = GOOD_CONFIG.face;
    void _dropped;
    expect(isAppConfig({ ...GOOD_CONFIG, face })).toBe(false);
  });
});

describe('config gate section', () => {
  it('rejects a gate missing the smoothing window', () => {
    const { smooth_frames: _dropped, ...gate } = GOOD_CONFIG.gate;
    void _dropped;
    expect(isAppConfig({ ...GOOD_CONFIG, gate })).toBe(false);
  });

  it('rejects a non-integer history length', () => {
    expect(isAppConfig({ ...GOOD_CONFIG, gate: { ...GOOD_CONFIG.gate, history_frames: 7.5 } })).toBe(false);
  });

  it('rejects a zero smoothing window', () => {
    expect(isAppConfig({ ...GOOD_CONFIG, gate: { ...GOOD_CONFIG.gate, smooth_frames: 0 } })).toBe(false);
  });

  it('rejects a smoothing window larger than the history', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, gate: { ...GOOD_CONFIG.gate, smooth_frames: 16, history_frames: 15 } }),
    ).toBe(false);
  });

  it('rejects a zero cant_see exit count', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, gate: { ...GOOD_CONFIG.gate, cant_see_exit_frames: 0 } }),
    ).toBe(false);
  });

  it('rejects a non-integer cant_see enter count', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, gate: { ...GOOD_CONFIG.gate, cant_see_enter_frames: 2.5 } }),
    ).toBe(false);
  });
});

describe('config smoothing section', () => {
  it('rejects a config missing the smoothing section', () => {
    const { smoothing: _smoothing, ...rest } = GOOD_CONFIG;
    void _smoothing;
    expect(isAppConfig(rest)).toBe(false);
  });

  it('rejects a non-positive hand cutoff', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, smoothing: { ...GOOD_CONFIG.smoothing, hand_min_cutoff: 0 } }),
    ).toBe(false);
  });

  it('rejects a negative hand beta', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, smoothing: { ...GOOD_CONFIG.smoothing, hand_beta: -0.1 } }),
    ).toBe(false);
  });

  it('rejects a shoulder alpha above one', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, smoothing: { ...GOOD_CONFIG.smoothing, shoulder_alpha: 1.5 } }),
    ).toBe(false);
  });
});

describe('config coach section', () => {
  it('rejects a missing timeout', () => {
    const { timeout_ms: _dropped, ...coach } = GOOD_CONFIG.coach;
    void _dropped;
    expect(isAppConfig({ ...GOOD_CONFIG, coach })).toBe(false);
  });

  it('rejects a non-positive cooldown', () => {
    expect(isAppConfig({ ...GOOD_CONFIG, coach: { ...GOOD_CONFIG.coach, cooldown_ms: -1 } })).toBe(false);
  });

  it('rejects a missing reply cap', () => {
    const { max_reply_chars: _dropped, ...coach } = GOOD_CONFIG.coach;
    void _dropped;
    expect(isAppConfig({ ...GOOD_CONFIG, coach })).toBe(false);
  });

  it('rejects a non-positive summary window', () => {
    expect(isAppConfig({ ...GOOD_CONFIG, coach: { ...GOOD_CONFIG.coach, summary_window_s: 0 } })).toBe(false);
  });
});

describe('config metrics section', () => {
  it('rejects a config missing the metrics section', () => {
    const { metrics: _metrics, ...rest } = GOOD_CONFIG;
    void _metrics;
    expect(isAppConfig(rest)).toBe(false);
  });

  it('rejects a non-positive fixed interval', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, metrics: { ...GOOD_CONFIG.metrics, interval_s: 0 } }),
    ).toBe(false);
  });

  it('rejects a non-positive coverage window', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, metrics: { ...GOOD_CONFIG.metrics, coverage_window_s: -1 } }),
    ).toBe(false);
  });

  it('rejects a non-positive record limit', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, metrics: { ...GOOD_CONFIG.metrics, record_max_s: 0 } }),
    ).toBe(false);
  });
});

describe('config setup section', () => {
  it('rejects a config missing the setup section', () => {
    const { setup: _setup, ...rest } = GOOD_CONFIG;
    void _setup;
    expect(isAppConfig(rest)).toBe(false);
  });

  it('rejects a zero check enter count', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, setup: { ...GOOD_CONFIG.setup, check_enter_frames: 0 } }),
    ).toBe(false);
  });

  it('rejects a non-integer check exit count', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, setup: { ...GOOD_CONFIG.setup, check_exit_frames: 2.5 } }),
    ).toBe(false);
  });

  it('rejects an edge margin at or beyond half the picture', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, setup: { ...GOOD_CONFIG.setup, edge_margin: 0.5 } }),
    ).toBe(false);
    expect(
      isAppConfig({ ...GOOD_CONFIG, setup: { ...GOOD_CONFIG.setup, edge_margin: -0.01 } }),
    ).toBe(false);
  });

  it('rejects a brightness range that runs backwards', () => {
    expect(
      isAppConfig({
        ...GOOD_CONFIG,
        setup: { ...GOOD_CONFIG.setup, brightness_min: 200, brightness_max: 50 },
      }),
    ).toBe(false);
  });

  it('rejects brightness outside luma range', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, setup: { ...GOOD_CONFIG.setup, brightness_max: 256 } }),
    ).toBe(false);
  });

  it('rejects a negative tilt limit', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, setup: { ...GOOD_CONFIG.setup, tilt_max_deg: -1 } }),
    ).toBe(false);
  });

  it('rejects a negative facing tolerance', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, setup: { ...GOOD_CONFIG.setup, facing_tol: -0.1 } }),
    ).toBe(false);
  });

  it('rejects a non-positive speed window or minimum', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, setup: { ...GOOD_CONFIG.setup, fps_window_s: 0 } }),
    ).toBe(false);
    expect(
      isAppConfig({ ...GOOD_CONFIG, setup: { ...GOOD_CONFIG.setup, fps_min: 0 } }),
    ).toBe(false);
  });
});

describe('config dev controls', () => {
  it('rejects a non-boolean dev_controls flag', () => {
    expect(isAppConfig({ ...GOOD_CONFIG, ui: { ...GOOD_CONFIG.ui, dev_controls: 'yes' } })).toBe(false);
  });

  it('accepts dev_controls on', () => {
    expect(
      isAppConfig({ ...GOOD_CONFIG, ui: { ...GOOD_CONFIG.ui, dev_controls: true } }),
    ).toBe(true);
  });
});

describe('config ui section', () => {
  it('rejects a config missing the ui section', () => {
    const { ui: _ui, ...rest } = GOOD_CONFIG;
    void _ui;
    expect(isAppConfig(rest)).toBe(false);
  });

  it('rejects a non-numeric readout rate', () => {
    expect(isAppConfig({ ...GOOD_CONFIG, ui: { readout_hz: 'fast', live_emit_hz: 30 } })).toBe(false);
  });
});

describe('config merge', () => {
  it('the committed defaults are a complete, valid config', () => {
    expect(isAppConfig(defaults)).toBe(true);
  });

  it('returns the defaults when there is no local file', () => {
    expect(buildConfig(defaults)).toEqual(defaults);
    expect(buildConfig(defaults, {})).toEqual(defaults);
  });

  it('local overrides win', () => {
    const cfg = buildConfig(defaults, { gate: { vis_min: 0.9 } });
    expect(cfg.gate.vis_min).toBe(0.9);
  });

  it('keys missing from local fall back to defaults', () => {
    const cfg = buildConfig(defaults, { gate: { vis_min: 0.9 } });
    expect(cfg.gate.bone_length_tol).toBe(defaults.gate.bone_length_tol);
    expect(cfg.coach.cooldown_ms).toBe(defaults.coach.cooldown_ms);
  });

  it('does not mutate the defaults', () => {
    const before = JSON.stringify(defaults);
    buildConfig(defaults, { gate: { vis_min: 0.9 } });
    expect(JSON.stringify(defaults)).toBe(before);
  });

  it('replaces arrays instead of concatenating them', () => {
    expect(deepMerge({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
  });

  it('throws if an override breaks a required field', () => {
    expect(() => buildConfig(defaults, { coach: { timeout_ms: 'soon' } })).toThrow();
  });
});