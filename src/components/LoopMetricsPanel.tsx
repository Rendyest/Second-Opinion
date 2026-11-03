import { useState } from 'react';
import type { ReplaySummary } from '../pipeline/replay';
import { percentile, savedFigure } from '../pipeline/policies';
import { downloadJsonFile } from './ClipRecorder';
import {
  BASELINE_NOTE,
  CHART_TITLE,
  EXPORT_CSV_LABEL,
  EXPORT_JSON_LABEL,
  LOG_SCALE_LABEL,
  LOOP_SECTION_TITLE,
  MEASURED_TAG,
  NOT_MEASURED,
  NO_LABELS,
  NO_RESULTS,
  REPLAY_CALIBRATED,
  REPLAY_SOURCE_IMPORTED,
  REPLAY_SOURCE_RECORDED,
  REPLAY_SOURCE_SYNTHETIC,
  REPLAY_UNCALIBRATED,
  SIMULATED_TAG,
} from '../metricsCopy';

/**
 * CSV export of a replay summary. Aggregates only: policy rows plus a
 * latency block. "." decimal separator, no locale formatting, no joints,
 * no angles, no images.
 */
export function summaryToCsv(s: ReplaySummary): string {
  const gated = s.policies.gated.calls.length;
  const rows: string[] = ['policy,baseline_calls,calls,saved,reduction_pct'];
  const line = (policy: string, baseline: number) => {
    const fig = savedFigure(baseline, gated);
    const pct = fig.reductionPct === null ? 'n/a' : fig.reductionPct.toFixed(4);
    rows.push(`${policy},${baseline},${gated},${fig.saved},${pct}`);
  };
  line('every_frame', s.policies.everyFrame.calls.length);
  line('fixed_interval', s.policies.fixedInterval.calls.length);
  rows.push('');
  rows.push('metric,value');
  const lat = [...s.system1LatencyMs].sort((a, b) => a - b);
  const cell = (v: number | null) => (v === null ? 'n/a' : v.toFixed(3));
  rows.push(`system1_median_ms,${cell(percentile(lat, 50))}`);
  rows.push(`system1_p95_ms,${cell(percentile(lat, 95))}`);
  rows.push(`system1_samples,${lat.length}`);
  return rows.join('\n');
}

function stepPath(times: number[], durationS: number, maxCalls: number, log: boolean): string {
  const x = (t: number) => (durationS > 0 ? (t / durationS) * 100 : 0);
  const y = (c: number) => {
    if (maxCalls <= 0) return 39;
    const f = log ? Math.log10(1 + c) / Math.log10(1 + maxCalls) : c / maxCalls;
    return 39 - f * 38;
  };
  let d = `M 0 ${y(0)}`;
  let cum = 0;
  for (const t of times) {
    d += ` H ${x(t).toFixed(2)}`;
    cum += 1;
    d += ` V ${y(cum).toFixed(2)}`;
  }
  d += ` H ${x(durationS).toFixed(2)}`;
  return d;
}

/**
 * Dev-only loop comparison for /metrics. With no replay output it shows
 * "No results yet" and no numbers. Never imported by session-facing code.
 */
