/**
 * Validation results schema (schemaVersion 1) for /validation.
 * Aggregates only: counts, means of absolute and signed errors, gate
 * tallies. No joints, no angles per frame, no images, no clips.
 */

export const VALIDATION_SCHEMA_VERSION = 1;

/** The fixed reference string every v1 file must carry. */
export const VALIDATION_REFERENCE = 'Posed target angle (nominal)';

export type ValidationView = 'front' | 'side';

export interface ValidationRecordedSet {
  n_clips: number;
  n_participants: number;
  n_frames_in_hold: number;
  n_frames_outside_hold: number;
  n_unlabelled_frames: number;
}

export interface ValidationShoulderRow {
  view: ValidationView;
  target_deg: number;
  n_gated_ok: number;
  mae_deg_gated_ok: number | null;
  bias_deg_gated_ok: number | null;
  n_all: number;
  mae_deg_all: number | null;
  bias_deg_all: number | null;
}

export interface ValidationElbowRow {
  /** Always 180: the straight-arm check. */
  target_deg: 180;
  label: string;
  n_gated_ok: number;
  mae_deg_gated_ok: number | null;
  bias_deg_gated_ok: number | null;
  n_all: number;
  mae_deg_all: number | null;
  bias_deg_all: number | null;
}

export interface ValidationResults {
  schemaVersion: 1;
  generatedAt: string;
  reference: typeof VALIDATION_REFERENCE;
  reference_verified_by?: string;
  thresholds_tuned_on_reported_clips: boolean;
  recordedSet: ValidationRecordedSet;
  /** One row per (view, target_deg) present in the data. Never pooled. */
  shoulder: ValidationShoulderRow[];
  /** Straight-arm check from front-view clips only. */
  elbow: ValidationElbowRow;
  /** Gate flags counted over in-hold frames. */
  gate: { flagged: number; total: number };
}

const TOP_LEVEL_KEYS: readonly string[] = [
  'schemaVersion',
  'generatedAt',
  'reference',
  'reference_verified_by',
  'thresholds_tuned_on_reported_clips',
  'recordedSet',
  'shoulder',
  'elbow',
  'gate',
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** MAE and bias are null exactly when their n is 0. */
function isErrorPair(n: unknown, mae: unknown, bias: unknown): boolean {
  if (!isNonNegativeInt(n)) return false;
  if (n === 0) return mae === null && bias === null;
  return isFiniteNum(mae) && (mae as number) >= 0 && isFiniteNum(bias);
}

function isRecordedSet(v: unknown): v is ValidationRecordedSet {
  if (!isRecord(v)) return false;
  return (
    isNonNegativeInt(v['n_clips']) &&
    isNonNegativeInt(v['n_participants']) &&
    (v['n_participants'] as number) >= 1 &&
    isNonNegativeInt(v['n_frames_in_hold']) &&
    isNonNegativeInt(v['n_frames_outside_hold']) &&
    isNonNegativeInt(v['n_unlabelled_frames'])
  );
}

function isShoulderRow(v: unknown): v is ValidationShoulderRow {
  if (!isRecord(v)) return false;
  if (v['view'] !== 'front' && v['view'] !== 'side') return false;
  if (!isFiniteNum(v['target_deg']) || (v['target_deg'] as number) < 0 || (v['target_deg'] as number) > 180) {
    return false;
  }
  if (!isNonNegativeInt(v['n_gated_ok']) || !isNonNegativeInt(v['n_all'])) return false;
  if ((v['n_gated_ok'] as number) > (v['n_all'] as number)) return false;
  return (
    isErrorPair(v['n_gated_ok'], v['mae_deg_gated_ok'], v['bias_deg_gated_ok']) &&
    isErrorPair(v['n_all'], v['mae_deg_all'], v['bias_deg_all'])
  );
}

function isElbowRow(v: unknown): v is ValidationElbowRow {
  if (!isRecord(v)) return false;
  if (v['target_deg'] !== 180) return false;
  if (typeof v['label'] !== 'string' || (v['label'] as string).length === 0) return false;
  if (!isNonNegativeInt(v['n_gated_ok']) || !isNonNegativeInt(v['n_all'])) return false;
  if ((v['n_gated_ok'] as number) > (v['n_all'] as number)) return false;
  return (
    isErrorPair(v['n_gated_ok'], v['mae_deg_gated_ok'], v['bias_deg_gated_ok']) &&
    isErrorPair(v['n_all'], v['mae_deg_all'], v['bias_deg_all'])
  );
}

export function isValidationResults(v: unknown): v is ValidationResults {
  if (!isRecord(v)) return false;
  for (const key of Object.keys(v)) {
    if (!TOP_LEVEL_KEYS.includes(key)) return false;
  }
  if (v['schemaVersion'] !== VALIDATION_SCHEMA_VERSION) return false;
  if (typeof v['generatedAt'] !== 'string' || (v['generatedAt'] as string).length === 0) return false;
  if (v['reference'] !== VALIDATION_REFERENCE) return false;
  if (v['reference_verified_by'] !== undefined && typeof v['reference_verified_by'] !== 'string') return false;
  if (typeof v['thresholds_tuned_on_reported_clips'] !== 'boolean') return false;
  if (!isRecordedSet(v['recordedSet'])) return false;
  if (!Array.isArray(v['shoulder']) || (v['shoulder'] as unknown[]).length === 0) return false;
  const seen = new Set<string>();
  for (const row of v['shoulder'] as unknown[]) {
    if (!isShoulderRow(row)) return false;
    const key = `${(row as ValidationShoulderRow).view}@${(row as ValidationShoulderRow).target_deg}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  if (!isElbowRow(v['elbow'])) return false;
  const gate = v['gate'];
  if (!isRecord(gate) || Object.keys(gate).length !== 2) return false;
  if (!isNonNegativeInt(gate['flagged']) || !isNonNegativeInt(gate['total'])) return false;
  return (gate['flagged'] as number) <= (gate['total'] as number);
}

/**
 * Parse the build-time results text. Anything missing, unparsable, or
 * failing validation yields null, and the page shows "No results yet".
 */
export function parseValidationResults(raw: string | undefined): ValidationResults | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  return isValidationResults(parsed) ? parsed : null;
}
