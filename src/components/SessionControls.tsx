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

export type SessionPhase = 'ready' | 'starting' | 'running' | 'paused' | 'finished';

const SESSION_STATUS: Record<SessionPhase, string> = {
  ready: 'Ready to start',
  starting: 'Starting session',
  running: 'Session in progress',
  paused: PAUSED_NOTE,
  finished: 'Session finished',
};

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
  phase,
}: {
  cameraOn: boolean;
  recording: boolean;
  tipsOn: boolean;
  phase: SessionPhase;
}) {
  return (
    <section aria-label="Session status" aria-live="polite">
      <h2>Status</h2>
      <ul>
        <li>{SESSION_STATUS[phase]}</li>
        <li>
          {cameraOn ? STATUS_CAMERA_ON : STATUS_CAMERA_OFF}
        </li>
        <li>
          <strong>{recording && phase === 'paused' ? 'Recording paused' : recording ? STATUS_RECORDING_ON : STATUS_RECORDING_OFF}</strong>
        </li>
        <li>
          {tipsOn ? STATUS_TIPS_ON : STATUS_TIPS_OFF}
        </li>
      </ul>
    </section>
  );
}

interface SessionControlsProps {
  /** Latest live frame; samples append only while it advances. */
  liveFrame: PoseFrame | null;
  cameraOn: boolean;
  consent: ConsentChoices;
  phase: SessionPhase;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  calibration: CalibrationState;
}

export function SessionControls({
  liveFrame,
  cameraOn,
  consent,
  phase,
  onPause,
  onResume,
  onFinish,
  calibration,
}: SessionControlsProps) {
  const bufferRef = useRef<ClipBuffer | null>(null);
  if (bufferRef.current === null) {
    bufferRef.current = new ClipBuffer();
  }
  const t0Ref = useRef<number | null>(null);
  const lastTRef = useRef<number | null>(null);
  const lastFrameRef = useRef<PoseFrame | null>(null);
  const fpsRef = useRef(30);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dlNote, setDlNote] = useState<string | null>(null);
  const buffer = bufferRef.current;

  // Buffers never survive leaving the page.
  useEffect(() => {
    const unregister = registerBuffer(buffer);
    return () => {
      buffer.clear();
      unregister();
    };
  }, [buffer]);

  const running = phase === 'running' && cameraOn;
  const paused = phase === 'paused';
  const finished = phase === 'finished';
  const canStartRecording = canRecord(consent) && running && !recording;

  // Append live samples only while actively recording: not paused, and the
  // recording choice still ticked.
  useEffect(() => {
    const buffer = bufferRef.current;
    if (paused) lastFrameRef.current = liveFrame;
    if (!running || !shouldAppendSample(recording, paused, canRecord(consent), liveFrame !== null)) return;
    if (!liveFrame || lastFrameRef.current === liveFrame) return;
    lastFrameRef.current = liveFrame;
    if (t0Ref.current === null) t0Ref.current = liveFrame.t;
    const t = liveFrame.t - t0Ref.current;
    if (t < 0) return;
    buffer?.append(t, { ...liveFrame.joints });
    lastTRef.current = t;
    if (liveFrame.fps > 0) fpsRef.current = liveFrame.fps;
  }, [liveFrame, recording, running, paused, consent]);

  useEffect(() => {
    if (!finished) return;
    bufferRef.current?.finish(lastTRef.current ?? 0);
    setRecording(false);
    if (dialogRef.current?.open) dialogRef.current.close();
  }, [finished]);

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
    lastFrameRef.current = null;
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
    if (!running || !recording || lastTRef.current === null || !buffer) return;
    if (buffer.markMoment(lastTRef.current)) setNotice(MARK_DONE_NOTE);
  };

  const download = () => {
    const buffer = bufferRef.current;
    if (!finished || !buffer || buffer.empty) return;
    const finishedClip = buffer.finish(lastTRef.current ?? 0);
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

  const tipsOn = running && canSendSummary(consent);

  return (
    <section aria-label="Session controls">
      <h2>Session controls</h2>
      <SessionStatus cameraOn={cameraOn} recording={recording && !finished} tipsOn={tipsOn} phase={phase} />
      {recording && !finished && (
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
        {(running || paused) && (
          <button className="primary-button" type="button" onClick={paused ? onResume : onPause}>
            {paused ? RESUME_LABEL : PAUSE_LABEL}
          </button>
        )}
        {!finished && (
          <button type="button" onClick={mark} disabled={!running || !recording}>
            {recording ? MARK_LABEL : MARK_IDLE_LABEL}
          </button>
        )}
        {(running || paused) && (
          <button type="button" onClick={() => dialogRef.current?.showModal()}>
            {FINISH_LABEL}
          </button>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {shouldOfferDownload(finished, !bufferRef.current.empty, canRecord(consent)) && (
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
          <button type="button" onClick={onFinish}>
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
