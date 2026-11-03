import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { computeBias, computeMae } from '../scripts/make-results.mjs';
import {
  isValidationResults,
  parseValidationResults,
  type ValidationResults,
} from '../src/validation/schema';
import { ValidationPage, ValidationResultsView } from '../src/pages/ValidationPage';

const BANNED = /\b(fps|frames?|calls?|saved|flag rate|latency|escalat\w*)\b/i;

function validResults(): ValidationResults {
  return {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    reference: 'Posed target angle (nominal)',
    thresholds_tuned_on_reported_clips: false,
    recordedSet: {
      n_clips: 2,
      n_participants: 2,
      n_frames_in_hold: 7,
      n_frames_outside_hold: 1,
      n_unlabelled_frames: 0,
    },
    shoulder: [
      {
        view: 'front',
        target_deg: 90,
        n_gated_ok: 3,
        mae_deg_gated_ok: 4,
        bias_deg_gated_ok: 4,
        n_all: 4,
        mae_deg_all: 5.5,
        bias_deg_all: 5.5,
      },
    ],
    elbow: {
      target_deg: 180,
      label: 'straight arm only',
      n_gated_ok: 3,
      mae_deg_gated_ok: 4,
      bias_deg_gated_ok: 2,
      n_all: 4,
      mae_deg_all: 5.5,
      bias_deg_all: 3,
    },
    gate: { flagged: 1, total: 7 },
  };
}

describe('validation error math', () => {
  it('computeMae([2,4,6]) is 4', () => {
    expect(computeMae([2, 4, 6])).toBe(4);
  });

  it('computeMae([-2,4,-6]) is 4', () => {
    expect(computeMae([-2, 4, -6])).toBe(4);
  });

  it('computeBias([2,4,6]) is 4', () => {
    expect(computeBias([2, 4, 6])).toBe(4);
  });

  it('computeBias([-2,4,-6]) is -4/3', () => {
    expect(computeBias([-2, 4, -6])).toBeCloseTo(-4 / 3, 10);
  });
});

describe('validation schema', () => {
  it('accepts a complete valid file', () => {
    expect(isValidationResults(validResults())).toBe(true);
  });

  it('accepts a missing optional reference_verified_by', () => {
    expect(isValidationResults(validResults())).toBe(true);
  });

  it.each([
    'schemaVersion',
    'generatedAt',
    'reference',
    'thresholds_tuned_on_reported_clips',
    'recordedSet',
    'shoulder',
    'elbow',
    'gate',
  ])('fails when top-level field %s is missing', (field) => {
    const copy = { ...validResults() } as Record<string, unknown>;
    delete copy[field];
    expect(isValidationResults(copy)).toBe(false);
  });

  it('fails on the wrong schemaVersion', () => {
    expect(isValidationResults({ ...validResults(), schemaVersion: 2 })).toBe(false);
  });

  it('fails when flagged exceeds total', () => {
    const copy = validResults();
    expect(isValidationResults({ ...copy, gate: { flagged: 8, total: 7 } })).toBe(false);
  });

  it('fails on a negative MAE', () => {
    const copy = validResults();
    copy.shoulder[0].mae_deg_all = -1;
    expect(isValidationResults(copy)).toBe(false);
  });

  it('fails on an unknown top-level key', () => {
    expect(isValidationResults({ ...validResults(), extra: 1 })).toBe(false);
  });

  it('fails on a duplicate (view, target_deg)', () => {
    const copy = validResults();
    expect(
      isValidationResults({ ...copy, shoulder: [...copy.shoulder, { ...copy.shoulder[0] }] }),
    ).toBe(false);
  });

  it('fails on the _example marker', () => {
    const example = JSON.parse(
      readFileSync(new URL('../docs/results.EXAMPLE.json', import.meta.url), 'utf-8'),
    ) as unknown;
    expect(isValidationResults(example)).toBe(false);
  });

  it('fails on a non-string reference_verified_by', () => {
    expect(isValidationResults({ ...validResults(), reference_verified_by: 7 })).toBe(false);
  });
});

