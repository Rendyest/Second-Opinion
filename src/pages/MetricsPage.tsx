import { MockTransport } from '../components/MockTransport';
import { ClipRecorder } from '../components/ClipRecorder';
import { ReplaySection } from '../components/ReplaySection';
import { useMockStream } from '../mock/MockStreamContext';
import { useGateDetails, useLiveStats, useReachDetails, type GateBoneDetails } from '../pose/liveStats';
import { config as appConfig } from '../config';
import type { System1State } from '../contracts';

function fmt(v: number | null): string {
  return v === null ? '—' : v.toFixed(3);
}

function boneLine(name: string, bone: GateBoneDetails, foreshorteningMin: number, tol: number): string {
  return (
    `${name}: ratio ${fmt(bone.ratio)}, smoothed ratio ${fmt(bone.smoothedRatio)} ` +
    `(min ${foreshorteningMin}); normLen ${fmt(bone.normLen)}, history median ${fmt(bone.historyMedian)}, ` +
    `jump fraction ${fmt(bone.jumpFraction)} (tol ${tol})`
  );
}

/**
 * Reviewer/judge route. The full LoopMetricsPanel (three policies, chart,
 * latency, export) arrives in slice 5; this slice wires the replay counters
 * and the configurable baseline to the mock stream.
 */
export function MetricsPage() {
  const { config, player } = useMockStream();
  const liveStats = useLiveStats();
  const gate = useGateDetails();
  const reach = useReachDetails();

  let frames = 0;
  let flagged = 0;
  let windows = 0;
  let escalations = 0;
  let coachCalls = 0;
  if (player !== null) {
    const stats = player.consumedPoseStats();
    frames = stats.frames;
    flagged = stats.flagged;
    for (const e of player.consumed()) {
      if (e.kind === 'system1_state') {
        windows += 1;
        if ((e.data as System1State).escalate) escalations += 1;
      } else if (e.kind === 'coach_event') {
        coachCalls += 1;
      }
    }
  }

  const flagRate = frames > 0 ? `${((flagged / frames) * 100).toFixed(1)}%` : '—';
  const interval = config ? `every ${config.baseline.fixed_interval_s} s` : 'loading config…';

  return (
    <div>
      <h1>Loop metrics (reviewers and judges)</h1>
      <p>
        Demo counters from the mock replay. The full calls-saved comparison (every frame vs fixed
        interval vs gated trigger, chart, latency, export) arrives in slice 5.
      </p>
      <MockTransport />
      <section aria-label="Replay demo counters">
        <h2>Replayed so far</h2>
        <ul>
          <li>Frames replayed: {frames}</li>
          <li>Gate-flagged frames: {flagged} ({flagRate})</li>
          <li>System 1 windows: {windows}</li>
          <li>Escalations: {escalations}</li>
          <li>Coach calls made (this replay): {coachCalls}</li>
        </ul>
        <p>Fixed-interval baseline (from config.json): {interval}.</p>
      </section>
      <section aria-label="Live pipeline">
        <h2>Live pipeline</h2>
        <p>
          {liveStats.status === 'live'
            ? `Camera on, about ${liveStats.fps} fps.`
            : liveStats.status === 'loading'
              ? 'Camera starting…'
              : 'Camera off.'}
        </p>
      </section>
      <section aria-label="Reach (dev)">
        <h2>Reach (dev)</h2>
        {reach === null ? (
          <p>No live source.</p>
        ) : (
          <ul>
            <li>Raw hand distance: {fmt(reach.rawDist)}</li>
            <li>Smoothed hand distance: {fmt(reach.smoothDist)}</li>
            <li>Zone radius: {fmt(reach.zoneRadius)}</li>
            <li>Shoulder rise: {fmt(reach.rise)}</li>
            <li>Phase: {reach.phase}</li>
            <li>Top signal: {reach.topSignal ?? 'none'}</li>
          </ul>
        )}
      </section>
      <section aria-label="Gate (dev)">
        <h2>Gate (dev)</h2>
        {gate === null ? (
          <p>No live source.</p>
        ) : (
          <>
            <p>
              Baseline:{' '}
              {gate.hasBaseline && gate.baseline
                ? `upper arm ${gate.baseline.upperArm.toFixed(3)}, forearm ${gate.baseline.forearm.toFixed(3)}, shoulder width ${gate.baseline.shoulderWidth.toFixed(3)}.`
                : 'none — foreshortening off, visibility and drift on.'}
            </p>
            <ul>
              {gate.joints.map((joint) => (
                <li key={joint.label}>
                  {joint.label} visibility: {joint.conf === null ? '—' : joint.conf.toFixed(2)} (min{' '}
                  {gate.visMin})
                </li>
              ))}
            </ul>
            <p>Scale: {fmt(gate.scale)}</p>
            <ul>
              <li>{boneLine('upper arm', gate.upperArm, gate.foreshorteningMin, gate.boneLengthTol)}</li>
              <li>{boneLine('forearm', gate.forearm, gate.foreshorteningMin, gate.boneLengthTol)}</li>
            </ul>
            <p>Reasons: {gate.reasons.length === 0 ? 'none' : gate.reasons.join(', ')}.</p>
          </>
        )}
      </section>
      <ReplaySection mockEvents={player ? player.consumed() : []} />
      <ClipRecorder enabled={appConfig.ui.dev_controls} />
    </div>
  );
}

