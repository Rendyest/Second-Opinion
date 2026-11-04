import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRecordedClip, parseReviewBundle } from '../src/contracts';
import { parseValidationResults, type ValidationResults } from '../src/validation/schema';

describe('judge demo data', () => {
  it('generates clips, a bundle and validation figures that all validate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-'));
    const out = mkdtempSync(join(tmpdir(), 'demoresults-'));
    const demo = fileURLToPath(new URL('../scripts/make-demo-data.mjs', import.meta.url));
    execFileSync(process.execPath, [demo, dir], { stdio: 'pipe' });

    for (const f of ['demo-front-90.json', 'demo-side-90.json', 'demo-front-45.json']) {
      parseRecordedClip(JSON.parse(readFileSync(join(dir, f), 'utf-8')));
    }
    const bundle = parseReviewBundle(JSON.parse(readFileSync(join(dir, 'review-bundle.json'), 'utf-8')));
    expect(bundle.clips.filter((c) => c.muse)).toHaveLength(1);

    const gen = fileURLToPath(new URL('../scripts/make-results.mjs', import.meta.url));
    execFileSync(process.execPath, [gen, dir], { cwd: out, stdio: 'pipe' });
    const results = parseValidationResults(
      readFileSync(join(out, 'results', 'results.json'), 'utf-8'),
    ) as ValidationResults | null;
    expect(results).not.toBeNull();
    if (!results) throw new Error('unreachable');
    expect(results.recordedSet.n_clips).toBe(3);
    expect(results.provenance).toBe('synthetic');
    expect(results.recordedSet.n_participants).toBe(0);
    expect(results.shoulder).toHaveLength(3);
    for (const row of results.shoulder) {
      expect(row.n_all).toBeGreaterThan(0);
      expect(row.mae_deg_all).not.toBeNull();
    }
  }, 120000);
});