describe('validation loading', () => {
  it('missing input parses to null', () => {
    expect(parseValidationResults(undefined)).toBeNull();
  });

  it('invalid JSON parses to null', () => {
    expect(parseValidationResults('not json{{{')).toBeNull();
  });

  it('a corrupt bundle parses to null', () => {
    expect(parseValidationResults(JSON.stringify({ schemaVersion: 1 }))).toBeNull();
  });

  it('renders "No results yet" when the repo has no results file', () => {
    const resultsPath = new URL('../results/results.json', import.meta.url);
    if (existsSync(resultsPath)) return; // a local run left a file; nothing to assert
    const html = renderToStaticMarkup(<ValidationPage />);
    expect(html).toContain('No results yet');
  });
});

describe('validation page', () => {
  it('shows gated and all figures side by side with n = 3 and n = 4', () => {
    const html = renderToStaticMarkup(<ValidationResultsView data={validResults()} />);
    expect(html).toContain('4.0° (n=3)');
    expect(html).toContain('5.5° (n=4)');
    expect(html).not.toContain('NaN');
  });

  it('keeps a front clip and a side clip at the same target in separate rows', () => {
    const copy = validResults();
    copy.shoulder = [
      { ...copy.shoulder[0], view: 'front' },
      { ...copy.shoulder[0], view: 'side' },
    ];
    const html = renderToStaticMarkup(<ValidationResultsView data={copy} />);
    expect(html).toContain('front view');
    expect(html).toContain('side view');
    // React escapes the apostrophe in static markup.
    expect(html).toContain('Outside the gate&#x27;s frontal-view assumption');
  });

  it('shows n/a with no NaN when n = 0', () => {
    const copy = validResults();
    copy.shoulder = [
      {
        view: 'front',
        target_deg: 90,
        n_gated_ok: 0,
        mae_deg_gated_ok: null,
        bias_deg_gated_ok: null,
        n_all: 0,
        mae_deg_all: null,
        bias_deg_all: null,
      },
    ];
    const html = renderToStaticMarkup(<ValidationResultsView data={copy} />);
    expect(html).toContain('n/a');
    expect(html).not.toContain('NaN');
  });

  it('names the tested views and angles and the lines the brief requires', () => {
    const html = renderToStaticMarkup(<ValidationResultsView data={validResults()} />);
    for (const line of [
      'Tested views and angles',
      'Other views and angles were not validated.',
      'Right arm only; left side not validated.',
      'Small recorded set; not clinical validation.',
      'Straight-arm check only, not a validation of elbow bend.',
      'Positive bias means the pipeline reads high.',
      '1 of 7 frames flagged',
      'Posed target angle (nominal)',
    ]) {
      expect(html).toContain(line);
    }
  });

  it('reviewer-only wording trips the session pattern solely on the mandated word', () => {
    const html = renderToStaticMarkup(<ValidationResultsView data={validResults()} />);
    expect(html).toContain('frames');
    expect(html.replace(/\bframes\b/gi, '')).not.toMatch(BANNED);
  });
});

