import type { PoseFrame, System1State, System1StateName, TopSignal } from '../contracts';
import type { AppConfig } from '../config';
import { loadFaceReach } from '../pose/calibration';
import {
  handPoint,
  isAtFace,
  livePointOffsets,
  minHandDistance,
  shoulderMidWidth,
  zoneRadius,
  type FaceReach,
  type PointOffsets,
} from '../pose/faceReach';
import { median } from '../pose/gate';

/**
 * System 1 behind an interface: a hand-to-face time series plus gate output
 * in, a system1_state out. A fine-tuned model can replace `scoreWindow`
 * later without UI changes — everything downstream only reads System1State.
 *
 * Task model (priority: the REACH; the wash itself is covered only by
 * whether the hand can be held at face level or drops). Phases per rep:
 * rest -> reach -> at_face -> hold -> (success) -> rest again. Bringing the
 * hand to the face bends the elbow, so reaching means the elbow angle
 * FALLS from its rest value and returns when the arm lowers again.
 *
 * The face zone is the NEAREST stored face point to the hand (offsets from
 * the shoulder midpoint, in shoulder widths). Stored offsets refresh slowly
 * only while the hand is clear of the zone; never while the hand is near.
 *
 * The rule-based detector scores four signals per hop (failed_range, stall,
 * compensation during reach; drop, compensation during hold); the window
 * score is the strongest signal and the top signal names it. Sinking inside
 * the zone feeds the drop signal but is capped below the enter threshold,
 * so it can hesitate but never struggle on its own. Jitter stays in the
 * TopSignal type so old mock data still parses, but the detector never
 * emits it. Hysteresis enters Struggling only after the score stays above
 * the enter threshold for N consecutive hops, and leaves as soon as a hop
 * scores below the lower threshold. Escalation fires at most once per
 * cooldown. Can't see you never reaches this code: gate-flagged frames are
 * skipped before windows form, so a tracking gap can neither start an
 * escalation nor count toward Struggling.
 */

export interface WindowScore {
  score: number;
  topSignal: TopSignal;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Adaptive exponential smoothing (One Euro style): the cutoff rises with
 * hand speed, so slow jitter is damped while a real move passes through.
 * The speed estimate is raw (no separate dcutoff key) so every tunable stays
 * in config.default.json.
 */
function euroAlpha(dt: number, speed: number, minCutoff: number, beta: number): number {
  const cutoff = minCutoff + beta * speed;
  if (!(cutoff > 0) || !(dt > 0)) return 1;
  const alpha = 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);
  return Math.min(1, Math.max(0, alpha));
}

/** Nearest stored face-point distance for an arbitrary hand position. */
function nearestPointDist(
  hand: { x: number; y: number },
  offsets: PointOffsets,
  sm: { mid: { x: number; y: number }; width: number },
): number | null {
  let best: number | null = null;
  for (const off of Object.values(offsets)) {
    const d =
      Math.hypot(hand.x - (sm.mid.x + off.x * sm.width), hand.y - (sm.mid.y + off.y * sm.width)) /
      sm.width;
    if (best === null || d < best) best = d;
  }
  return best;
}

export type RepPhase = 'reach' | 'hold';

export interface RepSnapshot {
  /** Seconds since the rep started (frame.t time). */
  ageS: number;
  /** Closest normalised hand distance seen this rep. */
  closestDist: number;
  /** Seconds the hand has been slow outside the zone. */
  stillS: number;
  /** Seconds out of the zone during hold. */
  outS: number;
  /** The hand is falling away faster than drop_speed. */
  fallingFast: boolean;
  /** The hand is currently inside the zone. */
  inZone: boolean;
  /** Current normalised hand distance. */
  dist: number;
  /** Touch distance the zone was measured from. */
  touchDist: number;
}

/**
 * Score one hop of a rep. Returns a score (possibly 0) — never null: the
 * caller only calls this while a rep is in progress, and nothing is scored
 * while no rep has started. `rise` is the shoulder hike in shoulder widths
 * versus the rest height recorded when the rep started.
 */
