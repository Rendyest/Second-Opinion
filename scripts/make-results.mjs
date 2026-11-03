/**
 * TEST/RUN TOOLING — not app code, never imported by the page.
 * Reads recorded clip JSON files from a folder, scores them against the
 * labels stored inside each clip, and writes aggregates-only
 * results/results.json for /validation.
 *
 * Usage: node scripts/make-results.mjs <clips-folder>
 *
 * Method (mirrors src/pose/angles.ts and src/pose/gate.ts exactly, including
 * the 1-decimal angle rounding and the EPS boundary rule, so the figures
 * describe the real pipeline):
 * - clip time only (frame.t * 1000); never Date.now()
 * - thresholds read from src/config/config.default.json (committed
 *   placeholders); a local config.local.json is NOT picked up
 * - only frames inside the clip's hold window enter an error list
 * - frames outside the hold window count as outside-hold
 * - clips with any missing label (name, view, target, hold) count all
 *   their frames as unlabelled, never as zero error
 * - clips without consent.recording === true are skipped and reported
 * - frames whose measured angle is not finite (degenerate joints) are
 *   skipped and reported; n counts cover measurable frames only
 *
 * REMINDER: figures computed from synthetic or test bundles must never be
 * reported as validation.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const EPS = 1e-9;
const GATE_JOINTS = ['r_shoulder', 'r_elbow', 'r_wrist'];
const SCALE_JOINT = 'l_shoulder';

function round1(v) {
  return Math.round(v * 10) / 10;
}

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Interior angle at vertex b in degrees, rounded to 1 decimal. NaN when degenerate. */
function angleAtVertex(a, b, c) {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const nu = Math.hypot(ux, uy);
  const nv = Math.hypot(vx, vy);
  if (nu < 1e-9 || nv < 1e-9) return NaN;
  const cos = Math.min(1, Math.max(-1, (ux * vx + uy * vy) / (nu * nv)));
  return round1((Math.acos(cos) * 180) / Math.PI);
}

function shoulderElevation(shoulder, elbow) {
  return angleAtVertex(elbow, shoulder, { x: shoulder.x, y: shoulder.y + 1 });
}

function elbowFlexion(shoulder, elbow, wrist) {
  return angleAtVertex(shoulder, elbow, wrist);
}

function boneLengths(joints) {
  const rs = joints['r_shoulder'];
  const re = joints['r_elbow'];
  const rw = joints['r_wrist'];
  const ls = joints['l_shoulder'];
  if (!rs || !re || !rw || !ls) return null;
  const upperArm = dist(rs, re);
  const forearm = dist(re, rw);
  const shoulderWidth = dist(ls, rs);
  if (!(upperArm > 0) || !(forearm > 0) || !(shoulderWidth > 0)) return null;
  return { upperArm, forearm, shoulderWidth };
}

function measureFrame(joints, baseline) {
  const current = boneLengths(joints);
  if (!current) return null;
  const out = {
    upperArmNorm: current.upperArm / current.shoulderWidth,
    forearmNorm: current.forearm / current.shoulderWidth,
  };
  if (baseline && baseline.shoulderWidth > 0) {
    const scale = current.shoulderWidth / baseline.shoulderWidth;
    out.scale = scale;
    if (baseline.upperArm > 0) out.upperArmRatio = current.upperArm / (scale * baseline.upperArm);
    if (baseline.forearm > 0) out.forearmRatio = current.forearm / (scale * baseline.forearm);
  }
  return out;
}

function trim(values, cap) {
  return values.length > cap ? values.slice(values.length - cap) : values;
}

