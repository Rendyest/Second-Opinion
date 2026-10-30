import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { attachScriptLabels, parseScriptLabels, scriptLabelToMuse } from '../src/review/labelImport';
import type { ReviewClip } from '../src/contracts';
import { ReviewCard } from '../src/components/ReviewCard';

function clip(id: string, withMuse: boolean): ReviewClip {
  return {
    clip_id: id,
    fps: 24,
    frames: [
      {
        t: 0,
        fps: 24,
        joints: { r_shoulder: { x: 0.5, y: 0.4, conf: 0.9 } },
        angles: { r_elbow_flexion: { deg: 90, conf: 0.9 }, r_shoulder_elevation: { deg: 45, conf: 0.9 } },
        gate: { ok: true, reasons: [] },
      },
    ],
    baseline: null,
    face: null,
    consent: { recording: true },
    ...(withMuse
      ? { muse: { struggling: true, severity: 'moderate' as const, error_types: ['timing'], reason: 'Slow.' } }
      : {}),
  };
}

function scriptLabel(over: Record<string, unknown> = {}) {
  return {
    clip_id: 'clip-aaaa',
    struggling: true,
    signal: 'stall',
    reason: 'Slow to reach.',
    needs_review: false,
    ...over,
  };
}

describe('script label parsing', () => {
  it('accepts one object or an array', () => {
    expect(parseScriptLabels(scriptLabel())).toHaveLength(1);
    expect(parseScriptLabels([scriptLabel(), scriptLabel({ clip_id: 'clip-bbbb' })])).toHaveLength(2);
  });

  it('rejects corrupt files, null struggling and unknown signals', () => {
    expect(() => parseScriptLabels(null)).toThrow();
    expect(() => parseScriptLabels(scriptLabel({ struggling: null }))).toThrow();
    expect(() => parseScriptLabels(scriptLabel({ signal: 'vibes' }))).toThrow();
    expect(() => parseScriptLabels(scriptLabel({ clip_id: 'x' }))).toThrow();
  });
});

describe('script label mapping', () => {
  it('maps stall, compensation and jitter to error types', () => {
    for (const [signal, error] of [
      ['stall', 'timing'],
      ['compensation', 'asymmetry'],
      ['jitter', 'instability'],
    ] as const) {
      const mapped = scriptLabelToMuse({ ...scriptLabel({ signal }), clip_id: 'clip-aaaa' });
      expect('rejected' in mapped).toBe(false);
      if (!('rejected' in mapped)) {
        expect(mapped.muse).toMatchObject({ struggling: true, severity: 'mild', error_types: [error] });
      }
    }
  });

  it('maps none to not struggling with severity none and no error types', () => {
    const mapped = scriptLabelToMuse(scriptLabel({ struggling: false, signal: 'none' }));
    expect('rejected' in mapped).toBe(false);
    if (!('rejected' in mapped)) {
      expect(mapped.muse).toMatchObject({ struggling: false, severity: 'none', error_types: [] });
    }
  });

  it('rejects uncertain for a human', () => {
    const mapped = scriptLabelToMuse(scriptLabel({ signal: 'uncertain' }));
    expect(mapped).toEqual({ rejected: 'uncertain' });
  });
});

describe('script label attach', () => {
  it('attaches only to clips without a Muse label and never overwrites', () => {
    const report = attachScriptLabels(
      [clip('clip-aaaa', false), clip('clip-bbbb', true)],
      [scriptLabel({ clip_id: 'clip-aaaa' }), scriptLabel({ clip_id: 'clip-bbbb' }), scriptLabel({ clip_id: 'clip-cccc' })],
    );
    expect(report.attached).toEqual(['clip-aaaa']);
    expect(report.skippedLabeled).toEqual(['clip-bbbb']);
    expect(report.skippedUnknown).toEqual(['clip-cccc']);
    expect(report.rejected).toEqual([]);
    expect(report.clips[0].muse?.error_types).toEqual(['timing']);
    // The bundle clip that already had a label keeps its own Muse object.
    expect(report.clips[1].muse?.severity).toBe('moderate');
  });

  it('records needs_review without changing the muse shape', () => {
    const report = attachScriptLabels(
      [clip('clip-aaaa', false)],
      [scriptLabel({ clip_id: 'clip-aaaa', needs_review: true })],
    );
    expect(report.needsReview).toEqual({ 'clip-aaaa': true });
    expect(Object.keys(report.clips[0].muse ?? {}).sort()).toEqual(
      ['error_types', 'reason', 'severity', 'struggling'],
    );
  });
});

describe('imported label tag', () => {
  function cardProps(over: object = {}) {
    return {
      clip: clip('clip-aaaa', true),
      existingReview: null,
      reviewer: 'R1',
      blindDefault: false,
      noteMaxChars: 200,
      onSubmit: () => {},
      onClose: () => {},
      ...over,
    };
  }

  it('shows the imported tag only for imported labels', () => {
    const tagged = renderToStaticMarkup(
      <ReviewCard {...cardProps({ museImported: true, museNeedsReview: true })} />,
    );
    expect(tagged).toContain('Imported label');
    expect(tagged).toContain('Needs review');
    const plain = renderToStaticMarkup(<ReviewCard {...cardProps()} />);
    expect(plain).not.toContain('Imported label');
    expect(plain).not.toContain('Needs review');
  });
});
