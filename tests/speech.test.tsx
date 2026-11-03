import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CoachPanel } from '../src/components/CoachPanel';
import { cancelSpeech, loadSpeakTips, saveSpeakTips, speakTip } from '../src/coach/speech';
import { READ_ALOUD_NOTE, READ_ALOUD_OFF, READ_ALOUD_ON, SPARK_ENABLE_LABEL } from '../src/copy';
import type { PoseFrame } from '../src/contracts';

const BANNED = /\b(fps|frames?|calls?|saved|flag rate|latency|escalat\w*)\b/i;

/** speech.ts guards on typeof localStorage; node tests stub it here. */
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

describe('spoken coaching', () => {
  it('defaults to sound on when nothing is stored', () => {
    expect(loadSpeakTips()).toBe(true);
  });

  it('remembers turning sound off and back on', () => {
    saveSpeakTips(false);
    expect(loadSpeakTips()).toBe(false);
    saveSpeakTips(true);
    expect(loadSpeakTips()).toBe(true);
  });

  it('stays silent where speech is unsupported, never throwing', () => {
    expect(speakTip('Take your time.')).toBe(false);
    expect(() => cancelSpeech()).not.toThrow();
  });

  it('shows the sound-on toggle with its note and no banned words', () => {
    const html = panelMarkup();
    expect(html).toContain(READ_ALOUD_ON);
    expect(html).toContain(READ_ALOUD_NOTE);
    expect(html).toContain('Get a tip');
    expect(html).not.toMatch(BANNED);
  });

  it('offers an explicit Spark opt-in instead of the tips-off note', () => {
    const html = renderToStaticMarkup(
      <CoachPanel
        frame={okFrame()}
        systemState="hesitating"
        topSignal="stall"
        cantSeeYouActive={false}
        escalationId={0}
        statsEpoch="test"
        consent={{ camera: false, recording: false, cloud_summary: false, cloud_clips: false }}
        onEnableSpark={() => {}}
      />,
    );
    expect(html).toContain(SPARK_ENABLE_LABEL);
    expect(html).not.toContain('Tips are off');
    expect(html).not.toContain('Get a tip');
    expect(html).not.toMatch(BANNED);
  });

  it('labels both toggle states without digits', () => {
    for (const s of [READ_ALOUD_ON, READ_ALOUD_OFF, READ_ALOUD_NOTE, SPARK_ENABLE_LABEL]) {
      expect(s).not.toMatch(BANNED);
      expect(s).not.toMatch(/\d/);
    }
    expect(READ_ALOUD_ON).toContain('on');
    expect(READ_ALOUD_OFF).toContain('off');
  });
});
