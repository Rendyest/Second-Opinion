import type { Joint2D } from '../contracts';
import {
  IMPORT_BAD_HOLD_ORDER,
  IMPORT_BAD_HOLD_RANGE,
  IMPORT_BAD_TARGET,
  IMPORT_BAD_VIEW,
  IMPORT_NEED_CONSENT,
  IMPORT_NEED_PARTICIPANT,
} from '../metricsCopy';

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/**
 * Clip time comes from the video's own media time (requestVideoFrameCallback
 * metadata, seconds) — never Date.now(). Same seconds unit as a live
 * recording, so replay's clock (frame.t * 1000) stays correct.
 */
export function mediaTimeToClipT(mediaTimeS: number): number {
  return round4(mediaTimeS);
}

/**
 * Optional mirror for a flipped setup: x is normalised 0-1, so mirroring is
 * 1 - x. Applied to landmark joints before rounding (buildClip rounds).
 */
export function applyMirror(joints: Record<string, Joint2D>, mirror: boolean): Record<string, Joint2D> {
  if (!mirror) return joints;
  return Object.fromEntries(
    Object.entries(joints).map(([name, j]) => [name, { ...j, x: 1 - j.x }]),
  );
}

/** The required import fields, before the import may start. */
export interface ImportMeta {
  consentRecording: boolean;
  participantId: string;
  view: string;
  targetShoulderDeg: number;
  holdStartS: number;
  holdEndS: number;
}

/**
 * Gate every required field; returns the first failure message, or null when
 * the import may start. durationS is null until the video reports a length.
 */
export function validateImportMeta(meta: ImportMeta, durationS: number | null): string | null {
  if (!meta.consentRecording) return IMPORT_NEED_CONSENT;
  if (meta.participantId.trim() === '') return IMPORT_NEED_PARTICIPANT;
  if (meta.view !== 'front' && meta.view !== 'side') return IMPORT_BAD_VIEW;
  if (!Number.isFinite(meta.targetShoulderDeg) || meta.targetShoulderDeg < 0 || meta.targetShoulderDeg > 180) {
    return IMPORT_BAD_TARGET;
  }
  if (
    !Number.isFinite(meta.holdStartS) ||
    !Number.isFinite(meta.holdEndS) ||
    meta.holdStartS < 0 ||
    meta.holdEndS <= meta.holdStartS
  ) {
    return IMPORT_BAD_HOLD_ORDER;
  }
  if (durationS === null || !Number.isFinite(durationS) || meta.holdEndS > durationS) {
    return IMPORT_BAD_HOLD_RANGE;
  }
  return null;
}

/**
 * Warn when the processed count is far below duration x frame rate. The
 * floor (pictures per second) comes from config metrics.import_min_frames_per_s.
 */
export function lowFrameWarning(processedFrames: number, durationS: number, minFramesPerS: number): boolean {
  if (!Number.isFinite(durationS) || durationS <= 0) return false;
  return processedFrames < durationS * minFramesPerS;
}
