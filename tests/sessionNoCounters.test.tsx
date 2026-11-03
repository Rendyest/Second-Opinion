import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionPage, defaultSource } from '../src/pages/SessionPage';
import defaults from '../src/config/config.default.json';

// SessionPage reads the merged config singleton, so a local override with
// dev_controls on would leak dev UI into these renders. Pin this suite to
// the committed defaults; the dev-controls case below asserts on them.
vi.mock('../src/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config')>();
  const { default: committed } = await import('../src/config/config.default.json');
  return { ...actual, config: actual.buildConfig(committed) };
});
import {
  CHECKING_IN,
  COACH_BUTTON_LABEL,
  EMERGENCY_STOP_LABEL,
  EMERGENCY_STOPPED_NOTE,
  FINISH_CLIPS_NEED,
  FINISH_CONFIRM,
  FINISH_DOWNLOAD_LABEL,
  FINISH_LABEL,
  FIX_BY_REASON,
  LOCAL_FALLBACK,
  MARK_DONE_NOTE,
  MARK_IDLE_LABEL,
  MARK_LABEL,
  PAUSE_LABEL,
  PAUSED_NOTE,
  RESUME_LABEL,
  SESSION_INTRO,
  SESSION_PRIVACY_NOTE,
  STATE_LABEL,
  STATUS_CAMERA_OFF,
  STATUS_CAMERA_ON,
  STATUS_RECORDING_OFF,
  STATUS_RECORDING_ON,
  STATUS_TIPS_OFF,
  STATUS_TIPS_ON,
  TASK_NAME,
  TOP_SIGNAL_WHY,
  fixLineFor,
} from '../src/copy';
import { DELETE_CLIPS_CONFIRM } from '../src/consentCopy';
import { MetricsPage } from '../src/pages/MetricsPage';
import { publishLiveStats } from '../src/pose/liveStats';
import { AngleList } from '../src/components/AngleReadout';
import { StruggleIndicator } from '../src/components/StruggleIndicator';
import { CoachPanel } from '../src/components/CoachPanel';
import { MockStreamContext, type MockStreamValue } from '../src/mock/MockStreamContext';
import { MockPlayer } from '../src/mock/mockStreamPlayer';
import { parseReplayFile } from '../src/contracts';
import type { PoseFrame } from '../src/contracts';
import { config } from '../src/config';
import { statusText } from '../src/pose/statusText';
import type { LiveStatus } from '../src/pose/useLivePose';

const BANNED = /\b(fps|frames?|calls?|saved|flag rate|latency|escalat\w*)\b/i;
const STAT_TESTID = /data-testid="stat-/;

const ALL_STATUSES: LiveStatus[] = ['idle', 'loading', 'live', 'denied', 'error'];

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

function flaggedFrame(): PoseFrame {
  return {
    ...okFrame(),
    t: 2.0,
    angles: {
      r_elbow_flexion: { deg: 74.5, conf: 0.4 },
      r_shoulder_elevation: { deg: 58.0, conf: 0.41 },
    },
    gate: { ok: false, reasons: ['foreshortening'] },
  };
}

/** Real mock player preloaded with mock-stream.json, stepped to the t=1.5 pose_frame. */
function preloadedValue(): MockStreamValue {
  const raw = readFileSync(new URL('../public/mock-stream.json', import.meta.url), 'utf-8');
  const player = new MockPlayer();
  player.setEvents(parseReplayFile(JSON.parse(raw) as unknown));
  player.step(3); // consume through the t=1.5 pose_frame so the stage holds a frame
  return {
    status: 'ready',
    error: null,
    player,
    config,
    snapshot: player.snapshot(),
  };
}

/** SessionPage against the preloaded mock stream. No effects fire. */
function sessionMarkup(): string {
  return renderToStaticMarkup(
    <MockStreamContext.Provider value={preloadedValue()}>
      <SessionPage initialSource="mock" />
    </MockStreamContext.Provider>,
  );
}

