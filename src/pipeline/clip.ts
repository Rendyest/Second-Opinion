import type { Joint2D, RecordedClip } from '../contracts';
import { isRecordedClip } from '../contracts';

/** One recorded sample: clip-relative seconds plus joints. */
export interface ClipSample {
  t: number;
  joints: Record<string, Joint2D>;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function roundJoints(joints: Record<string, Joint2D>): Record<string, Joint2D> {
  return Object.fromEntries(
    Object.entries(joints).map(([name, j]) => [
      name,
      { x: round4(j.x), y: round4(j.y), conf: round4(j.conf) },
    ]),
  );
}

/**
 * Pure clip builder (tested): joints rounded to 4 decimals, only the
 * allowed fields, no images. Throws if the result fails the validator.
 */
export function buildClip(args: {
  name: string;
  fps: number;
  samples: ClipSample[];
  baseline: RecordedClip['baseline'];
  face: RecordedClip['face'];
  thresholds: Record<string, unknown>;
  labels: Array<{ start_s: number; end_s: number }>;
  source: RecordedClip['source'];
  marks?: number[];
}): RecordedClip {
  const clip: RecordedClip = {
    version: 1,
    source: args.source,
    name: args.name,
    fps: args.fps,
    frames: args.samples.map((s) => ({ t: round4(s.t), joints: roundJoints(s.joints) })),
    baseline: args.baseline,
    face: args.face,
    config_used: args.thresholds,
    labels: args.labels.map((l) => ({ start_s: round4(l.start_s), end_s: round4(l.end_s) })),
  };
  if (args.marks !== undefined && args.marks.length > 0) {
    clip.marks = args.marks.map(round4);
  }
  if (!isRecordedClip(clip)) throw new Error('built clip failed validation');
  return clip;
}
