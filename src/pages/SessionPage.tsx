import { useEffect, useRef, useState } from 'react';
import { MockTransport } from '../components/MockTransport';
import { SourceSwitch, type PictureSource } from '../components/SourceSwitch';
import { VideoStage } from '../components/VideoStage';
import { AngleReadout } from '../components/AngleReadout';
import { useLivePose } from '../pose/useLivePose';
import { useMockStream } from '../mock/MockStreamContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { config } from '../config';
import { createPipeline } from '../pipeline/run';
import { type CantSeeYou } from '../system1/cantSeeYou';
import { publishLiveStats, publishReachDetails } from '../pose/liveStats';
import { useCalibration } from '../pose/calibration';
import { statusText } from '../pose/statusText';
import { StruggleIndicator } from '../components/StruggleIndicator';
import { CoachPanel } from '../components/CoachPanel';
import { SessionControls, type SessionPhase } from '../components/SessionControls';
import { ConsentForm } from '../components/ConsentForm';
import { DeleteMyClips } from '../components/DeleteMyClips';
import { useConsent } from '../consent/consent';
import { SESSION_INTRO, SESSION_PRIVACY_NOTE } from '../copy';
import type { PoseFrame, System1State, System1StateName } from '../contracts';
import { createSessionSummary, publishCompletedSession } from '../metrics/sessionSummary';
import { clearCoachCalls } from '../coach/coachCalls';

/**
 * Default picture source: live by default (participants never see the
 * switch); mock when the local dev flag is on. `?source=mock` in the URL
 * forces a mock demo regardless.
 */
export function defaultSource(devControls: boolean, search = ''): PictureSource {
  if (new URLSearchParams(search).get('source') === 'mock') return 'mock';
  return devControls ? 'mock' : 'live';
}

