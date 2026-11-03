/**
 * Thresholds and tunables. `config.default.json` is committed (public
 * placeholders). `config.local.json` is gitignored and overrides it key by
 * key. Nothing in `src` may hard-code a threshold.
 */
import defaults from './config.default.json';

export interface AppConfig {
  gate: {
    vis_min: number;
    bone_length_tol: number;
    foreshortening_min: number;
    smooth_frames: number;
    history_frames: number;
    cant_see_enter_frames: number;
    cant_see_exit_frames: number;
  };
  struggle: {
    enter_threshold: number;
    exit_threshold: number;
    consecutive_windows: number;
    window_frames: number;
    min_clean_frames: number;
    hop_frames: number;
    reach_window_s: number;
    hold_s: number;
    hold_max_s: number;
    drop_s: number;
    drop_tolerance_s: number;
    drop_speed: number;
    sink_weight: number;
    stall_speed: number;
    stall_s: number;
    shoulder_hike_frac: number;
    hike_hold_frames: number;
    start_motion_deg: number;
    start_motion_dist: number;
  };
  smoothing: {
    hand_min_cutoff: number;
    hand_beta: number;
    shoulder_alpha: number;
  };
  face: {
    reach_margin: number;
    zone_min: number;
    elbow_margin_deg: number;
    default_touch_dist: number;
    default_elbow_deg: number;
    anchor_smooth: number;
  };
  coach: {
    timeout_ms: number;
    cooldown_ms: number;
    max_reply_chars: number;
    summary_window_s: number;
  };
  metrics: {
    interval_s: number;
    coverage_window_s: number;
    record_max_s: number;
    import_min_frames_per_s: number;
  };
  setup: {
    check_enter_frames: number;
    check_exit_frames: number;
    edge_margin: number;
    brightness_min: number;
    brightness_max: number;
    tilt_max_deg: number;
    facing_tol: number;
    fps_window_s: number;
    fps_min: number;
  };
  ui: {
    readout_hz: number;
    live_emit_hz: number;
    dev_controls: boolean;
  };
  review: {
    note_max_chars: number;
    blind_default: boolean;
  };
  baseline: {
    fixed_interval_s: number;
  };
}

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function isGate(v: unknown): v is AppConfig['gate'] {
  if (!isPlainObject(v)) return false;
  return (
    isNum(v['vis_min']) &&
    isNum(v['bone_length_tol']) &&
    isNum(v['foreshortening_min']) &&
    isPositiveInt(v['smooth_frames']) &&
    isPositiveInt(v['history_frames']) &&
    (v['smooth_frames'] as number) <= (v['history_frames'] as number) &&
    isPositiveInt(v['cant_see_enter_frames']) &&
    isPositiveInt(v['cant_see_exit_frames'])
  );
}

function isStruggle(v: unknown): v is AppConfig['struggle'] {
  if (!isPlainObject(v)) return false;
  const s: Json = v;
  const exit = s['exit_threshold'];
  const enter = s['enter_threshold'];
  return (
    isNum(enter) &&
    isNum(exit) &&
    exit < enter &&
    isPositiveInt(s['consecutive_windows']) &&
    isPositiveInt(s['window_frames']) &&
    isPositiveInt(s['min_clean_frames']) &&
    isPositiveInt(s['hop_frames']) &&
    isNum(s['reach_window_s']) &&
    (s['reach_window_s'] as number) > 0 &&
    isNum(s['hold_s']) &&
    (s['hold_s'] as number) > 0 &&
    isNum(s['hold_max_s']) &&
    (s['hold_max_s'] as number) >= (s['hold_s'] as number) &&
    isNum(s['drop_s']) &&
    (s['drop_s'] as number) > 0 &&
    isNum(s['drop_tolerance_s']) &&
    (s['drop_tolerance_s'] as number) >= 0 &&
    (s['drop_tolerance_s'] as number) < (s['drop_s'] as number) &&
    isNum(s['drop_speed']) &&
    (s['drop_speed'] as number) > 0 &&
    isNum(s['sink_weight']) &&
    (s['sink_weight'] as number) >= 0 &&
    (s['sink_weight'] as number) <= 1 &&
    isNum(s['stall_speed']) &&
    (s['stall_speed'] as number) > 0 &&
    isNum(s['stall_s']) &&
    (s['stall_s'] as number) > 0 &&
    isNum(s['shoulder_hike_frac']) &&
    (s['shoulder_hike_frac'] as number) > 0 &&
    isPositiveInt(s['hike_hold_frames']) &&
    isNum(s['start_motion_deg']) &&
    (s['start_motion_deg'] as number) >= 0 &&
    isNum(s['start_motion_dist']) &&
    (s['start_motion_dist'] as number) >= 0
  );
}

function isSmoothing(v: unknown): v is AppConfig['smoothing'] {
  if (!isPlainObject(v)) return false;
  return (
    isNum(v['hand_min_cutoff']) &&
    (v['hand_min_cutoff'] as number) > 0 &&
    isNum(v['hand_beta']) &&
    (v['hand_beta'] as number) >= 0 &&
    isNum(v['shoulder_alpha']) &&
    (v['shoulder_alpha'] as number) >= 0 &&
    (v['shoulder_alpha'] as number) <= 1
  );
}

