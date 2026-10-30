/**
 * Imported coaching tips from the offline muse_coaching.py script. The
 * validator mirrors the script's own validate_coaching rules: required
 * fields and types, severity from the script's set, and a short cue.
 * Imported tips are playback only — they never count as a System 2 call.
 */

const SEVERITIES = ['none', 'mild', 'moderate', 'high'];

export interface CoachingTip {
  struggling: boolean;
  signal: string;
  body_part: string;
  severity: string;
  cue_text: string;
  ask_pain_check: boolean;
  safety_concern: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Throws a plain message when the file is not a coaching tip. */
export function validateCoachingTip(json: unknown): CoachingTip {
  if (!isRecord(json)) throw new Error('That file is not a coaching tip.');
  const { struggling, signal, body_part, severity, cue_text, ask_pain_check, safety_concern } = json;
  if (typeof struggling !== 'boolean') throw new Error('That file is not a coaching tip.');
  if (typeof signal !== 'string' || signal.length === 0) throw new Error('That file is not a coaching tip.');
  if (typeof body_part !== 'string' || body_part.length === 0) {
    throw new Error('That file is not a coaching tip.');
  }
  if (typeof severity !== 'string' || !SEVERITIES.includes(severity)) {
    throw new Error('That file is not a coaching tip.');
  }
  if (typeof cue_text !== 'string' || cue_text.trim().length === 0 || cue_text.length > 200) {
    throw new Error('That file is not a coaching tip.');
  }
  if (typeof ask_pain_check !== 'boolean') throw new Error('That file is not a coaching tip.');
  if (typeof safety_concern !== 'boolean') throw new Error('That file is not a coaching tip.');
  return { struggling, signal, body_part, severity, cue_text, ask_pain_check, safety_concern };
}
