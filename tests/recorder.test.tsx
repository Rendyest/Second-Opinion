import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RecordedClip } from '../src/contracts';
import { isRecordedClip } from '../src/contracts';
import { buildClip } from '../src/pipeline/clip';
import { ClipRecorder } from '../src/components/ClipRecorder';

const BASELINE = { upperArm: 0.1, forearm: 0.2, shoulderWidth: 0.2 };
const FACE = {
  offsets: { nose: { x: 0, y: -1 }, l_ear: { x: -0.5, y: -1.1 } },
  touchDist: 0.2,
  touchElbowDeg: 70,
};

function goodClip(): RecordedClip {
  return buildClip({
    name: 'P1',
    fps: 24,
    samples: [
      { t: 0, joints: { r_shoulder: { x: 0.60016, y: 0.5, conf: 0.91236 } } },
      { t: 0.041666, joints: { r_shoulder: { x: 0.6, y: 0.5, conf: 0.9 } } },
    ],
    baseline: BASELINE,
    face: FACE,
    thresholds: { gate: { vis_min: 0.5 } },
    labels: [{ start_s: 0, end_s: 0.04 }],
    source: 'recorded',
  });
}

describe('recorded clips', () => {
  it('produces only the allowed fields with numbers rounded to 4 decimals', () => {
    const clip = goodClip();
    expect(Object.keys(clip).sort()).toEqual(
      ['baseline', 'config_used', 'consent', 'face', 'fps', 'frames', 'labels', 'name', 'source', 'version'].sort(),
    );
    expect(clip.frames[0].joints['r_shoulder']).toEqual({ x: 0.6002, y: 0.5, conf: 0.9124 });
    expect(clip.frames[0].t).toBe(0);
    expect(isRecordedClip(clip)).toBe(true);
  });

  it('rejects unknown fields and image-like values', () => {
    const clip = goodClip();
    expect(isRecordedClip({ ...clip, extra: 1 })).toBe(false);
    expect(
      isRecordedClip({ ...clip, config_used: { note: `data:image/png;base64,${'A'.repeat(300)}` } }),
    ).toBe(false);
    expect(isRecordedClip({ ...clip, config_used: { blob: 'A'.repeat(300) } })).toBe(false);
    expect(isRecordedClip({ ...clip, frames: [{ t: 0, joints: {}, junk: 1 }] })).toBe(false);
    expect(isRecordedClip({ ...clip, version: 2 })).toBe(false);
  });

  it('exports through Download only: Blob, no storage, no network', () => {
    const src = readFileSync(new URL('../src/components/ClipRecorder.tsx', import.meta.url), 'utf-8');
    expect(src).toContain('URL.createObjectURL');
    expect(src).toContain('Blob');
    for (const banned of ['localStorage', 'sessionStorage', 'fetch(', 'WebSocket', 'XMLHttpRequest', 'sendBeacon', 'coach']) {
      expect(src, `recorder must not touch ${banned}`).not.toContain(banned);
    }
  });

  it('renders nothing when dev controls are off', () => {
    expect(renderToStaticMarkup(<ClipRecorder enabled={false} />)).toBe('');
  });
});