describe('session has no loop statistics', () => {
  it('statusText is plain wording for every status', () => {
    for (const status of ALL_STATUSES) {
      expect(statusText(status)).not.toMatch(BANNED);
    }
  });

  it('statusText for live has no digits', () => {
    expect(statusText('live')).not.toMatch(/\d/);
  });

  it('renders the session page with no banned words and no stat test ids', () => {
    const html = sessionMarkup();
    // The delete confirmation names "saved measurements" in the user's own
    // mandated wording; allow-list that exact line, guard everything else.
    expect(html).toContain(DELETE_CLIPS_CONFIRM);
    const guarded = html.split(DELETE_CLIPS_CONFIRM).join('');
    expect(guarded).not.toMatch(BANNED);
    expect(html).not.toMatch(STAT_TESTID);
  });

  it('renders the angle list with no banned words', () => {
    const html = renderToStaticMarkup(<AngleList frame={okFrame()} />);
    expect(html).not.toMatch(BANNED);
    expect(html).not.toMatch(STAT_TESTID);
    expect(html).not.toContain('uncertain');
  });

  it('covers the flagged path: uncertain label, still no banned words', () => {
    const html = renderToStaticMarkup(<AngleList frame={flaggedFrame()} />);
    expect(html).toContain('uncertain');
    expect(html).not.toMatch(BANNED);
    expect(html).not.toMatch(STAT_TESTID);
  });

  it('renders the session page with no dev controls', () => {
    // Grounded in the committed defaults, not in any local override.
    expect(defaults.ui.dev_controls).toBe(false);
    const html = sessionMarkup();
    expect(html).not.toContain('Picture source');
    expect(html).not.toContain('Mock replay');
    expect(html).not.toContain('Step one event');
  });

  it('every copy string passes the banned-word and digit checks', () => {
    const strings = [
      ...Object.values(STATE_LABEL),
      ...Object.values(TOP_SIGNAL_WHY),
      ...FIX_BY_REASON.map((f) => f.line),
      fixLineFor([]),
      CHECKING_IN,
      LOCAL_FALLBACK,
      COACH_BUTTON_LABEL,
      TASK_NAME,
      SESSION_INTRO,
      SESSION_PRIVACY_NOTE,
      STATUS_CAMERA_ON,
      STATUS_CAMERA_OFF,
      STATUS_RECORDING_ON,
      STATUS_RECORDING_OFF,
      STATUS_TIPS_ON,
      STATUS_TIPS_OFF,
      PAUSE_LABEL,
      RESUME_LABEL,
      PAUSED_NOTE,
      FINISH_LABEL,
      FINISH_CONFIRM,
      FINISH_DOWNLOAD_LABEL,
      FINISH_CLIPS_NEED,
      EMERGENCY_STOP_LABEL,
      EMERGENCY_STOPPED_NOTE,
      MARK_LABEL,
      MARK_IDLE_LABEL,
      MARK_DONE_NOTE,
    ];
    expect(strings.length).toBeGreaterThan(10);
    for (const s of strings) {
      expect(s).not.toMatch(BANNED);
      expect(s).not.toMatch(/\d/);
    }
  });

  it('defaults to live without dev controls, mock with them', () => {
    expect(defaultSource(false, '')).toBe('live');
    expect(defaultSource(true, '')).toBe('mock');
  });

  it('honours ?source=mock in the URL for demos', () => {
    expect(defaultSource(false, '?source=mock')).toBe('mock');
    expect(defaultSource(true, '?source=mock')).toBe('mock');
    expect(defaultSource(false, '?source=live')).toBe('live');
  });

  it('the banned pattern catches a hard-coded violation', () => {
    expect('Camera on, about 24 fps. 3 calls saved.').toMatch(BANNED);
  });

  it('the banned pattern catches a violation in session-control wording', () => {
    // Proof the guard covers the new controls: a banned line shaped like a
    // recording status must fail, while the real status lines pass.
    expect('Recording on, 2 calls saved.').toMatch(BANNED);
    expect(STATUS_RECORDING_ON).not.toMatch(BANNED);
    expect(EMERGENCY_STOPPED_NOTE).not.toMatch(BANNED);
    expect(MARK_DONE_NOTE).not.toMatch(BANNED);
  });
});

