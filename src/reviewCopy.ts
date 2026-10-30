/**
 * Reviewer/dev wording for /review. Kept out of src/copy.ts so participant
 * copy stays separate. Nothing here may trip the sessionNoCounters
 * banned-word pattern (review modules stay off the session route).
 */
import type { MuseLabel } from './contracts';

export const ERROR_TYPE_LABEL: Record<string, string> = {
  timing: 'timing too long',
  asymmetry: 'asymmetry or compensation',
  instability: 'instability',
  dropping: 'dropping items or limbs',
  overshoot: 'under/overshooting',
  incomplete: 'unable to complete within 2 tries',
  nonfunctional: 'wrong or non-functional movement',
};

export const REVIEW_LABEL_ERRORS: Record<string, string> = {
  'unknown-error-type': 'Unknown error type.',
  'severity-must-be-none': 'Severity must be none when the movement is not struggling.',
  'error-types-must-be-empty': 'Error types must be empty when the movement is not struggling.',
  'severity-requires-level': 'Choose mild, moderate or severe.',
  'error-types-required': 'Choose at least one error type.',
};

export const REVIEW_QUEUE_EMPTY = 'No review clips yet.';

export const REVIEW_NO_REVIEWS = 'No reviewed clips yet.';

export const REVIEW_POINTS_ONLY = 'Review is from body and face points only. Items and soap cannot be seen.';

export const REVIEW_NOTE_WARNING = 'Do not enter names or anything that could identify the person in the clip.';

export const REVIEW_SOURCE_RECORDED = 'Recorded';

export const REVIEW_MUSE_NEGATIVE = 'Not struggling';

export function museLabelText(muse: MuseLabel | null): string {
  if (!muse) return REVIEW_MUSE_NONE;
  return muse.struggling ? `Struggling, ${muse.severity}` : REVIEW_MUSE_NEGATIVE;
}

export const REVIEW_SOURCE_SYNTHETIC = 'Synthetic fixture';

export const REVIEW_PICK_LABEL = 'Choose a review bundle or recorder clip file';

export const REVIEW_MUSE_NONE = 'No Muse label';

export const REVIEW_FILTER_LABEL = 'Filter by status';

export const REVIEW_FILTER_ALL = 'All clips';

export const REVIEW_STATUS_LABEL: Record<string, string> = {
  unreviewed: 'Unreviewed',
  confirmed: 'Confirmed',
  corrected: 'Corrected',
  flagged: 'Flagged',
  labeled: 'Labeled',
};

export const REVIEW_UNDO_LABEL = 'Undo last review';

export const REVIEW_EXPORT_LABEL = 'Export reviews';

export const REVIEW_IMPORT_LABEL = 'Import reviews';

export const REVIEW_CLEAR_LABEL = 'Clear reviews';

export const REVIEW_CLEAR_CONFIRM = 'Delete all saved reviews on this browser? Clips are not stored here.';

export const REVIEW_IMPORT_CONFIRM = 'Replace all saved reviews with the imported file?';

export const REVIEW_REVIEWER_LABEL = 'Reviewer name';

export const REVIEWER_REQUIRED_NOTE = 'Enter your reviewer name above before submitting.';

export const REVIEW_NOTE_TOO_LONG = 'Note is too long. Shorten it before submitting.';

export const REVIEW_CONFIRM_LABEL = 'Confirm';

export const REVIEW_CORRECT_LABEL = 'Correct';

export const REVIEW_SAVE_CORRECTION_LABEL = 'Save correction';

export const REVIEW_LOCK_LABEL = 'Lock my label';

export const REVIEW_UNUSABLE_LABEL = 'Unusable clip';

export const REVIEW_SKIP_LABEL = 'Unsure / skip';

export const REVIEW_BACK_LABEL = 'Back to queue';

export const REVIEW_RECORDED_NOTE = 'Review recorded.';

export const REVIEW_ASSISTED_TAG = 'Assisted (likely overstated)';

export const REVIEW_BLIND_HEADING = 'Blind agreement';

export const REVIEW_ASSIST_HEADING = 'Assisted agreement';

export const REVIEW_AGREEMENT_TITLE = 'Agreement';

export const REVIEW_LABELS_PICK_LABEL = 'Import script labels';

export const REVIEW_IMPORTED_TAG = 'Imported label';

export const REVIEW_NEEDS_REVIEW_NOTE = 'Needs review';
