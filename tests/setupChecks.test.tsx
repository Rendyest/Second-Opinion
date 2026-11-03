import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createCheckDebouncer,
  evaluateSetupChecks,
  facingOffset,
  fpsOverWindow,
  insideEdges,
  REQUIRED_CHECKS,
  SETUP_CHECK_LABEL,
  SETUP_CONTINUE_WARNING,
  shoulderTiltDeg,
  startBlocked,
  type SetupCheckId,
  type SetupCheckResult,
  type SetupMeasurements,
  type SetupThresholds,
} from '../src/setup/checks';
import { SetupCheckList } from '../src/components/SetupChecks';

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

function byId(results: SetupCheckResult[], id: SetupCheckId): SetupCheckResult {
  const found = results.find((r) => r.id === id);
  if (!found) throw new Error(`missing check ${id}`);
  return found;
}

describe('setup required set', () => {
  it('requires exactly camera, upper body, face and calibration', () => {
    expect([...REQUIRED_CHECKS]).toEqual(['camera', 'upper_body', 'face', 'calibration']);
  });

  it('all passing measurements pass every check with no fixes', () => {
    for (const r of evaluateSetupChecks(allPass(), T)) {
      expect(r.pass).toBe(true);
      expect(r.fix).toBeNull();
    }
  });
});

describe('setup evaluation failures', () => {
  it('camera off fails only the camera check', () => {
    const results = evaluateSetupChecks({ ...allPass(), cameraOn: false }, T);
    expect(byId(results, 'camera').pass).toBe(false);
    expect(byId(results, 'camera').fix).toContain('Turn on camera for setup checks');
    for (const r of results) {
      if (r.id !== 'camera') expect(r.pass).toBe(true);
    }
  });

  it('upper body missing fails with its fix', () => {
    const results = evaluateSetupChecks({ ...allPass(), upperBodyVisible: false }, T);
    expect(byId(results, 'upper_body').pass).toBe(false);
    expect(byId(results, 'upper_body').fix).toContain('both shoulders and your right arm');
  });

  it('passes with a hint when only the left arm is out of view', () => {
    const results = evaluateSetupChecks({ ...allPass(), leftArmVisible: false }, T);
    const row = byId(results, 'upper_body');
    expect(row.pass).toBe(true);
    expect(row.fix).toContain('left arm');
    expect(row.fix).toContain('only the right side is needed');
  });

  it('face missing fails with its fix', () => {
    const results = evaluateSetupChecks({ ...allPass(), faceVisible: false }, T);
    expect(byId(results, 'face').pass).toBe(false);
    expect(byId(results, 'face').fix).toContain('Keep your face in view');
  });

  it('brightness boundaries are inclusive', () => {
    expect(byId(evaluateSetupChecks({ ...allPass(), brightness: 49 }, T), 'lighting').pass).toBe(false);
    expect(byId(evaluateSetupChecks({ ...allPass(), brightness: 50 }, T), 'lighting').pass).toBe(true);
    expect(byId(evaluateSetupChecks({ ...allPass(), brightness: 200 }, T), 'lighting').pass).toBe(true);
    expect(byId(evaluateSetupChecks({ ...allPass(), brightness: 201 }, T), 'lighting').pass).toBe(false);
  });

  it('too dark and too bright have separate fix lines', () => {
    const dark = byId(evaluateSetupChecks({ ...allPass(), brightness: 49 }, T), 'lighting');
    const bright = byId(evaluateSetupChecks({ ...allPass(), brightness: 201 }, T), 'lighting');
    expect(dark.fix).toContain('more light');
    expect(bright.fix).not.toContain('more light');
    expect(dark.fix).not.toEqual(bright.fix);
  });

  it('missing brightness fails without claiming dark or bright', () => {
    const row = byId(evaluateSetupChecks({ ...allPass(), brightness: null }, T), 'lighting');
    expect(row.pass).toBe(false);
    expect(row.fix).toContain('Hold still');
  });

  it('tilt exactly at the limit passes, just above fails', () => {
    expect(byId(evaluateSetupChecks({ ...allPass(), tiltDeg: 10 }, T), 'level').pass).toBe(true);
    expect(byId(evaluateSetupChecks({ ...allPass(), tiltDeg: 10.0001 }, T), 'level').pass).toBe(false);
  });

  it('facing offset exactly at the tolerance passes, just outside fails', () => {
    expect(byId(evaluateSetupChecks({ ...allPass(), facingOffset: 0.25 }, T), 'level').pass).toBe(true);
    expect(byId(evaluateSetupChecks({ ...allPass(), facingOffset: -0.25 }, T), 'level').pass).toBe(true);
    expect(byId(evaluateSetupChecks({ ...allPass(), facingOffset: 0.2501 }, T), 'level').pass).toBe(false);
  });

  it('missing tilt or facing fails the level check', () => {
    expect(byId(evaluateSetupChecks({ ...allPass(), tiltDeg: null }, T), 'level').pass).toBe(false);
    expect(byId(evaluateSetupChecks({ ...allPass(), facingOffset: null }, T), 'level').pass).toBe(false);
  });

  it('camera speed exactly at the minimum passes, just below fails', () => {
    expect(byId(evaluateSetupChecks({ ...allPass(), fps: 15 }, T), 'speed').pass).toBe(true);
    expect(byId(evaluateSetupChecks({ ...allPass(), fps: 14.9999 }, T), 'speed').pass).toBe(false);
    expect(byId(evaluateSetupChecks({ ...allPass(), fps: null }, T), 'speed').pass).toBe(false);
  });

  it('calibration needs both the arm and the face step', () => {
    const noArm = byId(evaluateSetupChecks({ ...allPass(), armCalibrated: false }, T), 'calibration');
    expect(noArm.pass).toBe(false);
    expect(noArm.fix).toContain('arm step');
    const noFace = byId(
      evaluateSetupChecks({ ...allPass(), armCalibrated: true, faceReady: false }, T),
      'calibration',
    );
    expect(noFace.pass).toBe(false);
    expect(noFace.fix).toContain('face step');
  });
});