/** Mirrors checkGate + the createGateTracker history update. Mutates hist. */
function gatePush(joints, baseline, t, hist) {
  const reasons = [];
  let lowVisibility = false;
  for (const name of [...GATE_JOINTS, SCALE_JOINT]) {
    const joint = joints[name];
    if (!joint || !(joint.conf >= t.vis_min)) {
      lowVisibility = true;
      break;
    }
  }
  if (lowVisibility) reasons.push('low_visibility');

  const leftShoulder = joints[SCALE_JOINT];
  const shouldersOk = !!leftShoulder && leftShoulder.conf >= t.vis_min;
  const meas = shouldersOk ? measureFrame(joints, baseline) : null;
  if (meas) {
    const ratios = [meas.upperArmRatio, meas.forearmRatio];
    const windows = [hist.upperArmRatios, hist.forearmRatios];
    let short = false;
    for (let i = 0; i < ratios.length; i++) {
      const ratio = ratios[i];
      if (ratio === undefined) continue;
      const smoothed = median([...windows[i].slice(-t.smooth_frames), ratio].slice(-t.smooth_frames));
      if (smoothed !== null && t.foreshortening_min - smoothed > EPS) short = true;
    }
    if (short) reasons.push('foreshortening');
    const norms = [meas.upperArmNorm, meas.forearmNorm];
    const histories = [hist.upperArmNorms, hist.forearmNorms];
    let drift = false;
    for (let i = 0; i < norms.length; i++) {
      const now = norms[i];
      if (now === undefined || histories[i].length < 3) continue;
      const ref = median(histories[i]);
      if (ref !== null && ref > 0 && Math.abs(now - ref) / ref - t.bone_length_tol > EPS) drift = true;
    }
    if (drift) reasons.push('bone_length_drift');
  }

  if (!reasons.includes('low_visibility')) {
    const update = measureFrame(joints, baseline);
    if (update) {
      if (update.upperArmRatio !== undefined) {
        hist.upperArmRatios = trim([...hist.upperArmRatios, update.upperArmRatio], t.smooth_frames);
      }
      if (update.forearmRatio !== undefined) {
        hist.forearmRatios = trim([...hist.forearmRatios, update.forearmRatio], t.smooth_frames);
      }
      if (update.upperArmNorm !== undefined) {
        hist.upperArmNorms = trim([...hist.upperArmNorms, update.upperArmNorm], t.history_frames);
      }
      if (update.forearmNorm !== undefined) {
        hist.forearmNorms = trim([...hist.forearmNorms, update.forearmNorm], t.history_frames);
      }
    }
  }
  return { ok: reasons.length === 0, reasons };
}

function emptyHistories() {
  return { upperArmRatios: [], forearmRatios: [], upperArmNorms: [], forearmNorms: [] };
}

/** Mean of absolute errors. Non-empty input. */
export function computeMae(errors) {
  return errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length;
}

/** Mean of signed errors (measured - target). Non-empty input. */
export function computeBias(errors) {
  return errors.reduce((a, b) => a + b, 0) / errors.length;
}

function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validHold(hold) {
  return (
    hold !== null &&
    typeof hold === 'object' &&
    isFiniteNum(hold.start_s) &&
    isFiniteNum(hold.end_s) &&
    hold.start_s >= 0 &&
    hold.end_s > hold.start_s
  );
}

function validBaseline(baseline) {
  if (baseline === null) return true;
  if (baseline === null || typeof baseline !== 'object') return false;
  return (
    isFiniteNum(baseline.upperArm) && isFiniteNum(baseline.forearm) && isFiniteNum(baseline.shoulderWidth)
  );
}

