import { useEffect, useRef, useState } from 'react';
import type { PoseFrame } from '../contracts';
import { config } from '../config';
import { buildClip } from '../pipeline/clip';
import type { CalibrationState } from '../pose/calibration';
import { canRecord, canSendSummary, type ConsentChoices } from '../consent/consent';
import {
  ClipBuffer,
  exportClipFile,
  registerBuffer,
  triggerBlobDownload,
  type BufferedClip,
} from '../recording/clipBuffer';
import {
  EMERGENCY_STOP_LABEL,
  EMERGENCY_STOPPED_NOTE,
  FINISH_CLIPS_NEED,
  FINISH_CONFIRM,
  FINISH_DOWNLOAD_LABEL,
  FINISH_LABEL,
  MARK_DONE_NOTE,
  MARK_IDLE_LABEL,
  MARK_LABEL,
  PAUSE_LABEL,
  PAUSED_NOTE,
  RESUME_LABEL,
  STATUS_CAMERA_OFF,
  STATUS_CAMERA_ON,
  STATUS_RECORDING_OFF,
  STATUS_RECORDING_ON,
  STATUS_TIPS_OFF,
  STATUS_TIPS_ON,
} from '../copy';

/**
 * Pure append gate so the pause rule is unit-testable: samples append only
 * while actively recording, unpaused, consented, and with a frame arriving.
 */
export function shouldAppendSample(
  recording: boolean,
  paused: boolean,
  consentRecording: boolean,
  hasFrame: boolean,
): boolean {
  return recording && !paused && consentRecording && hasFrame;
}

/** Download offer rule: a finished clip exists and recording consent is on. */
export function shouldOfferDownload(
  finished: boolean,
  hasClip: boolean,
  consentRecording: boolean,
): boolean {
  return finished && hasClip && consentRecording;
}

/**
 * Participant session controls (never behind dev_controls): an always-visible
 * status area, pause/resume, finish with an explicit Download offer, a
 * first-in-tab-order emergency stop while recording, and "Mark this moment".
 * Recording uses the shared in-memory clip service: the same clip format,
 * the same validator, and nothing leaves memory except an explicit Download.
 */
export function SessionStatus({
  cameraOn,
  recording,
  tipsOn,
  paused,
}: {
  cameraOn: boolean;
  recording: boolean;
  tipsOn: boolean;
  paused: boolean;
}) {
  return (
    <section aria-label="Session status" aria-live="polite">
      <h2>Status</h2>
      <ul>
        <li>
          <span aria-hidden="true">{cameraOn ? '✓' : '!'}</span>{' '}
          {cameraOn ? STATUS_CAMERA_ON : STATUS_CAMERA_OFF}
        </li>
        <li>
          <span aria-hidden="true">{recording ? '●' : '○'}</span>{' '}
          <strong>{recording ? STATUS_RECORDING_ON : STATUS_RECORDING_OFF}</strong>
        </li>
        <li>
          <span aria-hidden="true">{tipsOn ? '✓' : '!'}</span>{' '}
          {tipsOn ? STATUS_TIPS_ON : STATUS_TIPS_OFF}
        </li>
        {paused && (
          <li>
            <span aria-hidden="true">|</span> {PAUSED_NOTE}
          </li>
        )}
      </ul>
    </section>
  );
}

interface SessionControlsProps {
  /** Latest live frame; samples append only while it advances. */
  liveFrame: PoseFrame | null;
  cameraOn: boolean;
  consent: ConsentChoices;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  onStopCamera: () => void;
  calibration: CalibrationState;
}