describe('session indicator and coach panel', () => {
  function stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, ' ');
  }

  it('renders every System 1 state with no banned words', () => {
    for (const state of ['moving_well', 'hesitating', 'struggling', 'cant_see_you'] as const) {
      const html = renderToStaticMarkup(
        <StruggleIndicator state={state} score={0.81} fixLine="Keep your arm in view of the camera." />,
      );
      expect(html).not.toMatch(BANNED);
      expect(html).not.toMatch(STAT_TESTID);
    }
  });

  it("shows the fix line for Can't see you", () => {
    const html = renderToStaticMarkup(
      <StruggleIndicator state="cant_see_you" score={0.2} fixLine="Keep your arm in view of the camera." />,
    );
    // React escapes the apostrophe in static markup.
    expect(html).toContain('Can&#x27;t see you');
    expect(html).toContain('Keep your arm in view of the camera.');
  });

  it('shows the drop why line for a falling hand', () => {
    const html = renderToStaticMarkup(
      <StruggleIndicator state="struggling" score={0.9} fixLine={null} topSignal="drop" />,
    );
    expect(html).toContain('Your hand is coming down.');
    expect(html).not.toMatch(BANNED);
    expect(html).not.toMatch(STAT_TESTID);
  });

  it('shows the why line only for hesitating and struggling with a top signal', () => {
    const hesitating = renderToStaticMarkup(
      <StruggleIndicator state="hesitating" score={0.5} fixLine={null} topSignal="stall" />,
    );
    expect(hesitating).toContain('Movement has stalled.');
    const movingWell = renderToStaticMarkup(
      <StruggleIndicator state="moving_well" score={0.1} fixLine={null} topSignal="stall" />,
    );
    expect(movingWell).not.toContain('Movement has stalled.');
    const noSignal = renderToStaticMarkup(
      <StruggleIndicator state="struggling" score={0.9} fixLine={null} topSignal={undefined} />,
    );
    expect(noSignal).not.toContain('Movement has stalled.');
    for (const html of [hesitating, movingWell, noSignal]) {
      expect(html).not.toMatch(BANNED);
    }
  });

  it('renders the score meter with no digits, percent, or counts', () => {
    const html = renderToStaticMarkup(<StruggleIndicator state="struggling" score={0.81} fixLine={null} />);
    expect(html).toContain('score-bar');
    const text = stripTags(html);
    expect(text).not.toMatch(/\d/);
    expect(text).not.toContain('%');
    expect(text).not.toMatch(/\bof\b/i);
  });

  it('shows an empty steady bar for moving well with no scored window yet', () => {
    const html = renderToStaticMarkup(<StruggleIndicator state="moving_well" score={null} fixLine={null} />);
    expect(html).toContain('Moving well');
    expect(html).toContain('score-bar');
    expect(html).toContain('Steadiness: steady');
    expect(html).not.toMatch(BANNED);
    expect(stripTags(html)).not.toMatch(/\d/);
  });

  it('renders the coach panel idle with no banned words', () => {
    const html = renderToStaticMarkup(
      <CoachPanel
        frame={okFrame()}
        systemState="hesitating"
        topSignal="stall"
        cantSeeYouActive={false}
        escalationId={0}
        statsEpoch="test"
      />,
    );
    expect(html).toContain('Get a tip');
    expect(html).not.toMatch(BANNED);
    expect(html).not.toMatch(STAT_TESTID);
  });

  it('says tips are off instead of Get a tip when the summary choice is unticked', () => {
    const html = renderToStaticMarkup(
      <CoachPanel
        frame={okFrame()}
        systemState="hesitating"
        topSignal="stall"
        cantSeeYouActive={false}
        escalationId={0}
        statsEpoch="test"
        consent={{ camera: false, recording: false, cloud_summary: false, cloud_clips: false }}
      />,
    );
    expect(html).toContain('Tips are off');
    expect(html).not.toContain('Get a tip');
    expect(html).not.toMatch(BANNED);
    expect(html).not.toMatch(STAT_TESTID);
  });

  it('disables the button instead of repeating the fix line when tracking is lost', () => {
    const html = renderToStaticMarkup(
      <CoachPanel
        frame={okFrame()}
        systemState="cant_see_you"
        topSignal={undefined}
        cantSeeYouActive
        escalationId={0}
        statsEpoch="test"
      />,
    );
    // The fix line lives in StruggleIndicator; the panel just stays disabled.
    expect(html).not.toContain('Try turning to face the camera.');
    expect(html).not.toContain('Try keeping your forearm');
    expect(html).toContain('disabled');
    expect(html).not.toMatch(BANNED);
  });
});

