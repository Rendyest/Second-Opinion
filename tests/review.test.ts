import { describe, expect, it } from 'vitest';
import {
  agreementByMode,
  agreementFor,
  computeReviewStatus,
  exactLabelMatch,
  formatPct,
  reviewCounts,
  validateReviewLabel,
  validateReviewNote,
  withinOneSeverity,
  type ReviewLabel,
  type StoredReview,
} from '../src/review/labels';
import {
  CLIP_ID_RE,
  isRecordedClip,
  isReviewBundle,
  parseReviewBundle,
} from '../src/contracts';
import { buildClip, reviewClipFromRecorded } from '../src/pipeline/clip';
import { ERROR_TYPE_LABEL, REVIEW_NO_REVIEWS, REVIEW_QUEUE_EMPTY } from '../src/reviewCopy';

const MUSE = {
  struggling: true,
  severity: 'moderate' as const,
  error_types: ['timing'],
  reason: 'Slow to reach the face.',
};

function label(over: Partial<ReviewLabel> = {}): ReviewLabel {
  return { struggling: true, severity: 'moderate', errorTypes: ['timing'], ...over };
}

function stored(over: Partial<StoredReview> = {}): StoredReview {
  return {
    clip_id: 'clip-1',
    status: 'confirmed',
    mode: 'blind',
    struggling: true,
    severity: 'moderate',
    error_types: ['timing'],
    note: '',
    reviewer: 'R1',
    reviewed_at: '2026-01-01T00:00:00.000Z',
    muse: { ...MUSE },
    ...over,
  };
}

describe('review agreement numbers', () => {
  it('4 reviewed clips with 3 confirmed gives exact 75 (n = 4)', () => {
    const entries = [
      { label: label(), muse: { ...MUSE } },
      { label: label(), muse: { ...MUSE } },
      { label: label(), muse: { ...MUSE } },
      { label: label({ struggling: false, severity: 'none', errorTypes: [] }), muse: { ...MUSE } },
    ];
    const ag = agreementFor(entries);
    expect(ag.n).toBe(4);
    expect(ag.exactN).toBe(3);
    expect(ag.exact).toBe(75);
    expect(ag.withinN).toBe(3);
  });

  it('mild versus moderate is within one but not exact, symmetrically', () => {
    const mild = label({ severity: 'mild' });
    const moderate = label({ severity: 'moderate' });
    const museMild = { ...MUSE, severity: 'mild' as const };
    expect(exactLabelMatch(mild, museMild)).toBe(true);
    expect(exactLabelMatch(mild, MUSE)).toBe(false);
    expect(withinOneSeverity(mild, MUSE)).toBe(true);
    expect(withinOneSeverity(moderate, museMild)).toBe(true);
  });

  it('mild versus severe is neither exact nor within one', () => {
    const mild = label({ severity: 'mild' });
    const severe = { ...MUSE, severity: 'severe' as const };
    expect(exactLabelMatch(mild, severe)).toBe(false);
    expect(withinOneSeverity(mild, severe)).toBe(false);
  });

  it('none versus mild with different struggling values is neither', () => {
    const no = label({ struggling: false, severity: 'none', errorTypes: [] });
    const mildYes = { ...MUSE, severity: 'mild' as const };
    expect(exactLabelMatch(no, mildYes)).toBe(false);
    expect(withinOneSeverity(no, mildYes)).toBe(false);
  });

  it('error-type sets compare order-insensitively', () => {
    const a = label({ errorTypes: ['timing', 'instability'] });
    const b = { ...MUSE, error_types: ['instability', 'timing'] };
    expect(exactLabelMatch(a, b)).toBe(true);
    const c = label({ errorTypes: ['timing'] });
    expect(exactLabelMatch(c, b)).toBe(false);
  });

  it('a Correct whose final label equals Muse becomes confirmed', () => {
    expect(computeReviewStatus({ ...MUSE }, label())).toBe('confirmed');
    expect(computeReviewStatus({ ...MUSE }, label({ severity: 'mild' }))).toBe('corrected');
    expect(computeReviewStatus(null, label())).toBe('labeled');
  });

  it('blind and assisted agreement split correctly', () => {
    const entries = [
      { label: label(), muse: { ...MUSE }, mode: 'blind' as const },
      { label: label({ severity: 'mild' }), muse: { ...MUSE }, mode: 'blind' as const },
      { label: label(), muse: { ...MUSE }, mode: 'assist' as const },
    ];
    const split = agreementByMode(entries);
    expect(split.blind.n).toBe(2);
    expect(split.blind.exact).toBe(50);
    expect(split.blind.withinOne).toBe(100);
    expect(split.assist.n).toBe(1);
    expect(split.assist.exact).toBe(100);
  });

  it('zero reviewed clips is not a percent', () => {
    const ag = agreementFor([]);
    expect(ag).toEqual({ exact: 0, withinOne: 0, exactN: 0, withinN: 0, n: 0 });
    expect(REVIEW_NO_REVIEWS).toBe('No reviewed clips yet.');
    expect(REVIEW_QUEUE_EMPTY).toBe('No review clips yet.');
  });

  it('formats whole percents without decimals', () => {
    expect(formatPct(75)).toBe('75%');
    expect(formatPct(33.3)).toBe('33.3%');
  });
});

