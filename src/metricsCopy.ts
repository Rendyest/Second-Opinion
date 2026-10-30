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

export const REPLAY_SOURCE_IMPORTED = 'Imported video';

export const TELEMETRY_SECTION_TITLE = 'Telemetry (dev)';
export const TELEMETRY_PLAY_LABEL = 'Play';
export const TELEMETRY_PAUSE_LABEL = 'Pause';
export const TELEMETRY_STEP_BACK_LABEL = 'Step back';
export const TELEMETRY_STEP_FORWARD_LABEL = 'Step forward';
export const TELEMETRY_SEEK_LABEL = 'Seek';
export const TELEMETRY_SIGNAL_OK = 'Signal good';
export const TELEMETRY_SIGNAL_FLAGGED = 'Signal flagged';

export const IMPORT_SECTION_TITLE = 'Import video (dev)';
export const IMPORT_PICK_LABEL = 'Choose a video file';
export const IMPORT_PARTICIPANT_LABEL = 'Participant code (anonymous, like P1 — never a real name)';
export const IMPORT_TARGET_LABEL = 'Target shoulder angle in degrees';
export const IMPORT_VIEW_LABEL = 'Camera view';
export const IMPORT_VIEW_FRONT = 'Front';
export const IMPORT_VIEW_SIDE = 'Side';
export const IMPORT_HOLD_START_LABEL = 'Hold start (video seconds)';
export const IMPORT_HOLD_END_LABEL = 'Hold end (video seconds)';
export const IMPORT_MIRROR_LABEL = 'Mirror the picture left to right';
export const IMPORT_CONSENT =
  'The person in this recording has agreed that landmark numbers from their movement are saved on this computer. The video file itself never leaves this computer. No video or images are saved.';
export const IMPORT_START_LABEL = 'Import video';
export const IMPORT_DOWNLOAD_LABEL = 'Download imported clip';
export const IMPORT_DISCARD_LABEL = 'Discard import';
export const IMPORT_PREVIEW_LABEL = 'Preview picture (check the orientation)';
export const IMPORT_ROTATION_NOTE =
  'If the preview looks rotated, re-export the video upright and try again. The browser reads the file as-is.';
export const IMPORT_LOW_PICTURES_WARNING =
  'Few pictures came through. The clip may be too short to use.';
export const IMPORT_NEED_CONSENT = 'Tick the recording agreement above, then try again.';
export const IMPORT_NEED_PARTICIPANT = 'Enter a participant code (anonymous, like P1).';
export const IMPORT_BAD_VIEW = 'Pick front or side for the camera view.';
export const IMPORT_BAD_TARGET = 'Enter a target shoulder angle between 0 and 180.';
export const IMPORT_BAD_HOLD_ORDER = 'The hold end must be after the hold start.';
export const IMPORT_BAD_HOLD_RANGE = 'The hold window must sit inside the video.';
export const IMPORT_NO_VIDEO = 'Choose a video file first.';
export const IMPORT_NO_DURATION = 'The video did not report a length. Try another file.';
export const IMPORT_NO_RVFC = 'This browser cannot step through video pictures. Try Chrome or Edge.';
export const IMPORT_NO_POSE = 'The pose model could not load. Check the connection and try again.';
export const IMPORT_EMPTY = 'No pictures came through. Try another file.';
export const IMPORT_READING_NOTE = 'Reading pictures… nothing leaves this computer.';

export const LOOP_SECTION_TITLE = 'Loop comparison (dev)';
export const BASELINE_NOTE = 'Baselines are counted, never executed: they ignore the gate and the cooldown.';
export const EXPORT_JSON_LABEL = 'Download results (JSON)';
export const EXPORT_CSV_LABEL = 'Download results (CSV)';
export const LOG_SCALE_LABEL = 'Log scale';
export const CHART_TITLE = 'Cumulative calls per policy';
