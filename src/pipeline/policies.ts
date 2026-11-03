/**
 * Call-counting policies for the loop comparison. Each policy is one pure
 * function over timestamps. Baselines are counted, never executed: they
 * ignore the gate and the cooldown, which is stated beside every figure.
 */

/** One call per frame: every frame timestamp is a call. */
export function everyFrameCalls(frameTimesMs: number[]): number[] {
  return [...frameTimesMs];
}

/**
 * Fixed-interval calls: the first frame with t >= k * interval_s for
 * k = 0, 1, 2, ... while k * interval_s <= the last frame's t. Compared
 * in integer milliseconds so float error cannot change the count.
 */
export function fixedIntervalCalls(frameTimesMs: number[], intervalS: number): number[] {
  if (frameTimesMs.length === 0) return [];
  const intervalMs = Math.round(intervalS * 1000);
  const lastMs = frameTimesMs[frameTimesMs.length - 1];
  const calls: number[] = [];
  for (let k = 0; k * intervalMs <= lastMs; k++) {
    const at = k * intervalMs;
    const hit = frameTimesMs.find((t) => Math.round(t) >= at);
    if (hit === undefined) break;
    calls.push(hit);
  }
  return calls;
}

/**
 * Gated-trigger calls: one call per detector escalation, cooldown applied
 * exactly once, in this one function. Escalations while Can't see you is
 * active are skipped (the blocked intervals come from replay).
 */
export function gatedTriggerCalls(
  escalationTimesMs: number[],
  cooldownMs: number,
  blocked: ReadonlyArray<{ startMs: number; endMs: number }>,
): number[] {
  const calls: number[] = [];
  let cooledUntil = -Infinity;
  for (const t of escalationTimesMs) {
    if (blocked.some((b) => t >= b.startMs && t < b.endMs)) continue;
    if (t < cooledUntil) continue;
    calls.push(t);
    cooledUntil = t + cooldownMs;
  }
  return calls;
}

export interface SavedFigure {
  /** Baseline calls minus ours. Negative means ours called more. */
  saved: number;
  /** saved / baseline, or null when the baseline is 0 ("n/a"). */
  reductionPct: number | null;
  /** Ready-to-render line, always with the baseline beside the saving. */
  text: string;
}

/** Calls saved = baseline - ours. Reduction % = saved / baseline ("n/a" at 0). */
export function savedFigure(baselineCalls: number, ourCalls: number): SavedFigure {
  const saved = baselineCalls - ourCalls;
  const reductionPct = baselineCalls === 0 ? null : saved / baselineCalls;
  const reduction = reductionPct === null ? 'n/a' : `${(reductionPct * 100).toFixed(1)}%`;
  return {
    saved,
    reductionPct,
    text: `saved ${saved} of ${baselineCalls} baseline calls (${reduction})`,
  };
}

/**
 * Nearest-rank percentile of an ascending list: index ceil(p/100 * n),
 * 1-indexed. State this wherever percentiles are shown. Returns null for an
 * empty list ("Not measured").
 */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sortedAsc.length));
  return sortedAsc[Math.min(rank, sortedAsc.length) - 1];
}

export function formatMs(v: number | null): string {
  return v === null ? 'Not measured' : `${v.toFixed(1)} ms`;
}
