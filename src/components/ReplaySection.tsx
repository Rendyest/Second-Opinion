import { useState } from 'react';
import { parseRecordedClip, type RecordedClip, type ReplayEvent } from '../contracts';
import { config } from '../config';
import { clipFromMockEvents, runReplayWithTelemetry, type ReplaySummary, type TelemetryFrame } from '../pipeline/replay';
import { TelemetryPlayer } from './TelemetryPlayer';
import { LoopMetricsPanel } from './LoopMetricsPanel';
import {
  INVALID_CLIP_MESSAGE,
  REPLAY_PICK_LABEL,
  REPLAY_SECTION_TITLE,
  REPLAY_SYNTHETIC_LABEL,
} from '../metricsCopy';

/**
 * Dev-only replay for /metrics. Loads a recorded clip (or the synthetic
 * mock-stream fixture) from memory, runs the shared pipeline over it, and
 * shows the loop comparison. Never on /session; never writes anywhere.
 */
export function ReplaySection({ mockEvents }: { mockEvents: ReplayEvent[] }) {
  const [summary, setSummary] = useState<ReplaySummary | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryFrame[] | null>(null);
  const [clip, setClip] = useState<RecordedClip | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearReplay = () => {
    setSummary(null);
    setTelemetry(null);
    setClip(null);
  };

  const runClip = (clip: RecordedClip) => {
    try {
      const { summary: result, telemetry: strip } = runReplayWithTelemetry(
        clip,
        {
          gate: config.gate,
          struggle: config.struggle,
          face: config.face,
          smoothing: config.smoothing,
          visMin: config.gate.vis_min,
          cooldownMs: config.coach.cooldown_ms,
        },
        { intervalS: config.metrics.interval_s, coverageWindowS: config.metrics.coverage_window_s },
      );
      setError(null);
      setSummary(result);
      setTelemetry(strip);
      setClip(clip);
    } catch {
      setError(INVALID_CLIP_MESSAGE);
      clearReplay();
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const clip = parseRecordedClip(JSON.parse(await file.text()) as unknown);
      runClip(clip);
    } catch {
      setError(INVALID_CLIP_MESSAGE);
    }
  };

  const onSynthetic = () => {
    try {
      const clip = clipFromMockEvents(mockEvents, 'mock-stream.json', {
        gate: config.gate,
        struggle: config.struggle,
        face: config.face,
        smoothing: config.smoothing,
      });
      runClip(clip);
    } catch {
      setError(INVALID_CLIP_MESSAGE);
    }
  };

  return (
    <section aria-label="Replay (dev)">
      <h2>{REPLAY_SECTION_TITLE}</h2>
      <p>
        <label>
          {REPLAY_PICK_LABEL}{' '}
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
      </p>
      <div className="button-row">
        <button type="button" onClick={onSynthetic}>
          {REPLAY_SYNTHETIC_LABEL}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <LoopMetricsPanel summary={summary} />
      {clip && telemetry && telemetry.length > 0 && <TelemetryPlayer clip={clip} telemetry={telemetry} />}
    </section>
  );
}
