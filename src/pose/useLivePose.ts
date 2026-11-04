import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Joint2D, PoseFrame } from '../contracts';
import { config } from '../config';
import { buildPoseFrame } from './poseFrame';
import { cameraErrorMessage } from './cameraErrors';
import { publishGateDetails, publishLiveStats, type GateBoneDetails, type GateDetails } from './liveStats';
import {
  createGateTracker,
  median,
  type BoneBaseline,
  type GateHistories,
  type GateResult,
  type GateThresholds,
} from './gate';
import { loadCalibrationState } from './calibration';
import { canUseCamera, loadConsent, subscribeCameraWithdrawal } from '../consent/consent';
import { CONSENT_CAMERA_NEED } from '../consentCopy';
import {
  POSE_SIDECAR_URL,
  createSidecarPoseDetector,
  type PoseDetector,
} from './poseProvider';
/**
 * Where pose inference runs (the only runtime network calls this
 * slice makes, besides the local dev server and sidecar):
 * - Pose inference: localhost Detectron2 sidecar (POSE_SIDECAR_URL).
 *   Video frames are POSTed to 127.0.0.1 and never leave the machine.
 *   The sidecar returns COCO-17 points, remapped client-side to the Blaze
 *   slots buildPoseFrame expects (see pose/poseProvider.ts).
 */
export const POSE_SIDECAR_DEFAULT_URL = POSE_SIDECAR_URL;
export const SIDECAR_MESSAGE =
  'Pose sidecar is not running. Start it with `python server/pose_sidecar.py` - Mock replay still works.';

/** Injectable detector factory so tests can supply a fake without a server. */
export type PoseDetectorFactory = () => PoseDetector | Promise<PoseDetector>;
let detectorFactory: PoseDetectorFactory = () => createSidecarPoseDetector();
export function __setPoseDetectorFactory(f: PoseDetectorFactory | null): void {
  detectorFactory = f ?? (() => createSidecarPoseDetector());
}

export type LiveStatus = 'idle' | 'loading' | 'live' | 'denied' | 'error';

export interface LivePose {
  videoRef: RefObject<HTMLVideoElement>;
  status: LiveStatus;
  error: string | null;
  /** Latest pose_frame in the SAME contract as the mock stream. */
  frame: PoseFrame | null;
  trackingLost: boolean;
  fps: number;
  start: () => void;
  stop: () => void;
}

interface CameraRun {
  detector?: PoseDetector;
  stream?: MediaStream;
  video?: HTMLVideoElement;
}

function sameBaseline(a: BoneBaseline | null, b: BoneBaseline | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.upperArm === b.upperArm && a.forearm === b.forearm && a.shoulderWidth === b.shoulderWidth;
}

/** Dev-only snapshot of the latest gate computation for /metrics. Never persisted. */
function buildGateDetails(
  joints: Record<string, Joint2D>,
  baseline: BoneBaseline | null,
  t: GateThresholds,
  hist: GateHistories,
  result: GateResult,
): GateDetails {
  const visDefs = [
    { key: 'r_shoulder', label: 'right shoulder' },
    { key: 'r_elbow', label: 'right elbow' },
    { key: 'r_wrist', label: 'right wrist' },
    { key: 'l_shoulder', label: 'left shoulder' },
  ] as const;
  const bone = (norms: number[], ratios: number[]): GateBoneDetails => {
    const normLen = norms.length > 0 ? norms[norms.length - 1] : null;
    const ratio = ratios.length > 0 ? ratios[ratios.length - 1] : null;
    const smoothedRatio = median(ratios.slice(-t.smooth_frames));
    const historyMedian = median(norms);
    const jumpFraction =
      normLen !== null && historyMedian !== null && historyMedian > 0
        ? Math.abs(normLen - historyMedian) / historyMedian
        : null;
    return { ratio, smoothedRatio, normLen, historyMedian, jumpFraction };
  };
  return {
    hasBaseline: baseline !== null,
    baseline,
    visMin: t.vis_min,
    foreshorteningMin: t.foreshortening_min,
    boneLengthTol: t.bone_length_tol,
    joints: visDefs.map(({ key, label }) => {
      const joint = joints[key];
      const conf = joint && typeof joint.conf === 'number' ? joint.conf : null;
      return { label, conf, visible: conf !== null && conf >= t.vis_min };
    }),
    scale: result.scale ?? null,
    upperArm: bone(hist.upperArmNorms, hist.upperArmRatios),
    forearm: bone(hist.forearmNorms, hist.forearmRatios),
    reasons: [...result.reasons],
  };
}