describe('fps lives outside the session view', () => {
  it('no session-facing source file reads liveStats back for display', () => {
    // Producer useLivePose is intentionally excluded: it publishes the stats.
    // SessionPage is allowed to publish reach details (never rendered there);
    // what stays forbidden is subscribing to stats for session display.
    const sessionFacing = [
      '../src/pages/SessionPage.tsx',
      '../src/components/AngleReadout.tsx',
      '../src/components/VideoStage.tsx',
      '../src/components/MockTransport.tsx',
      '../src/components/SourceSwitch.tsx',
      '../src/components/ErrorBoundary.tsx',
      '../src/components/StruggleIndicator.tsx',
      '../src/components/CoachPanel.tsx',
      '../src/pose/statusText.ts',
      '../src/system1/cantSeeYou.ts',
      '../src/system1/windows.ts',
      '../src/coach/summary.ts',
      '../src/copy.ts',
    ];
    for (const rel of sessionFacing) {
      const src = readFileSync(new URL(rel, import.meta.url), 'utf-8');
      expect(src, `${rel} must not subscribe to liveStats`).not.toMatch(
        /useLiveStats|useGateDetails|useReachDetails|subscribeLiveStats|subscribeGateDetails|subscribeReachDetails/,
      );
    }
  });

  it('no session-facing source file imports replay, recorder, loop metrics, or review modules', () => {
    // The shared per-frame pipeline (pipeline/run) is the one exception: the
    // live session and clip replay both call it. Everything replay-shaped —
    // the replay runner, its policies, the recorder, the results panel, and
    // metrics copy — stays off the session route. So does the review bundle
    // (/review only, behind dev controls).
    const sessionFacing = [
      '../src/pages/SessionPage.tsx',
      '../src/components/AngleReadout.tsx',
      '../src/components/VideoStage.tsx',
      '../src/components/MockTransport.tsx',
      '../src/components/SourceSwitch.tsx',
      '../src/components/ErrorBoundary.tsx',
      '../src/components/StruggleIndicator.tsx',
      '../src/components/CoachPanel.tsx',
      '../src/components/CalibrationStep.tsx',
      '../src/components/FaceReachStep.tsx',
    ];
    for (const rel of sessionFacing) {
      const src = readFileSync(new URL(rel, import.meta.url), 'utf-8');
      expect(src, `${rel} must stay off the session route`).not.toMatch(
        /pipeline\/replay|pipeline\/policies|pipeline\/clip|LoopMetricsPanel|ClipRecorder|ReplaySection|metricsCopy|review\/|reviewCopy|ReviewBundle|ReviewClip/,
      );
    }
  });

  it('the session page renders no fps text', () => {
    expect(sessionMarkup()).not.toMatch(/\bfps\b/i);
  });

  it('fps renders on /metrics, the designated reviewer route', () => {
    publishLiveStats({ status: 'live', fps: 24 });
    const html = renderToStaticMarkup(
      <MockStreamContext.Provider value={preloadedValue()}>
        <MetricsPage />
      </MockStreamContext.Provider>,
    );
    expect(html).toContain('fps');
  });
});

describe('session live branch (no camera)', () => {
  function liveMarkup(): string {
    return renderToStaticMarkup(
      <MockStreamContext.Provider value={preloadedValue()}>
        <SessionPage initialSource="live" />
      </MockStreamContext.Provider>,
    );
  }

  it('renders the live branch with no banned words and no stat test ids', () => {
    const html = liveMarkup();
    // Same mandated delete wording as the mock branch (see above).
    expect(html).toContain(DELETE_CLIPS_CONFIRM);
    const guarded = html.split(DELETE_CLIPS_CONFIRM).join('');
    expect(guarded).not.toMatch(BANNED);
    expect(html).not.toMatch(STAT_TESTID);
  });

  it('shows no digits next to the status text', () => {
    const html = liveMarkup();
    const paras = [...html.matchAll(/<p aria-live="polite">([^<]*)<\/p>/g)];
    const status = paras.map((m) => m[1]).find((t) => t.includes('Camera'));
    if (status === undefined) throw new Error('live status paragraph missing');
    expect(status).not.toMatch(/\d/);
  });

  it('includes camera controls and stage toggles', () => {
    const html = liveMarkup();
    expect(html).toContain('Start camera');
    expect(html).toContain('Stop camera');
    expect(html).toContain('Skeleton:');
    expect(html).toContain('Mirror:');
  });
});
