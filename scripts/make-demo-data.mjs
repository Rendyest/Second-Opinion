/**
 * JUDGE DEMO DATA ONLY — synthetic clips for exercising the reviewer routes.
 * No real person data: every joint comes from a deterministic arm model
 * (straight-arm raises with a sine wobble), so output is reproducible.
 *
 * Usage: node scripts/make-demo-data.mjs [output-dir]
 * Defaults to scripts/clips/demo/ (gitignored, like all local clips).
 *
 * Writes recorder-format clips (source "synthetic", anonymous P-codes) plus
 * a review bundle wrapping the same movement. Nothing here may be reported
 * as validation: run scripts/make-results.mjs on the folder afterwards and
 * treat its figures as a pipeline smoke check only.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FPS = 24;
const DURATION_S = 6;
const HOLD = { start_s: 1.5, end_s: 5 };

// Arm geometry, in the same units as the joints below.
const SHOULDER = { x: 0.5, y: 0.4 };
const LEFT_SHOULDER = { x: 0.35, y: 0.4 };
const UPPER_ARM = 0.15;
const FOREARM = 0.14;
const SHOULDER_WIDTH = 0.15;

const FACE_JOINTS = {
  nose: { x: 0.5, y: 0.28 },
  l_eye: { x: 0.46, y: 0.24 },
  r_eye: { x: 0.54, y: 0.24 },
  mouth_l: { x: 0.47, y: 0.32 },
  mouth_r: { x: 0.53, y: 0.32 },
  l_ear: { x: 0.4, y: 0.28 },
  r_ear: { x: 0.6, y: 0.28 },
};

const FACE = {
  offsets: {
    nose: { x: 0, y: -1 },
    l_eye: { x: -0.2, y: -1.2 },
    r_eye: { x: 0.2, y: -1.2 },
  },
  touchDist: 0.2,
  touchElbowDeg: 70,
};

const BASELINE = { upperArm: UPPER_ARM, forearm: FOREARM, shoulderWidth: SHOULDER_WIDTH };

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

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

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function elevationAt(t, target) {
  const rest = 10;
  if (t < 0.5) return rest;
  if (t < 1.5) return rest + (target - rest) * smoothstep(0.5, 1.5, t);
  if (t <= HOLD.end_s) return target + 3 * Math.sin(2 * Math.PI * 0.5 * t);
  const eHoldEnd = target + 3 * Math.sin(2 * Math.PI * 0.5 * HOLD.end_s);
  return eHoldEnd * (1 - smoothstep(HOLD.end_s, DURATION_S, t)) + rest * smoothstep(HOLD.end_s, DURATION_S, t);
}

function joint(x, y, conf = 0.9) {
  return { x: round4(x), y: round4(y), conf };
}

function frameJoints(t, targetDeg) {
  const e = (elevationAt(t, targetDeg) * Math.PI) / 180;
  const bend = ((1.5 * Math.sin((2 * Math.PI * t) / 4 + 1)) * Math.PI) / 180;
  const ux = Math.sin(e);
  const uy = Math.cos(e);
  const ex = SHOULDER.x + UPPER_ARM * ux;
  const ey = SHOULDER.y + UPPER_ARM * uy;
  // Wrist direction: the upper-arm direction rotated by the small bend, so
  // elbow flexion stays near 180 (straight arm with a touch of wobble).
  const c = Math.cos(bend);
  const s = Math.sin(bend);
  const vx = ux * c - uy * s;
  const vy = ux * s + uy * c;
  const wx = ex + FOREARM * vx;
  const wy = ey + FOREARM * vy;
  return {
    r_shoulder: joint(SHOULDER.x, SHOULDER.y),
    l_shoulder: joint(LEFT_SHOULDER.x, LEFT_SHOULDER.y),
    r_elbow: joint(ex, ey),
    r_wrist: joint(wx, wy),
    r_index: joint(wx + 0.02 * vx, wy + 0.02 * vy),
    nose: joint(FACE_JOINTS.nose.x, FACE_JOINTS.nose.y),
    l_eye: joint(FACE_JOINTS.l_eye.x, FACE_JOINTS.l_eye.y),
    r_eye: joint(FACE_JOINTS.r_eye.x, FACE_JOINTS.r_eye.y),
    mouth_l: joint(FACE_JOINTS.mouth_l.x, FACE_JOINTS.mouth_l.y),
    mouth_r: joint(FACE_JOINTS.mouth_r.x, FACE_JOINTS.mouth_r.y),
    l_ear: joint(FACE_JOINTS.l_ear.x, FACE_JOINTS.l_ear.y),
    r_ear: joint(FACE_JOINTS.r_ear.x, FACE_JOINTS.r_ear.y),
  };
}

function anglesFor(joints) {
  const flex = angleAtVertex(joints.r_shoulder, joints.r_elbow, joints.r_wrist);
  const elev = angleAtVertex(joints.r_elbow, joints.r_shoulder, {
    x: joints.r_shoulder.x,
    y: joints.r_shoulder.y + 1,
  });
  return {
    r_elbow_flexion: { deg: flex, conf: 0.9 },
    r_shoulder_elevation: { deg: elev, conf: 0.9 },
  };
}

function buildClipDef({ file, clipId, name, view, targetDeg, muse }) {
  const times = [];
  for (let i = 0; i < FPS * DURATION_S; i += 1) times.push(round4(i / FPS));
  const frames = times.map((t) => ({ t, joints: frameJoints(t, targetDeg) }));
  const recorder = {
    version: 1,
    source: 'synthetic',
    name,
    fps: FPS,
    frames,
    baseline: { ...BASELINE },
    face: { offsets: { ...FACE.offsets }, touchDist: FACE.touchDist, touchElbowDeg: FACE.touchElbowDeg },
    config_used: {},
    view,
    target_shoulder_deg: targetDeg,
    hold: { ...HOLD },
    consent: { recording: true },
  };
  const bundleClip = {
    clip_id: clipId,
    fps: FPS,
    frames: frames.map((f) => ({
      t: f.t,
      fps: FPS,
      joints: f.joints,
      angles: anglesFor(f.joints),
      gate: { ok: true, reasons: [] },
    })),
    baseline: { ...BASELINE },
    face: { offsets: { ...FACE.offsets }, touchDist: FACE.touchDist, touchElbowDeg: FACE.touchElbowDeg },
    consent: { recording: true },
  };
  if (muse) bundleClip.muse = muse;
  return { file, recorder, bundleClip };
}

function main() {
  const outDir = resolve(process.argv[2] ?? join('scripts', 'clips', 'demo'));
  mkdirSync(outDir, { recursive: true });

  const defs = [
    buildClipDef({
      file: 'demo-front-90.json',
      clipId: 'demo-front-90',
      name: 'P01',
      view: 'front',
      targetDeg: 90,
      muse: {
        struggling: true,
        severity: 'mild',
        error_types: ['timing'],
        reason: 'Demo label: reach slightly slow.',
      },
    }),
    buildClipDef({ file: 'demo-side-90.json', clipId: 'demo-side-90', name: 'P02', view: 'side', targetDeg: 90 }),
    buildClipDef({ file: 'demo-front-45.json', clipId: 'demo-front-45', name: 'P03', view: 'front', targetDeg: 45 }),
  ];

  for (const d of defs) {
    writeFileSync(join(outDir, d.file), `${JSON.stringify(d.recorder, null, 2)}\n`);
  }
  writeFileSync(
    join(outDir, 'review-bundle.json'),
    `${JSON.stringify({ version: 1, source: 'synthetic', clips: defs.map((d) => d.bundleClip) }, null, 2)}\n`,
  );

  console.log(`Wrote judge demo data to ${outDir}:`);
  for (const d of defs) console.log(`  ${d.file}`);
  console.log('  review-bundle.json');
  console.log('Judges:');
  console.log('  1. /metrics -> Replay -> Choose a clip file -> any demo-*.json');
  console.log('  2. /review -> Choose a review bundle file -> review-bundle.json');
  console.log(`  3. node scripts/make-results.mjs ${outDir}   (writes results/results.json for /validation)`);
  console.log('SYNTHETIC DEMO DATA ONLY — never use its figures for reported results.');
}

main();
