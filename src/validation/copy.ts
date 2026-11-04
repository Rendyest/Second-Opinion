/**
 * Reviewer wording for /validation. Kept out of src/copy.ts so participant
 * copy stays separate. This is a reviewer route like /metrics: counts and
 * the word "frames" appear here by design and are never shown on /session.
 */

export const VALIDATION_TITLE = 'Movement validation';

export const VALIDATION_NO_RESULTS = 'No results yet';

export const VALIDATION_SHOULDER_HEADING = 'Shoulder angle by view and target';
export const VALIDATION_ELBOW_HEADING = 'Straight-arm check';
export const VALIDATION_GATE_HEADING = 'Gate over in-hold frames';
export const VALIDATION_SET_HEADING = 'Recorded set';

export const VALIDATION_ELBOW_NOTE = 'Straight-arm check only, not a validation of elbow bend.';

export const VALIDATION_SIDE_NOTE =
  "Outside the gate's frontal-view assumption; not comparable with front-view rows.";

export const VALIDATION_RIGHT_ARM_ONLY = 'Right arm only; left side not validated.';

export const VALIDATION_SMALL_SET = 'Small recorded set; not clinical validation.';

export const VALIDATION_NOTE_POSING =
  'The reference is the nominal posed target, not a measured angle, so posing error is included in these figures.';
export const VALIDATION_NOTE_GATE =
  'The gate removes low-quality frames, so the gated-OK figure is expected to be lower.';
export const VALIDATION_NOTE_BIAS = 'Positive bias means the pipeline reads high.';
export const VALIDATION_NOTE_HOLD = "Errors use frames inside each clip's hold window only.";

export const VALIDATION_REFERENCE_LABEL = 'Reference';
export const VALIDATION_VERIFIED_LABEL = 'Reference checked by';
export const VALIDATION_TUNED_LABEL = 'Thresholds tuned on reported clips';

export const VALIDATION_TESTED_LEAD = 'Tested views and angles';
export const VALIDATION_TESTED_REST = 'Other views and angles were not validated.';
