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
import { publishReachDetails } from '../pose/liveStats';
import { useCalibration } from '../pose/calibration';
import { statusText } from '../pose/statusText';
import { StruggleIndicator } from '../components/StruggleIndicator';
import { CoachPanel } from '../components/CoachPanel';
import { SessionControls } from '../components/SessionControls';
import { ConsentForm } from '../components/ConsentForm';
import { DeleteMyClips } from '../components/DeleteMyClips';
import { useConsent } from '../consent/consent';
import { SESSION_INTRO, SESSION_PRIVACY_NOTE } from '../copy';
import type { PoseFrame, System1State, System1StateName } from '../contracts';

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

  const mockFrame = (snapshot?.latest.pose_frame?.data ?? null) as PoseFrame | null;
  const frame = source === 'live' ? live.frame : mockFrame;
  const cameraOn = source === 'live' && live.status === 'live';

  // Merge the stored calibration into the gate: flags are only added, and
  // without a baseline the gate runs visibility plus drift (less reliable).
  const { state: calibration } = useCalibration();
  // Consent choices, changeable here so a person can withdraw mid-session.
  // Withdrawing camera stops the session; recording stops any recording.
  const { consent, set: setConsent } = useConsent();
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
  const [paused, setPaused] = useState(false);
  const wasPaused = useRef(false);
  useEffect(() => {
    if (wasPaused.current && !paused) {
      pipelineRef.current?.resetWindow();
      setCantSeeEpisodes((e) => e + 1);
    }
    wasPaused.current = paused;
  }, [paused]);

  // Fresh history whenever the picture source, the camera lifecycle, or the
  // stored baseline changes (re-run calibration, cleared calibration).
  useEffect(() => {
    pipelineRef.current?.reset();
    publishReachDetails(null);
    lastPushedRef.current = null;
    setCantSee({ active: false, fixLine: null });
    setLiveSystem(null);
  }, [source, live.status, calibration.baseline]);

  // Withdrawing the camera choice stops the camera and the session.
  const liveStatus = live.status;
  const liveStop = live.stop;
  useEffect(() => {
    if (!consent.camera && (liveStatus === 'live' || liveStatus === 'loading')) {
      liveStop();
    }
  }, [consent.camera, liveStatus, liveStop]);

  useEffect(() => {
    if (!frame) {
      setEffectiveFrame(null);
      return;
    }
    // Paused: scoring, coaching stats and recording stay frozen; the camera
    // picture stays as it is.
    if (paused) return;
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
  }, [frame, calibration.baseline, source, paused]);

  // Dev-only controls (mock/live switch, mock transport) stay hidden unless
  // the local config turns them on. Participants never see them.
  const devControls = config.ui.dev_controls;

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
    <div>      <h1>Session — wash your face with the face towel</h1>
      <p>
        {SESSION_INTRO} {SESSION_PRIVACY_NOTE}
      </p>

      <ConsentForm consent={consent} onChange={setConsent} />
      <DeleteMyClips />

      {devControls && (
        <SourceSwitch
          value={source}
          onChange={(next) => {
            if (next === 'mock') live.stop();
            setSource(next);
          }}
        />
      )}

      {source === 'live' && (
        <section aria-label="Camera controls">
          <h2>Camera</h2>
          <p aria-live="polite">{statusText(live.status)}</p>
          {live.error && <p role="alert">{live.error}</p>}
          {live.error && <p>Mock replay still works — switch Picture source back to Mock replay.</p>}
          <div className="button-row">
            <button type="button" onClick={live.start} disabled={live.status === 'loading' || live.status === 'live'}>
              Start camera
            </button>
            <button type="button" onClick={live.stop} disabled={live.status !== 'live' && live.status !== 'loading'}>
              Stop camera
            </button>
          </div>
          <p>Pose runs on this laptop only. No pictures leave your machine in this slice.</p>
        </section>
      )}

      <ErrorBoundary>
        <VideoStage
          frame={effectiveFrame}
          mirrored={mirrored}
          showSkeleton={showSkeleton}
          dimBelowConf={config.gate.vis_min}
          videoRef={live.videoRef}
          cameraOn={cameraOn}
          cameraHint={
            source === 'live'
              ? 'Camera off — press Start camera below to turn on your camera.'
              : undefined
          }
          uncalibrated={calibration.baseline === null}
        />
      </ErrorBoundary>

      <div className="button-row" role="group" aria-label="Stage toggles">
        <button type="button" onClick={() => setShowSkeleton((v) => !v)} aria-pressed={showSkeleton}>
          Skeleton: {showSkeleton ? 'on' : 'off'}
        </button>
        <button type="button" onClick={() => setMirrored((v) => !v)} aria-pressed={mirrored}>
          Mirror: {mirrored ? 'on' : 'off'}
        </button>
      </div>

      <AngleReadout frame={effectiveFrame} />

      <StruggleIndicator
        state={systemState}
        score={systemScore}
        fixLine={cantSee.fixLine}
        topSignal={topSignal}
      />

      <CoachPanel
        frame={effectiveFrame}
        systemState={systemState}
        topSignal={topSignal}
        cantSeeYouActive={cantSee.active}
        escalationId={escalationId}
        statsEpoch={`${source}|${live.status}|${calibration.baseline === null ? 'none' : 'cal'}|${cantSeeEpisodes}`}
        consent={consent}
        paused={paused}
        onEnableSpark={() => setConsent('cloud_summary', true)}
      />

      <SessionControls
        liveFrame={live.frame}
        cameraOn={cameraOn}
        consent={consent}
        paused={paused}
        onPause={() => setPaused(true)}
        onResume={() => setPaused(false)}
        onStopCamera={live.stop}
        calibration={calibration}
      />

      {source === 'mock' && devControls && <MockTransport />}
    </div>
  );
}