describe('review label rules', () => {
  it('struggling no forces severity none and an empty error-type set', () => {
    expect(validateReviewLabel(label({ struggling: false, severity: 'none', errorTypes: [] }))).toEqual([]);
    expect(validateReviewLabel(label({ struggling: false, severity: 'mild', errorTypes: [] }))).toContain(
      'severity-must-be-none',
    );
    expect(validateReviewLabel(label({ struggling: false, severity: 'none', errorTypes: ['timing'] }))).toContain(
      'error-types-must-be-empty',
    );
  });

  it('struggling yes requires a non-none severity and at least one error type', () => {
    expect(validateReviewLabel(label())).toEqual([]);
    expect(validateReviewLabel(label({ severity: 'none' }))).toContain('severity-requires-level');
    expect(validateReviewLabel(label({ errorTypes: [] }))).toContain('error-types-required');
  });

  it('rejects unknown error-type ids', () => {
    expect(validateReviewLabel(label({ errorTypes: ['levitation'] }))).toContain('unknown-error-type');
  });

  it('unusable clips need no label fields', () => {
    expect(validateReviewLabel(label({ severity: 'none', errorTypes: [] }), true)).toEqual([]);
  });

  it('notes longer than the cap are rejected', () => {
    expect(validateReviewNote('x'.repeat(200), 200)).toBe(true);
    expect(validateReviewNote('x'.repeat(201), 200)).toBe(false);
  });

  it('every error-type id has display text', () => {
    for (const id of ['timing', 'asymmetry', 'instability', 'dropping', 'overshoot', 'incomplete', 'nonfunctional']) {
      expect(typeof ERROR_TYPE_LABEL[id]).toBe('string');
      expect(ERROR_TYPE_LABEL[id].length).toBeGreaterThan(0);
    }
  });
});

describe('review counting', () => {
  it('unusable clips are excluded from agreement and counted separately', () => {
    const reviews = [
      stored({ clip_id: 'a' }),
      stored({ clip_id: 'b' }),
      stored({ clip_id: 'c' }),
      stored({
        clip_id: 'd',
        status: 'corrected',
        struggling: false,
        severity: 'none',
        error_types: [],
        muse: { struggling: true, severity: 'moderate', error_types: ['timing'], reason: 'x' },
      }),
      stored({ clip_id: 'e', status: 'flagged', unusable: true, muse: { ...MUSE } }),
    ];
    const counts = reviewCounts(reviews);
    expect(counts.unusable).toBe(1);
    expect(counts.counted).toBe(4);
    const counted = reviews
      .filter((r) => r.status === 'confirmed' || r.status === 'corrected')
      .map((r) => ({
        label: { struggling: r.struggling, severity: r.severity, errorTypes: r.error_types },
        muse: r.muse as NonNullable<StoredReview['muse']>,
      }));
    expect(agreementFor(counted).exact).toBe(75);
  });

  it('skipped clips are counted separately and never agreement', () => {
    const reviews = [stored({ clip_id: 'a' }), stored({ clip_id: 'b', status: 'unreviewed', skipped: true })];
    const counts = reviewCounts(reviews);
    expect(counts.skipped).toBe(1);
    expect(counts.unreviewed).toBe(1);
    expect(counts.labeled).toBe(0);
  });

  it('clips with no Muse label are labeled, excluded, and counted', () => {
    const reviews = [stored({ clip_id: 'a' }), stored({ clip_id: 'b', status: 'labeled', muse: null })];
    const counts = reviewCounts(reviews);
    expect(counts.labeled).toBe(1);
    expect(counts.counted).toBe(1);
  });
});

