import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CoachPanel } from '../src/components/CoachPanel';
import { CoachCallLog } from '../src/components/CoachCallLog';
import { clearCoachCalls, recordCoachCall, subscribeCoachCalls } from '../src/coach/coachCalls';
import {
  COACH_CALLS_EMPTY,
  COACH_CALLS_FALLBACK,
  COACH_CALLS_LIVE,
  COACH_CALLS_SECTION_TITLE,
  COACH_CALLS_TRIGGER_BUTTON,
  COACH_CALLS_TRIGGER_ESCALATION,
} from '../src/metricsCopy';
import { LIVE_TIP_NOTE } from '../src/copy';
import type { PoseFrame } from '../src/contracts';

const BANNED = /\b(fps|frames?|calls?|saved|flag rate|latency|escalat\w*)\b/i;

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

describe('coach call log', () => {
  it('sequences records and notifies subscribers', () => {
    clearCoachCalls();
    let notes = 0;
    const unsub = subscribeCoachCalls(() => {
      notes += 1;
    });
    const first = recordCoachCall({ trigger: 'escalation', state: 'struggling', topSignal: 'stall', outcome: 'live' });
    const second = recordCoachCall({ trigger: 'button', state: 'hesitating', outcome: 'fallback' });
    unsub();
    recordCoachCall({ trigger: 'button', state: 'moving_well', outcome: 'live' });
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(notes).toBe(2);
    expect(first.outcome).toBe('live');
    expect(second.topSignal).toBeUndefined();
    clearCoachCalls();
  });

  it('clears back to an empty log with the sequence reset', () => {
    clearCoachCalls();
    const htmlBefore = renderToStaticMarkup(<CoachCallLog />);
    expect(htmlBefore).toContain(COACH_CALLS_EMPTY);
    recordCoachCall({ trigger: 'button', state: 'moving_well', outcome: 'live' });
    expect(renderToStaticMarkup(<CoachCallLog />)).not.toContain(COACH_CALLS_EMPTY);
    clearCoachCalls();
    const next = recordCoachCall({ trigger: 'button', state: 'moving_well', outcome: 'live' });
    expect(next.seq).toBe(1);
    clearCoachCalls();
  });

  it('renders the empty state with no numbers shown', () => {
    clearCoachCalls();
    const html = renderToStaticMarkup(<CoachCallLog />);
    expect(html).toContain(COACH_CALLS_SECTION_TITLE);
    expect(html).toContain(COACH_CALLS_EMPTY);
    expect(html).not.toContain('<li>');
  });

  it('renders each attempt with outcome, state and trigger', () => {
    clearCoachCalls();
    recordCoachCall({ trigger: 'escalation', state: 'struggling', topSignal: 'stall', outcome: 'live' });
    recordCoachCall({ trigger: 'button', state: 'hesitating', topSignal: 'drop', outcome: 'fallback' });
    const html = renderToStaticMarkup(<CoachCallLog />);
    expect(html).toContain(COACH_CALLS_LIVE);
    expect(html).toContain(COACH_CALLS_FALLBACK);
    expect(html).toContain('Struggling');
    expect(html).toContain('Movement has stalled.');
    expect(html).toContain('Your hand is coming down.');
    expect(html).toContain(COACH_CALLS_TRIGGER_ESCALATION);
    expect(html).toContain(COACH_CALLS_TRIGGER_BUTTON);
    clearCoachCalls();
  });

  it('keeps the reviewer labels free of session banned words', () => {
    for (const s of [
      COACH_CALLS_SECTION_TITLE,
      COACH_CALLS_EMPTY,
      COACH_CALLS_LIVE,
      COACH_CALLS_FALLBACK,
      COACH_CALLS_TRIGGER_ESCALATION,
      COACH_CALLS_TRIGGER_BUTTON,
      LIVE_TIP_NOTE,
    ]) {
      expect(s).not.toMatch(BANNED);
    }
  });
});

describe('coach panel live marker', () => {
  it('idle panel shows no live note', () => {
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
    expect(html).not.toContain(LIVE_TIP_NOTE);
    expect(html).not.toMatch(BANNED);
  });
});
