import { afterEach, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PoseFrame, System1State } from '../src/contracts';
import { createSessionSummary, publishCompletedSession } from '../src/metrics/sessionSummary';
import { MockStreamContext } from '../src/mock/MockStreamContext';
import { MetricsPage } from '../src/pages/MetricsPage';

afterEach(() => publishCompletedSession(null));

const frame: PoseFrame = {
  t: 1, fps: 30, joints: {}, gate: { ok: true, reasons: [] },
  angles: {
    r_elbow_flexion: { deg: 30, conf: 1 },
    r_shoulder_elevation: { deg: 45, conf: 0.1 },
  },
};
const struggle: System1State = {
  t: 1, state: 'struggling', score: 0.8, top_signal: 'stall', escalate: true,
};

function renderMetrics() {
  return renderToStaticMarkup(
    <MockStreamContext.Provider value={{ status: 'ready', snapshot: null, player: null, error: null, config: null }}>
      <MetricsPage />
    </MockStreamContext.Provider>,
  );
}

it('aggregates usable angles and actual outcomes while excluding paused time and frames', () => {
  const summary = createSessionSummary();
  summary.setRunning(true, 1000);
  summary.observe(frame, struggle, 0.5);
  summary.observe({ ...frame, angles: { r_elbow_flexion: { deg: 50, conf: 1 } } },
    { ...struggle, escalate: false }, 0.5);
  summary.observe({ ...frame, gate: { ok: false, reasons: [] } }, null, 0.5);
  summary.setRunning(false, 3000);
  summary.observe(frame, struggle, 0.5);
  summary.setRunning(true, 9000);
  summary.observe({ ...frame, angles: {} }, struggle, 0.5);
  summary.recordCoaching('escalation', 'fallback');
  summary.recordCoaching('button', 'cancelled');
  summary.setRunning(false, 10000);
  const finished = summary.snapshot();
  expect(finished).toMatchObject({
    durationMs: 3000, windows: 3, episodes: 2, escalations: 2, signals: { stall: 2 },
    angles: { r_elbow_flexion: { count: 2, min: 30, max: 50, sum: 80 } },
    coaching: { escalation: { fallback: 1 }, button: { cancelled: 1 } },
  });
  expect(finished.angles.r_shoulder_elevation).toBeUndefined();
  expect(JSON.stringify(finished)).not.toContain('joints');

  expect(renderMetrics()).toContain('No completed live session is available.');
  publishCompletedSession(finished);
  const html = renderMetrics();
  expect(html).toContain('3.0 seconds');
  expect(html).toContain('30.0°–50.0°, mean 40.0° (n=2)');
  expect(html).toContain('Unavailable — no usable readings');
  expect(html).toContain('mock replay counters below are simulated');
  publishCompletedSession(null);
  expect(renderMetrics()).not.toContain('mean 40.0°');
});

it('reports missing detector observations separately from zero struggles', () => {
  publishCompletedSession(createSessionSummary().snapshot());
  expect(renderMetrics()).toContain('Unavailable — no System 1 results');
});