describe('review bundle validation', () => {
  function poseFrame(t: number) {
    return {
      t,
      fps: 24,
      joints: { r_shoulder: { x: 0.5, y: 0.4, conf: 0.9 } },
      angles: {
        r_elbow_flexion: { deg: 90, conf: 0.9 },
        r_shoulder_elevation: { deg: 45, conf: 0.9 },
      },
      gate: { ok: true, reasons: [] },
    };
  }

  function goodClip(id: string) {
    return {
      clip_id: id,
      fps: 24,
      frames: [poseFrame(0), poseFrame(0.04)],
      baseline: { upperArm: 0.1, forearm: 0.2, shoulderWidth: 0.2 },
      face: null,
      consent: { recording: true },
      muse: { ...MUSE },
    };
  }

  function goodBundle() {
    return { version: 1, source: 'recorded', clips: [goodClip('clip-aaaa'), goodClip('clip-bbbb')] };
  }

  it('accepts a well-formed bundle', () => {
    expect(isReviewBundle(goodBundle())).toBe(true);
    const parsed = parseReviewBundle(goodBundle());
    expect(parsed.clips).toHaveLength(2);
  });

  it('rejects a corrupt bundle with a clear message', () => {
    expect(() => parseReviewBundle({ version: 2, source: 'recorded', clips: [] })).toThrow(/review bundle/);
    expect(() => parseReviewBundle({ ...goodBundle(), extra: 1 })).toThrow(/review bundle/);
    expect(() => parseReviewBundle({ ...goodBundle(), clips: [{ ...goodClip('clip-aaaa'), clip_id: 'x' }] })).toThrow(
      /review bundle/,
    );
  });

  it('rejects a clip without consent.recording true with the message', () => {
    const noConsent = { ...goodClip('clip-aaaa'), consent: { recording: false } };
    expect(() => parseReviewBundle({ ...goodBundle(), clips: [noConsent] })).toThrow(
      "This clip has no recorded consent, so it can't be loaded for review.",
    );
  });

  it('rejects duplicate clip ids and image-like values', () => {
    expect(() =>
      parseReviewBundle({ ...goodBundle(), clips: [goodClip('clip-same'), goodClip('clip-same')] }),
    ).toThrow(/share the id/);
    const blob = { ...goodClip('clip-aaaa'), muse: { ...MUSE, reason: `data:image/png;base64,${'A'.repeat(10)}` } };
    expect(isReviewBundle({ ...goodBundle(), clips: [blob] })).toBe(false);
    expect(() => parseReviewBundle({ ...goodBundle(), clips: [blob] })).toThrow(/image data/);
  });

  it('clip ids match the required shape', () => {
    expect(CLIP_ID_RE.test('clip-1')).toBe(true);
    expect(CLIP_ID_RE.test('ab')).toBe(false);
    expect(CLIP_ID_RE.test('has space')).toBe(false);
  });
});

describe('recorder clip conversion', () => {
  function recorded() {
    return buildClip({
      name: 'P1',
      fps: 24,
      samples: [{ t: 0, joints: { r_shoulder: { x: 0.6, y: 0.5, conf: 0.9 } } }],
      baseline: { upperArm: 0.1, forearm: 0.2, shoulderWidth: 0.2 },
      face: null,
      thresholds: {},
      labels: [],
      source: 'recorded',
    });
  }

  it('assigns a clip id, drops the name, and treats muse as absent', () => {
    const out = reviewClipFromRecorded(recorded(), 'clip-xyz1');
    expect(out.clip_id).toBe('clip-xyz1');
    expect('name' in out).toBe(false);
    expect('muse' in out).toBe(false);
    expect(out.consent).toEqual({ recording: true });
    expect(out.frames).toHaveLength(1);
  });

  it('assigns a random valid id when none is given', () => {
    const out = reviewClipFromRecorded(recorded());
    expect(CLIP_ID_RE.test(out.clip_id)).toBe(true);
  });

  it('rejects a recorder clip without recorded consent', () => {
    const clip = { ...recorded(), consent: { recording: false } };
    expect(isRecordedClip(clip)).toBe(true);
    expect(() => reviewClipFromRecorded(clip)).toThrow(
      "This clip has no recorded consent, so it can't be loaded for review.",
    );
  });
});