describe('start gating', () => {
  function blockedWith(m: SetupMeasurements): SetupCheckId[] {
    return startBlocked(evaluateSetupChecks(m, T));
  }

  it('all passing checks leave Start enabled', () => {
    expect(blockedWith(allPass())).toEqual([]);
  });

  it('each required check alone blocks Start when it fails', () => {
    const failing: Array<[SetupCheckId, SetupMeasurements]> = [
      ['camera', { ...allPass(), cameraOn: false }],
      ['upper_body', { ...allPass(), upperBodyVisible: false }],
      ['face', { ...allPass(), faceVisible: false }],
      ['calibration', { ...allPass(), armCalibrated: false }],
    ];
    for (const [id, m] of failing) {
      expect(blockedWith(m)).toEqual([id]);
    }
  });

  it('advisory failures alone never block Start', () => {
    const advisory: SetupMeasurements = {
      ...allPass(),
      brightness: 10,
      tiltDeg: 45,
      facingOffset: 0.9,
      fps: 3,
    };
    expect(blockedWith(advisory)).toEqual([]);
  });
});

describe('check debounce', () => {
  it('enters failure after consecutive failing evaluations', () => {
    const d = createCheckDebouncer(3, 5);
    expect(d.push(false)).toBe(false);
    expect(d.push(false)).toBe(false);
    expect(d.push(false)).toBe(false);
  });

  it('needs consecutive passes to recover', () => {
    const d = createCheckDebouncer(3, 5);
    for (let i = 0; i < 5; i++) expect(d.push(true)).toBe(i === 4);
    expect(d.push(false)).toBe(true);
    expect(d.push(false)).toBe(true);
    expect(d.push(false)).toBe(false);
  });

  it('a single clean frame resets the failing streak', () => {
    const d = createCheckDebouncer(3, 5);
    d.push(false);
    d.push(false);
    d.push(true);
    d.push(false);
    d.push(false);
    expect(d.push(false)).toBe(false);
  });

  it('reset returns to failing', () => {
    const d = createCheckDebouncer(1, 1);
    expect(d.push(true)).toBe(true);
    d.reset();
    expect(d.push(false)).toBe(false);
  });
});