export function useLivePose(): LivePose {
  const videoRef = useRef<HTMLVideoElement>(null);
  const runRef = useRef<CameraRun | null>(null);
  const rafRef = useRef(0);
  const lastTRef = useRef(0);
  const lastEmitRef = useRef(0);
  const fpsRef = useRef(0);
  const gateTrackerRef = useRef(createGateTracker(config.gate));
  const gateBaselineRef = useRef<BoneBaseline | null>(null);
  const lastGatePublishRef = useRef(0);
  const aliveRef = useRef(true);
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<PoseFrame | null>(null);
  const [trackingLost, setTrackingLost] = useState(false);
  const [fps, setFps] = useState(0);

  // Reviewer routes read pipeline status from here; participant routes never do.
  useEffect(() => {
    publishLiveStats({ status, fps });
  }, [status, fps]);

  const stop = useCallback(() => {
    const run = runRef.current;
    runRef.current = null;
    cancelAnimationFrame(rafRef.current);
    if (run) {
      if (run.video && run.video.srcObject === run.stream) run.video.srcObject = null;
      run.stream?.getTracks().forEach((track) => track.stop());
      run.detector?.close();
    }
    gateTrackerRef.current.reset();
    gateBaselineRef.current = null;
    publishGateDetails(null);
    if (aliveRef.current) {
      setFrame(null);
      setTrackingLost(false);
      setFps(0);
      setStatus('idle');
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    const unsubscribe = subscribeCameraWithdrawal(() => {
      if (runRef.current) stop();
    });
    return () => {
      unsubscribe();
      aliveRef.current = false;
      stop();
    };
  }, [stop]);

  const start = useCallback(() => {
    if (!aliveRef.current || runRef.current) return;
    // Consent is enforced here, not just in the checkboxes: without the
    // camera choice the camera never starts. Ticking it never starts the
    // camera by itself — the person still presses "Turn on camera".
    if (!canUseCamera(loadConsent())) {
      setError(CONSENT_CAMERA_NEED);
      return;
    }
    if (!('mediaDevices' in navigator) || !navigator.mediaDevices?.getUserMedia) {
      setStatus('denied');
      setError('This browser cannot reach a camera. Try a recent Chrome or Edge on localhost or HTTPS.');
      return;
    }
    setStatus('loading');
    setError(null);
    const run: CameraRun = {};
    runRef.current = run;
    const isCurrent = () => runRef.current === run;

    (async () => {
      try {
        let detector: PoseDetector;
        try {
          detector = await detectorFactory();
        } catch {
          if (!isCurrent()) return;
          stop();
          setStatus('error');
          setError(SIDECAR_MESSAGE);
          return;
        }
        if (!isCurrent()) {
          detector.close();
          return;
        }
        run.detector = detector;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!isCurrent()) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        run.stream = stream;
        const video = videoRef.current;
        if (!video) throw new Error('video element not ready');
        run.video = video;
        video.srcObject = stream;
        await video.play();
        if (!isCurrent()) return;
        setStatus('live');
        lastTRef.current = performance.now();
        lastEmitRef.current = 0;
        lastGatePublishRef.current = 0;
        fpsRef.current = 0;
        let lost = false;
        let inFlight = false;

        const handlePoints = (points: { x: number; y: number; visibility?: number }[] | undefined) => {
          if (!isCurrent()) return;
          if (!points?.length) {
            if (!lost) {
              lost = true;
              setFrame(null);
              setTrackingLost(true);
              gateTrackerRef.current.reset();
              publishGateDetails(null);
            }
            return;
          }
          if (lost) {
            lost = false;
            setTrackingLost(false);
          }
          const nextFrame = buildPoseFrame(points, video.currentTime, Math.round(fpsRef.current));
          const baseline = loadCalibrationState().baseline;
          const gateTracker = gateTrackerRef.current;
          if (!sameBaseline(gateBaselineRef.current, baseline)) {
            gateTracker.reset();
            gateBaselineRef.current = baseline;
          }
          const gateResult = gateTracker.push(nextFrame.joints, baseline);
          setFrame(nextFrame);
          // Dev panel updates at most the slower of the readout and emit rates.
          const gatePublishIntervalMs = 1000 / Math.min(config.ui.readout_hz, config.ui.live_emit_hz);
          const now = performance.now();
          if (now - lastGatePublishRef.current >= gatePublishIntervalMs) {
            lastGatePublishRef.current = now;
            publishGateDetails(
              buildGateDetails(nextFrame.joints, baseline, config.gate, gateTracker.snapshot(), gateResult),
            );
          }
        };

        const loop = () => {
          if (!isCurrent()) return;
          rafRef.current = requestAnimationFrame(loop);
          if (video.readyState < 2) return;
          const now = performance.now();
          const dt = now - lastTRef.current;
          lastTRef.current = now;
          if (dt > 0) {
            const inst = 1000 / dt;
            fpsRef.current = fpsRef.current === 0 ? inst : fpsRef.current * 0.9 + inst * 0.1;
            setFps(Math.round(fpsRef.current));
          }
          // Emit at most ui.live_emit_hz: the UI must not compete with inference.
          if (now - lastEmitRef.current < 1000 / config.ui.live_emit_hz) return;
          if (inFlight) return;
          lastEmitRef.current = now;
          inFlight = true;
          void detector
            .detect(video, now)
            .then(handlePoints)
            .finally(() => {
              inFlight = false;
            });
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch (e: unknown) {
        if (!isCurrent()) return;
        stop();
        const mapped = cameraErrorMessage(e);
        setStatus(mapped.status);
        setError(mapped.message);
      }
    })();
  }, [stop]);

  return { videoRef, status, error, frame, trackingLost, fps, start, stop };
}
