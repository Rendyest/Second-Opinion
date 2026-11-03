/**
 * Consent wording for /setup and /session. Plain language, short sentences,
 * no jargon. Every line must match what the code does: nothing here may
 * promise more (or less) than the implementation. This notice is for this
 * demo only.
 */

export const CONSENT_TITLE = 'Consent';

export const CONSENT_CAMERA_LABEL = 'Use my camera';
export const CONSENT_CAMERA_TEXT =
  'Your picture is used on this computer only, to find your arm and face points. ' +
  'Calibration keeps your arm lengths and face point positions in this browser until you delete them. ' +
  'Nothing from your picture is sent anywhere. ' +
  'Your browser will also ask for permission.';

export const CONSENT_RECORDING_LABEL = 'Allow clip recording for research';
export const CONSENT_RECORDING_TEXT =
  'Recording keeps only numbers for body and face points over time. No video, no pictures. ' +
  'It stays in this browser until you choose to download it. Nothing is uploaded.';

export const CONSENT_SUMMARY_LABEL = 'Allow short summaries of my movement to be sent to the cloud model';
export const CONSENT_SUMMARY_TEXT =
  'During a session, a short summary of your movement is sent to a cloud AI model (Muse Spark) to write tips: ' +
  'the task name, the smallest, largest and average of each angle, how long the session ran, ' +
  'what the movement detector noticed, and whether you reached your face and for how long you held. ' +
  'No pictures, no video, no body points.';

export const CONSENT_CLIPS_LABEL = 'Allow face-masked clips to be sent to the cloud model for labeling';
export const CONSENT_CLIPS_TEXT =
  'This app does not send any video. Your choice is recorded for the separate labeling step of this project.';

export const CONSENT_MASKING_NOTE =
  'Masking reduces but does not guarantee that a person cannot be identified.';

export const CONSENT_DEMO_NOTE = 'This notice is for this demo only.';

export const CONSENT_CAMERA_NEED = 'Turn on the camera choice first, then try again.';
export const CONSENT_RECORDING_NEED = 'Turn on the recording choice first, then try again.';
export const CONSENT_TIPS_OFF_NOTE = 'Tips are off. Turn on the cloud summary choice to get tips.';

export const DELETE_CLIPS_LABEL = 'Delete my clips';
export const DELETE_CLIPS_CONFIRM =
  'Delete recordings, saved measurements and any loaded review clips on this browser? ' +
  'Your saved reviews stay. Files you already downloaded stay where they are.';
export const DELETE_CLIPS_DONE = 'Your recordings and saved measurements were deleted from this browser.';

export const CALIBRATION_NEEDS_CAMERA =
  'Calibration needs your permission to use the camera. Tick “Use my camera” above, then try again.';

export const CALIBRATION_CONSENT_STALE =
  'The consent text has changed. Please read it and tick “Use my camera” again.';

export const CALIBRATION_CHECKS_LEAD = 'Calibration can start once these checks pass:';

export const CALIBRATION_STOPPED = 'Calibration stopped because camera permission was withdrawn.';

/**
 * Plain-language lines for each field the coach summary may carry, keyed by
 * the validator's allowed field names. If the proxy accepts a new field,
 * add its line here too.
 */
export const SUMMARY_FIELDS_PLAIN: Record<string, string> = {
  task: 'The name of the task.',
  angles: 'The smallest, largest and average of each angle.',
  duration_s: 'How long the session ran.',
  held_s: 'How long your hand was held at your face.',
  reached: 'Whether your hand reached your face.',
  system1: 'What the movement detector noticed.',
};
