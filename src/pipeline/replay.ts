import type { ClipSource, GateReason, PoseFrame, RecordedClip, ReplayEvent } from '../contracts';
import { elbowFlexion, shoulderElevation, type Joint } from '../pose/angles';
import { createPipeline, type PipelineThresholds } from './run';
import { everyFrameCalls, fixedIntervalCalls, gatedTriggerCalls } from './policies';

/** Per-frame telemetry for the /metrics overlay. In-memory only: never persisted, never sent. */
export interface TelemetryFrame {
  t: number;
  ok: boolean;
  reasons: GateReason[];
  elbowDeg: number;
  shoulderDeg: number;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function roundJoints(joints: Record<string, { x: number; y: number; conf: number }>): Record<string, Joint> {
  const out: Record<string, Joint> = {};
  for (const [name, j] of Object.entries(joints)) {
    out[name] = { x: round4(j.x), y: round4(j.y), conf: round4(j.conf) };
  }
  return out;
}

/**
 * Build a synthetic clip from mock replay pose_frame events. Joints only
 * (rounded), no baseline or face data: this always replays "uncalibrated".
 */
export function clipFromMockEvents(
  events: ReplayEvent[],
  clipName: string,
  configUsed: Record<string, unknown>,
): RecordedClip {
  const frames = events
    .filter((e) => e.kind === 'pose_frame')
    .map((e) => {
      const f = e.data as PoseFrame;
      return { t: f.t, joints: roundJoints(f.joints) };
    });
  const fps = events.length > 0 && events[0].kind === 'pose_frame' ? (events[0].data as PoseFrame).fps : 30;
  return {
    version: 1,
    source: 'synthetic',
    name: clipName,
    fps,
    frames,
    baseline: null,
    face: null,
    config_used: configUsed,
  };
}

export interface PolicyResult {
  calls: number[];
}

export interface ReplaySummary {
  clipName: string;
  source: ClipSource;
  calibrated: boolean;
  durationS: number;
  frames: number;
  /** Scored System 1 windows. */
  inferences: number;
  escalations: number;
  flaggedFrames: number;
  /** Flagged frames / all frames, after recomputing the gate. */
  flagRate: number;
  escalationTimesMs: number[];
  policies: {
    everyFrame: PolicyResult;
    fixedInterval: PolicyResult & { intervalS: number };
    gated: PolicyResult & { cooldownMs: number };
  };
  coverage: {
    windowS: number;
    labels: number;
    perPolicy: Record<string, { covered: number; total: number }>;
  };
  /** Measured compute time per scored window, on this machine. */
  system1LatencyMs: number[];
  thresholds: Record<string, unknown>;
}

/**
 * Labelled coverage: how many labelled intervals had at least one call in
 * [start, start + windowS]. Calls before the start or after the window end
 * do not count.
 */
export function labelCoverage(
  labels: ReadonlyArray<{ start_s: number; end_s: number }>,
  callTimesMs: number[],
  windowS: number,
): { covered: number; total: number } {
  let covered = 0;
  for (const label of labels) {
    const startMs = label.start_s * 1000;
    const endMs = startMs + windowS * 1000;
    if (callTimesMs.some((t) => t >= startMs && t <= endMs)) covered += 1;
  }
  return { covered, total: labels.length };
}

export interface ReplayOptions {
  intervalS: number;
  coverageWindowS: number;
}

/**
 * Run the shared pipeline over a clip as fast as possible (not tied to
 * playback). Clock = frame.t * 1000; performance.now() measures compute
 * time only and never feeds a decision.
 */
export function runReplay(
  clip: RecordedClip,
  t: PipelineThresholds,
  opts: ReplayOptions,
): ReplaySummary {
  return runReplayInner(clip, t, opts, null);
}

/**
 * Same run as runReplay, plus a per-frame telemetry strip for the /metrics
 * overlay. The strip is returned alongside the summary and never enters it,
 * so exports and persistence cannot carry it.
 */
export function runReplayWithTelemetry(
  clip: RecordedClip,
  t: PipelineThresholds,
  opts: ReplayOptions,
): { summary: ReplaySummary; telemetry: TelemetryFrame[] } {
  const telemetry: TelemetryFrame[] = [];
  const summary = runReplayInner(clip, t, opts, telemetry);
  return { summary, telemetry };
}

function runReplayInner(
  clip: RecordedClip,
  t: PipelineThresholds,
  opts: ReplayOptions,
  telemetry: TelemetryFrame[] | null,
): ReplaySummary {
  const pipeline = createPipeline({ ...t, storedFace: clip.face ?? null });
  const frameTimesMs: number[] = [];
  const escalationTimesMs: number[] = [];
  const blocked: Array<{ startMs: number; endMs: number }> = [];
  const system1LatencyMs: number[] = [];
  let blockedStart: number | null = null;
  let inferences = 0;
  let escalations = 0;
  let flaggedFrames = 0;

  for (const clipFrame of clip.frames) {
    const joints = clipFrame.joints as Record<string, Joint>;
    const rs = joints['r_shoulder'];
    const re = joints['r_elbow'];
    const rw = joints['r_wrist'];
    const elbow =
      rs && re && rw
        ? elbowFlexion(rs, re, rw)
        : { deg: NaN, conf: 0 };
    const shoulder =
      rs && re
        ? shoulderElevation(rs, re)
        : { deg: NaN, conf: 0 };
    const frame: PoseFrame = {
      t: clipFrame.t,
      fps: clip.fps,
      joints,
      angles: { r_elbow_flexion: elbow, r_shoulder_elevation: shoulder },
      gate: { ok: true, reasons: [] },
    };
    const nowMs = clipFrame.t * 1000;
    frameTimesMs.push(nowMs);
    const computeStart = performance.now();
    const result = pipeline.push(frame, clip.baseline, nowMs, true);
    const computeMs = performance.now() - computeStart;
    if (!result.gate.ok) flaggedFrames += 1;
    if (telemetry) {
      telemetry.push({
        t: clipFrame.t,
        ok: result.gate.ok,
        reasons: [...result.gate.reasons],
        elbowDeg: elbow.deg,
        shoulderDeg: shoulder.deg,
      });
    }
    if (result.cantSee.active && blockedStart === null) blockedStart = nowMs;
    if (!result.cantSee.active && blockedStart !== null) {
      blocked.push({ startMs: blockedStart, endMs: nowMs });
      blockedStart = null;
    }
    if (result.system1 !== null) {
      inferences += 1;
      system1LatencyMs.push(computeMs);
      if (result.system1.escalate) {
        escalations += 1;
        escalationTimesMs.push(nowMs);
      }
    }
  }
  if (blockedStart !== null && frameTimesMs.length > 0) {
    blocked.push({ startMs: blockedStart, endMs: frameTimesMs[frameTimesMs.length - 1] });
  }

  const everyFrame = everyFrameCalls(frameTimesMs);
  const fixedInterval = fixedIntervalCalls(frameTimesMs, opts.intervalS);
  const gated = gatedTriggerCalls(escalationTimesMs, t.cooldownMs, blocked);
  const labels = clip.labels ?? [];
  const policies: ReplaySummary['policies'] = {
    everyFrame: { calls: everyFrame },
    fixedInterval: { calls: fixedInterval, intervalS: opts.intervalS },
    gated: { calls: gated, cooldownMs: t.cooldownMs },
  };
  const perPolicy: Record<string, { covered: number; total: number }> = {
    every_frame: labelCoverage(labels, everyFrame, opts.coverageWindowS),
    fixed_interval: labelCoverage(labels, fixedInterval, opts.coverageWindowS),
    gated_trigger: labelCoverage(labels, gated, opts.coverageWindowS),
  };

  const lastT = clip.frames.length > 0 ? clip.frames[clip.frames.length - 1].t : 0;
  return {
    clipName: clip.name,
    source: clip.source,
    calibrated: clip.baseline !== null && clip.face !== null,
    durationS: lastT,
    frames: clip.frames.length,
    inferences,
    escalations,
    flaggedFrames,
    flagRate: clip.frames.length === 0 ? 0 : flaggedFrames / clip.frames.length,
    escalationTimesMs,
    policies,
    coverage: { windowS: opts.coverageWindowS, labels: labels.length, perPolicy },
    system1LatencyMs,
    thresholds: { ...t, storedFace: undefined, visMin: t.visMin, cooldownMs: t.cooldownMs },
  };
}