export function scoreWindow(
  phase: RepPhase,
  rep: RepSnapshot,
  rise: number,
  radius: number,
  s: AppConfig['struggle'],
): WindowScore {
  // On an exact tie, prefer the specific shoulder-hike explanation over a
  // generic stopped-hand one.
  const compensation = clamp01(rise / s.shoulder_hike_frac);
  if (phase === 'hold') {
    // A drop is time out of the zone past the tolerance (tracking blips are
    // ignored), ramping to 1.0 at drop_s; a fast fall past the tolerance
    // scores 1.0 immediately. Sinking inside the zone feeds the same signal
    // but is capped by sink_weight, below the enter threshold.
    let drop: number;
    if (!rep.inZone) {
      drop =
        rep.outS <= s.drop_tolerance_s
          ? 0
          : rep.fallingFast
            ? 1
            : clamp01((rep.outS - s.drop_tolerance_s) / (s.drop_s - s.drop_tolerance_s));
    } else if (radius > rep.touchDist) {
      drop = s.sink_weight * clamp01((rep.dist - rep.touchDist) / (radius - rep.touchDist));
    } else {
      drop = 0;
    }
    const candidates: ReadonlyArray<{ signal: TopSignal; score: number }> = [
      { signal: 'drop', score: drop },
      { signal: 'compensation', score: compensation },
    ];
    let best = candidates[0];
    for (const candidate of candidates) {
      if (candidate.score > best.score) best = candidate;
    }
    return { score: best.score, topSignal: best.signal };
  }
  const failedRange =
    rep.ageS >= s.reach_window_s ? clamp01((rep.closestDist - radius) / radius) : 0;
  const stall = clamp01(rep.stillS / s.stall_s);
  // Start from stall so an all-zero window keeps its old signal; on a
  // positive tie compensation replaces it below.
  let best: WindowScore = { score: stall, topSignal: 'stall' };
  const challengers: WindowScore[] = [
    { score: compensation, topSignal: 'compensation' },
    { score: failedRange, topSignal: 'failed_range' },
  ];
  for (const candidate of challengers) {
    const tiesStall =
      candidate.topSignal === 'compensation' &&
      best.topSignal === 'stall' &&
      candidate.score === best.score &&
      best.score > 0;
    if (candidate.score > best.score || tiesStall) best = candidate;
  }
  return best;
}

export interface StateMachineResult {
  state: System1StateName;
  score: number;
  topSignal: TopSignal | undefined;
  escalate: boolean;
}

/**
 * Hysteresis over window scores. Null scores (no-score windows) hold the
 * current state and never escalate.
 */
export function createStateMachine(t: {
  enterThreshold: number;
  exitThreshold: number;
  consecutiveWindows: number;
  cooldownMs: number;
}) {
  let state: System1StateName = 'moving_well';
  let streak = 0;
  let cooledUntil = 0;
  return {
    push(nowMs: number, scored: { score: number; topSignal: TopSignal } | null): StateMachineResult | null {
      if (!scored) return null;
      const { score, topSignal } = scored;
      if (state === 'struggling') {
        if (score < t.exitThreshold) {
          state = 'moving_well';
          streak = 0;
        }
      } else if (score >= t.enterThreshold) {
        streak += 1;
        state = streak >= t.consecutiveWindows ? 'struggling' : 'hesitating';
      } else {
        streak = 0;
        state = score < t.exitThreshold ? 'moving_well' : 'hesitating';
      }
      let escalate = false;
      if (state === 'struggling' && nowMs >= cooledUntil) {
        escalate = true;
        cooledUntil = nowMs + t.cooldownMs;
      }
      return { state, score, topSignal: state === 'moving_well' ? undefined : topSignal, escalate };
    },
    reset() {
      state = 'moving_well';
      streak = 0;
      cooledUntil = 0;
    },
    snapshot() {
      return { state, streak };
    },
  };
}

