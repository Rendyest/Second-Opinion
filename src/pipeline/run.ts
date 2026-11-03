import type { PoseFrame, System1State } from '../contracts';
import type { AppConfig } from '../config';
import {
  createGateTracker,
  mergeGate,
  type BoneBaseline,
  type GateResult,
} from '../pose/gate';
import { createCantSeeYouTracker, type CantSeeYou } from '../system1/cantSeeYou';
import { createSystem1Detector, type System1Detector } from '../system1/detector';
import type { FaceReach } from '../pose/faceReach';

/**
 * The per-frame loop shared by the live session and clip replay, so the two
 * cannot drift: gate check (flags only added) -> can't-see-you state ->
 * System 1 detector. Replay passes the clip clock (frame.t * 1000) as nowMs
 * and must never use Date.now() or performance.now() for decisions.
 */
export interface PipelineThresholds {
  gate: AppConfig['gate'];
  struggle: AppConfig['struggle'];
  face: AppConfig['face'];
  smoothing: AppConfig['smoothing'];
  visMin: number;
  cooldownMs: number;
  /**
   * Face data for the run. Undefined loads the stored face step (live
   * session); null uses standard values plus live-tracked points
   * (uncalibrated replay); a value uses it directly (calibrated replay).
   */
  storedFace?: FaceReach | null;
}

export interface FrameResult {
  /** The frame with gate flags merged in (flags only added, never removed). */
  frame: PoseFrame;
  gate: GateResult;
  cantSee: CantSeeYou;
  system1: System1State | null;
}

export interface SharedPipeline {
  push(
    frame: PoseFrame,
    baseline: BoneBaseline | null,
    nowMs: number,
    runDetector: boolean,
  ): FrameResult;
  reset(): void;
  /** Drop the rep and window buffers but keep hysteresis (tracking gap). */
  resetWindow(): void;
  snapshot(): ReturnType<System1Detector['snapshot']>;
}

export function createPipeline(t: PipelineThresholds): SharedPipeline {
  const gateTracker = createGateTracker(t.gate);
  const cantSeeTracker = createCantSeeYouTracker(
    t.gate.cant_see_enter_frames,
    t.gate.cant_see_exit_frames,
  );
  const detector = createSystem1Detector({
    struggle: t.struggle,
    face: t.face,
    smoothing: t.smoothing,
    visMin: t.visMin,
    cooldownMs: t.cooldownMs,
    stored: t.storedFace,
  });

  return {
    push(frame, baseline, nowMs, runDetector) {
      const gate = gateTracker.push(frame.joints, baseline);
      const merged = mergeGate(frame, gate);
      const cantSee = cantSeeTracker.push(gate.ok, gate.reasons);
      const system1 = runDetector ? detector.push(merged, nowMs) : null;
      return { frame: merged, gate, cantSee, system1 };
    },
    reset() {
      gateTracker.reset();
      cantSeeTracker.reset();
      detector.reset();
    },
    resetWindow() {
      detector.resetWindow();
    },
    snapshot() {
      return detector.snapshot();
    },
  };
}
