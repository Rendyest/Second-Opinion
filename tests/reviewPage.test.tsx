import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AppNav } from '../src/components/AppNav';
import { MockStreamContext } from '../src/mock/MockStreamContext';
import { buildClip } from '../src/pipeline/clip';
import { reviewClipFromRecorded } from '../src/pipeline/clip';
import type { ReviewClip } from '../src/contracts';
import type { StoredReview } from '../src/review/labels';
import { buildQueueRows, ReviewQueue } from '../src/components/ReviewQueue';
import { ReviewCard } from '../src/components/ReviewCard';
import { ReviewPage } from '../src/pages/ReviewPage';

// Pin to the committed defaults so local overrides cannot change the markup.
vi.mock('../src/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config')>();
  const { default: committed } = await import('../src/config/config.default.json');
  return { ...actual, config: actual.buildConfig(committed) };
});

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
});

const MUSE = {
  struggling: true,
  severity: 'moderate' as const,
  error_types: ['timing'],
  reason: 'Slow to reach the face.',
};

function joints() {
  return {
    r_shoulder: { x: 0.5, y: 0.4, conf: 0.9 },
    r_elbow: { x: 0.55, y: 0.55, conf: 0.9 },
    r_wrist: { x: 0.5, y: 0.7, conf: 0.9 },
    l_shoulder: { x: 0.4, y: 0.4, conf: 0.9 },
    nose: { x: 0.5, y: 0.3, conf: 0.9 },
  };
}

function clipFixture(id: string, withMuse = true): ReviewClip {
  const angles = {
    r_elbow_flexion: { deg: 90, conf: 0.9 },
    r_shoulder_elevation: { deg: 45, conf: 0.9 },
  };
  const frames = [0, 0.04, 0.08].map((t) => ({
    t,
    fps: 24,
    joints: joints(),
    angles,
    gate: { ok: true, reasons: [] },
  }));
  return {
    clip_id: id,
    fps: 24,
    frames,
    baseline: null,
    face: null,
    consent: { recording: true },
    ...(withMuse ? { muse: { ...MUSE } } : {}),
  };
}

