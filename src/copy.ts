import type { GateReason, System1StateName, TopSignal } from './contracts';

/**
 * Every participant-facing string for the session view lives here — state
 * labels, why lines, fix lines, and coach copy — so wording can be reviewed
 * and edited in one place. Nothing here may trip the sessionNoCounters
 * banned-word pattern (no fps, frames, calls, saved, flag rate, latency, or
 * escalat-* words, and no digits in live text).
 */

export const STATE_LABEL: Record<System1StateName, string> = {
  moving_well: 'Moving well',
  hesitating: 'Hesitating',
  struggling: 'Struggling',
  cant_see_you: "Can't see you",
};

export const TOP_SIGNAL_WHY: Record<TopSignal, string> = {
  stall: 'Movement has stalled.',
  jitter: 'Movement looks unsteady.',
  compensation: 'Your shoulder is lifting.',
  failed_range: 'A little further may help.',
  drop: 'Your hand is coming down.',
};

/** Fix shown under "Can't see you": first matching reason in gate order wins. */
export const FIX_BY_REASON: ReadonlyArray<{ reason: GateReason; line: string }> = [
  { reason: 'low_visibility', line: 'Keep your arm in view of the camera.' },
  { reason: 'foreshortening', line: 'Try keeping your forearm across the camera view, not pointing at it.' },
  { reason: 'bone_length_drift', line: 'Try holding still for a moment.' },
];

export function fixLineFor(reasons: readonly GateReason[]): string {
  for (const { reason, line } of FIX_BY_REASON) {
    if (reasons.includes(reason)) return line;
  }
  return 'Try moving back into view of the camera.';
}

export const CHECKING_IN = 'Checking in...';

export const LOCAL_FALLBACK = 'Take your time. Try slowing down.';

export const COACH_BUTTON_LABEL = 'Get a tip';

export const TASK_NAME = 'wash your face with the face towel';

export const SESSION_INTRO = 'Use your right arm to wash your face with the face towel. Take your time. Move in whatever way feels comfortable, and pause whenever you like.';

export const SESSION_PRIVACY_NOTE =
  'Only a short summary of your movement is captured. No pictures or video leave this computer.';

export const FACE_STEP_TITLE = 'Face Calibration';

export const FACE_STEP_INTRO =
  'Sit facing the camera with your arm relaxed and your hand away from your face.';

export const FACE_HOLD_PROMPT = 'Now bring your hand to your forehead or cheek and hold it there.';

export const FACE_ANCHOR_FAIL =
  'Face check failed: keep your face in view with your hand away, then try again.';

export const FACE_HOLD_FAIL =
  'Face check failed: bring your hand to your forehead or cheek and hold it there, then try again.';

export const FACE_NO_POSE_FAIL =
  'Face check failed: no pose detected. Move into view, then try again.';

export const FACE_PASS = 'Face step passed: reach checks are set.';

export const FACE_SKIPPED_NOTE =
  'You continued without the face step. Reach checks use standard values.';

export const FACE_START_LABEL = 'Start face step';

export const FACE_RETRY_LABEL = 'Retry face step';

export const FACE_HOLD_LABEL = 'Calibrate hold';

export const FACE_SKIP_LABEL = 'Continue without face step';
