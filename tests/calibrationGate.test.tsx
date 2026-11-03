import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  attemptCalibrationStart,
  CALIBRATION_BLOCKING_CHECKS,
  calibrationBlocks,
  evaluateSetupChecks,
  shouldAbortCapture,
  type SetupCheckResult,
  type SetupMeasurements,
  type SetupThresholds,
} from '../src/setup/checks';
import { CalibrationBlockedNotice } from '../src/components/CalibrationBlockedNotice';
import {
  CALIBRATION_CHECKS_LEAD,
  CALIBRATION_CONSENT_STALE,
  CALIBRATION_NEEDS_CAMERA,
  CALIBRATION_STOPPED,
  CONSENT_CAMERA_TEXT,
} from '../src/consentCopy';
import { CONSENT_TEXT_VERSION } from '../src/consent/consent';

const BANNED = /\b(fps|frames?|calls?|saved|flag rate|latency|escalat\w*)\b/i;

const T: SetupThresholds = {
  visMin: 0.5,
  edgeMargin: 0.05,
  brightnessMin: 50,
  brightnessMax: 200,
  tiltMaxDeg: 10,
  facingTol: 0.25,
  fpsMin: 15,
};

function allPass(): SetupMeasurements {
  return {
    cameraOn: true,
    upperBodyVisible: true,
    leftArmVisible: true,
    faceVisible: true,
    brightness: 120,
    tiltDeg: 2,
    facingOffset: 0.05,
    fps: 24,
    armCalibrated: true,
    faceReady: true,
  };
}

const OFF = {
  camera: false,
  recording: false,
  cloud_summary: false,
  cloud_clips: false,
  text_version: CONSENT_TEXT_VERSION,
  ts: 0,
};
const ON = { ...OFF, camera: true };
const STALE = { ...ON, text_version: CONSENT_TEXT_VERSION + 1 };

function resultsFor(m: SetupMeasurements): SetupCheckResult[] {
  return evaluateSetupChecks(m, T);
}

/** Failing measurement per blocking check id. */
const FAILING: Record<string, SetupMeasurements> = {
  camera: { ...allPass(), cameraOn: false },
  upper_body: { ...allPass(), upperBodyVisible: false },
  face: { ...allPass(), faceVisible: false },
  lighting: { ...allPass(), brightness: 10 },
  level: { ...allPass(), tiltDeg: 45 },
  speed: { ...allPass(), fps: 1 },
};

describe('calibration blocking set', () => {
  it('is exactly checks 1 to 6; check 7 is excluded', () => {
    expect([...CALIBRATION_BLOCKING_CHECKS]).toEqual([
      'camera',
      'upper_body',
      'face',
      'lighting',
      'level',
      'speed',
    ]);
  });
});