export function SessionControls({
  liveFrame,
  cameraOn,
  consent,
  paused,
  onPause,
  onResume,
  onStopCamera,
  calibration,
}: SessionControlsProps) {
  const bufferRef = useRef<ClipBuffer | null>(null);
  const unregisterRef = useRef<(() => void) | null>(null);
  if (bufferRef.current === null) {
    bufferRef.current = new ClipBuffer();
    unregisterRef.current = registerBuffer(bufferRef.current);
  }
  const t0Ref = useRef<number | null>(null);
  const lastTRef = useRef<number | null>(null);
  const fpsRef = useRef(30);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const [recording, setRecording] = useState(false);
  const [finished, setFinished] = useState(false);
  const [finishedClip, setFinishedClip] = useState<BufferedClip | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dlNote, setDlNote] = useState<string | null>(null);

  // Buffers never survive leaving the page.
  useEffect(
    () => () => {
      bufferRef.current?.clear();
      unregisterRef.current?.();
    },
    [],
  );

  const canStartRecording = canRecord(consent) && cameraOn && !recording && !finished;

  // Append live samples only while actively recording: not paused, and the
  // recording choice still ticked.
  useEffect(() => {
    const buffer = bufferRef.current;
    if (!shouldAppendSample(recording, paused, canRecord(consent), liveFrame !== null)) return;
    if (!liveFrame) return;
    if (t0Ref.current === null) t0Ref.current = liveFrame.t;
    const t = liveFrame.t - t0Ref.current;
    if (t < 0) return;
    buffer?.append(t, { ...liveFrame.joints });
    lastTRef.current = t;
    if (liveFrame.fps > 0) fpsRef.current = liveFrame.fps;
  }, [liveFrame, recording, paused, consent]);

  // Withdrawing the recording choice stops at once and discards the clip in
  // progress. The camera keeps running.
  useEffect(() => {
    if (!consent.recording && recording) {
      bufferRef.current?.clear();
      t0Ref.current = null;
      lastTRef.current = null;
      setRecording(false);
      setNotice(EMERGENCY_STOPPED_NOTE);
    }
  }, [consent.recording, recording]);

  const startRecording = () => {
    if (!canStartRecording) return;
    bufferRef.current?.clear();
    t0Ref.current = null;
    lastTRef.current = null;
    setNotice(null);
    setRecording(true);
  };

  const emergencyStop = () => {
    bufferRef.current?.clear();
    t0Ref.current = null;
    lastTRef.current = null;
    setRecording(false);
    setNotice(EMERGENCY_STOPPED_NOTE);
  };

  const mark = () => {
    const buffer = bufferRef.current;
    if (!recording || lastTRef.current === null || !buffer) return;
    if (buffer.markMoment(lastTRef.current)) setNotice(MARK_DONE_NOTE);
  };

  const finish = () => {
    const buffer = bufferRef.current;
    const clip = buffer ? buffer.finish(lastTRef.current ?? 0) : { samples: [], labels: [], marks: [] };
    onStopCamera();
    setRecording(false);
    t0Ref.current = null;
    lastTRef.current = null;
    setFinishedClip(clip.samples.length > 0 ? clip : null);
    setFinished(true);
    dialogRef.current?.close();
  };

  const download = () => {
    if (!finishedClip) return;
    const text = JSON.stringify(
      buildClip({
        name: 'session-clip',
        fps: fpsRef.current,
        samples: finishedClip.samples,
        baseline: calibration.baseline,
        face: calibration.face,
        thresholds: {
          gate: config.gate,
          struggle: config.struggle,
          face: config.face,
          smoothing: config.smoothing,
        },
        labels: finishedClip.labels,
        marks: finishedClip.marks,
        source: 'recorded',
      }),
    );
    const url = exportClipFile(text, consent);
    if (!url) {
      setDlNote(FINISH_CLIPS_NEED);
      return;
    }
    setDlNote(null);
    triggerBlobDownload(url, 'session-clip.clip.json');
  };

  const tipsOn = canSendSummary(consent);

  return (
    <section aria-label="Session controls">
      <h2>Session controls</h2>
      <SessionStatus cameraOn={cameraOn} recording={recording} tipsOn={tipsOn} paused={paused} />
      {recording && (
        <div className="button-row">
          <button type="button" className="emergency-stop" onClick={emergencyStop}>
            {EMERGENCY_STOP_LABEL}
          </button>
        </div>
      )}
      <div className="button-row">
        {!recording && !finished && (
          <button type="button" onClick={startRecording} disabled={!canStartRecording}>
            Start recording
          </button>
        )}
        {!finished && (
          <button type="button" onClick={paused ? onResume : onPause}>
            {paused ? RESUME_LABEL : PAUSE_LABEL}
          </button>
        )}
        <button type="button" onClick={mark} disabled={!recording}>
          {recording ? MARK_LABEL : MARK_IDLE_LABEL}
        </button>
        {!finished && (
          <button type="button" onClick={() => dialogRef.current?.showModal()}>
            {FINISH_LABEL}
          </button>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {shouldOfferDownload(finished, finishedClip !== null, canRecord(consent)) && (
        <div className="button-row">
          <button type="button" onClick={download}>
            {FINISH_DOWNLOAD_LABEL}
          </button>
        </div>
      )}
      {dlNote && <p role="status">{dlNote}</p>}
      <dialog ref={dialogRef} aria-label={FINISH_LABEL}>
        <p>{FINISH_CONFIRM}</p>
        <div className="button-row">
          <button type="button" onClick={finish}>
            {FINISH_LABEL}
          </button>
          <button type="button" onClick={() => dialogRef.current?.close()}>
            Keep going
          </button>
        </div>
      </dialog>
    </section>
  );
}