export interface DetectorOptions {
  struggle: AppConfig['struggle'];
  face: AppConfig['face'];
  smoothing: AppConfig['smoothing'];
  visMin: number;
  cooldownMs: number;
  /**
   * Stored face data. Undefined loads from localStorage; null means no
   * stored step (standard values + live-tracked points). Tests pass this
   * explicitly so they never touch storage.
   */
  stored?: FaceReach | null;
}

interface RepState {
  startT: number;
  restElbow: number;
  restDist: number;
  restShoulderY: number;
  closestDist: number;
  stillS: number;
  lastDist: number;
  lastT: number;
  holdS: number;
  holdTotalS: number;
  outS: number;
  fallingFast: boolean;
  /** Consecutive scored hops with the shoulder above the hike fraction. */
  hikeStreak: number;
}

export interface System1Detector {
  /** Feed one frame; returns a fresh state when a scored hop completes. */
  push(frame: PoseFrame, nowMs: number): System1State | null;
  /** Drop the rep and window buffers but keep the hysteresis state. */
  resetWindow(): void;
  reset(): void;
  /** Current phase, working offsets and last distance — for tests and review. */
  snapshot(): {
    phase: 'rest' | 'reach' | 'hold' | 'done';
    offsets: PointOffsets | null;
    /** Smoothed hand distance; null until the first usable frame. */
    lastDist: number | null;
    /** Raw (unsmoothed) hand distance on the latest usable frame. */
    rawDist: number | null;
    /** Latest scored shoulder rise, in shoulder widths. */
    rise: number | null;
    zoneRadius: number;
    /** Top signal of the latest scored hop. */
    topSignal: TopSignal | null;
  };
}

/**
 * Reach-and-hold detector over clean frames. A hop is scored at most once
 * per hop_frames clean frames, so consecutive_windows counts hops, not
 * frames. Gate-flagged frames never enter: too few clean frames yields no
 * score rather than a low one.
 */
