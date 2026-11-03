import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { isRecordedClip, type RecordedClip } from '../src/contracts';
import { buildClip } from '../src/pipeline/clip';
import {
  applyMirror,
  lowFrameWarning,
  mediaTimeToClipT,
  validateImportMeta,
  type ImportMeta,
} from '../src/importer/videoImport';
import { VideoImport } from '../src/components/VideoImport';

const BASELINE = { upperArm: 0.1, forearm: 0.2, shoulderWidth: 0.2 };
const FACE = {
  offsets: { nose: { x: 0, y: -1 }, l_ear: { x: -0.5, y: -1.1 } },
  touchDist: 0.2,
  touchElbowDeg: 70,
};

function goodMeta(over: Partial<ImportMeta> = {}): ImportMeta {
  return {
    consentRecording: true,
    participantId: 'P1',
    view: 'front',
    targetShoulderDeg: 90,
    holdStartS: 1,
    holdEndS: 3,
    ...over,
  };
}

function goodClip(): RecordedClip {
  return buildClip({
    name: 'P1',
    fps: 24,
    samples: [
      { t: 0, joints: { r_shoulder: { x: 0.6, y: 0.5, conf: 0.9 } } },
      { t: 0.1, joints: { r_shoulder: { x: 0.6, y: 0.5, conf: 0.9 } } },
    ],
    baseline: BASELINE,
    face: FACE,
    thresholds: { gate: { vis_min: 0.5 } },
    labels: [],
    source: 'imported_video',
    imported: {
      view: 'front',
      targetShoulderDeg: 90,
      hold: { start_s: 1, end_s: 3 },
      video: { durationS: 4, frames: 2, fps: 30 },
    },
  });
}

describe('video import media times', () => {
  it('maps media times 0.0, 0.1, 0.2 s to t = 0, 0.1, 0.2 (0, 100, 200 ms), never Date.now()', () => {
    expect(mediaTimeToClipT(0.0)).toBe(0);
    expect(mediaTimeToClipT(0.1)).toBe(0.1);
    expect(mediaTimeToClipT(0.2)).toBe(0.2);
    const src = readFileSync(new URL('../src/components/VideoImport.tsx', import.meta.url), 'utf-8');
    expect(src).not.toContain('Date.now()');
  });

  it('flips x when mirroring and leaves y and conf alone', () => {
    const joints = { r_shoulder: { x: 0.2, y: 0.5, conf: 0.9 } };
    expect(applyMirror(joints, true)['r_shoulder']).toEqual({ x: 0.8, y: 0.5, conf: 0.9 });
    expect(applyMirror(joints, false)).toBe(joints);
  });
});

describe('video import gating', () => {
  it('accepts a complete, in-range meta', () => {
    expect(validateImportMeta(goodMeta(), 4)).toBeNull();
  });

  it('rejects a missing field each in turn', () => {
    expect(validateImportMeta(goodMeta({ consentRecording: false }), 4)).not.toBeNull();
    expect(validateImportMeta(goodMeta({ participantId: '  ' }), 4)).not.toBeNull();
    expect(validateImportMeta(goodMeta({ view: 'top' }), 4)).not.toBeNull();
    expect(validateImportMeta(goodMeta({ targetShoulderDeg: Number.NaN }), 4)).not.toBeNull();
    expect(validateImportMeta(goodMeta({ targetShoulderDeg: 181 }), 4)).not.toBeNull();
    expect(validateImportMeta(goodMeta({ holdStartS: Number.NaN, holdEndS: 3 }), 4)).not.toBeNull();
  });

  it('rejects hold_end_s at or before hold_start_s', () => {
    expect(validateImportMeta(goodMeta({ holdStartS: 2, holdEndS: 2 }), 4)).not.toBeNull();
    expect(validateImportMeta(goodMeta({ holdStartS: 3, holdEndS: 2 }), 4)).not.toBeNull();
  });

  it('rejects a hold past the end of the video', () => {
    expect(validateImportMeta(goodMeta({ holdEndS: 5 }), 4)).not.toBeNull();
    expect(validateImportMeta(goodMeta(), null)).not.toBeNull();
  });
});

describe('video import clip file', () => {
  it('builds a valid imported_video clip with the required fields inside', () => {
    const clip = goodClip();
    expect(isRecordedClip(clip)).toBe(true);
    expect(clip.source).toBe('imported_video');
    expect(clip.view).toBe('front');
    expect(clip.target_shoulder_deg).toBe(90);
    expect(clip.hold).toEqual({ start_s: 1, end_s: 3 });
    expect(clip.video).toEqual({ duration_s: 4, frames: 2, fps: 30 });
  });

  it('a live recording without the new keys is byte-identical to before', () => {
    const clip = buildClip({
      name: 'P1',
      fps: 24,
      samples: [{ t: 0, joints: { r_shoulder: { x: 0.6, y: 0.5, conf: 0.9 } } }],
      baseline: BASELINE,
      face: FACE,
      thresholds: {},
      labels: [],
      source: 'recorded',
    });
    expect('view' in clip).toBe(false);
    expect('hold' in clip).toBe(false);
    expect('video' in clip).toBe(false);
    expect('target_shoulder_deg' in clip).toBe(false);
    expect(isRecordedClip(clip)).toBe(true);
  });

  it('still rejects unknown fields, bad views, targets, holds and video info', () => {
    const clip = goodClip();
    expect(isRecordedClip({ ...clip, extra: 1 })).toBe(false);
    expect(isRecordedClip({ ...clip, view: 'top' })).toBe(false);
    expect(isRecordedClip({ ...clip, target_shoulder_deg: 181 })).toBe(false);
    expect(isRecordedClip({ ...clip, hold: { start_s: 3, end_s: 2 } })).toBe(false);
    expect(isRecordedClip({ ...clip, video: { duration_s: 4, frames: 2, fps: -1 } })).toBe(false);
    expect(isRecordedClip({ ...clip, source: 'dvd' })).toBe(false);
  });
});

describe('video import low-picture warning', () => {
  it('warns far below duration x frame rate, not at the floor', () => {
    expect(lowFrameWarning(10, 2, 15)).toBe(true);
    expect(lowFrameWarning(30, 2, 15)).toBe(false);
    expect(lowFrameWarning(29, 2, 15)).toBe(true);
  });
});

describe('video import component', () => {
  it('renders the required fields with no network or storage side effects', () => {
    const html = renderToStaticMarkup(<VideoImport />);
    for (const label of [
      'Choose a video file',
      'Target shoulder angle',
      'Camera view',
      'Hold start',
      'Hold end',
      'Mirror the picture',
      'Import video',
    ]) {
      expect(html).toContain(label);
    }
    const src = readFileSync(new URL('../src/components/VideoImport.tsx', import.meta.url), 'utf-8');
    for (const banned of [
      'fetch(',
      'XMLHttpRequest',
      'sendBeacon',
      'localStorage',
      'sessionStorage',
      'Date.now()',
      'performance.now()',
    ]) {
      expect(src, `importer must not touch ${banned}`).not.toContain(banned);
    }
  });
});
