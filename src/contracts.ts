/**
 * Data contracts shared by the UI and the (future) perception pipeline.
 * Field names match the build brief verbatim.
 */

export interface Joint2D {
  x: number;
  y: number;
  conf: number;
}

export interface AngleReading {
  deg: number;
  conf: number;
}

export type GateReason = 'low_visibility' | 'bone_length_drift' | 'foreshortening';

const GATE_REASONS: readonly GateReason[] = ['low_visibility', 'bone_length_drift', 'foreshortening'];

export interface PoseFrame {
  t: number;
  fps: number;
  joints: Record<string, Joint2D>;
  angles: Record<string, AngleReading>;
  gate: { ok: boolean; reasons: GateReason[] };
}

export type System1StateName = 'moving_well' | 'hesitating' | 'struggling' | 'cant_see_you';

const SYSTEM1_STATES: readonly System1StateName[] = [
  'moving_well',
  'hesitating',
  'struggling',
  'cant_see_you',
];

export type TopSignal = 'stall' | 'jitter' | 'compensation' | 'failed_range' | 'drop';

const TOP_SIGNALS: readonly TopSignal[] = [
  'stall',
  'jitter',
  'compensation',
  'failed_range',
  'drop',
];

export interface System1State {
  t: number;
  state: System1StateName;
  score: number;
  /**
   * Main suspected cause. Optional (or empty) for moving_well, which has no
   * cause to name; required for every other state.
   */
  top_signal?: TopSignal;
  escalate: boolean;
}

export interface CoachEvent {
  t: number;
  trigger: string;
  latency_ms: number;
  ok: boolean;
  message: string;
  inputs: string;
}

export type ReplayEventKind = 'pose_frame' | 'system1_state' | 'coach_event';

const REPLAY_KINDS: readonly ReplayEventKind[] = ['pose_frame', 'system1_state', 'coach_event'];