describe('validation generator', () => {
  function joint(x: number, y: number) {
    return { x, y, conf: 0.9 };
  }

  function frame(t: number, ex: number, ey: number, wx: number, wy: number) {
    return {
      t,
      joints: {
        r_shoulder: joint(0.5, 0.4),
        r_elbow: joint(ex, ey),
        r_wrist: joint(wx, wy),
        l_shoulder: joint(0.3, 0.4),
      },
    };
  }

  function writeClip(dir: string, file: string, over: Record<string, unknown>) {
    const clip = {
      version: 1,
      source: 'recorded',
      name: 'P1',
      fps: 24,
      frames: [],
      baseline: { upperArm: 0.2, forearm: 0.2, shoulderWidth: 0.2 },
      face: null,
      config_used: {},
      consent: { recording: true },
      ...over,
    };
    writeFileSync(join(dir, file), JSON.stringify(clip));
  }

  it('scores in-hold frames, excludes outside-hold frames, and sorts unlabelled and unconsented clips', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clips-'));
    const out = mkdtempSync(join(tmpdir(), 'results-'));
    // Front clip at target 90: two in-hold frames at elevation 90 (error 0),
    // one outside-hold frame hanging at elevation 0 (error -90, excluded).
    writeClip(dir, 'front.json', {
      name: 'P1',
      view: 'front',
      target_shoulder_deg: 90,
      hold: { start_s: 0, end_s: 1 },
      frames: [frame(0, 0.7, 0.4, 0.7, 0.6), frame(0.5, 0.7, 0.4, 0.7, 0.6), frame(5, 0.5, 0.6, 0.5, 0.8)],
    });
    // Side clip at the same target: its own row, and no elbow scoring.
    writeClip(dir, 'side.json', {
      name: 'P2',
      view: 'side',
      target_shoulder_deg: 90,
      hold: { start_s: 0, end_s: 1 },
      frames: [frame(0, 0.7, 0.4, 0.7, 0.6)],
    });
    // No hold: all three frames land in n_unlabelled_frames.
    writeClip(dir, 'unlabelled.json', {
      name: 'P3',
      view: 'front',
      target_shoulder_deg: 90,
      frames: [frame(0, 0.7, 0.4, 0.7, 0.6), frame(1, 0.7, 0.4, 0.7, 0.6), frame(2, 0.7, 0.4, 0.7, 0.6)],
    });
    // No consent: skipped entirely.
    writeClip(dir, 'noconsent.json', {
      name: 'P4',
      view: 'front',
      target_shoulder_deg: 90,
      hold: { start_s: 0, end_s: 1 },
      consent: { recording: false },
      frames: [frame(0, 0.7, 0.4, 0.7, 0.6)],
    });

    const script = new URL('../scripts/make-results.mjs', import.meta.url);
    execFileSync(process.execPath, [fileURLToPath(script), dir], { cwd: out, stdio: 'pipe' });
    const text = readFileSync(join(out, 'results', 'results.json'), 'utf-8');
    expect(text).not.toContain('joints');
    const results = JSON.parse(text) as ValidationResults;
    expect(isValidationResults(results)).toBe(true);

    const front = results.shoulder.find((r) => r.view === 'front');
    const side = results.shoulder.find((r) => r.view === 'side');
    expect(results.shoulder.length).toBe(2);
    // The hanging outside-hold frame (error -90) never enters the MAE.
    expect(front?.n_all).toBe(2);
    expect(front?.mae_deg_all).toBe(0);
    expect(front?.n_gated_ok).toBe(2);
    expect(side?.n_all).toBe(1);
    expect(side?.mae_deg_all).toBe(0);
    // Elbow is front-view only: two frames at flexion 90 vs 180.
    expect(results.elbow.n_all).toBe(2);
    expect(results.elbow.mae_deg_all).toBe(90);
    expect(results.elbow.bias_deg_all).toBe(-90);
    expect(results.recordedSet).toEqual({
      n_clips: 2,
      n_participants: 3,
      n_frames_in_hold: 3,
      n_frames_outside_hold: 1,
      n_unlabelled_frames: 3,
    });
    expect(results.gate).toEqual({ flagged: 0, total: 3 });
  });
});

describe('validation example isolation', () => {
  it('no app source references the example docs', () => {
    const roots = [new URL('../src/', import.meta.url)];
    const sources: string[] = [];
    const walk = (dir: URL) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const next = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
        if (entry.isDirectory()) walk(next);
        else if (/\.(ts|tsx)$/.test(entry.name)) sources.push(fileURLToPath(next));
      }
    };
    for (const root of roots) walk(root);
    expect(sources.length).toBeGreaterThan(10);
    for (const file of sources) {
      expect(readFileSync(file, 'utf-8'), file).not.toContain('docs/');
    }
  });
});
