import { useEffect, useRef, useState } from 'react';
import { MockTransport } from '../components/MockTransport';
import { SourceSwitch, type PictureSource } from '../components/SourceSwitch';
import { VideoStage } from '../components/VideoStage';
import { AngleReadout } from '../components/AngleReadout';
import { useLivePose } from '../pose/useLivePose';
import { useMockStream } from '../mock/MockStreamContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { config } from '../config';
import { createGateTracker, mergeGate, type GateTracker } from '../pose/gate';
import { createCantSeeYouTracker, type CantSeeYou } from '../system1/cantSeeYou';
import { createSystem1Detector } from '../system1/detector';
import { publishReachDetails } from '../pose/liveStats';
import { useCalibration } from '../pose/calibration';
import { statusText } from '../pose/statusText';
import { StruggleIndicator } from '../components/StruggleIndicator';
import { CoachPanel } from '../components/CoachPanel';
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
  const trackerRef = useRef<GateTracker | null>(null);
  if (trackerRef.current === null) {
    trackerRef.current = createGateTracker(config.gate);
  }
  // Each frame is pushed exactly once (StrictMode-safe): the ref guards
  // against the push effect re-running on the same frame object.
  const lastPushedRef = useRef<PoseFrame | null>(null);
  const [effectiveFrame, setEffectiveFrame] = useState<PoseFrame | null>(null);

  const cantSeeRef = useRef<ReturnType<typeof createCantSeeYouTracker> | null>(null);
  if (cantSeeRef.current === null) {
    cantSeeRef.current = createCantSeeYouTracker(
      config.gate.cant_see_enter_frames,
      config.gate.cant_see_exit_frames,
    );
  }
  const [cantSee, setCantSee] = useState<CantSeeYou>({ active: false, fixLine: null });

  // The live System 1 detector: angle time series plus gate output in,
  // system1_state out. Mock mode uses the recorded states instead.
  const detectorRef = useRef<ReturnType<typeof createSystem1Detector> | null>(null);
  if (detectorRef.current === null) {
    detectorRef.current = createSystem1Detector({
      struggle: config.struggle,
      face: config.face,
      smoothing: config.smoothing,
      visMin: config.gate.vis_min,
      cooldownMs: config.coach.cooldown_ms,
    });
  }
  const [liveSystem, setLiveSystem] = useState<System1State | null>(null);
  // Monotonic escalation counter: each detector pulse bumps the id once, and
  // the coach panel asks once per new id (even across cooldowns).
  const [escalationId, setEscalationId] = useState(0);
  // How many Can't-see-you episodes have ended: bumping it restarts coach stats.
  const [cantSeeEpisodes, setCantSeeEpisodes] = useState(0);
  const wasCantSee = useRef(false);

  // Fresh history whenever the picture source, the camera lifecycle, or the
  // stored baseline changes (re-run calibration, cleared calibration).
  useEffect(() => {
    trackerRef.current?.reset();
    cantSeeRef.current?.reset();
    detectorRef.current?.reset();
    publishReachDetails(null);
    lastPushedRef.current = null;
    setCantSee({ active: false, fixLine: null });
    setLiveSystem(null);
  }, [source, live.status, calibration.baseline]);

  useEffect(() => {
    if (!frame) {
      setEffectiveFrame(null);
      return;
    }
    const tracker = trackerRef.current;
    const cantSeeTracker = cantSeeRef.current;
    const detector = detectorRef.current;
    if (!tracker || !cantSeeTracker || !detector || lastPushedRef.current === frame) return;
    lastPushedRef.current = frame;
    const computed = tracker.push(frame.joints, calibration.baseline);
    const merged = mergeGate(frame, computed);
    setEffectiveFrame(merged);
    const nextCantSee = cantSeeTracker.push(computed.ok, computed.reasons);
    setCantSee(nextCantSee);
    if (wasCantSee.current && !nextCantSee.active) {
      // Tracking is back: drop the stale window (hysteresis state is kept)
      // and restart coach stats so the gap never counts.
      detector.resetWindow();
      setCantSeeEpisodes((e) => e + 1);
    }
    wasCantSee.current = nextCantSee.active;
    if (source === 'live') {
      const next = detector.push(merged, Date.now());
      // Dev-only reach readout for /metrics; never rendered on /session.
      const reach = detector.snapshot();
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
  }, [frame, calibration.baseline, source]);

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
    <div>      <h1>Session — wash your face with the cloth</h1>
      <p>
        {SESSION_INTRO} {SESSION_PRIVACY_NOTE}
      </p>

      {devControls && (
        <SourceSwitch
          value={source}
          onChange={(next) => {
            if (next === 'mock') live.stop();
            setSource(next);
          }}
        />
      )}

      <ErrorBoundary>
        <VideoStage
          frame={effectiveFrame}
          mirrored={mirrored}
          showSkeleton={showSkeleton}
          dimBelowConf={config.gate.vis_min}
          videoRef={live.videoRef}
          cameraOn={cameraOn}
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
      />

      {source === 'mock' && devControls && <MockTransport />}

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
    </div>
  );
}
