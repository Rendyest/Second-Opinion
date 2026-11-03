import { isMuseLabel, type MuseLabel } from '../contracts';

/** Reviewer severity, ordered for distance. */
export type Severity = 'none' | 'mild' | 'moderate' | 'severe';

export const SEVERITY_ORDER: readonly Severity[] = ['none', 'mild', 'moderate', 'severe'];

/** Error-type ids; display text lives in reviewCopy (metrics-style split). */
export const ERROR_TYPE_IDS = [
  'timing',
  'asymmetry',
  'instability',
  'dropping',
  'overshoot',
  'incomplete',
  'nonfunctional',
] as const;

export type ErrorTypeId = (typeof ERROR_TYPE_IDS)[number];

export function isErrorTypeId(v: unknown): v is ErrorTypeId {
  return typeof v === 'string' && (ERROR_TYPE_IDS as readonly string[]).includes(v);
}

/** A reviewer's label for one clip. */
export interface ReviewLabel {
  struggling: boolean;
  severity: Severity;
  errorTypes: string[];
}

export type ReviewMode = 'blind' | 'assist';

export type ReviewStatus = 'unreviewed' | 'confirmed' | 'corrected' | 'flagged' | 'labeled';

/** One autosaved review. Aggregates and labels only — never joints or frames. */
export interface StoredReview {
  clip_id: string;
  status: ReviewStatus;
  mode: ReviewMode;
  struggling: boolean;
  severity: Severity;
  error_types: string[];
  note: string;
  reviewer: string;
  reviewed_at: string;
  muse: MuseLabel | null;
  skipped?: boolean;
  unusable?: boolean;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

/**
 * Pure label validation. Returns issue codes (empty means valid). Unusable
 * clips need no label fields at all.
 */
export function validateReviewLabel(label: ReviewLabel, unusable = false): string[] {
  if (unusable) return [];
  const issues: string[] = [];
  for (const id of label.errorTypes) {
    if (!isErrorTypeId(id)) {
      issues.push('unknown-error-type');
      break;
    }
  }
  if (!label.struggling) {
    if (label.severity !== 'none') issues.push('severity-must-be-none');
    if (label.errorTypes.length > 0) issues.push('error-types-must-be-empty');
    return issues;
  }
  if (label.severity === 'none') issues.push('severity-requires-level');
  if (label.errorTypes.length === 0) issues.push('error-types-required');
  return issues;
}

type Comparable = Pick<ReviewLabel, 'struggling' | 'severity' | 'errorTypes'>;
type MuseComparable = Pick<MuseLabel, 'struggling' | 'severity' | 'error_types'>;

/** Exact match: struggling, severity, and error-type sets equal (order-insensitive). */
export function exactLabelMatch(a: Comparable, b: MuseComparable): boolean {
  return a.struggling === b.struggling && a.severity === b.severity && sameSet(a.errorTypes, b.error_types);
}

export function severityIndex(s: Severity): number {
  const i = SEVERITY_ORDER.indexOf(s);
  return i < 0 ? 0 : i;
}

/**
 * Within one severity level: struggling equal and at most 1 apart on
 * none < mild < moderate < severe. none versus mild with different
 * struggling values is not agreement.
 */
export function withinOneSeverity(a: Comparable, b: MuseComparable): boolean {
  return (
    a.struggling === b.struggling &&
    Math.abs(severityIndex(a.severity) - severityIndex(b.severity as Severity)) <= 1
  );
}

/** Status is computed from the final labels, never from the button pressed. */
export function computeReviewStatus(
  muse: MuseLabel | null,
  final: ReviewLabel,
): 'confirmed' | 'corrected' | 'labeled' {
  if (muse === null) return 'labeled';
  return exactLabelMatch(final, muse) ? 'confirmed' : 'corrected';
}

export interface Agreement {
  /** Percent, whole when an integer else one decimal. */
  exact: number;
  withinOne: number;
  exactN: number;
  withinN: number;
  n: number;
}

function percent(k: number, n: number): number {
  if (n === 0) return 0;
  return Math.round((k / n) * 1000) / 10;
}

/** Agreement over counted reviews (confirmed/corrected: a Muse label, not unusable). */
export function agreementFor(entries: Array<{ label: ReviewLabel; muse: MuseLabel }>): Agreement {
  const n = entries.length;
  const exactN = entries.filter((e) => exactLabelMatch(e.label, e.muse)).length;
  const withinN = entries.filter((e) => withinOneSeverity(e.label, e.muse)).length;
  return { exact: percent(exactN, n), withinOne: percent(withinN, n), exactN, withinN, n };
}

export interface ModeAgreement {
  blind: Agreement;
  assist: Agreement;
}

export function agreementByMode(
  entries: Array<{ label: ReviewLabel; muse: MuseLabel; mode: ReviewMode }>,
): ModeAgreement {
  return {
    blind: agreementFor(entries.filter((e) => e.mode === 'blind')),
    assist: agreementFor(entries.filter((e) => e.mode === 'assist')),
  };
}

export interface ReviewCounts {
  /** confirmed + corrected. */
  counted: number;
  unusable: number;
  skipped: number;
  /** Reviewed clips with no Muse label. */
  labeled: number;
  /** Still unreviewed (includes skipped ones, which stay unreviewed). */
  unreviewed: number;
}

export function reviewCounts(reviews: StoredReview[]): ReviewCounts {
  return {
    counted: reviews.filter((r) => r.status === 'confirmed' || r.status === 'corrected').length,
    unusable: reviews.filter((r) => r.unusable === true).length,
    skipped: reviews.filter((r) => r.skipped === true).length,
    labeled: reviews.filter((r) => r.status === 'labeled').length,
    unreviewed: reviews.filter((r) => r.status === 'unreviewed').length,
  };
}

/** "75%" when an integer, otherwise one decimal ("66.7%"). */
export function formatPct(p: number): string {
  return Number.isInteger(p) ? `${p}%` : `${p.toFixed(1)}%`;
}

const REVIEW_STATUSES: readonly string[] = ['unreviewed', 'confirmed', 'corrected', 'flagged', 'labeled'];
const REVIEW_MODES: readonly string[] = ['blind', 'assist'];

/** Strict shape check for a persisted review. Never throws. */
export function isStoredReview(v: unknown): v is StoredReview {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  const keys = Object.keys(r);
  const required = [
    'clip_id',
    'status',
    'mode',
    'struggling',
    'severity',
    'error_types',
    'note',
    'reviewer',
    'reviewed_at',
    'muse',
  ];
  for (const k of required) {
    if (!keys.includes(k)) return false;
  }
  for (const k of keys) {
    if (!required.includes(k) && k !== 'skipped' && k !== 'unusable') return false;
  }
  return (
    typeof r['clip_id'] === 'string' &&
    typeof r['status'] === 'string' &&
    REVIEW_STATUSES.includes(r['status'] as string) &&
    typeof r['mode'] === 'string' &&
    REVIEW_MODES.includes(r['mode'] as string) &&
    typeof r['struggling'] === 'boolean' &&
    typeof r['severity'] === 'string' &&
    SEVERITY_ORDER.includes(r['severity'] as Severity) &&
    Array.isArray(r['error_types']) &&
    (r['error_types'] as unknown[]).every((e) => typeof e === 'string') &&
    typeof r['note'] === 'string' &&
    typeof r['reviewer'] === 'string' &&
    typeof r['reviewed_at'] === 'string' &&
    (r['muse'] === null || isMuseLabel(r['muse'])) &&
    (r['skipped'] === undefined || typeof r['skipped'] === 'boolean') &&
    (r['unusable'] === undefined || typeof r['unusable'] === 'boolean')
  );
}

/** Parse an imported reviews file; throws a plain-worded message on failure. */
export function parseStoredReviews(v: unknown): StoredReview[] {
  if (!Array.isArray(v) || !v.every(isStoredReview)) {
    throw new Error('That file is not a valid reviews file. It must hold an array of saved reviews.');
  }
  return v;
}

/** A note longer than the configured cap is rejected. */
export function validateReviewNote(note: string, maxChars: number): boolean {
  return note.length <= maxChars;
}
