/**
 * Reviewer/dev wording for /metrics: replay, recording, and the loop
 * comparison. Kept out of src/copy.ts so participant copy stays separate.
 * Nothing here may trip the sessionNoCounters banned-word pattern.
 */

export const METRICS_TITLE = 'Loop metrics (reviewers and judges)';

export const NO_RESULTS = 'No results yet';

export const REPLAY_SECTION_TITLE = 'Replay';
export const REPLAY_PICK_LABEL = 'Choose a clip file';
export const REPLAY_SYNTHETIC_LABEL = 'Replay synthetic fixture';
export const REPLAY_SOURCE_RECORDED = 'Recorded';
export const REPLAY_SOURCE_SYNTHETIC = 'Synthetic fixture';
export const REPLAY_CALIBRATED = 'calibrated';
export const REPLAY_UNCALIBRATED = 'uncalibrated';

export const RECORDER_SECTION_TITLE = 'Record a clip (dev)';
export const RECORDER_LABEL_PROMPT = 'Clip label (an anonymous code like P1, not a real name)';
export const RECORDER_CONSENT =
  'The person in this recording has agreed that landmark numbers from their movement are saved on this computer. No video or images are saved.';
export const RECORDER_START_LABEL = 'Start recording';
export const RECORDER_STOP_LABEL = 'Stop recording';
export const RECORDER_MARK_START_LABEL = 'Mark struggle start';
export const RECORDER_MARK_END_LABEL = 'Mark struggle end';
export const RECORDER_DOWNLOAD_LABEL = 'Download clip';
export const RECORDER_CLIPS_NEED =
  'Turn on the recording and face-masked clips choices to download.';
export const RECORDER_DISCARD_LABEL = 'Discard clip';
export const RECORDER_RECORDING_NOTE = 'Recording… landmark numbers only.';
export const RECORDER_DONE_NOTE = 'Recording stopped. Download to keep the clip, or discard it.';

export const SIMULATED_TAG = 'Simulated';
export const MEASURED_TAG = 'Measured';
export const NOT_MEASURED = 'Not measured';
export const NO_LABELS = 'No labelled intervals in this clip';

export const INVALID_CLIP_MESSAGE =
  'That file is not a valid clip. Pick a recorded clip file and try again.';

export const LOOP_SECTION_TITLE = 'Loop comparison (dev)';
export const BASELINE_NOTE = 'Baselines are counted, never executed: they ignore the gate and the cooldown.';
export const EXPORT_JSON_LABEL = 'Download results (JSON)';
export const EXPORT_CSV_LABEL = 'Download results (CSV)';
export const LOG_SCALE_LABEL = 'Log scale';
export const CHART_TITLE = 'Cumulative calls per policy';
