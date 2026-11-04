import { useEffect, useRef, useState } from 'react';
import { checkSidecarHealth, createSidecarPoseDetector, type PoseDetector } from '../pose/poseProvider';
import { buildClip, type ClipSample } from '../pipeline/clip';
import { config } from '../config';
import { buildPoseFrame } from '../pose/poseFrame';
import { SIDECAR_MESSAGE } from '../pose/useLivePose';
import { useCalibration } from '../pose/calibration';
import { canSendClip, useConsent } from '../consent/consent';
import { downloadJsonFile } from './ClipRecorder';
import { applyMirror, lowFrameWarning, mediaTimeToClipT, validateImportMeta } from '../importer/videoImport';
import {
  IMPORT_CONSENT,
  IMPORT_DISCARD_LABEL,
  IMPORT_DOWNLOAD_LABEL,
  IMPORT_EMPTY,
  IMPORT_HOLD_END_LABEL,
  IMPORT_HOLD_START_LABEL,
  IMPORT_LOW_PICTURES_WARNING,
  IMPORT_MIRROR_LABEL,
  IMPORT_NO_DURATION,
  IMPORT_NO_RVFC,
  IMPORT_NO_VIDEO,
  IMPORT_PARTICIPANT_LABEL,
  IMPORT_PICK_LABEL,
  IMPORT_PREVIEW_LABEL,
  IMPORT_READING_NOTE,
  IMPORT_ROTATION_NOTE,
  IMPORT_SECTION_TITLE,
  IMPORT_START_LABEL,
  IMPORT_TARGET_LABEL,
  IMPORT_VIEW_FRONT,
  IMPORT_VIEW_LABEL,
  IMPORT_VIEW_SIDE,
  RECORDER_CLIPS_NEED,
} from '../metricsCopy';

type ImportPhase = 'idle' | 'importing' | 'done';

/**
 * Dev-only video import inside the slice 5 recorder section (never on
 * /session). A local .mp4 plays in a hidden <video> via an object URL; each
 * decoded frame goes to the localhost Detectron2 sidecar and through the
 * same pure joint builder (buildPoseFrame) as the live hook, with clip time
 * from the video's own media time. Frames stay on this machine (sidecar on
 * 127.0.0.1) and no pictures are written anywhere. The only export is the
 * Download button, through the same clip gate as a live recording.
 *
 * Rotation: browsers apply an .mp4 rotation tag to the decoded <video>
 * frames, so landmarks arrive upright. There is no script-readable rotation
 * field, so the preview picture is the orientation check — if it looks
 * rotated, re-export the video upright. The mirror checkbox flips x for a
 * flipped setup.
 */