function main() {
  const folder = process.argv[2];
  if (!folder) {
    console.error('Usage: node scripts/make-results.mjs <clips-folder>');
    process.exit(1);
  }
  const configPath = new URL('../src/config/config.default.json', import.meta.url);
  const gate = JSON.parse(readFileSync(configPath, 'utf-8')).gate;

  const files = readdirSync(resolve(folder)).filter((f) => f.endsWith('.json'));
  const shoulder = new Map(); // `${view}@${target}` -> { gated: [], all: [] }
  const elbow = { gated: [], all: [] };
  const names = new Set();
  let nClips = 0;
  let nInHold = 0;
  let nOutsideHold = 0;
  let nUnlabelled = 0;
  let gateFlagged = 0;
  let gateTotal = 0;
  let skippedNoConsent = 0;
  let skippedUnmeasurable = 0;

  for (const file of files) {
    let clip;
    try {
      clip = JSON.parse(readFileSync(join(resolve(folder), file), 'utf-8'));
    } catch {
      console.log(`skip ${file}: not valid JSON`);
      continue;
    }
    if (!clip || clip.version !== 1 || !Array.isArray(clip.frames)) {
      console.log(`skip ${file}: not a clip file`);
      continue;
    }
    if (!clip.consent || clip.consent.recording !== true) {
      skippedNoConsent += 1;
      console.log(`skip ${file}: no recorded consent`);
      continue;
    }
    if (!validBaseline(clip.baseline)) {
      console.log(`skip ${file}: malformed baseline`);
      continue;
    }
    const labelled =
      typeof clip.name === 'string' &&
      clip.name.length > 0 &&
      (clip.view === 'front' || clip.view === 'side') &&
      isFiniteNum(clip.target_shoulder_deg) &&
      clip.target_shoulder_deg >= 0 &&
      clip.target_shoulder_deg <= 180 &&
      validHold(clip.hold);
    if (typeof clip.name === 'string' && clip.name.length > 0) names.add(clip.name);
    if (!labelled) {
      nUnlabelled += clip.frames.length;
      console.log(`unlabelled ${file}: frames counted as unlabelled, never as zero error`);
      continue;
    }
    nClips += 1;
    const hist = emptyHistories();
    const key = `${clip.view}@${clip.target_shoulder_deg}`;
    if (!shoulder.has(key)) shoulder.set(key, { gated: [], all: [] });
    const bucket = shoulder.get(key);
    for (const frame of clip.frames) {
      if (!frame || !isFiniteNum(frame.t) || !frame.joints || typeof frame.joints !== 'object') continue;
      const rs = frame.joints['r_shoulder'];
      const re = frame.joints['r_elbow'];
      const rw = frame.joints['r_wrist'];
      if (!rs || !re || !rw) {
        skippedUnmeasurable += 1;
        continue;
      }
      const shoulderDeg = shoulderElevation(rs, re);
      const elbowDeg = elbowFlexion(rs, re, rw);
      if (!Number.isFinite(shoulderDeg) || !Number.isFinite(elbowDeg)) {
        skippedUnmeasurable += 1;
        continue;
      }
      const result = gatePush(frame.joints, clip.baseline, gate, hist);
      const inHold = frame.t >= clip.hold.start_s && frame.t <= clip.hold.end_s;
      if (!inHold) {
        nOutsideHold += 1;
        continue;
      }
      nInHold += 1;
      gateTotal += 1;
      if (!result.ok) gateFlagged += 1;
      const shoulderErr = shoulderDeg - clip.target_shoulder_deg;
      bucket.all.push(shoulderErr);
      if (result.ok) bucket.gated.push(shoulderErr);
      if (clip.view === 'front') {
        const elbowErr = elbowDeg - 180;
        elbow.all.push(elbowErr);
        if (result.ok) elbow.gated.push(elbowErr);
      }
    }
  }

  const shoulderRows = [...shoulder.entries()]
    .map(([key, bucket]) => {
      const at = key.indexOf('@');
      return {
        view: key.slice(0, at),
        target_deg: Number(key.slice(at + 1)),
        n_gated_ok: bucket.gated.length,
        mae_deg_gated_ok: bucket.gated.length > 0 ? round4(computeMae(bucket.gated)) : null,
        bias_deg_gated_ok: bucket.gated.length > 0 ? round4(computeBias(bucket.gated)) : null,
        n_all: bucket.all.length,
        mae_deg_all: bucket.all.length > 0 ? round4(computeMae(bucket.all)) : null,
        bias_deg_all: bucket.all.length > 0 ? round4(computeBias(bucket.all)) : null,
      };
    })
    .sort((a, b) => (a.view < b.view ? -1 : a.view > b.view ? 1 : a.target_deg - b.target_deg));

  const results = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    reference: 'Posed target angle (nominal)',
    thresholds_tuned_on_reported_clips: false,
    recordedSet: {
      n_clips: nClips,
      n_participants: names.size,
      n_frames_in_hold: nInHold,
      n_frames_outside_hold: nOutsideHold,
      n_unlabelled_frames: nUnlabelled,
    },
    shoulder: shoulderRows,
    elbow: {
      target_deg: 180,
      label: 'straight arm only',
      n_gated_ok: elbow.gated.length,
      mae_deg_gated_ok: elbow.gated.length > 0 ? round4(computeMae(elbow.gated)) : null,
      bias_deg_gated_ok: elbow.gated.length > 0 ? round4(computeBias(elbow.gated)) : null,
      n_all: elbow.all.length,
      mae_deg_all: elbow.all.length > 0 ? round4(computeMae(elbow.all)) : null,
      bias_deg_all: elbow.all.length > 0 ? round4(computeBias(elbow.all)) : null,
    },
    gate: { flagged: gateFlagged, total: gateTotal },
  };

  mkdirSync('results', { recursive: true });
  writeFileSync(join('results', 'results.json'), `${JSON.stringify(results, null, 2)}\n`);

  console.log(`clips: ${nClips}, participants: ${names.size}, in-hold: ${nInHold}`);
  for (const row of shoulderRows) {
    console.log(
      `${row.view} @ ${row.target_deg}: n_all=${row.n_all} mae_all=${row.mae_deg_all} n_gated=${row.n_gated_ok} mae_gated=${row.mae_deg_gated_ok}`,
    );
  }
  console.log(`skipped (no consent): ${skippedNoConsent}, skipped (unmeasurable): ${skippedUnmeasurable}`);
  console.log('REMINDER: figures from synthetic or test bundles must never be reported as validation.');
  console.log('If thresholds were tuned on these clips, set thresholds_tuned_on_reported_clips truthfully.');
}

// Importable for unit tests (computeMae/computeBias); the folder run only
// happens when the file is executed directly.
const invokedAsScript =
  typeof process.argv[1] === 'string' && /make-results\.mjs$/.test(process.argv[1]);
if (invokedAsScript) main();
