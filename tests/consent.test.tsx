import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConsentForm } from '../src/components/ConsentForm';
import { DeleteMyClips } from '../src/components/DeleteMyClips';
import {
  SessionControls,
  SessionStatus,
  shouldAppendSample,
  shouldOfferDownload,
} from '../src/components/SessionControls';
import { buildClip } from '../src/pipeline/clip';
import { isRecordedClip } from '../src/contracts';
import { clearCalibration, loadCalibrationState, saveBaseline } from '../src/pose/calibration';
import {
  canRecord,
  canSendClip,
  canSendSummary,
  canUseCamera,
  CONSENT_TEXT_VERSION,
  loadConsent,
  setChoice,
  storageWorks,
  type ConsentState,
} from '../src/consent/consent';
import {
  CALIBRATION_CHECKS_LEAD,
  CALIBRATION_CONSENT_STALE,
  CALIBRATION_NEEDS_CAMERA,
  CALIBRATION_STOPPED,
  CONSENT_CAMERA_TEXT,
  CONSENT_CLIPS_TEXT,
  CONSENT_DEMO_NOTE,
  CONSENT_MASKING_NOTE,
  CONSENT_RECORDING_TEXT,
  CONSENT_SUMMARY_TEXT,
  DELETE_CLIPS_CONFIRM,
  DELETE_CLIPS_DONE,
  DELETE_CLIPS_LABEL,
  SUMMARY_FIELDS_PLAIN,
} from '../src/consentCopy';
import { ALLOWED_SUMMARY_KEYS } from '../server/validate.mjs';
import { clearAllBuffers, ClipBuffer, exportClipFile, registerBuffer } from '../src/recording/clipBuffer';

const BANNED = /\b(fps|frames?|calls?|saved|flag rate|latency|escalat\w*)\b/i;

/** consent.ts guards on typeof localStorage; node tests stub it here. */
function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function state(): ConsentState {
  return {
    camera: false,
    recording: false,
    cloud_summary: false,
    cloud_clips: false,
    text_version: CONSENT_TEXT_VERSION,
    ts: 0,
  };
}

