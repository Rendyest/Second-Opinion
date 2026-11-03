import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CoachPanel } from '../src/components/CoachPanel';
import { loadAutoTips, saveAutoTips } from '../src/coach/autoTips';
import { AUTO_TIPS_NOTE, AUTO_TIPS_OFF, AUTO_TIPS_ON } from '../src/copy';
import type { PoseFrame } from '../src/contracts';

const BANNED = /\b(fps|frames?|calls?|saved|flag rate|latency|escalat\w*)\b/i;

/** autoTips.ts guards on typeof localStorage; node tests stub it here. */
function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  });
  return store;
}

beforeEach(() => {
  stubStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function okFrame(): PoseFrame {
  return {
    t: 1.5,
    fps: 24,
    joints: {
      r_shoulder: { x: 0.55, y: 0.4, conf: 0.95 },
      r_elbow: { x: 0.41, y: 0.52, conf: 0.93 },
      r_wrist: { x: 0.48, y: 0.35, conf: 0.88 },
    },
    angles: {
      r_elbow_flexion: { deg: 87.2, conf: 0.91 },
      r_shoulder_elevation: { deg: 64.0, conf: 0.88 },
    },
    gate: { ok: true, reasons: [] },
  };
}

function panelMarkup(): string {
  return renderToStaticMarkup(
    <CoachPanel
      frame={okFrame()}
      systemState="hesitating"
      topSignal="stall"
      cantSeeYouActive={false}
      escalationId={0}
      statsEpoch="test"
    />,
  );
}

describe('automatic coaching mode', () => {
  it('defaults to on when nothing is stored', () => {
    expect(loadAutoTips()).toBe(true);
  });

  it('remembers turning automatic tips off and back on', () => {
    saveAutoTips(false);
    expect(loadAutoTips()).toBe(false);
    saveAutoTips(true);
    expect(loadAutoTips()).toBe(true);
  });

  it('shows the on state with its note and no banned words', () => {
    const html = panelMarkup();
    expect(html).toContain(AUTO_TIPS_ON);
    expect(html).toContain(AUTO_TIPS_NOTE);
    expect(html).toContain('Get a tip');
    expect(html).not.toMatch(BANNED);
  });

  it('labels both toggle states without digits', () => {
    for (const s of [AUTO_TIPS_ON, AUTO_TIPS_OFF, AUTO_TIPS_NOTE]) {
      expect(s).not.toMatch(BANNED);
      expect(s).not.toMatch(/\d/);
    }
    expect(AUTO_TIPS_ON).toContain('on');
    expect(AUTO_TIPS_OFF).toContain('off');
  });
});
