import type { RefObject } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VideoStage } from '../src/components/VideoStage';
import { CalibrationStep } from '../src/components/CalibrationStep';
import { config } from '../src/config';
import type { PoseFrame } from '../src/contracts';

const videoRef = { current: null } as unknown as RefObject<HTMLVideoElement>;

function frame(gate: PoseFrame['gate']): PoseFrame {
  return {
    t: 1.5,
    fps: 24,
    joints: {
      r_shoulder: { x: 0.55, y: 0.4, conf: 0.95 },
      r_elbow: { x: 0.41, y: 0.52, conf: 0.93 },
      r_wrist: { x: 0.48, y: 0.35, conf: 0.88 },
      r_hip: { x: 0.55, y: 0.7, conf: 0.91 },
    },
    angles: {
      r_elbow_flexion: { deg: 87.2, conf: 0.91 },
      r_shoulder_elevation: { deg: 64.0, conf: 0.88 },
    },
    gate,
  };
}

function stageMarkup(gate: PoseFrame['gate'], uncalibrated = false): string {
  return renderToStaticMarkup(
    <VideoStage
      frame={frame(gate)}
      mirrored
      showSkeleton
      dimBelowConf={config.gate.vis_min}
      videoRef={videoRef}
      cameraOn={false}
      uncalibrated={uncalibrated}
    />,
  );
}

describe('gate badge', () => {
  it('shows a green badge with text on a good frame', () => {
    const html = stageMarkup({ ok: true, reasons: [] });
    expect(html).toContain('Signal good');
    expect(html).toContain('gate-badge gate-ok');
    expect(html).not.toContain('gate-badge gate-bad');
  });

  it('shows a red badge naming every reason, not colour alone', () => {
    const html = stageMarkup({ ok: false, reasons: ['low_visibility', 'foreshortening'] });
    expect(html).toContain('Signal poor');
    expect(html).toContain('low visibility');
    expect(html).toContain('arm pointing toward the camera');
    expect(html).toContain('gate-badge gate-bad');
  });

  it('marks the gate less reliable without a calibration', () => {
    const html = stageMarkup({ ok: true, reasons: [] }, true);
    expect(html).toContain('No calibration yet');
    expect(html).toContain('less reliable');
  });

  it('hides the warning once calibrated', () => {
    expect(stageMarkup({ ok: true, reasons: [] })).not.toContain('No calibration yet');
  });
});

describe('calibration step', () => {
  it('starts idle with the facing-camera instruction, start, and continue options', () => {
    const html = renderToStaticMarkup(<CalibrationStep />);
    expect(html).toContain('Calibration');
    expect(html).toContain('Sit facing the camera, arms relaxed');
    expect(html).toContain('Start calibration');
    expect(html).toContain('Continue without calibration');
  });
});