export function LoopMetricsPanel({ summary }: { summary: ReplaySummary | null }) {
  const [logScale, setLogScale] = useState(false);
  if (summary === null) {
    return (
      <section aria-label="Loop comparison (dev)">
        <h2>{LOOP_SECTION_TITLE}</h2>
        <p>{NO_RESULTS}</p>
      </section>
    );
  }
  const gated = summary.policies.gated.calls.length;
  const every = summary.policies.everyFrame.calls.length;
  const fixed = summary.policies.fixedInterval.calls.length;
  const savedEvery = savedFigure(every, gated);
  const savedFixed = savedFigure(fixed, gated);
  const lat = [...summary.system1LatencyMs].sort((a, b) => a - b);
  const latMed = percentile(lat, 50);
  const latP95 = percentile(lat, 95);
  const maxCalls = Math.max(every, fixed, gated);
  const series = [
    { name: 'every_frame', calls: summary.policies.everyFrame.calls, dash: undefined as string | undefined },
    { name: 'fixed_interval', calls: summary.policies.fixedInterval.calls, dash: '4 2' },
    { name: 'gated_trigger', calls: summary.policies.gated.calls, dash: '1 2' },
  ];
  return (
    <section aria-label="Loop comparison (dev)">
      <h2>{LOOP_SECTION_TITLE}</h2>
      <p>
        Source:{' '}
        {summary.source === 'recorded'
          ? REPLAY_SOURCE_RECORDED
          : summary.source === 'imported_video'
            ? REPLAY_SOURCE_IMPORTED
            : REPLAY_SOURCE_SYNTHETIC}{' '}·{' '}
        {summary.calibrated ? REPLAY_CALIBRATED : REPLAY_UNCALIBRATED} · {summary.clipName}
      </p>
      <p>{BASELINE_NOTE}</p>
      <ul>
        <li>Frames: {summary.frames}</li>
        <li>System 1 inferences: {summary.inferences}</li>
        <li>Escalations: {summary.escalations}</li>
        <li>Gate flag rate: {(summary.flagRate * 100).toFixed(1)}%</li>
        <li>Duration: {summary.durationS.toFixed(1)} s</li>
      </ul>
      <h3>Muse Spark calls made</h3>
      <ul>
        <li>every_frame: {every} calls</li>
        <li>fixed_interval (every {summary.policies.fixedInterval.intervalS} s): {fixed} calls</li>
        <li>
          gated_trigger: {gated} calls ({SIMULATED_TAG})
        </li>
      </ul>
      <h3>Calls saved</h3>
      <ul>
        <li>vs every_frame baseline ({every} calls): {savedEvery.text}</li>
        <li>vs fixed_interval baseline ({fixed} calls): {savedFixed.text}</li>
      </ul>
      <h3>Needed-help coverage</h3>
      {summary.coverage.labels === 0 ? (
        <p>{NO_LABELS}</p>
      ) : (
        <ul>
          {Object.entries(summary.coverage.perPolicy).map(([policy, c]) => (
            <li key={policy}>
              {policy}: {c.covered} of {c.total} labelled intervals covered (within{' '}
              {summary.coverage.windowS} s of start)
            </li>
          ))}
        </ul>
      )}
      <h3>Latency</h3>
      <ul>
        <li>
          System 1 compute time on this machine: median{' '}
          {latMed === null ? NOT_MEASURED : `${latMed.toFixed(1)} ms`}, p95{' '}
          {latP95 === null ? NOT_MEASURED : `${latP95.toFixed(1)} ms`} ({lat.length} samples)
        </li>
        <li>System 2: {NOT_MEASURED} ({MEASURED_TAG} only with real calls, which are off)</li>
      </ul>
      <h3>{CHART_TITLE}</h3>
      <p>
        <label>
          <input type="checkbox" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} />{' '}
          {LOG_SCALE_LABEL}
        </label>
      </p>
      <svg viewBox="0 0 100 40" width="100%" role="img" aria-label={CHART_TITLE}>
        {series.map((s) => (
          <path
            key={s.name}
            d={stepPath(s.calls.map((t) => t / 1000), summary.durationS, maxCalls, logScale)}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.8"
            strokeDasharray={s.dash}
          />
        ))}
      </svg>
      <ul>
        {series.map((s) => (
          <li key={s.name}>
            {s.name}: {s.calls.length} calls
          </li>
        ))}
      </ul>
      <div className="button-row">
        <button
          type="button"
          onClick={() => downloadJsonFile(`${summary.clipName}.replay.json`, JSON.stringify(summary, null, 2))}
        >
          {EXPORT_JSON_LABEL}
        </button>
        <button
          type="button"
          onClick={() => downloadJsonFile(`${summary.clipName}.replay.csv`, summaryToCsv(summary))}
        >
          {EXPORT_CSV_LABEL}
        </button>
      </div>
    </section>
  );
}
