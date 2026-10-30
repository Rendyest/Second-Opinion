import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { validateCoachingTip } from '../src/coach/coachingImport';
import { CoachPanel, ImportedTipView } from '../src/components/CoachPanel';
import type { PoseFrame } from '../src/contracts';

function tip(over: Record<string, unknown> = {}) {
  return {
    struggling: true,
    signal: 'stall',
    body_part: 'arm',
    severity: 'mild',
    cue_text: 'Try moving slowly and comfortably.',
    ask_pain_check: false,
    safety_concern: false,
    ...over,
  };
}

describe('coaching tip validation', () => {
  it('accepts a complete script tip', () => {
    expect(validateCoachingTip(tip())).toEqual(tip());
  });

  it('rejects corrupt tips, wrong severities and long cues', () => {
    expect(() => validateCoachingTip(null)).toThrow();
    expect(() => validateCoachingTip(tip({ severity: 'severe' }))).toThrow();
    expect(() => validateCoachingTip(tip({ cue_text: '' }))).toThrow();
    expect(() => validateCoachingTip(tip({ cue_text: 'x'.repeat(201) }))).toThrow();
    expect(() => validateCoachingTip(tip({ struggling: 'yes' }))).toThrow();
  });
});

describe('imported tip playback', () => {
  function frame(): PoseFrame {
    return {
      t: 1.5,
      fps: 24,
      joints: { r_shoulder: { x: 0.55, y: 0.4, conf: 0.95 } },
      angles: {
        r_elbow_flexion: { deg: 87.2, conf: 0.91 },
        r_shoulder_elevation: { deg: 64.0, conf: 0.88 },
      },
      gate: { ok: true, reasons: [] },
    };
  }

  it('shows the picker on the panel with no fetch or storage', () => {
    const html = renderToStaticMarkup(
      <CoachPanel
        frame={frame()}
        systemState="hesitating"
        topSignal="stall"
        cantSeeYouActive={false}
        escalationId={0}
        statsEpoch="test"
      />,
    );
    expect(html).toContain('Show a tip from a file');
    // The import path only validates and displays; requests stay on the live path.
    const src = readFileSync(new URL('../src/components/CoachPanel.tsx', import.meta.url), 'utf-8');
    const importBlock = src.slice(src.indexOf('{COACH_IMPORT_LABEL}'));
    expect(importBlock).not.toContain('requestCoachMessage(');
    expect(importBlock).not.toContain('fetch(');
    expect(importBlock).not.toContain('localStorage');
  });

  it('renders the cue with its struggling, signal and severity metadata', () => {
    const html = renderToStaticMarkup(
      <ImportedTipView tip={tip({ safety_concern: true, ask_pain_check: true })} onDismiss={() => {}} />,
    );
    expect(html).toContain('Imported tip');
    expect(html).toContain('Try moving slowly and comfortably.');
    expect(html).toContain('Struggling: yes');
    expect(html).toContain('Signal: stall');
    expect(html).toContain('Severity: mild');
    expect(html).toContain('Safety concern noted.');
    expect(html).toContain('Pain check suggested.');
  });
});