describe('consent defaults', () => {
  it('loads all four boxes unticked', () => {
    stubStorage();
    const loaded = loadConsent();
    expect(loaded.camera).toBe(false);
    expect(loaded.recording).toBe(false);
    expect(loaded.cloud_summary).toBe(false);
    expect(loaded.cloud_clips).toBe(false);
  });

  it('a text_version change resets all choices to unticked', () => {
    stubStorage();
    localStorage.setItem(
      'mirra.consent.v1',
      JSON.stringify({
        choices: { camera: true, recording: true, cloud_summary: true, cloud_clips: true },
        text_version: CONSENT_TEXT_VERSION + 1,
        ts: 0,
      }),
    );
    const loaded = loadConsent();
    expect([loaded.camera, loaded.recording, loaded.cloud_summary, loaded.cloud_clips]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('consent dependency', () => {
  it('box 4 is off until box 2 is ticked', () => {
    let s = state();
    s = setChoice(s, 'cloud_clips', true);
    // Setting clips while recording is off still stores the tick here; the
    // gate is canSendClip, which stays false. The checkbox UI keeps box 4
    // disabled until box 2 is ticked.
    expect(canSendClip(s)).toBe(false);
  });

  it('unticking box 2 unticks box 4', () => {
    let s = state();
    s = setChoice(s, 'recording', true);
    s = setChoice(s, 'cloud_clips', true);
    expect(s.cloud_clips).toBe(true);
    s = setChoice(s, 'recording', false);
    expect(s.recording).toBe(false);
    expect(s.cloud_clips).toBe(false);
  });

  it('persisted choices round-trip through localStorage', () => {
    stubStorage();
    let s = loadConsent();
    s = setChoice(s, 'camera', true);
    s = setChoice(s, 'recording', true);
    const again = loadConsent();
    expect(again.camera).toBe(true);
    expect(again.recording).toBe(true);
    expect(again.cloud_summary).toBe(false);
    expect(again.text_version).toBe(CONSENT_TEXT_VERSION);
  });
});

describe('consent gates', () => {
  it('camera gate follows box 1 only', () => {
    expect(canUseCamera(state())).toBe(false);
    expect(canUseCamera({ ...state(), recording: true })).toBe(false);
    expect(canUseCamera({ ...state(), camera: true })).toBe(true);
  });

  it('recording gate follows box 2 only', () => {
    expect(canRecord(state())).toBe(false);
    expect(canRecord({ ...state(), camera: true })).toBe(false);
    expect(canRecord({ ...state(), recording: true })).toBe(true);
  });

  it('summary gate follows box 3 only', () => {
    expect(canSendSummary(state())).toBe(false);
    expect(canSendSummary({ ...state(), cloud_summary: true })).toBe(true);
  });

  it('clip export needs box 2 AND box 4 together', () => {
    expect(canSendClip(state())).toBe(false);
    expect(canSendClip({ ...state(), recording: true })).toBe(false);
    expect(canSendClip({ ...state(), cloud_clips: true })).toBe(false);
    expect(canSendClip({ ...state(), recording: true, cloud_clips: true })).toBe(true);
  });

  it('exportClipFile is the only export path and it enforces both boxes', () => {
    const both = { ...state(), recording: true, cloud_clips: true };
    const recOnly = { ...state(), recording: true };
    const seen: Blob[] = [];
    const url = exportClipFile('{}', both, (blob) => {
      seen.push(blob);
      return 'blob:clip';
    });
    expect(url).toBe('blob:clip');
    expect(seen).toHaveLength(1);
    expect(exportClipFile('{}', recOnly)).toBeNull();
    expect(exportClipFile('{}', state())).toBeNull();
  });
});

describe('consent copy is truthful and check-safe', () => {
  it('names what is kept and where it stays, with no banned words or digits', () => {
    const lines = [
      CONSENT_CAMERA_TEXT,
      CONSENT_RECORDING_TEXT,
      CONSENT_SUMMARY_TEXT,
      CONSENT_CLIPS_TEXT,
      CONSENT_MASKING_NOTE,
      CONSENT_DEMO_NOTE,
      DELETE_CLIPS_LABEL,
      CALIBRATION_NEEDS_CAMERA,
      CALIBRATION_CONSENT_STALE,
      CALIBRATION_CHECKS_LEAD,
      CALIBRATION_STOPPED,
      // DELETE_CLIPS_CONFIRM and DELETE_CLIPS_DONE are verbatim user copy
      // ("saved measurements" names what is deleted), so they are exempt
      // from the counters guard and checked separately below.
    ];
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) {
      expect(line).not.toMatch(BANNED);
      expect(line).not.toMatch(/\d/);
    }
    for (const line of [DELETE_CLIPS_CONFIRM, DELETE_CLIPS_DONE]) {
      expect(line).toContain('saved measurements');
      expect(line).not.toMatch(/\d/);
    }
  });

  it('names the cloud recipient as a cloud AI model (Muse Spark)', () => {
    expect(CONSENT_SUMMARY_TEXT).toContain('a cloud AI model (Muse Spark)');
  });

  it('says plainly that no video is sent', () => {
    expect(CONSENT_CLIPS_TEXT).toContain('This app does not send any video.');
  });

  it('is a demo notice, not an ethics form', () => {
    const all = [
      CONSENT_CAMERA_TEXT,
      CONSENT_RECORDING_TEXT,
      CONSENT_SUMMARY_TEXT,
      CONSENT_CLIPS_TEXT,
      CONSENT_MASKING_NOTE,
      CONSENT_DEMO_NOTE,
    ].join(' ');
    expect(all.toLowerCase()).not.toContain('ethics');
    expect(all.toLowerCase()).not.toContain('approved');
  });

  it('every summary field has a plain line and every line maps to a field', () => {
    const allowed = [...ALLOWED_SUMMARY_KEYS].sort();
    const described = Object.keys(SUMMARY_FIELDS_PLAIN).sort();
    expect(described).toEqual(allowed);
  });
});

describe('consent checkboxes', () => {
  it('all four boxes start unticked and box 4 is disabled until box 2 is ticked', () => {
    const html = renderToStaticMarkup(<ConsentForm consent={state()} onChange={() => {}} />);
    expect(html).not.toContain('checked');
    // The fourth checkbox carries the disabled attribute; the others do not.
    const disabledCount = (html.match(/disabled/g) ?? []).length;
    expect(disabledCount).toBe(1);
  });

  it('box 4 is enabled once box 2 is ticked', () => {
    const html = renderToStaticMarkup(
      <ConsentForm consent={{ ...state(), recording: true }} onChange={() => {}} />,
    );
    expect(html).not.toContain('disabled');
  });

  it('checkbox markup passes the banned-word and no-digit checks', () => {
    for (const consent of [state(), { ...state(), recording: true, cloud_clips: true }]) {
      const html = renderToStaticMarkup(<ConsentForm consent={consent} onChange={() => {}} />);
      const text = html.replace(/<[^>]+>/g, ' ');
      expect(text).not.toMatch(BANNED);
      expect(text).not.toMatch(/\d/);
    }
  });
});

describe('delete my clips', () => {
  it('is present with a confirm step and clears stores but leaves consent', () => {
    stubStorage();
    saveBaseline({ upperArm: 100, forearm: 100, shoulderWidth: 100 });
    const before = loadCalibrationState();
    expect(before.baseline).not.toBeNull();
    const stored = setChoice(loadConsent(), 'recording', true);
    expect(stored.recording).toBe(true);

    const html = renderToStaticMarkup(<DeleteMyClips />);
    expect(html).toContain('Delete my clips');
    expect(html).toContain('Delete recordings, session metrics, saved measurements and any loaded review clips');

    // The confirmed path: buffers plus calibration and face data go away.
    const buffer = new ClipBuffer();
    const unregister = registerBuffer(buffer);
    try {
      buffer.append(1, { r_wrist: { x: 0.5, y: 0.5, conf: 0.9 } });
      clearAllBuffers();
      clearCalibration();
      expect(buffer.empty).toBe(true);
      expect(loadCalibrationState().baseline).toBeNull();
    } finally {
      unregister();
    }
    expect(loadConsent().recording).toBe(true);
  });

  it('delete markup has no digits in its visible text', () => {
    const html = renderToStaticMarkup(<DeleteMyClips />);
    const text = html.replace(/<[^>]+>/g, ' ');
    expect(text).not.toMatch(/\d/);
  });
});

describe('session controls', () => {
  function stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, ' ');
  }

  const OFF = { camera: false, recording: false, cloud_summary: false, cloud_clips: false };

  function controls(extra: object = {}) {
    return renderToStaticMarkup(
      <SessionControls
        liveFrame={null}
        cameraOn={false}
        consent={{ ...OFF }}
        phase="ready"
        onPause={() => {}}
        onResume={() => {}}
        onFinish={() => {}}
        calibration={{ baseline: null, skipped: false, face: null, faceSkipped: false }}
        {...extra}
      />,
    );
  }

  it('status area always shows camera, recording and tips as text', () => {
    const html = renderToStaticMarkup(
      <SessionStatus cameraOn={false} recording={false} tipsOn={false} phase="ready" />,
    );
    expect(html).toContain('Camera off');
    expect(html).toContain('Recording off');
    expect(html).toContain('Tips off');
    expect(html).not.toContain('Recording on');
  });

  it('status area marks an active recording unmistakably', () => {
    const html = renderToStaticMarkup(
      <SessionStatus cameraOn recording tipsOn={false} phase="running" />,
    );
    expect(html).toContain('Recording on');
    expect(html).toContain('Camera on');
  });

  it('idle controls keep exercise actions unavailable before start', () => {
    const html = controls();
    expect(html).not.toContain('Pause');
    expect(html).toContain('Not recording');
    expect(html.split('<dialog')[0]).not.toContain('Finish session');
    expect(html).not.toContain('Stop recording now');
    expect(html).not.toContain('Download clip');
    const text = stripTags(html);
    expect(text).not.toMatch(BANNED);
    expect(text).not.toMatch(/\d/);
  });

  it('pause rule: appends stop while paused, and resume needs all four inputs', () => {
    expect(shouldAppendSample(true, false, true, true)).toBe(true);
    expect(shouldAppendSample(true, true, true, true)).toBe(false);
    expect(shouldAppendSample(true, false, false, true)).toBe(false);
    expect(shouldAppendSample(false, false, true, true)).toBe(false);
    expect(shouldAppendSample(true, false, true, false)).toBe(false);
  });

  it('download offer needs a finished clip and recording consent', () => {
    expect(shouldOfferDownload(true, true, true)).toBe(true);
    expect(shouldOfferDownload(true, true, false)).toBe(false);
    expect(shouldOfferDownload(true, false, true)).toBe(false);
    expect(shouldOfferDownload(false, true, true)).toBe(false);
  });

  it('marks ride along in the shared clip format and stay strict', () => {
    const clip = buildClip({
      name: 'P1',
      fps: 24,
      samples: [{ t: 0, joints: { r_wrist: { x: 0.5, y: 0.5, conf: 0.9 } } }],
      baseline: null,
      face: null,
      thresholds: {},
      labels: [],
      marks: [1.23456],
      source: 'recorded',
    });
    expect(clip.marks).toEqual([1.2346]);
    expect(isRecordedClip(clip)).toBe(true);
    const without = buildClip({
      name: 'P1',
      fps: 24,
      samples: [{ t: 0, joints: { r_wrist: { x: 0.5, y: 0.5, conf: 0.9 } } }],
      baseline: null,
      face: null,
      thresholds: {},
      labels: [],
      source: 'recorded',
    });
    expect('marks' in without).toBe(false);
    expect(isRecordedClip(without)).toBe(true);
  });

  it('no code path exports a clip without going through the clip gate', () => {
    for (const rel of ['../src/components/SessionControls.tsx', '../src/components/ClipRecorder.tsx']) {
      const src = readFileSync(new URL(rel, import.meta.url), 'utf-8');
      expect(src, `${rel} must gate exports`).toMatch(/canSendClip|exportClipFile/);
    }
    const sessionSrc = readFileSync(
      new URL('../src/components/SessionControls.tsx', import.meta.url),
      'utf-8',
    );
    expect(sessionSrc, 'session must not mint its own object URLs').not.toContain('createObjectURL');
  });

  it('finished recording buffers keep samples, labels and marks until cleared', () => {
    const buffer = new ClipBuffer();
    buffer.append(0, { r_wrist: { x: 0.5, y: 0.5, conf: 0.9 } });
    buffer.append(1, { r_wrist: { x: 0.51, y: 0.49, conf: 0.9 } });
    buffer.markStart(0);
    expect(buffer.markMoment(1)).toBe(true);
    const clip = buffer.finish(1);
    expect(clip.samples).toHaveLength(2);
    expect(clip.labels).toEqual([{ start_s: 0, end_s: 1 }]);
    expect(clip.marks).toEqual([1]);
    buffer.clear();
    expect(buffer.empty).toBe(true);
  });
});

describe('clip buffer', () => {
  it('marks land only while recording and survive finish', () => {
    const buffer = new ClipBuffer();
    expect(buffer.markMoment(1)).toBe(false);
    buffer.append(1, { r_wrist: { x: 0.5, y: 0.5, conf: 0.9 } });
    expect(buffer.markMoment(1.5)).toBe(true);
    buffer.markStart(1);
    const clip = buffer.finish(2);
    expect(clip.marks).toEqual([1.5]);
    expect(clip.labels).toEqual([{ start_s: 1, end_s: 2 }]);
  });

  it('emergency discard drops the clip in progress', () => {
    const buffer = new ClipBuffer();
    buffer.append(1, { r_wrist: { x: 0.5, y: 0.5, conf: 0.9 } });
    buffer.markMoment(1.2);
    buffer.clear();
    expect(buffer.empty).toBe(true);
    const clip = buffer.finish(2);
    expect(clip.samples).toEqual([]);
    expect(clip.marks).toEqual([]);
  });

  it('delete-my-clips clears registered buffers and leaves consent alone', () => {
    stubStorage();
    const buffer = new ClipBuffer();
    const unregister = registerBuffer(buffer);
    try {
      buffer.append(1, { r_wrist: { x: 0.5, y: 0.5, conf: 0.9 } });
      const stored = setChoice(loadConsent(), 'camera', true);
      expect(stored.camera).toBe(true);
      clearAllBuffers();
      expect(buffer.empty).toBe(true);
      expect(loadConsent().camera).toBe(true);
    } finally {
      unregister();
    }
  });
});

describe('consent storage health', () => {
  function formMarkup(): string {
    return renderToStaticMarkup(<ConsentForm consent={state()} onChange={() => {}} />);
  }

  it('passes the probe when storage keeps what it is given', () => {
    stubStorage();
    expect(storageWorks()).toBe(true);
  });

  it('fails the probe when writes throw instead of sticking', () => {
    stubStorage();
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
      clear: () => {},
    });
    expect(storageWorks()).toBe(false);
  });

  it('stays silent when storage works', () => {
    stubStorage();
    const html = formMarkup();
    expect(html).not.toContain('tick them each visit');
    expect(html).not.toMatch(BANNED);
  });

  it('explains itself when the browser discards stored choices', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
      clear: () => {},
    });
    const html = formMarkup();
    expect(html).toContain('tick them each visit');
    expect(html).not.toMatch(BANNED);
    // Strip tags first: tag names like h2 are not participant-visible text.
    const text = html.replace(/<[^>]+>/g, ' ');
    expect(text).not.toMatch(/\d/);
  });
});
