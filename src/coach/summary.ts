import type { PoseFrame, System1StateName, TopSignal } from '../contracts';
import { config } from '../config';
import { loadFaceReach } from '../pose/calibration';
import { reachPresence } from '../pose/faceReach';

/**
 * The only thing the client ever sends to the coach proxy: aggregate angle
 * statistics plus the current System 1 state. No joints, no images, no frame
 * data of any kind — enforced by construction (numbers and short enums in,
 * same out) and by the server-side validator.
 */
export interface AngleSummary {
  min: number;
  max: number;
  mean: number;
}

export interface CoachSummary {
  task: string;
  angles: Record<string, AngleSummary>;
  duration_s: number;
  /** Aggregate only: the hand reached the face at least once in the window. */
  reached: boolean;
  /** Aggregate only: seconds the hand spent at the face in the window. */
  held_s: number;
  system1: {
    state: System1StateName;
    top_signal?: TopSignal;
  };
}

export interface AngleStats {
  count: number;
  firstT: number;
  lastT: number;
  angles: Record<string, { min: number; max: number; sum: number; count: number }>;
  /** Recent clean samples backing the aggregates; pruned to the window. */
  samples: Array<{ t: number; angles: Record<string, number>; inZone: boolean | null }>;
  /** Aggregate only: any kept sample at the face. */
  reached: boolean;
  /** Aggregate only: seconds at the face across the kept samples. */
  heldS: number;
}

/**
 * Fold one frame into running angle statistics. Never mutates `prev`:
 * every level (stats, angles, each slot, sample list) is copied. Flagged
 * frames and frames without angles never enter — coaching must never judge
 * untrusted frames. Only samples within `windowS` seconds of the new frame
 * are kept, so the aggregates describe recent movement, not the session.
 */
export function addFrameToStats(
  prev: AngleStats | null,
  frame: PoseFrame | null,
  windowS = Infinity,
): AngleStats | null {
  if (!frame || !frame.gate.ok) return prev;
  const readings: Record<string, number> = {};
  for (const [key, reading] of Object.entries(frame.angles)) {
    if (!reading || !Number.isFinite(reading.deg)) continue;
    readings[key] = reading.deg;
  }
  if (Object.keys(readings).length === 0) return prev;
  // Aggregate reach presence for this frame: stored step wins, otherwise the
  // live points stand in (same rule as the detector's no-store mode).
  const elbowDeg = frame.angles['r_elbow_flexion']?.deg;
  const inZone = reachPresence(
    frame.joints,
    typeof elbowDeg === 'number' ? elbowDeg : NaN,
    loadFaceReach(),
    config.face,
    config.gate.vis_min,
  );
  const samples = [...(prev?.samples ?? []), { t: frame.t, angles: readings, inZone }].filter(
    (s) => s.t >= frame.t - windowS,
  );
  const angles: AngleStats['angles'] = {};
  // Recomputed from the kept samples only, so evicted frames stop counting.
  let reached = false;
  let heldS = 0;
  let prevT: number | null = null;
  for (const sample of samples) {
    for (const [key, deg] of Object.entries(sample.angles)) {
      const slot = angles[key] ?? { min: deg, max: deg, sum: 0, count: 0 };
      angles[key] = {
        min: Math.min(slot.min, deg),
        max: Math.max(slot.max, deg),
        sum: slot.sum + deg,
        count: slot.count + 1,
      };
    }
    // Aggregate reach presence over the kept window only.
    if (sample.inZone === true) {
      reached = true;
      if (prevT !== null && sample.t > prevT) heldS += sample.t - prevT;
    }
    prevT = sample.t;
  }
  return {
    count: samples.length,
    firstT: samples[0].t,
    lastT: samples[samples.length - 1].t,
    angles,
    samples,
    reached,
    heldS,
  };
}

/** Build the request body. Null when there is nothing to coach on yet. */
export function buildCoachSummary(
  task: string,
  stats: AngleStats | null,
  state: System1StateName,
  topSignal?: TopSignal,
): CoachSummary | null {
  if (!stats || stats.count === 0) return null;
  const angles: Record<string, AngleSummary> = {};
  for (const [key, slot] of Object.entries(stats.angles)) {
    if (slot.count === 0) continue;
    angles[key] = { min: slot.min, max: slot.max, mean: slot.sum / slot.count };
  }
  if (Object.keys(angles).length === 0) return null;
  return {
    task,
    angles,
    duration_s: Math.max(0, stats.lastT - stats.firstT),
    reached: stats.reached,
    held_s: Math.round(Math.max(0, stats.heldS) * 10) / 10,
    system1: topSignal === undefined ? { state } : { state, top_signal: topSignal },
  };
}

/**
 * Wrist-down alternate: the working wrist sits below the shoulder line
 * (image y grows downward). Positions with conf 0 are the (0,0) defaults,
 * so both joints must actually be present. Gate-independent on purpose:
 * tips must come online while the person moves, when the gate rightly
 * flags frames.
 */
export function wristBelowShoulder(frame: PoseFrame | null): boolean {
  const wrist = frame?.joints['r_wrist'];
  const shoulder = frame?.joints['r_shoulder'];
  if (!wrist || !shoulder || !(wrist.conf > 0) || !(shoulder.conf > 0)) return false;
  return wrist.y > shoulder.y;
}

/** Cooldown is active until the stored timestamp passes. Starts after every call. */
export function cooldownActive(cooldownUntilMs: number, nowMs: number): boolean {
  return nowMs < cooldownUntilMs;
}

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * POST one summary to the coach proxy and return its message. Never throws:
 * any failure (network, timeout, bad status, unparsable body) resolves to
 * { ok: false } so the caller falls back locally and the session continues.
 */
export async function requestCoachMessage(
  summary: CoachSummary,
  deps: { fetchImpl?: FetchImpl; timeoutMs: number; signal?: AbortSignal },
): Promise<{ ok: true; message: string } | { ok: false }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
    try {
      const res = await (deps.fetchImpl ?? fetch)('/api/coach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(summary),
        signal: deps.signal ? AbortSignal.any([deps.signal, controller.signal]) : controller.signal,
      });
      if (!res.ok) return { ok: false };
      const data = (await res.json()) as unknown;
      if (typeof data !== 'object' || data === null) return { ok: false };
      const message = (data as { message?: unknown }).message;
      if (typeof message !== 'string' || message.trim().length === 0) return { ok: false };
      return { ok: true, message };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false };
  }
}

/**
 * A coach call must never start while Can't see you is active — an
 * escalation out of a tracking gap would judge the person on noise.
 */
export function canRequestCoach(cantSeeYouActive: boolean, coolingDown: boolean): boolean {
  return !cantSeeYouActive && !coolingDown;
}

/**
 * Escalation edge as a counter. The detector's boolean pulse becomes a
 * monotonic id upstream; this returns the id when it differs from the last
 * one the panel handled, else null. The caller records the returned id even
 * when blocked, so each escalation asks at most once and a blocked one
 * never re-fires later.
 */
export function nextEscalation(escalationId: number, lastHandled: number): number | null {
  return escalationId === lastHandled ? null : escalationId;
}