describe('calibration gate', () => {
  it('unticked camera consent blocks with the consent notice', () => {
    const blocks = calibrationBlocks(OFF, resultsFor(allPass()));
    expect(blocks).toEqual([{ kind: 'consent' }]);
  });

  it('shows the consent notice first and the failing checks below it', () => {
    const blocks = calibrationBlocks(OFF, resultsFor({ ...allPass(), cameraOn: false }));
    expect(blocks[0]).toEqual({ kind: 'consent' });
    expect(blocks[1]?.kind).toBe('checks');
  });

  it('stale consent text blocks until camera consent is ticked again', () => {
    expect(calibrationBlocks(STALE, resultsFor(allPass()))).toEqual([{ kind: 'stale' }]);
  });

  it('each of checks 1 to 6 failing alone blocks with its name and fix', () => {
    for (const id of CALIBRATION_BLOCKING_CHECKS) {
      const blocks = calibrationBlocks(ON, resultsFor(FAILING[id] as SetupMeasurements));
      expect(blocks).toHaveLength(1);
      const only = blocks[0];
      expect(only.kind).toBe('checks');
      if (only.kind === 'checks') {
        expect(only.failing.map((f) => f.id)).toContain(id);
        const row = only.failing.find((f) => f.id === id);
        expect(row?.label).toBeTruthy();
        expect(row?.fix).toBeTruthy();
      }
    }
  });

  it('all of checks 1 to 6 passing with consent ticked allows capture', () => {
    expect(calibrationBlocks(ON, resultsFor(allPass()))).toEqual([]);
  });

  it('check 7 failing (not calibrated yet) does not block calibration', () => {
    const notCalibrated = resultsFor({ ...allPass(), armCalibrated: false, faceReady: false });
    expect(calibrationBlocks(ON, notCalibrated)).toEqual([]);
  });

  it('a narrowed blocking set lets other failures through', () => {
    const lightingFail = resultsFor(FAILING['lighting'] as SetupMeasurements);
    expect(calibrationBlocks(ON, lightingFail, ['camera', 'upper_body', 'face'])).toEqual([]);
  });

  it('a blocked start runs nothing; an allowed start runs begin once', () => {
    let calls = 0;
    const begin = () => {
      calls += 1;
    };
    const blocked = attemptCalibrationStart(OFF, resultsFor(allPass()), begin);
    expect(blocked.length).toBeGreaterThan(0);
    expect(calls).toBe(0);
    const allowed = attemptCalibrationStart(ON, resultsFor(allPass()), begin);
    expect(allowed).toEqual([]);
    expect(calls).toBe(1);
  });

  it('a blocked hold start runs nothing', () => {
    let calls = 0;
    attemptCalibrationStart(ON, resultsFor(FAILING['face'] as SetupMeasurements), () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });
});

describe('mid-capture withdrawal', () => {
  it('aborts a running capture only when consent is gone', () => {
    expect(shouldAbortCapture(true, false)).toBe(true);
    expect(shouldAbortCapture(true, true)).toBe(false);
    expect(shouldAbortCapture(false, false)).toBe(false);
  });

  it('the stopped message is text with no banned words or digits', () => {
    expect(CALIBRATION_STOPPED).toContain('Calibration stopped');
    expect(CALIBRATION_STOPPED).not.toMatch(BANNED);
    expect(CALIBRATION_STOPPED).not.toMatch(/\d/);
  });
});

describe('calibration blocked notice', () => {
  function stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, ' ');
  }

  it('renders nothing when nothing blocks', () => {
    expect(renderToStaticMarkup(<CalibrationBlockedNotice blocks={[]} />)).toBe('');
  });

  it('shows the consent notice first and each failing check with its fix', () => {
    const blocks = calibrationBlocks(OFF, resultsFor(FAILING['lighting'] as SetupMeasurements));
    const html = renderToStaticMarkup(<CalibrationBlockedNotice blocks={blocks} />);
    expect(html).toContain(CALIBRATION_NEEDS_CAMERA);
    expect(html).toContain(CALIBRATION_CHECKS_LEAD);
    expect(html.indexOf(CALIBRATION_NEEDS_CAMERA)).toBeLessThan(html.indexOf(CALIBRATION_CHECKS_LEAD));
    expect(html).toContain('Lighting');
    expect(html).toContain('Add more light');
    const text = stripTags(html);
    expect(text).not.toMatch(BANNED);
    expect(text).not.toMatch(/\d/);
  });

  it('shows the stale-text notice', () => {
    const html = renderToStaticMarkup(<CalibrationBlockedNotice blocks={calibrationBlocks(STALE, [])} />);
    expect(html).toContain(CALIBRATION_CONSENT_STALE);
  });

  it('names every failing check, never a bare failure', () => {
    const blocks = calibrationBlocks(ON, resultsFor({ ...allPass(), cameraOn: false, fps: 1 }));
    const html = renderToStaticMarkup(<CalibrationBlockedNotice blocks={blocks} />);
    expect(html).toContain('Camera found');
    expect(html).toContain('Camera speed');
  });
});

describe('calibration consent copy', () => {
  it('says calibration keeps measurements in this browser', () => {
    expect(CONSENT_CAMERA_TEXT).toContain('arm lengths');
    expect(CONSENT_CAMERA_TEXT).toContain('face point positions');
    expect(CONSENT_CAMERA_TEXT).toContain('until you delete them');
    expect(CONSENT_CAMERA_TEXT).not.toMatch(BANNED);
    expect(CONSENT_CAMERA_TEXT).not.toMatch(/\d/);
  });

  it('every calibration notice is text with no banned words or digits', () => {
    for (const s of [
      CALIBRATION_NEEDS_CAMERA,
      CALIBRATION_CONSENT_STALE,
      CALIBRATION_CHECKS_LEAD,
      CALIBRATION_STOPPED,
    ]) {
      expect(s).not.toMatch(BANNED);
      expect(s).not.toMatch(/\d/);
    }
  });
});
