import { MockTransport } from '../components/MockTransport';
import { ClipRecorder } from '../components/ClipRecorder';
import { CoachCallLog } from '../components/CoachCallLog';
import { ReplaySection } from '../components/ReplaySection';
import { useMockStream } from '../mock/MockStreamContext';
import { useGateDetails, useLiveStats, useReachDetails, type GateBoneDetails } from '../pose/liveStats';
import { config as appConfig } from '../config';
import type { System1State } from '../contracts';
import { SESSION_ANGLES, useCompletedSession } from '../metrics/sessionSummary';

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
  const completed = useCompletedSession();

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
    <div className="page reviewer-page metrics-page">
      <header className="page-heading">
        <h1>Session metrics</h1>
        <p>Review movement estimates, System 1 events, and coaching outcomes.</p>
      </header>
      <section className="panel live-report" aria-label="Most recently completed live session">
        <div className="section-heading">
          <h2>Most recently completed live session</h2>
          <span className="source-label">Live camera</span>
        </div>
        {!completed ? <div className="empty-state"><p>No completed live session is available.</p><p>Finish a camera session to see its summary here.</p></div> : (
          <>
            <p>Source: live camera session. Angles are webcam estimates from usable frames.</p>
            <dl className="metric-definitions">
              <div>
                <dt>Active session duration, excluding pauses</dt>
                <dd>{(completed.durationMs / 1000).toFixed(1)} seconds</dd>
              </div>
              {Object.entries(SESSION_ANGLES).map(([key, label]) => {
                const angle = completed.angles[key as keyof typeof SESSION_ANGLES];
                return (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{angle
                      ? `${angle.min.toFixed(1)}°–${angle.max.toFixed(1)}°, mean ${(angle.sum / angle.count).toFixed(1)}° (n=${angle.count})`
                      : 'Unavailable — no usable readings'}
                    {angle && (
                      <div className="angle-chart" aria-hidden="true">
                        <svg viewBox="0 0 184 14" preserveAspectRatio="none">
                          <line x1="2" x2="182" y1="7" y2="7" className="chart-track" />
                          <line x1={angle.min + 2} x2={angle.max + 2} y1="7" y2="7" className="chart-range" />
                          <line x1={angle.sum / angle.count + 2} x2={angle.sum / angle.count + 2} y1="2" y2="12" className="chart-mean" />
                        </svg>
                        <div><span>0°</span><span>90°</span><span>180°</span></div>
                      </div>
                    )}
                    </dd>
                  </div>
                );
              })}
              <div>
                <dt>System 1 struggle episodes</dt>
                <dd>{completed.windows ? completed.episodes : 'Unavailable — no System 1 results'}</dd>
              </div>
              <div>
                <dt>System 1 coaching signals</dt>
                <dd>{completed.windows ? completed.escalations : 'Unavailable — no System 1 results'}</dd>
              </div>
            </dl>
            {Object.entries(completed.signals).length > 0 && (
              <ul aria-label="Struggle episodes by first signal">
                {Object.entries(completed.signals).map(([signal, count]) => (
                  <li key={signal}>{signal.replace(/_/g, ' ')}: {count}</li>
                ))}
              </ul>
            )}
            <h3>Coaching outcomes by trigger</h3>
            <ul>
              {(['button', 'escalation'] as const).map((trigger) => {
                const counts = completed.coaching[trigger];
                return (
                  <li key={trigger}>
                    {trigger === 'button' ? 'Manual' : 'System 1'}: {counts.live} cloud tips,{' '}
                    {counts.fallback} local fallbacks, {counts.local} local tips with cloud off,{' '}
                    {counts.cancelled} cancelled cloud requests
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      <section className="panel replay-panel" aria-label="Simulated replay">
        <div className="section-heading"><h2>Replay workspace</h2><span className="source-label">Simulated data</span></div>
        <p>
          The mock replay counters below are simulated and separate from the live session.
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
      </section>
      <details className="disclosure">
        <summary>Live pipeline diagnostics</summary>
        <div className="diagnostic-grid">
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
        <CoachCallLog />
        </div>
      </details>
      <ReplaySection mockEvents={player ? player.consumed() : []} />
      <ClipRecorder enabled={appConfig.ui.dev_controls} />
    </div>
  );
}
