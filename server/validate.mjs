/**
 * Validation for the coach-proxy request body. The body must be ONLY the
 * aggregate summary object — task name, per-angle min/max/mean, duration,
 * and System 1 state. Anything else is rejected, especially anything
 * image-like (base64 blobs, data: URIs, long strings). Error reasons never
 * include request values.
 */

/** Top-level fields the coach summary may carry. Consent text must describe each one. */
export const ALLOWED_SUMMARY_KEYS = ['angles', 'duration_s', 'held_s', 'reached', 'system1', 'task'];

const TOP_SIGNALS = ['stall', 'jitter', 'compensation', 'failed_range', 'drop'];
const STATES = ['moving_well', 'hesitating', 'struggling', 'cant_see_you'];
const MAX_STRING = 2000;
const BASE64_RUN = /[A-Za-z0-9+/=]{500,}/;

function fail(reason) {
  return { ok: false, error: reason };
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkString(s, max = MAX_STRING) {
  if (typeof s !== 'string' || s.length === 0 || s.length > max) return false;
  if (s.startsWith('data:')) return false;
  if (BASE64_RUN.test(s)) return false;
  return true;
}

function checkAngleEntry(name, entry) {
  if (!/^[a-z_]+$/.test(name)) return false;
  if (!isPlainObject(entry)) return false;
  const keys = Object.keys(entry).sort().join(',');
  if (keys !== 'max,mean,min') return false;
  for (const k of ['min', 'max', 'mean']) {
    if (typeof entry[k] !== 'number' || !Number.isFinite(entry[k])) return false;
  }
  return true;
}

export function validateCoachSummary(body) {
  if (!isPlainObject(body)) return fail('body must be an object');
  if (Object.keys(body).sort().join(',') !== 'angles,duration_s,held_s,reached,system1,task') {
    return fail('unexpected top-level fields');
  }
  if (!checkString(body.task, 200)) return fail('bad task');
  if (typeof body.duration_s !== 'number' || !Number.isFinite(body.duration_s) || body.duration_s < 0) {
    return fail('bad duration_s');
  }
  if (typeof body.reached !== 'boolean') return fail('bad reached');
  if (
    typeof body.held_s !== 'number' ||
    !Number.isFinite(body.held_s) ||
    body.held_s < 0 ||
    body.held_s > 600
  ) {
    return fail('bad held_s');
  }
  if (!isPlainObject(body.angles)) return fail('bad angles');
  for (const [name, entry] of Object.entries(body.angles)) {
    if (!checkAngleEntry(name, entry)) return fail('bad angles');
  }
  const system1 = body.system1;
  if (!isPlainObject(system1)) return fail('bad system1');
  const systemKeys = Object.keys(system1).sort().join(',');
  if (systemKeys !== 'state' && systemKeys !== 'state,top_signal') return fail('bad system1');
  if (!STATES.includes(system1.state)) return fail('bad system1');
  if ('top_signal' in system1 && !TOP_SIGNALS.includes(system1.top_signal)) return fail('bad system1');
  return { ok: true };
}