function storedReview(over: Partial<StoredReview> = {}): StoredReview {
  return {
    clip_id: 'clip-aaaa',
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

function cardProps(over: object = {}) {
  return {
    clip: clipFixture('clip-aaaa'),
    existingReview: null,
    reviewer: 'R1',
    blindDefault: true,
    noteMaxChars: 200,
    onSubmit: () => {},
    onClose: () => {},
    ...over,
  };
}

describe('review queue', () => {
  it('shows an empty queue with no numbers', () => {
    const html = renderToStaticMarkup(
      <ReviewQueue
        rows={[]}
        filter="all"
        onFilterChange={() => {}}
        counts={{ unreviewed: 0, confirmed: 0, corrected: 0, flagged: 0, labeled: 0 }}
        skippedCount={0}
        source="recorded"
        selectedId={null}
        onSelect={() => {}}
        dimBelowConf={0.5}
      />,
    );
    expect(html).toContain('No review clips yet.');
    expect(html).not.toContain('clip-');
  });

  it('builds rows with status, muse text and skipped last', () => {
    const clips = [clipFixture('clip-aaaa'), clipFixture('clip-bbbb', false)];
    const byId = new Map([
      ['clip-bbbb', storedReview({ clip_id: 'clip-bbbb', status: 'unreviewed', skipped: true })],
    ]);
    const rows = buildQueueRows(clips, byId);
    expect(rows.map((r) => r.clip.clip_id)).toEqual(['clip-aaaa', 'clip-bbbb']);
    expect(rows[1]?.skipped).toBe(true);
    expect(rows[1]?.status).toBe('unreviewed');
    expect(rows[0]?.museText).toBe('Struggling, moderate');
    expect(rows[1]?.museText).toBe('No Muse label');
  });

  it('renders the source badge, statuses and filter counts as text', () => {
    const rows = buildQueueRows([clipFixture('clip-aaaa')], new Map());
    const html = renderToStaticMarkup(
      <ReviewQueue
        rows={rows}
        filter="all"
        onFilterChange={() => {}}
        counts={{ unreviewed: 1, confirmed: 0, corrected: 0, flagged: 0, labeled: 0 }}
        skippedCount={0}
        source="synthetic"
        selectedId={null}
        onSelect={() => {}}
        dimBelowConf={0.5}
      />,
    );
    expect(html).toContain('Synthetic fixture');
    expect(html).toContain('clip-aaaa');
    expect(html).toContain('Unreviewed');
    expect(html).toContain('Unreviewed (1)');
    expect(html).toContain('Struggling, moderate');
  });

  it('never renders the recorder name, only the clip id', () => {
    const recorded = buildClip({
      name: 'P1',
      fps: 24,
      samples: [{ t: 0, joints: joints() }],
      baseline: null,
      face: null,
      thresholds: {},
      labels: [],
      source: 'recorded',
    });
    const converted = reviewClipFromRecorded(recorded, 'clip-name1');
    const rows = buildQueueRows([converted], new Map());
    const html = renderToStaticMarkup(
      <ReviewQueue
        rows={rows}
        filter="all"
        onFilterChange={() => {}}
        counts={{ unreviewed: 1, confirmed: 0, corrected: 0, flagged: 0, labeled: 0 }}
        skippedCount={0}
        source="recorded"
        selectedId={null}
        onSelect={() => {}}
        dimBelowConf={0.5}
      />,
    );
    expect(html).toContain('clip-name1');
    expect(html).not.toContain('P1');
  });
});

describe('review card in blind mode', () => {
  it('hides the Muse label and reason before Lock my label, with no Confirm', () => {
    const html = renderToStaticMarkup(<ReviewCard {...cardProps()} />);
    expect(html).toContain('Lock my label');
    expect(html).not.toContain('Slow to reach the face.');
    expect(html).not.toContain('Confirm');
    expect(html).not.toContain('Ticks: recorder marks.');
  });

  it('shows the Muse label and reason after the lock (submitted view)', () => {
    const html = renderToStaticMarkup(
      <ReviewCard {...cardProps({ existingReview: storedReview() })} />,
    );
    expect(html).toContain('Review recorded.');
    expect(html).toContain('Slow to reach the face.');
    expect(html).toContain('Confirmed');
    expect(html).not.toContain('Lock my label');
  });

  it('asks for the reviewer name before any submit', () => {
    const html = renderToStaticMarkup(<ReviewCard {...cardProps({ reviewer: '' })} />);
    expect(html).toContain('Enter your reviewer name above before submitting.');
  });
});

describe('review card in assist mode', () => {
  it('pre-fills Muse and offers Confirm, with marks as ticks', () => {
    const clip = { ...clipFixture('clip-aaaa'), marks: [0.02] };
    const html = renderToStaticMarkup(
      <ReviewCard {...cardProps({ clip, blindDefault: false })} />,
    );
    expect(html).toContain('Muse label: Struggling, moderate');
    expect(html).toContain('Slow to reach the face.');
    expect(html).toContain('Confirm');
    expect(html).toContain('Ticks: recorder marks.');
  });

  it('caps the note length and shows the identification warning', () => {
    const html = renderToStaticMarkup(<ReviewCard {...cardProps({ noteMaxChars: 200 })} />);
    expect(html).toContain('maxLength="200"');
    expect(html).toContain('Do not enter names or anything that could identify the person in the clip.');
  });

  it('player controls are text and the player owns its keyboard', () => {
    const html = renderToStaticMarkup(<ReviewCard {...cardProps()} />);
    expect(html).toContain('Play');
    expect(html).toContain('Step back');
    expect(html).toContain('Step forward');
    expect(html).toContain('Seek');
  });
});

describe('review page', () => {
  it('shows the picker and an empty queue with the headline agreement', () => {
    stubStorage();
    const html = renderToStaticMarkup(<ReviewPage />);
    expect(html).toContain('Choose a review bundle or recorder clip file');
    expect(html).toContain('No review clips yet.');
    expect(html).toContain('No reviewed clips yet.');
    expect(html).toContain('Reviewer name');
  });

  it('splits blind and assisted agreement with counts, excluding unloaded clips', () => {
    stubStorage({
      'mirra.reviews.v1': JSON.stringify([
        storedReview({ clip_id: 'a', mode: 'blind' }),
        storedReview({
          clip_id: 'b',
          mode: 'assist',
          status: 'corrected',
          struggling: false,
          severity: 'none',
          error_types: [],
          muse: { ...MUSE },
        }),
      ]),
    });
    const html = renderToStaticMarkup(<ReviewPage />);
    expect(html).toContain('Blind agreement');
    expect(html).toContain('100% exact (1 of 1 clips)');
    expect(html).toContain('Assisted (likely overstated)');
    expect(html).toContain('0% exact (0 of 1 clips)');
    expect(html).toContain('Unusable: 0');
    expect(html).toContain('Reviews without a loaded clip: 2');
  });
});

describe('review nav gating', () => {
  it('hides the Review link unless dev controls are on', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MockStreamContext.Provider
          value={{ status: 'ready', error: null, player: null, config: null, snapshot: null }}
        >
          <AppNav />
        </MockStreamContext.Provider>
      </MemoryRouter>,
    );
    expect(html).toContain('Setup');
    expect(html).toContain('Session');
    expect(html).toContain('Metrics');
    expect(html).not.toContain('href="/review"');
  });
});
