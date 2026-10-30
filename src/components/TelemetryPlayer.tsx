import { useEffect, useRef, useState } from 'react';
import type { PoseFrame, RecordedClip } from '../contracts';
import { SkeletonSvg } from '../review/skeletonSvg';
import { config } from '../config';
import type { TelemetryFrame } from '../pipeline/replay';
import {
  TELEMETRY_PAUSE_LABEL,
  TELEMETRY_PLAY_LABEL,
  TELEMETRY_SECTION_TITLE,
  TELEMETRY_SEEK_LABEL,
  TELEMETRY_SIGNAL_FLAGGED,
  TELEMETRY_SIGNAL_OK,
  TELEMETRY_STEP_BACK_LABEL,
  TELEMETRY_STEP_FORWARD_LABEL,
} from '../metricsCopy';

function fmtDeg(v: number): string {
  return Number.isFinite(v) ? `${v.toFixed(1)}°` : 'n/a';
}

/**
 * Dev-only frame player for the last replay. Skeleton plus the recomputed
 * per-frame telemetry (gate, angles) on a playhead. Telemetry lives in
 * memory only: this module has no storage and no network.
 */
export function TelemetryPlayer({
  clip,
  telemetry,
}: {
  clip: RecordedClip;
  telemetry: TelemetryFrame[];
}) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef(0);
  const last = telemetry.length - 1;
  const safeIdx = telemetry.length === 0 ? 0 : Math.min(Math.max(idx, 0), last);
  const cur = telemetry[safeIdx];
  const clipFrame = clip.frames[safeIdx];

  useEffect(() => {
    if (!playing || telemetry.length === 0) return;
    const stepMs = 1000 / (clip.fps > 0 ? clip.fps : 24);
    timer.current = window.setTimeout(() => setIdx((i) => (i + 1) % telemetry.length), stepMs);
    return () => window.clearTimeout(timer.current);
  }, [playing, idx, telemetry.length, clip.fps]);

  useEffect(() => {
    setIdx(0);
    setPlaying(false);
  }, [clip.name, telemetry.length]);

  if (!cur || !clipFrame) return null;
  const frame: PoseFrame = {
    t: clipFrame.t,
    fps: clip.fps,
    joints: clipFrame.joints,
    angles: {
      r_elbow_flexion: { deg: cur.elbowDeg, conf: 1 },
      r_shoulder_elevation: { deg: cur.shoulderDeg, conf: 1 },
    },
    gate: { ok: cur.ok, reasons: [...cur.reasons] },
  };

  return (
    <section aria-label={TELEMETRY_SECTION_TITLE}>
      <h3>{TELEMETRY_SECTION_TITLE}</h3>
      <SkeletonSvg frame={frame} dimBelowConf={config.gate.vis_min} label={`Frame at ${cur.t.toFixed(2)} seconds`} />
      <p>{`Clip time: ${cur.t.toFixed(2)} s of ${clip.frames.length > 0 ? clip.frames[clip.frames.length - 1].t.toFixed(2) : '0.00'} s`}</p>
      <p>{cur.ok ? TELEMETRY_SIGNAL_OK : `${TELEMETRY_SIGNAL_FLAGGED}: ${cur.reasons.join(', ')}`}</p>
      <p>{`Elbow ${fmtDeg(cur.elbowDeg)}, shoulder ${fmtDeg(cur.shoulderDeg)}`}</p>
      <div className="button-row">
        <button type="button" onClick={() => setPlaying((p) => !p)}>
          {playing ? TELEMETRY_PAUSE_LABEL : TELEMETRY_PLAY_LABEL}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setIdx((i) => Math.max(0, Math.min(i, last) - 1));
          }}
        >
          {TELEMETRY_STEP_BACK_LABEL}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setIdx((i) => Math.min(Math.max(i, 0) + 1, last));
          }}
        >
          {TELEMETRY_STEP_FORWARD_LABEL}
        </button>
      </div>
      <label>
        {TELEMETRY_SEEK_LABEL}{' '}
        <input
          type="range"
          min={0}
          max={Math.max(last, 0)}
          value={safeIdx}
          onChange={(e) => setIdx(Number(e.target.value))}
        />
      </label>
    </section>
  );
}
