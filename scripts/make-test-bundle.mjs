/**
 * TEST DATA ONLY — synthetic review-bundle generator for the /review loader.
 *
 * These clips must NEVER be used for reported results. They exercise the
 * bundle validator (consent rejection, duplicate/unknown fields) and the
 * review UI only.
 *
 * Usage: `node scripts/make-test-bundle.mjs [output-path]`
 * Defaults to a path OUTSIDE the repo (Desktop) so it can't be committed.
 *
 * Shapes follow src/contracts.ts exactly (ReviewBundle / ReviewClip /
 * PoseFrame): bundle keys are only version/source/clips, review clips carry
 * clip_id (no `name` — the schema rejects unknown fields, and the loader
 * drops a recorder clip's name via reviewClipFromRecorded), and each clip
 * embeds baseline + face but no config (review clips have no config_used).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const FPS = 24;

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

function joint(x, y, conf = 0.9) {
  return { x: round4(x), y: round4(y), conf: round4(conf) };
}

/** Plausible synthetic arm sweep: elbow bends, hand rises toward the face. */
function makeFrames(count) {
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    const k = count === 1 ? 1 : i / (count - 1);
    const t = round4(i / FPS);
    const joints = {
      r_shoulder: joint(0.5, 0.4),
      r_elbow: joint(0.55 - 0.05 * k, 0.55 - 0.2 * k),
      r_wrist: joint(0.5 + 0.02 * k, 0.7 - 0.34 * k),
      l_shoulder: joint(0.4, 0.4),
      nose: joint(0.5, 0.3),
      l_eye: joint(0.46, 0.26),
      r_eye: joint(0.54, 0.26),
    };
    frames.push({
      t,
      fps: FPS,
      joints,
      angles: {
        r_elbow_flexion: { deg: round4(150 - 80 * k), conf: 0.9 },
        r_shoulder_elevation: { deg: round4(20 + 40 * k), conf: 0.9 },
      },
      gate: { ok: true, reasons: [] },
    });
  }
  return frames;
}

const BASELINE = { upperArm: 100, forearm: 100, shoulderWidth: 100 };

const FACE = {
  offsets: {
    nose: { x: 0, y: -0.5 },
    l_eye: { x: -0.2, y: -0.7 },
    r_eye: { x: 0.2, y: -0.7 },
  },
  touchDist: 0.2,
  touchElbowDeg: 70,
};

function baseClip(clip_id, frames) {
  return {
    clip_id,
    fps: FPS,
    frames,
    baseline: { ...BASELINE },
    face: { offsets: { ...FACE.offsets }, touchDist: FACE.touchDist, touchElbowDeg: FACE.touchElbowDeg },
    consent: { recording: true },
  };
}

function buildBundle() {
  // 1. Valid, consent true, no Muse label. No `name` field exists on review
  // clips by design — the "SECRET-NAME" check applies to the single-recorder
  // path, where reviewClipFromRecorded drops the recorder's name.
  const clip1 = baseClip('test-clip-01-nomuse', makeFrames(48));

  // 2. Valid, consent true, WITH a Muse label.
  const clip2 = {
    ...baseClip('test-clip-02-muse', makeFrames(48)),
    muse: {
      struggling: true,
      severity: 'moderate',
      error_types: ['timing'],
      reason: 'Synthetic test label: slow to reach the face.',
    },
  };

  // 3. consent.recording false — loader rejects the whole file with the
  // "no recorded consent" message.
  const clip3 = { ...baseClip('test-clip-03-noconsent', makeFrames(48)), consent: { recording: false } };

  // 4. consent missing — loader rejects the whole file ("not a valid
  // review clip").
  const clip4 = baseClip('test-clip-04-missing-consent', makeFrames(48));
  delete clip4.consent;

  // 5. Consent true but a single frame — loads, but a reviewer would mark it
  // "Unusable clip". (An empty frames array would be rejected at load, so the
  // too-short case is the loadable one.)
  const clip5 = baseClip('test-clip-05-short', makeFrames(1));

  return { version: 1, source: 'synthetic', clips: [clip1, clip2, clip3, clip4, clip5] };
}

function main() {
  const fallback = join(homedir(), 'Desktop', 'review-test-bundle.json');
  const outPath = resolve(process.argv[2] ?? fallback);
  const bundle = buildBundle();

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(bundle, null, 2)}\n`);

  // Companion file with only the loadable clips, for actually exercising
  // the review UI (the full bundle is rejected as a whole while clips 3/4
  // are present — that rejection is the expected loader behaviour).
  const dot = outPath.lastIndexOf('.');
  const validPath = dot > 0 ? `${outPath.slice(0, dot)}-valid-only${outPath.slice(dot)}` : `${outPath}-valid-only`;
  const validOnly = { version: 1, source: 'synthetic', clips: [bundle.clips[0], bundle.clips[1], bundle.clips[4]] };
  writeFileSync(validPath, `${JSON.stringify(validOnly, null, 2)}\n`);

  console.log(`Wrote test bundle (5 clips): ${outPath}`);
  console.log(`Wrote loadable subset (clips 1, 2, 5): ${validPath}`);
  console.log('REMINDER: synthetic test data only — never use these clips for reported results.');
  console.log('Expected loader behaviour: the 5-clip file is rejected as a whole');
  console.log('(clip 3: no recorded consent; clip 4: not a valid review clip).');
}

main();