/** Participant route: task, picture, angles. No dashboards here. */
export function SessionPage({ initialSource }: { initialSource?: PictureSource }) {
  const { snapshot } = useMockStream();
  const [source, setSource] = useState<PictureSource>(
    () =>
      initialSource ??
      defaultSource(config.ui.dev_controls, typeof window === 'undefined' ? '' : window.location.search),
  );
  const [mirrored, setMirrored] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const live = useLivePose();
  const [phase, setPhase] = useState<SessionPhase>('ready');
  const [sessionId, setSessionId] = useState(0);
  const summaryRef = useRef<ReturnType<typeof createSessionSummary> | null>(null);
  const paused = phase === 'paused';
  const finished = phase === 'finished';

  const mockFrame = (snapshot?.latest.pose_frame?.data ?? null) as PoseFrame | null;
  const frame = source === 'live' ? live.frame : mockFrame;
  const cameraOn = source === 'live' && live.status === 'live';
  const trackingLost = cameraOn && live.trackingLost;

  // Merge the stored calibration into the gate: flags are only added, and
  // without a baseline the gate runs visibility plus drift (less reliable).
  const { state: calibration } = useCalibration();
  // Consent choices, changeable here so a person can withdraw mid-session.
  // Withdrawing camera stops the session; recording stops any recording.
  const { consent, set: setConsent } = useConsent();
  const running = phase === 'running' && cameraOn && consent.camera;

  const startSession = () => {
    if (source !== 'live' || (phase !== 'ready' && !finished)) return;
    if (finished && !consent.camera) return;
    if (consent.camera) {
      publishCompletedSession(null);
      clearCoachCalls();
      if (finished) {
        setSessionId((id) => id + 1);
        setEscalationId(0);
      }
      setPhase('starting');
    }
    live.start();
  };

  const finishSession = () => {
    if (phase !== 'running' && phase !== 'paused') return;
    live.stop();
    setPhase('finished');
  };

  useEffect(() => {
    if (phase === 'starting') {
      if (cameraOn && consent.camera) {
        summaryRef.current = createSessionSummary();
        setPhase('running');
      }
      else if (!consent.camera || live.status === 'denied' || live.status === 'error' || live.status === 'idle') {
        setPhase('ready');
      }
    } else if ((phase === 'running' || phase === 'paused') && (!cameraOn || !consent.camera)) {
      setPhase('finished');
    }
  }, [phase, cameraOn, consent.camera, live.status]);

  useEffect(() => {
    const summary = summaryRef.current;
    if (!summary) return;
    summary.setRunning(running, performance.now());
    if (finished) {
      publishCompletedSession(summary.snapshot());
      summaryRef.current = null;
    }
  }, [running, finished]);

  useEffect(() => () => {
    publishLiveStats({ status: 'idle', fps: 0 });
    publishReachDetails(null);
  }, []);
  // The shared per-frame loop (gate -> can't-see-you -> System 1), also used
  // by clip replay so live and replay cannot drift apart.
  const pipelineRef = useRef<ReturnType<typeof createPipeline> | null>(null);
  if (pipelineRef.current === null) {
    pipelineRef.current = createPipeline({
      gate: config.gate,
      struggle: config.struggle,
      face: config.face,
      smoothing: config.smoothing,
      visMin: config.gate.vis_min,
      cooldownMs: config.coach.cooldown_ms,
    });
  }
  // Each frame is pushed exactly once (StrictMode-safe): the ref guards
  // against the push effect re-running on the same frame object.
  const lastPushedRef = useRef<PoseFrame | null>(null);
  const [effectiveFrame, setEffectiveFrame] = useState<PoseFrame | null>(null);

  const [cantSee, setCantSee] = useState<CantSeeYou>({ active: false, fixLine: null });

  // The live System 1 detector output: angle time series plus gate output in,
  // system1_state out. Mock mode uses the recorded states instead.
  const [liveSystem, setLiveSystem] = useState<System1State | null>(null);
  // Monotonic escalation counter: each detector pulse bumps the id once, and
  // the coach panel asks once per new id (even across cooldowns).
  const [escalationId, setEscalationId] = useState(0);
  // How many Can't-see-you episodes have ended: bumping it restarts coach stats.
  const [cantSeeEpisodes, setCantSeeEpisodes] = useState(0);
  const wasCantSee = useRef(false);
  // Pausing freezes scoring, coaching requests and recording appends; the
  // camera picture stays. Resuming clears the detector windows, as after
  // a tracking gap.
  const resumeSession = () => {
    if (!paused || !cameraOn || !consent.camera) return;
    pipelineRef.current?.resetWindow();
    lastPushedRef.current = frame;
    setEffectiveFrame(null);
    setCantSeeEpisodes((e) => e + 1);
    setPhase('running');
  };

  // Fresh history whenever the picture source, the camera lifecycle, or the
  // stored baseline changes (re-run calibration, cleared calibration).
  useEffect(() => {
    pipelineRef.current?.reset();
    publishReachDetails(null);
    lastPushedRef.current = null;
    wasCantSee.current = false;
    setCantSee({ active: false, fixLine: null });
    setLiveSystem(null);
  }, [source, live.status, calibration.baseline, sessionId]);

  useEffect(() => {
    if (!trackingLost) return;
    summaryRef.current?.trackingGap();
    pipelineRef.current?.reset();
    lastPushedRef.current = null;
    wasCantSee.current = false;
    setCantSee({ active: false, fixLine: null });
    setLiveSystem(null);
    publishReachDetails(null);
    setCantSeeEpisodes((e) => e + 1);
  }, [trackingLost]);

  useEffect(() => {
    if (trackingLost || !frame || finished) {
      setEffectiveFrame(null);
      return;
    }
    // Paused: scoring, coaching stats and recording stay frozen; the camera
    // picture stays as it is.
    if (source === 'live' && !running) return;
    const pipeline = pipelineRef.current;
    if (!pipeline || lastPushedRef.current === frame) return;
    lastPushedRef.current = frame;
    const result = pipeline.push(frame, calibration.baseline, Date.now(), source === 'live');
    setEffectiveFrame(result.frame);
    setCantSee(result.cantSee);
    if (wasCantSee.current && !result.cantSee.active) {
      // Tracking is back: drop the stale window (hysteresis state is kept)
      // and restart coach stats so the gap never counts.
      pipeline.resetWindow();
      setCantSeeEpisodes((e) => e + 1);
    }
    wasCantSee.current = result.cantSee.active;
    if (source === 'live') {
      const next = result.system1;
      if (result.cantSee.active) summaryRef.current?.trackingGap();
      summaryRef.current?.observe(result.frame, next, config.gate.vis_min);
      // Dev-only reach readout for /metrics; never rendered on /session.
      const reach = pipeline.snapshot();
      publishReachDetails({
        rawDist: reach.rawDist,
        smoothDist: reach.lastDist,
        zoneRadius: reach.zoneRadius,
        rise: reach.rise,
        phase: reach.phase,
        topSignal: reach.topSignal,
      });
      if (next) {
        setLiveSystem(next);
        if (next.escalate) setEscalationId((id) => id + 1);
      }
    }
  }, [frame, calibration.baseline, source, running, finished, trackingLost]);

  // Dev-only controls (mock/live switch, mock transport) stay hidden unless
  // the local config turns them on. Participants never see them.
  const devControls = config.ui.dev_controls;
  const mockTransport = source === 'mock' && devControls;

  // Stage toggles live in their own row, except in mock mode where they dock
  // at the far right of the mock transport buttons.
  const stageToggles = (
    <>
      <button type="button" onClick={() => setShowSkeleton((v) => !v)} aria-pressed={showSkeleton}>
        Skeleton: {showSkeleton ? 'on' : 'off'}
      </button>
      <button type="button" onClick={() => setMirrored((v) => !v)} aria-pressed={mirrored}>
        Mirror: {mirrored ? 'on' : 'off'}
      </button>
    </>
  );

  // System 1 state for the indicator: Can't see you wins while the gate
  // can't see the arm; otherwise the mock replay's recorded state, or the
  // live detector's latest state (neutral default until its first window).
  const mockState = (snapshot?.latest.system1_state?.data ?? null) as System1State | null;
  const systemState: System1StateName =
    cantSee.active
      ? 'cant_see_you'
      : source === 'mock'
        ? (mockState?.state ?? 'moving_well')
        : (liveSystem?.state ?? 'moving_well');
  const systemScore: number | null =
    source === 'mock' ? (mockState?.score ?? null) : (liveSystem?.score ?? null);
  const topSignal = source === 'mock' ? mockState?.top_signal : liveSystem?.top_signal;

  return (
    <div className="page session-page">
      <header className="page-heading">
        <h1>Wash your face with a towel</h1>
        <p>Practice a guided movement at your own pace.</p>
      </header>

      <div className="session-layout">
        <section className="session-stage" aria-label="Movement preview">
          <header className="section-heading">
            <h2>Movement preview</h2>
            <span className="source-label">{source === 'mock' ? 'Simulated replay' : 'Live camera'}</span>
          </header>

          {devControls && phase === 'ready' && (
            <SourceSwitch
              value={source}
              onChange={(next) => {
                if (next === 'mock') live.stop();
                setSource(next);
              }}
            />
          )}
          {mockTransport && <MockTransport trailingActions={stageToggles} />}

          {source === 'live' && (
            <section className="camera-controls" aria-label="Camera controls">
              <div className="camera-actions">
                <p aria-live="polite">{statusText(live.status)}</p>
                {(phase === 'ready' || finished) && (
                  <button className="primary-button" type="button" onClick={startSession} disabled={finished && !consent.camera}>
                    {finished ? 'Restart camera' : 'Start camera'}
                  </button>
                )}
                {phase === 'starting' && (
                  <button type="button" onClick={() => {
                    live.stop();
                    setPhase('ready');
                  }}>
                    Cancel start
                  </button>
                )}
              </div>
              {!consent.camera && !finished && <p><a href="#session-privacy">Allow camera use in Privacy and consent</a> to begin.</p>}
              {live.error && <p role="alert">{live.error}</p>}
              {live.error && devControls && <p>Use Picture source to switch to simulated replay.</p>}
              {finished && (
                <p>{consent.camera
                  ? 'Restarting clears this session and any clip you haven’t downloaded.'
                  : 'Allow camera use to restart.'}</p>
              )}
            </section>
          )}

          <ErrorBoundary>
            <VideoStage
              frame={trackingLost || finished ? null : effectiveFrame}
              clearOnMissingFrame={source === 'live'}
              mirrored={mirrored}
              showSkeleton={showSkeleton}
              dimBelowConf={config.gate.vis_min}
              videoRef={live.videoRef}
              cameraOn={cameraOn}
              isReplay={source === 'mock'}
              uncalibrated={calibration.baseline === null}
            />
          </ErrorBoundary>
          {trackingLost && <p role="status">Tracking lost — please return to the camera view</p>}
          {(running || (source === 'mock' && effectiveFrame)) && !trackingLost && !finished && (
            <StruggleIndicator state={systemState} score={systemScore} fixLine={cantSee.fixLine} topSignal={topSignal} />
          )}

          <SessionControls
            key={sessionId}
            liveFrame={!trackingLost && consent.camera ? live.frame : null}
            cameraOn={cameraOn}
            consent={consent}
            phase={phase}
            onPause={() => {
              if (running) setPhase('paused');
            }}
            onResume={resumeSession}
            onFinish={finishSession}
            calibration={calibration}
          />

          {!mockTransport && (
            <div className="button-row" role="group" aria-label="Stage toggles">
              {stageToggles}
            </div>
          )}
          {source === 'mock' && devControls && <MockTransport />}
        </section>

        <div className="session-rail">
          <section className="panel exercise-panel" aria-label="Exercise instructions">
            <h2>Your exercise</h2>
            <p>{SESSION_INTRO}</p>
          </section>
          {!finished && (
            <CoachPanel
              frame={trackingLost ? null : effectiveFrame}
              systemState={systemState}
              topSignal={topSignal}
              cantSeeYouActive={trackingLost || cantSee.active}
              escalationId={escalationId}
              statsEpoch={`${source}|${live.status}|${calibration.baseline === null ? 'none' : 'cal'}|${cantSeeEpisodes}`}
              consent={consent}
              paused={paused}
              active={running}
              onOutcome={summaryRef.current?.recordCoaching}
            />
          )}
        </div>
      </div>

      <div className="session-secondary">
        <details className="disclosure" open={!consent.camera} id="session-privacy">
          <summary>Privacy and consent</summary>
          <p className="muted">{SESSION_PRIVACY_NOTE}</p>
          <ConsentForm consent={consent} onChange={setConsent} />
          <DeleteMyClips onDelete={() => {
            summaryRef.current = null;
            setCantSeeEpisodes((count) => count + 1);
            if (finished) setSessionId((id) => id + 1);
          }} />
        </details>
        {!trackingLost && !finished && (
          <details className="disclosure">
            <summary>Joint-angle details</summary>
            <AngleReadout frame={effectiveFrame} />
          </details>
        )}
      </div>
    </div>
  );
}
