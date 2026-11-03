import type { Joint2D, PoseFrame, RecordedClip, ReviewClip } from '../contracts';
import { CLIP_ID_RE, isRecordedClip, isReviewClip } from '../contracts';
import { elbowFlexion, shoulderElevation } from '../pose/angles';

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
    // Both recorders call this only after the recording-consent gate.
    consent: { recording: true },
  };
  if (args.marks !== undefined && args.marks.length > 0) {
    clip.marks = args.marks.map(round4);
  }
  if (!isRecordedClip(clip)) throw new Error('built clip failed validation');
  return clip;
}

function randomClipId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'clip-';
  for (let i = 0; i < 8; i += 1) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Accept a single recorder clip as a review clip: assign a random in-memory
 * id, drop the recorder's name (never displayed), recompute the two angles
 * from the joints with the shared angle math, and treat Muse as absent.
 * Recorded gate flags are ignored here exactly as in replay.
 */
export function reviewClipFromRecorded(clip: RecordedClip, clipId: string = randomClipId()): ReviewClip {
  if (!clip.consent || clip.consent.recording !== true) {
    throw new Error("This clip has no recorded consent, so it can't be loaded for review.");
  }
  if (!CLIP_ID_RE.test(clipId)) {
    throw new Error(`That clip id "${clipId}" is not valid for review.`);
  }
  const frames: PoseFrame[] = clip.frames.map((f) => {
    const shoulder = f.joints['r_shoulder'] ?? { x: 0, y: 0, conf: 0 };
    const elbow = f.joints['r_elbow'] ?? { x: 0, y: 0, conf: 0 };
    const wrist = f.joints['r_wrist'] ?? { x: 0, y: 0, conf: 0 };
    const flex = elbowFlexion(shoulder, elbow, wrist);
    const elev = shoulderElevation(shoulder, elbow);
    return {
      t: f.t,
      fps: clip.fps,
      joints: f.joints,
      angles: {
        r_elbow_flexion: { deg: flex.deg, conf: flex.conf },
        r_shoulder_elevation: { deg: elev.deg, conf: elev.conf },
      },
      gate: { ok: true, reasons: [] },
    };
  });
  const review: ReviewClip = {
    clip_id: clipId,
    fps: clip.fps,
    frames,
    baseline: clip.baseline,
    face: clip.face,
    consent: { recording: true },
  };
  if (clip.marks !== undefined && clip.marks.length > 0) {
    review.marks = [...clip.marks];
  }
  if (!isReviewClip(review)) throw new Error('That recorder clip could not be loaded for review.');
  return review;
}