export interface ReplayEvent {
  kind: ReplayEventKind;
  at_ms: number;
  data: PoseFrame | System1State | CoachEvent;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isJoint(v: unknown): v is Joint2D {
  return (
    isRecord(v) && typeof v['x'] === 'number' && typeof v['y'] === 'number' && typeof v['conf'] === 'number'
  );
}

function isAngle(v: unknown): v is AngleReading {
  return isRecord(v) && typeof v['deg'] === 'number' && typeof v['conf'] === 'number';
}

export function isPoseFrame(v: unknown): v is PoseFrame {
  if (!isRecord(v)) return false;
  if (typeof v['t'] !== 'number' || typeof v['fps'] !== 'number') return false;
  if (!isRecord(v['joints']) || !Object.values(v['joints']).every(isJoint)) return false;
  if (!isRecord(v['angles']) || !Object.values(v['angles']).every(isAngle)) return false;
  if (!isRecord(v['gate'])) return false;
  const gate = v['gate'];
  if (typeof gate['ok'] !== 'boolean' || !Array.isArray(gate['reasons'])) return false;
  const reasons: unknown[] = gate['reasons'];
  return reasons.every((r): r is GateReason => typeof r === 'string' && GATE_REASONS.includes(r as GateReason));
}

export function isSystem1State(v: unknown): v is System1State {
  if (!isRecord(v)) return false;
  if (
    typeof v['t'] !== 'number' ||
    typeof v['state'] !== 'string' ||
    !SYSTEM1_STATES.includes(v['state'] as System1StateName) ||
    typeof v['score'] !== 'number' ||
    typeof v['escalate'] !== 'boolean'
  ) {
    return false;
  }
  const top = v['top_signal'];
  if (v['state'] === 'moving_well') {
    return top === undefined || top === '' || (typeof top === 'string' && TOP_SIGNALS.includes(top as TopSignal));
  }
  return typeof top === 'string' && TOP_SIGNALS.includes(top as TopSignal);
}

export function isCoachEvent(v: unknown): v is CoachEvent {
  if (!isRecord(v)) return false;
  return (
    typeof v['t'] === 'number' &&
    typeof v['trigger'] === 'string' &&
    typeof v['latency_ms'] === 'number' &&
    typeof v['ok'] === 'boolean' &&
    typeof v['message'] === 'string' &&
    typeof v['inputs'] === 'string'
  );
}

export function isReplayEvent(v: unknown): v is ReplayEvent {
  if (!isRecord(v)) return false;
  if (typeof v['kind'] !== 'string' || !REPLAY_KINDS.includes(v['kind'] as ReplayEventKind)) return false;
  if (typeof v['at_ms'] !== 'number' || v['at_ms'] < 0) return false;
  switch (v['kind'] as ReplayEventKind) {
    case 'pose_frame':
      return isPoseFrame(v['data']);
    case 'system1_state':
      return isSystem1State(v['data']);
    case 'coach_event':
      return isCoachEvent(v['data']);
  }
}

/**
 * A recorded clip: landmark numbers only (rounded to 4 decimals), no images,
 * no video, no pixel data. Replay recomputes angles, gate, can't-see-you and
 * System 1 from the joints; recorded gate flags are ignored.
 */
export interface ClipFrame {
  /** Clip-relative seconds. */
  t: number;
  joints: Record<string, Joint2D>;
}

export interface ClipLabel {
  start_s: number;
  end_s: number;
}

export type ClipSource = 'recorded' | 'synthetic' | 'imported_video';

function isClipSource(value: unknown): value is ClipSource {
  return value === 'recorded' || value === 'synthetic' || value === 'imported_video';
}

/** Camera view at import time, stored with the clip. */
export type ClipView = 'front' | 'side';

/** Hold window in video seconds, stored with an imported clip. */
export interface ClipHold {
  start_s: number;
  end_s: number;
}

/** Provenance of an imported video. fps is null when it could not be read. */
export interface ClipVideoInfo {
  duration_s: number;
  frames: number;
  fps: number | null;
}

export interface RecordedClip {
  version: 1;
  source: ClipSource;
  name: string;
  fps: number;
  frames: ClipFrame[];
  /** Null replays in a mode labelled "uncalibrated". */
  baseline: { upperArm: number; forearm: number; shoulderWidth: number } | null;
  face: { offsets: Record<string, { x: number; y: number }>; touchDist: number; touchElbowDeg: number } | null;
  config_used: Record<string, unknown>;
  labels?: ClipLabel[];
  /** Point marks (clip-relative seconds) from "Mark this moment". Never any media. */
  marks?: number[];
  /** Written by the recorders after the recording-consent gate. */
  consent?: { recording: boolean };
  /** Set only by the dev video import: the required import fields. */
  view?: ClipView;
  /** Set only by the dev video import: target shoulder angle, degrees 0-180. */
  target_shoulder_deg?: number;
  /** Set only by the dev video import: hold window in video seconds. */
  hold?: ClipHold;
  /** Set only by the dev video import: video provenance, never any media. */
  video?: ClipVideoInfo;
}

const CLIP_KEYS: readonly string[] = [
  'version',
  'source',
  'name',
  'fps',
  'frames',
  'baseline',
  'face',
  'config_used',
  'labels',
  'marks',
  'consent',
  'view',
  'target_shoulder_deg',
  'hold',
  'video',
];

/** True for any string that smells like embedded image data. */
function looksLikeImageData(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  if (v.startsWith('data:')) return true;
  return v.length > 256 && /^[A-Za-z0-9+/=\s]+$/.test(v);
}

function containsImageData(v: unknown): boolean {
  if (looksLikeImageData(v)) return true;
  if (Array.isArray(v)) return v.some(containsImageData);
  if (isRecord(v)) return Object.values(v).some(containsImageData);
  return false;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isClipFrame(v: unknown): v is ClipFrame {
  if (!isRecord(v)) return false;
  const keys = Object.keys(v);
  if (keys.length !== 2 || !keys.includes('t') || !keys.includes('joints')) return false;
  if (!isFiniteNum(v['t']) || (v['t'] as number) < 0) return false;
  const joints = v['joints'];
  if (!isRecord(joints)) return false;
  return Object.values(joints).every(isJoint);
}

function isClipLabel(v: unknown): v is ClipLabel {
  if (!isRecord(v)) return false;
  const keys = Object.keys(v);
  if (keys.length !== 2 || !keys.includes('start_s') || !keys.includes('end_s')) return false;
  if (!isFiniteNum(v['start_s']) || !isFiniteNum(v['end_s'])) return false;
  return (v['start_s'] as number) >= 0 && (v['end_s'] as number) >= (v['start_s'] as number);
}

export function isClipBaseline(v: unknown): v is NonNullable<RecordedClip['baseline']> {
  if (!isRecord(v)) return false;
  return (
    isFiniteNum(v['upperArm']) &&
    (v['upperArm'] as number) > 0 &&
    isFiniteNum(v['forearm']) &&
    (v['forearm'] as number) > 0 &&
    isFiniteNum(v['shoulderWidth']) &&
    (v['shoulderWidth'] as number) > 0
  );
}

export function isClipFace(v: unknown): v is NonNullable<RecordedClip['face']> {
  if (!isRecord(v)) return false;
  const offsets = v['offsets'];
  if (!isRecord(offsets) || Object.keys(offsets).length === 0) return false;
  const offsetsOk = Object.values(offsets).every(
    (o) => isRecord(o) && isFiniteNum(o['x']) && isFiniteNum(o['y']),
  );
  return (
    offsetsOk &&
    isFiniteNum(v['touchDist']) &&
    (v['touchDist'] as number) > 0 &&
    isFiniteNum(v['touchElbowDeg'])
  );
}

function isClipVideoInfo(v: unknown): v is ClipVideoInfo {
  if (!isRecord(v)) return false;
  const keys = Object.keys(v);
  if (keys.length !== 3 || !keys.includes('duration_s') || !keys.includes('frames') || !keys.includes('fps')) {
    return false;
  }
  if (!isFiniteNum(v['duration_s']) || (v['duration_s'] as number) < 0) return false;
  if (!isFiniteNum(v['frames']) || !Number.isInteger(v['frames']) || (v['frames'] as number) < 0) return false;
  const fps = v['fps'];
  return fps === null || (isFiniteNum(fps) && (fps as number) > 0);
}

export function isRecordedClip(v: unknown): v is RecordedClip {
  if (!isRecord(v)) return false;
  for (const key of Object.keys(v)) {
    if (!CLIP_KEYS.includes(key)) return false;
  }
  if (v['version'] !== 1) return false;
  if (!isClipSource(v['source'])) return false;
  if (typeof v['name'] !== 'string' || (v['name'] as string).length === 0) return false;
  if (!isFiniteNum(v['fps']) || (v['fps'] as number) <= 0) return false;
  if (!Array.isArray(v['frames']) || !(v['frames'] as unknown[]).every(isClipFrame)) return false;
  const baseline = v['baseline'];
  if (baseline !== null && !isClipBaseline(baseline)) return false;
  const face = v['face'];
  if (face !== null && !isClipFace(face)) return false;
  if (!isRecord(v['config_used'])) return false;
  if (v['labels'] !== undefined) {
    if (!Array.isArray(v['labels']) || !(v['labels'] as unknown[]).every(isClipLabel)) return false;
  }
  if (v['marks'] !== undefined) {
    if (
      !Array.isArray(v['marks']) ||
      !(v['marks'] as unknown[]).every((m) => isFiniteNum(m) && (m as number) >= 0)
    ) {
      return false;
    }
  }
  if (v['consent'] !== undefined) {
    const consent = v['consent'];
    if (!isRecord(consent) || Object.keys(consent).length !== 1 || typeof consent['recording'] !== 'boolean') {
      return false;
    }
  }
  if (v['view'] !== undefined && v['view'] !== 'front' && v['view'] !== 'side') return false;
  if (v['target_shoulder_deg'] !== undefined) {
    const deg = v['target_shoulder_deg'];
    if (!isFiniteNum(deg) || (deg as number) < 0 || (deg as number) > 180) return false;
  }
  if (v['hold'] !== undefined && !isClipLabel(v['hold'])) return false;
  if (v['video'] !== undefined && !isClipVideoInfo(v['video'])) return false;
  return !containsImageData(v);
}

/** Display severities for a Muse label, ordered for distance. */
export type MuseSeverity = 'none' | 'mild' | 'moderate' | 'severe';

const MUSE_SEVERITIES: readonly string[] = ['none', 'mild', 'moderate', 'severe'];

/** Optional machine label on a review clip. Never invented by the UI. */
export interface MuseLabel {
  struggling: boolean;
  severity: MuseSeverity;
  error_types: string[];
  reason: string;
}

/**
 * One clip inside a review bundle. Like a recorded clip but with a stable
 * clip_id instead of a name (the recorder's name is never displayed), full
 * pose_frame entries, and mandatory recording consent.
 */
export interface ReviewClip {
  clip_id: string;
  fps: number;
  frames: PoseFrame[];
  baseline: NonNullable<RecordedClip['baseline']> | null;
  face: NonNullable<RecordedClip['face']> | null;
  marks?: number[];
  consent: { recording: boolean };
  muse?: MuseLabel;
}

/** In-memory review bundle: clips only, never results. */
export interface ReviewBundle {
  version: 1;
  source: ClipSource;
  clips: ReviewClip[];
}

export const CLIP_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

export function isMuseLabel(v: unknown): v is MuseLabel {
  if (!isRecord(v)) return false;
  const keys = Object.keys(v);
  if (keys.length !== 4 || !keys.includes('struggling') || !keys.includes('severity')) return false;
  if (!keys.includes('error_types') || !keys.includes('reason')) return false;
  if (typeof v['struggling'] !== 'boolean') return false;
  if (typeof v['severity'] !== 'string' || !MUSE_SEVERITIES.includes(v['severity'])) return false;
  if (!Array.isArray(v['error_types']) || !(v['error_types'] as unknown[]).every((e) => typeof e === 'string')) {
    return false;
  }
  const reason = v['reason'];
  return typeof reason === 'string' && reason.length > 0 && reason.length <= 2000;
}

const REVIEW_CLIP_KEYS: readonly string[] = ['clip_id', 'fps', 'frames', 'baseline', 'face', 'consent'];
const REVIEW_CLIP_OPTIONAL: readonly string[] = ['marks', 'muse'];

export function isReviewClip(v: unknown): v is ReviewClip {
  if (!isRecord(v)) return false;
  for (const key of Object.keys(v)) {
    if (!REVIEW_CLIP_KEYS.includes(key) && !REVIEW_CLIP_OPTIONAL.includes(key)) return false;
  }
  for (const key of REVIEW_CLIP_KEYS) {
    if (!(key in v)) return false;
  }
  if (typeof v['clip_id'] !== 'string' || !CLIP_ID_RE.test(v['clip_id'] as string)) return false;
  if (!isFiniteNum(v['fps']) || (v['fps'] as number) <= 0) return false;
  if (!Array.isArray(v['frames']) || (v['frames'] as unknown[]).length === 0) return false;
  if (!(v['frames'] as unknown[]).every(isPoseFrame)) return false;
  const baseline = v['baseline'];
  if (baseline !== null && !isClipBaseline(baseline)) return false;
  const face = v['face'];
  if (face !== null && !isClipFace(face)) return false;
  if (v['marks'] !== undefined) {
    if (
      !Array.isArray(v['marks']) ||
      !(v['marks'] as unknown[]).every((m) => isFiniteNum(m) && (m as number) >= 0)
    ) {
      return false;
    }
  }
  const consent = v['consent'];
  if (!isRecord(consent) || Object.keys(consent).length !== 1 || typeof consent['recording'] !== 'boolean') {
    return false;
  }
  if (v['muse'] !== undefined && !isMuseLabel(v['muse'])) return false;
  return true;
}

export function isReviewBundle(v: unknown): v is ReviewBundle {
  if (!isRecord(v)) return false;
  for (const key of Object.keys(v)) {
    if (key !== 'version' && key !== 'source' && key !== 'clips') return false;
  }
  if (v['version'] !== 1) return false;
  if (!isClipSource(v['source'])) return false;
  if (!Array.isArray(v['clips'])) return false;
  const seen = new Set<string>();
  for (const clip of v['clips'] as unknown[]) {
    if (!isReviewClip(clip)) return false;
    if (seen.has((clip as ReviewClip).clip_id)) return false;
    seen.add((clip as ReviewClip).clip_id);
  }
  return !containsImageData(v);
}

/** Parse a picked review-bundle file; throws a plain-worded message on failure. */
export function parseReviewBundle(v: unknown): ReviewBundle {
  if (!isRecord(v) || v['version'] !== 1 || !isClipSource(v['source'])) {
    throw new Error('That file is not a valid review bundle. It must hold version 1, a source and a clips array.');
  }
  for (const key of Object.keys(v)) {
    if (key !== 'version' && key !== 'source' && key !== 'clips') {
      throw new Error('That file is not a valid review bundle. It must hold version 1, a source and a clips array.');
    }
  }
  if (!Array.isArray(v['clips'])) {
    throw new Error('That file is not a valid review bundle. It must hold version 1, a source and a clips array.');
  }
  const seen = new Set<string>();
  const clips = (v['clips'] as unknown[]).map((clip, i) => {
    if (!isReviewClip(clip)) {
      throw new Error(`That file is not a valid review bundle. Clip ${i} is not a valid review clip.`);
    }
    if (clip.consent.recording !== true) {
      throw new Error("This clip has no recorded consent, so it can't be loaded for review.");
    }
    if (seen.has(clip.clip_id)) {
      throw new Error(`That file is not a valid review bundle. Two clips share the id "${clip.clip_id}".`);
    }
    seen.add(clip.clip_id);
    return clip;
  });
  const bundle: ReviewBundle = {
    version: 1,
    source: v['source'],
    clips,
  };
  if (containsImageData(bundle)) {
    throw new Error('That file is not a valid review bundle. It must not contain image data.');
  }
  return bundle;
}

/** Parse pasted or picked clip JSON; throws a plain-worded message on failure. */
export function parseRecordedClip(v: unknown): RecordedClip {
  if (!isRecordedClip(v)) {
    throw new Error(
      'That file is not a valid clip. It must be clip JSON with joints only ' +
        '(no images), a version of 1, and no unknown fields.',
    );
  }
  return v;
}

/** Parse a replay file of shape `{ "events": [...] }`; throws naming the first bad entry. */
export function parseReplayFile(v: unknown): ReplayEvent[] {
  if (!isRecord(v) || !Array.isArray(v['events'])) {
    throw new Error('replay file must be an object with an "events" array');
  }
  const events: unknown[] = v['events'];
  return events.map((e, i) => {
    if (!isReplayEvent(e)) throw new Error(`replay file: event ${i} has an invalid shape`);
    return e;
  });
}
