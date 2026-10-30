import { CLIP_ID_RE, type MuseLabel, type ReviewClip } from '../contracts';

/**
 * Script-label signal to reviewer error-type mapping. The labelling script
 * emits coarse movement signals; the reviewer taxonomy needs error types.
 * 'none' means no struggle (severity none, empty set). 'uncertain' and null
 * struggling are rejected: a human must look.
 */
export const SCRIPT_SIGNAL_MAP: Record<string, string> = {
  stall: 'timing',
  compensation: 'asymmetry',
  jitter: 'instability',
};

const KNOWN_SIGNALS = [...Object.keys(SCRIPT_SIGNAL_MAP), 'none', 'uncertain'];

/** One parsed script label, before mapping to a Muse label. */
export interface ScriptLabel {
  clip_id: string;
  struggling: boolean;
  signal: string;
  reason: string;
  needs_review: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseOne(v: unknown): ScriptLabel {
  if (!isRecord(v)) throw new Error('That file is not a script label file.');
  const { clip_id, struggling, signal, reason, needs_review } = v;
  if (typeof clip_id !== 'string' || !CLIP_ID_RE.test(clip_id)) {
    throw new Error('That file is not a script label file.');
  }
  // Null struggling (insufficient evidence) needs a human, like uncertain.
  if (typeof struggling !== 'boolean') throw new Error('That file is not a script label file.');
  if (typeof signal !== 'string' || !KNOWN_SIGNALS.includes(signal)) {
    throw new Error('That file is not a script label file.');
  }
  if (typeof reason !== 'string' || reason.length === 0 || reason.length > 2000) {
    throw new Error('That file is not a script label file.');
  }
  if (typeof needs_review !== 'boolean') throw new Error('That file is not a script label file.');
  return { clip_id, struggling, signal, reason, needs_review };
}

/** A script label file holds one label object or an array of them. */
export function parseScriptLabels(json: unknown): ScriptLabel[] {
  if (Array.isArray(json)) return json.map(parseOne);
  return [parseOne(json)];
}

export interface MappedLabel {
  muse: MuseLabel;
  needsReview: boolean;
}

/**
 * Map a script label onto a Muse label. Uncertain signals are rejected.
 * The script emits no severity, so struggling imports default to mild —
 * the reviewer corrects it in assist mode or after the blind lock.
 */
export function scriptLabelToMuse(label: ScriptLabel): MappedLabel | { rejected: string } {
  if (label.signal === 'uncertain') return { rejected: 'uncertain' };
  if (label.signal === 'none') {
    return {
      muse: { struggling: false, severity: 'none', error_types: [], reason: label.reason },
      needsReview: label.needs_review,
    };
  }
  const errorType = SCRIPT_SIGNAL_MAP[label.signal];
  if (!errorType) return { rejected: 'unknown signal' };
  return {
    muse: { struggling: true, severity: 'mild', error_types: [errorType], reason: label.reason },
    needsReview: label.needs_review,
  };
}

export interface AttachReport {
  clips: ReviewClip[];
  attached: string[];
  skippedLabeled: string[];
  skippedUnknown: string[];
  rejected: Array<{ clip_id: string; reason: string }>;
  needsReview: Record<string, boolean>;
}

/**
 * Attach script labels to clips that have no Muse label. Clips that
 * already carry one are never overwritten.
 */
export function attachScriptLabels(clips: ReviewClip[], labels: ScriptLabel[]): AttachReport {
  const byId = new Map(clips.map((c) => [c.clip_id, c]));
  const next = clips.map((c) => (c.muse ? { ...c, muse: { ...c.muse } } : { ...c }));
  const nextById = new Map(next.map((c) => [c.clip_id, c]));
  const report: AttachReport = {
    clips: next,
    attached: [],
    skippedLabeled: [],
    skippedUnknown: [],
    rejected: [],
    needsReview: {},
  };
  for (const label of labels) {
    const clip = nextById.get(label.clip_id);
    if (!clip) {
      report.skippedUnknown.push(label.clip_id);
      continue;
    }
    if (byId.get(label.clip_id)?.muse) {
      report.skippedLabeled.push(label.clip_id);
      continue;
    }
    const mapped = scriptLabelToMuse(label);
    if ('rejected' in mapped) {
      report.rejected.push({ clip_id: label.clip_id, reason: mapped.rejected });
      continue;
    }
    clip.muse = mapped.muse;
    report.attached.push(label.clip_id);
    report.needsReview[label.clip_id] = mapped.needsReview;
  }
  return report;
}
