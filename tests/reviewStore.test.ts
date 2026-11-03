import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearLoadedBundle,
  clearReviews,
  getLoadedBundle,
  loadReviewer,
  loadReviews,
  parseReviewsImport,
  saveReviewer,
  saveReviews,
  serializeReviews,
  setLoadedBundle,
  subscribeLoadedBundle,
} from '../src/review/store';
import { isStoredReview } from '../src/review/labels';
import type { StoredReview } from '../src/review/labels';
import type { ReviewBundle } from '../src/contracts';

/** store.ts guards on typeof localStorage; node tests stub it here. */
function stubStorage(preset: Record<string, string> = {}): Map<string, string> {
  const store = new Map<string, string>(Object.entries(preset));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearLoadedBundle();
});

function review(over: Partial<StoredReview> = {}): StoredReview {
  return {
    clip_id: 'clip-1',
    status: 'confirmed',
    mode: 'blind',
    struggling: true,
    severity: 'moderate',
    error_types: ['timing'],
    note: 'steady reach',
    reviewer: 'R1',
    reviewed_at: '2026-01-01T00:00:00.000Z',
    muse: { struggling: true, severity: 'moderate', error_types: ['timing'], reason: 'Slow.' },
    ...over,
  };
}

describe('review persistence', () => {
  it('round-trips reviews through localStorage', () => {
    stubStorage();
    expect(loadReviews()).toEqual([]);
    saveReviews([review()]);
    expect(loadReviews()).toEqual([review()]);
  });

  it('drops invalid entries instead of throwing', () => {
    stubStorage({
      'mirra.reviews.v1': JSON.stringify([review(), { clip_id: 7 }, null, 'x']),
    });
    expect(loadReviews()).toEqual([review()]);
  });

  it('returns empty when storage is corrupt or missing', () => {
    stubStorage({ 'mirra.reviews.v1': 'not json{{' });
    expect(loadReviews()).toEqual([]);
  });

  it('remembers the reviewer name separately from reviews', () => {
    stubStorage();
    expect(loadReviewer()).toBe('');
    saveReviewer('R9');
    expect(loadReviewer()).toBe('R9');
    expect(loadReviews()).toEqual([]);
  });

  it('exported reviews contain no joints, frames or images', () => {
    const text = serializeReviews([review({ note: 'ok' })]);
    expect(text).not.toContain('joints');
    expect(text).not.toContain('frames');
    expect(text).not.toContain('data:');
    expect(JSON.parse(text)).toHaveLength(1);
  });

  it('imports a valid reviews file and rejects a corrupt one', () => {
    expect(parseReviewsImport(serializeReviews([review()]))).toEqual([review()]);
    expect(() => parseReviewsImport('[{"clip_id":1}]')).toThrow(/valid reviews file/);
    expect(() => parseReviewsImport('nope')).toThrow(/valid reviews file/);
  });

  it('clear removes reviews but the holder is separate', () => {
    stubStorage();
    saveReviews([review()]);
    clearReviews();
    expect(loadReviews()).toEqual([]);
  });

  it('isStoredReview accepts full reviews and rejects partial ones', () => {
    expect(isStoredReview(review())).toBe(true);
    expect(isStoredReview({ ...review(), skipped: true })).toBe(true);
    const { note: _note, ...without } = review();
    void _note;
    expect(isStoredReview(without)).toBe(false);
    expect(isStoredReview({ ...review(), status: 'maybe' })).toBe(false);
    expect(isStoredReview({ ...review(), muse: { struggling: true } })).toBe(false);
    expect(isStoredReview(null)).toBe(false);
  });
});

describe('loaded review bundle holder', () => {
  function bundle(): ReviewBundle {
    return { version: 1, source: 'recorded', clips: [] };
  }

  it('holds the bundle in memory and clears it without touching reviews', () => {
    stubStorage();
    saveReviews([review()]);
    expect(getLoadedBundle()).toBeNull();
    setLoadedBundle(bundle());
    expect(getLoadedBundle()).toEqual(bundle());
    clearLoadedBundle();
    expect(getLoadedBundle()).toBeNull();
    expect(loadReviews()).toEqual([review()]);
  });

  it('notifies subscribers on change', () => {
    let calls = 0;
    const stop = subscribeLoadedBundle(() => {
      calls += 1;
    });
    try {
      setLoadedBundle(bundle());
      clearLoadedBundle();
      expect(calls).toBe(2);
    } finally {
      stop();
    }
  });
});
