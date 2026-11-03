import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionPage } from '../src/pages/SessionPage';
import { MetricsPage } from '../src/pages/MetricsPage';
import { MockStreamContext, type MockStreamValue } from '../src/mock/MockStreamContext';
import { MockPlayer } from '../src/mock/mockStreamPlayer';
import { parseReplayFile } from '../src/contracts';
import {
  publishGateDetails,
  publishReachDetails,
  type GateDetails,
  type ReachDetails,
} from '../src/pose/liveStats';
import { config } from '../src/config';

const DEV_LABELS = [
  'Gate (dev)',
  'smoothed ratio',
  'history median',
  'jump fraction',
  'No live source.',
  'Reach (dev)',
  'Raw hand distance',
  'Smoothed hand distance',
  'Zone radius',
  'Shoulder rise',
  'Top signal',
];

/** SessionPage against the real mock replay, stepped to the t=1.5 pose_frame. */
function sessionMarkup(): string {
  const raw = readFileSync(new URL('../public/mock-stream.json', import.meta.url), 'utf-8');
  const player = new MockPlayer();
  player.setEvents(parseReplayFile(JSON.parse(raw) as unknown));
  player.step(3);
  const value: MockStreamValue = {
    status: 'ready',
    error: null,
    player,
    config,
    snapshot: player.snapshot(),
  };
  return renderToStaticMarkup(
    <MockStreamContext.Provider value={value}>
      <SessionPage />
    </MockStreamContext.Provider>,
  );
}

function metricsMarkup(): string {
  const value: MockStreamValue = { status: 'loading', error: null, player: null, config: null, snapshot: null };
  return renderToStaticMarkup(
    <MockStreamContext.Provider value={value}>
      <MetricsPage />
    </MockStreamContext.Provider>,
  );
}

const FIXTURE: GateDetails = {
  hasBaseline: true,
  baseline: { upperArm: 100, forearm: 100, shoulderWidth: 100 },
  visMin: 0.5,
  foreshorteningMin: 0.5,
  boneLengthTol: 0.3,
  joints: [
    { label: 'right shoulder', conf: 0.93, visible: true },
    { label: 'right elbow', conf: 0.91, visible: true },
    { label: 'right wrist', conf: 0.88, visible: true },
    { label: 'left shoulder', conf: 0.9, visible: true },
  ],
  scale: 1.38,
  upperArm: { ratio: 1, smoothedRatio: 1, normLen: 1, historyMedian: 1, jumpFraction: 0 },
  forearm: { ratio: 0.4, smoothedRatio: 0.4, normLen: 0.4, historyMedian: 0.4, jumpFraction: 0 },
  reasons: ['foreshortening'],
};

describe('gate dev diagnostics live on /metrics, never on /session', () => {
  it('shows none of the diagnostic labels on the session page', () => {
    const html = sessionMarkup();
    for (const label of DEV_LABELS) {
      expect(html).not.toContain(label);
    }
  });

  it('shows "No live source." on /metrics with no live data', () => {
    publishGateDetails(null);
    expect(metricsMarkup()).toContain('No live source.');
  });

  it('shows the gate details on /metrics when published', () => {
    publishGateDetails(FIXTURE);
    const html = metricsMarkup();
    expect(html).toContain('Gate (dev)');
    expect(html).toContain('right shoulder visibility');
    expect(html).toContain('smoothed ratio');
    expect(html).toContain('history median');
    expect(html).toContain('jump fraction');
    expect(html).toContain('foreshortening');
    publishGateDetails(null);
  });
});

const REACH_FIXTURE: ReachDetails = {
  rawDist: 0.31,
  smoothDist: 0.29,
  zoneRadius: 0.3,
  rise: 0.2,
  phase: 'reach',
  topSignal: 'stall',
};

describe('reach dev diagnostics live on /metrics, never on /session', () => {
  it('shows no reach labels on the session page', () => {
    const html = sessionMarkup();
    for (const label of ['Reach (dev)', 'Raw hand distance', 'Smoothed hand distance']) {
      expect(html).not.toContain(label);
    }
  });

  it('shows no reach readout on /metrics with no live data', () => {
    publishReachDetails(null);
    publishGateDetails(FIXTURE);
    expect(metricsMarkup()).not.toContain('Raw hand distance');
    publishGateDetails(null);
  });

  it('shows the reach readout on /metrics when published', () => {
    publishReachDetails(REACH_FIXTURE);
    const html = metricsMarkup();
    expect(html).toContain('Reach (dev)');
    expect(html).toContain('Raw hand distance');
    expect(html).toContain('Smoothed hand distance');
    expect(html).toContain('Zone radius');
    expect(html).toContain('Shoulder rise');
    expect(html).toContain('Top signal');
    expect(html).toContain('stall');
    publishReachDetails(null);
  });
});

describe('loop comparison on /metrics, never on /session', () => {
  it('shows no loop labels on the session page', () => {
    const html = sessionMarkup();
    for (const label of ['Loop comparison (dev)', 'Replay (dev)', 'Record a clip (dev)']) {
      expect(html).not.toContain(label);
    }
  });

  it('shows "No results yet" with no counters and no replay output', () => {
    publishGateDetails(null);
    publishReachDetails(null);
    const html = metricsMarkup();
    expect(html).toContain('No results yet');
    expect(html).not.toContain('Calls saved');
    expect(html).not.toContain('Gate flag rate');
    expect(html).not.toContain('System 2');
  });
});