export function VideoImport() {
  const { consent, set } = useConsent();
  const { state: calibration } = useCalibration();
  const [participant, setParticipant] = useState('P1');
  const [targetDeg, setTargetDeg] = useState('');
  const [view, setView] = useState('front');
  const [holdStart, setHoldStart] = useState('');
  const [holdEnd, setHoldEnd] = useState('');
  const [mirror, setMirror] = useState(false);
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [processed, setProcessed] = useState(0);
  const [mediaS, setMediaS] = useState(0);
  const [durationS, setDurationS] = useState<number | null>(null);
  const [warnLow, setWarnLow] = useState(false);
  const [clipText, setClipText] = useState<string | null>(null);
  const [clipName, setClipName] = useState('P1');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const detectorRef = useRef<PoseDetector | null>(null);
  const samplesRef = useRef<ClipSample[]>([]);
  const decodedRef = useRef(0);
  const baseRef = useRef(calibration);
  baseRef.current = calibration;

  const revokeUrl = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  };

  useEffect(() => revokeUrl, []);

  const drawPreview = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    const w = video.videoWidth || 320;
    const h = video.videoHeight || 240;
    canvas.width = 320;
    canvas.height = Math.max(1, Math.round((320 * h) / w));
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    revokeUrl();
    detectorRef.current = null;
    samplesRef.current = [];
    decodedRef.current = 0;
    setClipText(null);
    setWarnLow(false);
    setProcessed(0);
    setMediaS(0);
    setDurationS(null);
    setError(null);
    setPhase('idle');
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    const video = videoRef.current;
    if (!video) return;
    video.src = url;
    video.load();
  };

  const start = () => {
    const video = videoRef.current;
    if (!video || !urlRef.current) {
      setError(IMPORT_NO_VIDEO);
      return;
    }
    const meta = {
      consentRecording: consent.recording,
      participantId: participant,
      view,
      targetShoulderDeg: Number(targetDeg),
      holdStartS: Number(holdStart),
      holdEndS: Number(holdEnd),
    };
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      setError(IMPORT_NO_DURATION);
      return;
    }
    setDurationS(duration);
    const invalid = validateImportMeta(meta, duration);
    if (invalid) {
      setError(invalid);
      return;
    }
    const rvfc = (video as unknown as {
      requestVideoFrameCallback?: (cb: (now: number, md: { mediaTime: number }) => void) => number;
    }).requestVideoFrameCallback;
    if (typeof rvfc !== 'function') {
      setError(IMPORT_NO_RVFC);
      return;
    }
    setError(null);
    samplesRef.current = [];
    decodedRef.current = 0;
    setProcessed(0);
    setMediaS(0);
    setWarnLow(false);
    setPhase('importing');

    void (async () => {
      if (!(await checkSidecarHealth())) {
        detectorRef.current = null;
        setError(SIDECAR_MESSAGE);
        setPhase('idle');
        return;
      }
      detectorRef.current = createSidecarPoseDetector();
      const detector = detectorRef.current;
      if (!detector) {
        setError(SIDECAR_MESSAGE);
        setPhase('idle');
        return;
      }
      // Frame pump driven by the video clock: each callback reads its own
      // media time, so t tracks the file, not the wall clock. Detection is
      // async (localhost sidecar), so frames chain sequentially in order.
      let chain: Promise<void> = Promise.resolve();
      const pump = (_now: number, md: { mediaTime: number }) => {
        const v = videoRef.current;
        const dt = detectorRef.current;
        if (!v || !dt) return;
        if (!v.ended) {
          (v as unknown as { requestVideoFrameCallback: (cb: typeof pump) => void }).requestVideoFrameCallback(pump);
        }
        const t = mediaTimeToClipT(md.mediaTime);
        setMediaS(md.mediaTime);
        const tMs = Math.round(md.mediaTime * 1000);
        decodedRef.current += 1;
        chain = chain.then(async () => {
          let points: Array<{ x: number; y: number; visibility?: number }> | undefined;
          try {
            points = await dt.detect(v, tMs);
          } catch {
            points = undefined;
          }
          if (!points) return; // nobody in view: the gap stays a gap
          const frame = buildPoseFrame(points, md.mediaTime, 30);
          samplesRef.current.push({ t, joints: applyMirror(frame.joints, mirror) });
          setProcessed(samplesRef.current.length);
        });
      };
      try {
        video.currentTime = 0;
        await video.play();
        (video as unknown as { requestVideoFrameCallback: (cb: typeof pump) => void }).requestVideoFrameCallback(
          pump,
        );
      } catch {
        setError(IMPORT_NO_VIDEO);
        setPhase('idle');
      }
    })();
  };

  const finish = () => {
    const video = videoRef.current;
    video?.pause();
    detectorRef.current?.close();
    detectorRef.current = null;
    const samples = samplesRef.current;
    const duration = video && Number.isFinite(video.duration) ? video.duration : 0;
    const decoded = decodedRef.current;
    if (samples.length === 0) {
      setError(IMPORT_EMPTY);
      setPhase('idle');
      return;
    }
    setWarnLow(lowFrameWarning(samples.length, duration, config.metrics.import_min_frames_per_s));
    const measuredFps = duration > 0 && decoded > 0 ? decoded / duration : null;
    const name = participant.trim() === '' ? 'P1' : participant.trim();
    const cal = baseRef.current;
    try {
      const clip = buildClip({
        name,
        fps: measuredFps !== null && measuredFps > 0 ? Math.round(measuredFps) : 30,
        samples,
        baseline: cal.baseline,
        face: cal.face,
        thresholds: {
          gate: config.gate,
          struggle: config.struggle,
          face: config.face,
          smoothing: config.smoothing,
        },
        labels: [],
        source: 'imported_video',
        imported: {
          view: view as 'front' | 'side',
          targetShoulderDeg: Number(targetDeg),
          hold: { start_s: Number(holdStart), end_s: Number(holdEnd) },
          video: { durationS: duration, frames: samples.length, fps: measuredFps },
        },
      });
      setClipText(JSON.stringify(clip));
      setClipName(name);
      setPhase('done');
    } catch {
      setError(IMPORT_EMPTY);
      setPhase('idle');
    }
  };

  const download = () => {
    if (!clipText) return;
    if (!canSendClip(consent)) {
      setError(RECORDER_CLIPS_NEED);
      return;
    }
    downloadJsonFile(`${clipName}.imported.clip.json`, clipText);
    // Stay on the done step so the same clip can be downloaded again.
  };

  const discard = () => {
    detectorRef.current?.close();
    detectorRef.current = null;
    videoRef.current?.pause();
    samplesRef.current = [];
    setClipText(null);
    setPhase('idle');
    setError(null);
  };

  return (
    <section aria-label="Import video (dev)">
      <h3>{IMPORT_SECTION_TITLE}</h3>
      <p>
        <label>
          {IMPORT_PICK_LABEL}{' '}
          <input type="file" accept=".mp4,video/mp4" onChange={(e) => onFile(e.target.files?.[0] ?? undefined)} />
        </label>
      </p>
      <p>
        <label>
          <input type="checkbox" checked={consent.recording} onChange={(e) => set('recording', e.target.checked)} />{' '}
          {IMPORT_CONSENT}
        </label>
      </p>
      <p>
        <label>
          {IMPORT_PARTICIPANT_LABEL}{' '}
          <input type="text" value={participant} onChange={(e) => setParticipant(e.target.value)} maxLength={24} />
        </label>
      </p>
      <p>
        <label>
          {IMPORT_TARGET_LABEL}{' '}
          <input
            type="number"
            value={targetDeg}
            onChange={(e) => setTargetDeg(e.target.value)}
            min={0}
            max={180}
            step="any"
          />
        </label>
      </p>
      <p>
        <label>
          {IMPORT_VIEW_LABEL}{' '}
          <select value={view} onChange={(e) => setView(e.target.value)}>
            <option value="front">{IMPORT_VIEW_FRONT}</option>
            <option value="side">{IMPORT_VIEW_SIDE}</option>
          </select>
        </label>
      </p>
      <p>
        <label>
          {IMPORT_HOLD_START_LABEL}{' '}
          <input type="number" value={holdStart} onChange={(e) => setHoldStart(e.target.value)} min={0} step="any" />
        </label>
      </p>
      <p>
        <label>
          {IMPORT_HOLD_END_LABEL}{' '}
          <input type="number" value={holdEnd} onChange={(e) => setHoldEnd(e.target.value)} min={0} step="any" />
        </label>
      </p>
      <p>
        <label>
          <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />{' '}
          {IMPORT_MIRROR_LABEL}
        </label>
      </p>
      <div>
        <p>{IMPORT_PREVIEW_LABEL}</p>
        <canvas ref={canvasRef} aria-label={IMPORT_PREVIEW_LABEL} />
        <p>{IMPORT_ROTATION_NOTE}</p>
      </div>
      {error && <p role="alert">{error}</p>}
      {phase === 'importing' && (
        <p aria-live="polite">
          {IMPORT_READING_NOTE} {processed} pictures at {mediaS.toFixed(1)} s of{' '}
          {durationS === null ? '?' : durationS.toFixed(1)} s.
        </p>
      )}
      {phase === 'done' && warnLow && <p role="alert">{IMPORT_LOW_PICTURES_WARNING}</p>}
      <div className="button-row">
        {phase !== 'done' ? (
          <button type="button" onClick={start} disabled={phase === 'importing'}>
            {IMPORT_START_LABEL}
          </button>
        ) : (
          <>
            <button type="button" onClick={download}>
              {IMPORT_DOWNLOAD_LABEL}
            </button>
            <button type="button" onClick={discard}>
              {IMPORT_DISCARD_LABEL}
            </button>
          </>
        )}
      </div>
      <video
        ref={videoRef}
        // Kept rendering (2 px, transparent) instead of display:none:
        // requestVideoFrameCallback only fires for presented frames.
        style={{ width: 2, height: 2, opacity: 0, position: 'absolute' }}
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        onLoadedMetadata={(e) => {
          setDurationS(e.currentTarget.duration);
          try {
            e.currentTarget.currentTime = Math.min(0.5, e.currentTarget.duration / 2);
          } catch {
            // Preview seek is best-effort; import reads from the start.
          }
        }}
        onSeeked={drawPreview}
        onEnded={finish}
      />
    </section>
  );
}
