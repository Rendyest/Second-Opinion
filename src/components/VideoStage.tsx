import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { Joint2D, PoseFrame } from '../contracts';
import { isLowConfidence } from '../pose/angles';
import { GATE_REASON_TEXT } from '../pose/gate';

interface VideoStageProps {
  /** Latest frame from either source; null before the first frame. */
  frame: PoseFrame | null;
  clearOnMissingFrame?: boolean;
  /** Mirror the picture (default on: people expect a mirror view). */
  mirrored: boolean;
  showSkeleton: boolean;
  /** Joints below this confidence render dimmed and dashed. From config.json. */
  dimBelowConf: number;
  /** Live camera element. Detached (no stream) in mock mode. */
  videoRef: RefObject<HTMLVideoElement>;
  cameraOn: boolean;
  isReplay?: boolean;
  /** Live-branch hint shown over the dark stage instead of the default text. */
  cameraHint?: string;
  /** No stored calibration: the gate runs visibility-only and is less reliable. */
  uncalibrated?: boolean;
}

const SEGMENTS: ReadonlyArray<readonly [string, string]> = [
  ['l_shoulder', 'l_elbow'],
  ['l_elbow', 'l_wrist'],
  ['r_shoulder', 'r_elbow'],
  ['r_elbow', 'r_wrist'],
  ['l_shoulder', 'r_shoulder'],
];

export interface DrawableJoint {
  name: string;
  joint: Joint2D;
  weak: boolean;
}

export interface DrawableSegment {
  a: string;
  b: string;
  weak: boolean;
  /** True for the working right-arm segments (landmarks 12/14/16). */
  highlight: boolean;
}

/** Joints of the working arm. Highlight needs both endpoints on this arm. */
const RIGHT_ARM_JOINTS: ReadonlySet<string> = new Set(['r_shoulder', 'r_elbow', 'r_wrist']);

/**
 * Everything the overlay draws, with low-confidence flags attached. Joints
 * are never dropped here — weak ones are dimmed/dashed by the caller.
 * Segments need both endpoints, so a segment is skipped only when a joint
 * is entirely absent; the joints themselves are still listed.
 */
export function drawList(
  frame: PoseFrame,
  dimBelowConf: number,
): { joints: DrawableJoint[]; segments: DrawableSegment[] } {
  const joints = Object.entries(frame.joints).map(([name, joint]) => ({
    name,
    joint,
    weak: isLowConfidence(joint.conf, dimBelowConf),
  }));
  const segments: DrawableSegment[] = [];
  for (const [a, b] of SEGMENTS) {
    const ja = frame.joints[a];
    const jb = frame.joints[b];
    if (!ja || !jb) continue;
    segments.push({
      a,
      b,
      weak: isLowConfidence(Math.min(ja.conf, jb.conf), dimBelowConf),
      highlight: RIGHT_ARM_JOINTS.has(a) && RIGHT_ARM_JOINTS.has(b),
    });
  }
  return { joints, segments };
}

/**
 * Video plus canvas skeleton overlay. The canvas is drawn from the pose_frame
 * only, so the overlay never lags the pipeline. Mirroring is display-only:
 * landmark 12/14/16 always means the person's right arm, so overlay joints
 * and angle labels refer to the same arm either way.
 */
export function VideoStage({
  frame,
  clearOnMissingFrame = false,
  mirrored,
  showSkeleton,
  dimBelowConf,
  videoRef,
  cameraOn,
  isReplay = false,
  cameraHint,
  uncalibrated = false,
}: VideoStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!showSkeleton || (!frame && clearOnMissingFrame)) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    // No frame yet (before the first frame, or the replay looped back to
    // zero): hold the last drawing instead of blanking it. Between events,
    // on pause, and on loop the same frame object keeps arriving, so the
    // overlay below re-draws — or simply persists — the latest pose_frame.
    if (!frame) return;
    const parent = canvas.parentElement;
    const w = parent?.clientWidth ?? 640;
    const h = parent?.clientHeight || Math.round((w * 10) / 16);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    if (mirrored) ctx.setTransform(-1, 0, 0, 1, w, 0);
    const px = (p: Joint2D) => ({ x: p.x * w, y: p.y * h });
    const { joints, segments } = drawList(frame, dimBelowConf);

    for (const { a, b, weak, highlight } of segments) {
      const pa = px(frame.joints[a]);
      const pb = px(frame.joints[b]);
      ctx.save();
      if (weak) {
        ctx.globalAlpha = 0.4;
        ctx.setLineDash([6, 4]);
      }
      // Dark underlay then light core: readable on any camera picture.
      // The working arm is thicker as well as tinted.
      ctx.lineWidth = highlight ? 9 : 7;
      ctx.strokeStyle = '#111';
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.lineWidth = highlight ? 5 : 3;
      ctx.strokeStyle = highlight ? '#8ce9cb' : '#fff';
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.restore();
    }

    for (const { joint, weak } of joints) {
      const p = px(joint);
      ctx.save();
      if (weak) ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#111';
      if (weak) ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }, [frame, mirrored, showSkeleton, dimBelowConf, clearOnMissingFrame]);

  return (
    <div className="stage-wrap">
      <div className="stage-viewport">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- live camera has no audio track */}
        <video
          ref={videoRef}
          className="stage-video"
          style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
          muted
          playsInline
          aria-label="Camera picture"
        />
        {!cameraOn && (
          <div className={isReplay ? 'stage-replay-label' : 'stage-placeholder'}>
            {!isReplay && (
              <svg aria-hidden="true" viewBox="0 0 32 32" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="4" y="9" width="17" height="14" rx="3" />
                <path d="m21 14 6-4v12l-6-4" strokeLinejoin="round" />
              </svg>
            )}
            <strong>{isReplay ? 'Simulated movement' : (cameraHint ?? 'Camera preview is off')}</strong>
            {!isReplay && !cameraHint && <span>Start a session when you’re ready.</span>}
          </div>
      )}
      <canvas ref={canvasRef} className="stage-canvas" aria-hidden="true" />
      </div>
      {(frame || uncalibrated) && <div className="stage-status">
      {frame && (
        <p role="status" className={frame.gate.ok ? 'gate-badge gate-ok' : 'gate-badge gate-bad'}>
          {frame.gate.ok
            ? 'Signal good'
            : `Signal poor: ${frame.gate.reasons.map((reason) => GATE_REASON_TEXT[reason]).join('; ')}`}
        </p>
      )}
      {uncalibrated && (
        <p className="gate-warning">No calibration yet — the signal check is less reliable.</p>
      )}
      </div>}
    </div>
  );
}