export function createSystem1Detector(o: DetectorOptions): System1Detector {
  const s = o.struggle;
  const machine = createStateMachine({
    enterThreshold: s.enter_threshold,
    exitThreshold: s.exit_threshold,
    consecutiveWindows: s.consecutive_windows,
    cooldownMs: o.cooldownMs,
  });
  const stored: FaceReach | null = o.stored === undefined ? loadFaceReach() : o.stored;
  const touchDist = stored?.touchDist ?? o.face.default_touch_dist;
  const touchElbowDeg = stored?.touchElbowDeg ?? o.face.default_elbow_deg;
  const storedOffsets: PointOffsets | null = stored?.offsets ?? null;
  const radius = zoneRadius(touchDist, o.face.reach_margin, o.face.zone_min);

  type Phase = 'rest' | 'reach' | 'hold' | 'done';
  let phase: Phase = 'rest';
  let rep: RepState | null = null;
  let restElbow: number | null = null;
  let restDist: number | null = null;
  let offsets: PointOffsets | null = storedOffsets ? { ...storedOffsets } : null;
  let lastDist: number | null = null;
  let lastRawDist: number | null = null;
  let lastRise: number | null = null;
  let lastTop: TopSignal | null = null;
  let cleanFrames = 0;
  let sinceScore = 0;
  // Input smoothing state: reset with every rep (and therefore whenever the
  // detector resets or a Can't-see-you gap ends the window).
  let smoothHX: number | null = null;
  let smoothHY: number | null = null;
  let smoothHT: number | null = null;
  let smoothRsY: number | null = null;
  let restShoulderSamples: number[] = [];

  function clearRep() {
    phase = 'rest';
    rep = null;
    lastDist = null;
    lastRawDist = null;
    lastRise = null;
    lastTop = null;
    restElbow = null;
    restDist = null;
    cleanFrames = 0;
    sinceScore = 0;
    offsets = storedOffsets ? { ...storedOffsets } : null;
    smoothHX = null;
    smoothHY = null;
    smoothHT = null;
    smoothRsY = null;
    restShoulderSamples = [];
  }

  return {
    push(frame, nowMs) {
      if (!frame.gate.ok) return null;
      const deg = frame.angles['r_elbow_flexion']?.deg;
      const rsY = frame.joints['r_shoulder']?.y;
      if (typeof deg !== 'number' || !Number.isFinite(deg)) return null;
      if (typeof rsY !== 'number' || !Number.isFinite(rsY)) return null;
      const sm = shoulderMidWidth(frame.joints);
      if (!sm) return null;
      const live = livePointOffsets(frame.joints, o.visMin);
      // Anchor refresh: never while the hand is near. With stored offsets,
      // each visible point creeps toward its live position (exponential
      // average) only on frames where the hand is clear of the zone;
      // without a stored step the live points stand in directly.
      const probe = offsets ?? live?.offsets ?? null;
      const before = probe ? minHandDistance(frame.joints, probe, o.visMin) : null;
      if (offsets && storedOffsets) {
        if (live && before && before.dist > 2 * radius) {
          const next: PointOffsets = { ...offsets };
          for (const [name, liveOff] of Object.entries(live.offsets)) {
            const current = next[name];
            if (!current) continue;
            next[name] = {
              x: current.x + o.face.anchor_smooth * (liveOff.x - current.x),
              y: current.y + o.face.anchor_smooth * (liveOff.y - current.y),
            };
          }
          offsets = next;
        }
      } else if (live && Object.keys(live.offsets).length > 0) {
        offsets = { ...live.offsets };
      }
      if (!offsets) return null;
      const measured = minHandDistance(frame.joints, offsets, o.visMin);
      if (!measured) return null;
      const rawHand = handPoint(frame.joints, o.visMin);
      if (!rawHand) return null;
      // Input smoothing runs only on usable (gate-ok) frames.
      let sx: number;
      let sy: number;
      if (smoothHX === null || smoothHY === null || smoothHT === null) {
        sx = rawHand.x;
        sy = rawHand.y;
      } else {
        const smoothDt = frame.t - smoothHT;
        if (smoothDt > 0) {
          const rawSpeed =
            Math.hypot(rawHand.x - smoothHX, rawHand.y - smoothHY) / smoothDt;
          const alpha = euroAlpha(
            smoothDt,
            rawSpeed,
            o.smoothing.hand_min_cutoff,
            o.smoothing.hand_beta,
          );
          sx = smoothHX + alpha * (rawHand.x - smoothHX);
          sy = smoothHY + alpha * (rawHand.y - smoothHY);
          // Snap exactly to raw at full gain so pass-through configs stay bit-exact.
          if (1 - alpha < 1e-9) {
            sx = rawHand.x;
            sy = rawHand.y;
          }
        } else {
          // No time elapsed (duplicate or out-of-order frame): smoothing is
          // undefined without a dt, so take the raw point like before.
          sx = rawHand.x;
          sy = rawHand.y;
        }
      }
      smoothHX = sx;
      smoothHY = sy;
      smoothHT = frame.t;
      const shoulderAlpha = Math.min(1, Math.max(0, o.smoothing.shoulder_alpha));
      smoothRsY = smoothRsY === null ? rsY : smoothRsY + shoulderAlpha * (rsY - smoothRsY);
      const distNow = nearestPointDist({ x: sx, y: sy }, offsets, sm) ?? measured.dist;
      lastDist = distNow;
      lastRawDist = measured.dist;
      const inZone = isAtFace(distNow, deg, radius, touchElbowDeg, o.face.elbow_margin_deg);
      // Every usable frame counts toward the clean-frame minimum, including
      // rest and done frames that never produce a scored hop.
      cleanFrames += 1;

      if (phase === 'rest') {
        if (
          (restElbow !== null && restElbow - deg >= s.start_motion_deg) ||
          (restDist !== null && restDist - distNow >= s.start_motion_dist)
        ) {
          phase = 'reach';
          const restMedian = median(restShoulderSamples);
          rep = {
            startT: frame.t,
            restElbow: restElbow as number,
            restDist: restDist as number,
            restShoulderY: restMedian ?? smoothRsY,
            closestDist: distNow,
            stillS: 0,
            lastDist: distNow,
            lastT: frame.t,
            holdS: 0,
            holdTotalS: 0,
            outS: 0,
            fallingFast: false,
            hikeStreak: 0,
          };
          restShoulderSamples = [];
        } else {
          restElbow = deg;
          restDist = distNow;
          restShoulderSamples.push(smoothRsY);
          return null;
        }
      } else if (phase === 'done') {
        // The rep is over; wait for the arm to lower again before resting.
        if (rep && deg > rep.restElbow - s.start_motion_deg) {
          phase = 'rest';
          rep = null;
          restElbow = deg;
          restDist = distNow;
          restShoulderSamples = [smoothRsY];
        }
        return null;
      } else if (phase === 'reach' && rep) {
        const dt = frame.t - rep.lastT;
        rep.closestDist = Math.min(rep.closestDist, distNow);
        if (inZone) {
          phase = 'hold';
          // The entering sample closes the interval since the previous clean
          // frame, so its time belongs to the hold being measured.
          const arrival = Math.max(0, dt);
          rep.holdS = arrival;
          rep.holdTotalS = arrival;
          rep.outS = 0;
          rep.fallingFast = false;
        } else if (dt > 0) {
          // A stop means low hand speed in either direction: moving away is
          // motion, not stillness, and it resets the stall clock.
          const speed = Math.abs(rep.lastDist - distNow) / dt;
          rep.stillS = speed < s.stall_speed ? rep.stillS + dt : 0;
        }
        rep.lastDist = distNow;
        rep.lastT = frame.t;
      } else if (phase === 'hold' && rep) {
        const dt = frame.t - rep.lastT;
        rep.holdTotalS += Math.max(0, dt);
        if (inZone) {
          rep.holdS += Math.max(0, dt);
          rep.outS = 0;
          rep.fallingFast = false;
        } else {
          const fall = dt > 0 ? (distNow - rep.lastDist) / dt : 0;
          rep.holdS = 0;
          rep.outS += Math.max(0, dt);
          rep.fallingFast = fall > s.drop_speed;
        }
        rep.lastDist = distNow;
        rep.lastT = frame.t;
        if (rep.holdS >= s.hold_s || rep.holdTotalS >= s.hold_max_s) {
          // Success: held at face level (or the rep ran its full course).
          // The arm lowering returns the detector to rest.
          phase = 'done';
          machine.reset();
          const success: System1State = { t: frame.t, state: 'moving_well', score: 0, escalate: false };
          return success;
        }
      }

      if (cleanFrames < s.min_clean_frames) return null;
      sinceScore += 1;
      if (sinceScore < s.hop_frames) return null;
      sinceScore = 0;
      if ((phase !== 'reach' && phase !== 'hold') || !rep) return null;
      const rise = (rep.restShoulderY - (smoothRsY ?? rsY)) / sm.width;
      // A hike only counts toward compensation after holding past the
      // fraction for hike_hold_frames consecutive scored hops.
      rep.hikeStreak = rise > s.shoulder_hike_frac ? rep.hikeStreak + 1 : 0;
      const scoredRise = rep.hikeStreak >= s.hike_hold_frames ? rise : 0;
      lastRise = rise;
      const snapshot = {
        ageS: frame.t - rep.startT,
        closestDist: rep.closestDist,
        stillS: rep.stillS,
        outS: rep.outS,
        fallingFast: rep.fallingFast,
        inZone,
        dist: distNow,
        touchDist,
      };
      const scored = scoreWindow(phase, snapshot, scoredRise, radius, s);
      const out = machine.push(nowMs, scored);
      if (!out) return null;
      lastTop = out.topSignal ?? null;
      const next: System1State = { t: frame.t, state: out.state, score: out.score, escalate: out.escalate };
      if (out.topSignal !== undefined) next.top_signal = out.topSignal;
      return next;
    },
    snapshot() {
      return {
        phase,
        offsets: offsets ? { ...offsets } : null,
        lastDist,
        rawDist: lastRawDist,
        rise: lastRise,
        zoneRadius: radius,
        topSignal: lastTop,
      };
    },
    resetWindow() {
      clearRep();
    },
    reset() {
      clearRep();
      machine.reset();
    },
  };
}