describe('setup geometry helpers', () => {
  const j = (x: number, y: number, conf = 0.9) => ({ x, y, conf });

  it('level shoulders have no tilt', () => {
    expect(shoulderTiltDeg(j(0.4, 0.5), j(0.6, 0.5), 0.5)).toBeCloseTo(0, 10);
  });

  it('a ten-degree shoulder line reads ten degrees', () => {
    const tilt = Math.tan((10 * Math.PI) / 180) * 0.2;
    expect(shoulderTiltDeg(j(0.4, 0.5), j(0.6, 0.5 + tilt), 0.5)).toBeCloseTo(10, 5);
  });

  it('missing or low-confidence shoulders give no tilt', () => {
    expect(shoulderTiltDeg(undefined, j(0.6, 0.5), 0.5)).toBeNull();
    expect(shoulderTiltDeg(j(0.4, 0.5, 0.1), j(0.6, 0.5), 0.5)).toBeNull();
  });

  it('a centered nose has no facing offset', () => {
    expect(facingOffset(j(0.5, 0.3), j(0.4, 0.5), j(0.6, 0.5), 0.5)).toBeCloseTo(0, 10);
  });

  it('nose offset is measured in shoulder widths', () => {
    // Shoulders 0.2 apart; nose 0.05 right of midpoint -> 0.25 widths.
    expect(facingOffset(j(0.55, 0.3), j(0.4, 0.5), j(0.6, 0.5), 0.5)).toBeCloseTo(0.25, 10);
  });

  it('missing face points give no facing offset', () => {
    expect(facingOffset(undefined, j(0.4, 0.5), j(0.6, 0.5), 0.5)).toBeNull();
    expect(facingOffset(j(0.5, 0.3, 0.1), j(0.4, 0.5), j(0.6, 0.5), 0.5)).toBeNull();
  });

  it('edge margin keeps joints inside the picture', () => {
    expect(insideEdges(j(0.05, 0.5), 0.05)).toBe(true);
    expect(insideEdges(j(0.049, 0.5), 0.05)).toBe(false);
    expect(insideEdges(j(0.5, 0.96), 0.05)).toBe(false);
    expect(insideEdges(undefined, 0.05)).toBe(false);
  });

  it('camera speed needs two stamps inside the window', () => {
    expect(fpsOverWindow([], 10000, 2)).toBeNull();
    expect(fpsOverWindow([9000], 10000, 2)).toBeNull();
    expect(fpsOverWindow([9000, 9500, 10000], 10000, 2)).toBeCloseTo(1.5, 10);
    expect(fpsOverWindow([1000, 9500, 10000], 10000, 2)).toBeCloseTo(1, 10);
  });
});

describe('setup checklist markup', () => {
  function stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, ' ');
  }

  function list(results: SetupCheckResult[]) {
    return renderToStaticMarkup(
      <SetupCheckList
        results={results}
        blocked={startBlocked(results)}
        onStart={() => {}}
        onContinueAnyway={() => {}}
      />,
    );
  }

  it('every row carries Pass or Needs attention as text', () => {
    const html = list(evaluateSetupChecks(allPass(), T));
    for (const label of Object.values(SETUP_CHECK_LABEL)) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Pass');
    const failing = list(evaluateSetupChecks({ ...allPass(), cameraOn: false }, T));
    expect(failing).toContain('Needs attention');
  });

  it('Start is aria-disabled and described by the unmet checks', () => {
    const html = list(evaluateSetupChecks({ ...allPass(), cameraOn: false, faceVisible: false }, T));
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-describedby="setup-check-camera setup-check-face"');
    expect(html).toContain('Continue anyway');
    expect(html).toContain(SETUP_CONTINUE_WARNING);
  });

  it('Start is enabled with no override when every required check passes', () => {
    const advisoryFail: SetupMeasurements = { ...allPass(), brightness: 10, fps: 3 };
    const html = list(evaluateSetupChecks(advisoryFail, T));
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('Continue anyway');
    expect(html).not.toContain(SETUP_CONTINUE_WARNING);
  });

  it('checklist copy passes the banned-word and no-digit checks', () => {
    const strings = [
      ...Object.values(SETUP_CHECK_LABEL),
      SETUP_CONTINUE_WARNING,
      ...evaluateSetupChecks(allPass(), T).flatMap((r) => (r.fix ? [r.fix] : [])),
      ...evaluateSetupChecks(
        {
          cameraOn: false,
          upperBodyVisible: false,
          leftArmVisible: false,
          faceVisible: false,
          brightness: 10,
          tiltDeg: 45,
          facingOffset: 0.9,
          fps: 1,
          armCalibrated: false,
          faceReady: false,
        },
        T,
      ).flatMap((r) => (r.fix ? [r.fix] : [])),
    ];
    expect(strings.length).toBeGreaterThan(10);
    for (const s of strings) {
      expect(s).not.toMatch(BANNED);
      expect(s).not.toMatch(/\d/);
    }
    const html = list(evaluateSetupChecks(allPass(), T));
    expect(stripTags(html)).not.toMatch(BANNED);
    expect(stripTags(html)).not.toMatch(/\d/);
  });
});