function isFace(v: unknown): v is AppConfig['face'] {
  if (!isPlainObject(v)) return false;
  const smooth = (v as Json)['anchor_smooth'];
  return (
    isNum(v['reach_margin']) &&
    (v['reach_margin'] as number) >= 0 &&
    isNum(v['zone_min']) &&
    (v['zone_min'] as number) > 0 &&
    isNum(v['elbow_margin_deg']) &&
    (v['elbow_margin_deg'] as number) >= 0 &&
    isNum(v['default_touch_dist']) &&
    (v['default_touch_dist'] as number) > 0 &&
    isNum(v['default_elbow_deg']) &&
    isNum(smooth) &&
    (smooth as number) >= 0 &&
    (smooth as number) <= 1
  );
}

function isCoach(v: unknown): v is AppConfig['coach'] {
  if (!isPlainObject(v)) return false;
  const c: Json = v;
  return (
    isPositiveInt(c['timeout_ms']) &&
    isPositiveInt(c['cooldown_ms']) &&
    isPositiveInt(c['max_reply_chars']) &&
    isNum(c['summary_window_s']) &&
    (c['summary_window_s'] as number) > 0
  );
}

function isSetup(v: unknown): v is AppConfig['setup'] {
  if (!isPlainObject(v)) return false;
  const min = v['brightness_min'];
  const max = v['brightness_max'];
  const edge = v['edge_margin'];
  return (
    isPositiveInt(v['check_enter_frames']) &&
    isPositiveInt(v['check_exit_frames']) &&
    isNum(edge) &&
    (edge as number) >= 0 &&
    (edge as number) < 0.5 &&
    isNum(min) &&
    (min as number) >= 0 &&
    (min as number) <= 255 &&
    isNum(max) &&
    (max as number) >= 0 &&
    (max as number) <= 255 &&
    (min as number) <= (max as number) &&
    isNum(v['tilt_max_deg']) &&
    (v['tilt_max_deg'] as number) >= 0 &&
    isNum(v['facing_tol']) &&
    (v['facing_tol'] as number) >= 0 &&
    isNum(v['fps_window_s']) &&
    (v['fps_window_s'] as number) > 0 &&
    isNum(v['fps_min']) &&
    (v['fps_min'] as number) > 0
  );
}

function isMetrics(v: unknown): v is AppConfig['metrics'] {
  if (!isPlainObject(v)) return false;
  return (
    isNum(v['interval_s']) &&
    (v['interval_s'] as number) > 0 &&
    isNum(v['coverage_window_s']) &&
    (v['coverage_window_s'] as number) > 0 &&
    isNum(v['record_max_s']) &&
    (v['record_max_s'] as number) > 0 &&
    isNum(v['import_min_frames_per_s']) &&
    (v['import_min_frames_per_s'] as number) > 0
  );
}

function isUi(v: unknown): v is AppConfig['ui'] {
  if (!isPlainObject(v)) return false;
  return (
    isNum(v['readout_hz']) &&
    isNum(v['live_emit_hz']) &&
    typeof v['dev_controls'] === 'boolean'
  );
}

function isBaseline(v: unknown): v is AppConfig['baseline'] {
  return isPlainObject(v) && isNum(v['fixed_interval_s']);
}

function isReview(v: unknown): v is AppConfig['review'] {
  if (!isPlainObject(v)) return false;
  return isPositiveInt(v['note_max_chars']) && typeof v['blind_default'] === 'boolean';
}

export function isAppConfig(v: unknown): v is AppConfig {
  if (!isPlainObject(v)) return false;
  return (
    isGate(v['gate']) &&
    isStruggle(v['struggle']) &&
    isSmoothing(v['smoothing']) &&
    isFace(v['face']) &&
    isCoach(v['coach']) &&
    isMetrics(v['metrics']) &&
    isSetup(v['setup']) &&
    isBaseline(v['baseline']) &&
    isReview(v['review']) &&
    isUi(v['ui'])
  );
}

/** Nested objects merge key by key; anything else (numbers, arrays) is replaced. */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in base ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** Pure and testable: merge, then validate. Throws if the result is incomplete. */
export function buildConfig(defaultsJson: unknown, localJson: unknown = {}): AppConfig {
  const merged = deepMerge(defaultsJson, localJson);
  if (!isAppConfig(merged)) throw new Error('config is missing required threshold fields');
  return merged;
}

// Optional file: the glob returns nothing when config.local.json doesn't exist
// (public repo, fresh clone), so the build still works on defaults alone.
const localModules = import.meta.glob('./config.local.json', {
  eager: true,
  import: 'default',
});
const local: unknown = Object.values(localModules)[0] ?? {};

export const config: AppConfig = buildConfig(defaults, local);

/** Kept so existing callers don't change. No network fetch any more. */
export async function loadConfig(): Promise<AppConfig> {
  return config;
}
