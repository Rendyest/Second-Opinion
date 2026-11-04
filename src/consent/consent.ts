import { useCallback, useEffect, useState } from 'react';

/**
 * Consent: four separate unticked-by-default choices. Persisted with no name
 * or identity — only the four booleans, the copy version, and a timestamp.
 * Changing the copy version resets everything to unticked.
 */

export type ConsentKey = 'camera' | 'recording' | 'cloud_summary' | 'cloud_clips';

export interface ConsentChoices {
  camera: boolean;
  recording: boolean;
  cloud_summary: boolean;
  cloud_clips: boolean;
}

export interface ConsentState extends ConsentChoices {
  text_version: number;
  ts: number;
}

/** Bump when the consent wording changes; stored choices reset to unticked. */
export const CONSENT_TEXT_VERSION = 1;

const STORAGE_KEY = 'mirra.consent.v1';

const ALL_OFF: ConsentChoices = {
  camera: false,
  recording: false,
  cloud_summary: false,
  cloud_clips: false,
};

function isChoices(v: unknown): v is ConsentChoices {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['camera'] === 'boolean' &&
    typeof r['recording'] === 'boolean' &&
    typeof r['cloud_summary'] === 'boolean' &&
    typeof r['cloud_clips'] === 'boolean'
  );
}

function freshState(): ConsentState {
  return { ...ALL_OFF, text_version: CONSENT_TEXT_VERSION, ts: Date.now() };
}

/** Read the stored consent. Safe without storage: everything unticked. */
export function loadConsent(): ConsentState {
  try {
    if (typeof localStorage === 'undefined') return freshState();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as { choices?: unknown; text_version?: unknown; ts?: unknown };
    if (!isChoices(parsed.choices) || parsed.text_version !== CONSENT_TEXT_VERSION) {
      return freshState();
    }
    return {
      ...(parsed.choices as ConsentChoices),
      text_version: CONSENT_TEXT_VERSION,
      ts: typeof parsed.ts === 'number' ? parsed.ts : Date.now(),
    };
  } catch {
    return freshState();
  }
}

function writeConsent(state: ConsentState): ConsentState {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ choices: state, text_version: state.text_version, ts: state.ts }),
      );
    }
  } catch {
    // Private mode or quota: the in-memory choice still works for this visit.
  }
  return state;
}

/**
 * Apply one choice. Unticking recording also unticks cloud_clips (clips can
 * only leave with both). Everything else changes independently.
 */
export function setChoice(prev: ConsentState, key: ConsentKey, value: boolean): ConsentState {
  const next: ConsentState = { ...prev, [key]: value, ts: Date.now() };
  if (key === 'recording' && !value) next.cloud_clips = false;
  return writeConsent(next);
}

/** The camera may be used. Ticking it never starts the camera by itself. */
export function canUseCamera(c: ConsentChoices): boolean {
  return c.camera;
}

const cameraChoiceListeners = new Set<(allowed: boolean) => void>();

export function subscribeCameraWithdrawal(stop: () => void): () => void {
  const onChoice = (allowed: boolean) => {
    if (!allowed) stop();
  };
  cameraChoiceListeners.add(onChoice);
  const onStorage = (event: StorageEvent) => {
    if ((!event.key || event.key === STORAGE_KEY) && !canUseCamera(loadConsent())) stop();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    cameraChoiceListeners.delete(onChoice);
    window.removeEventListener('storage', onStorage);
  };
}

/** Clips may be recorded (in memory only). */
export function canRecord(c: ConsentChoices): boolean {
  return c.recording;
}

/** Coach summaries may be sent to the cloud model. */
export function canSendSummary(c: ConsentChoices): boolean {
  return c.cloud_summary;
}

/** A clip may leave this browser. Requires recording AND cloud_clips. */
export function canSendClip(c: ConsentChoices): boolean {
  return c.recording && c.cloud_clips;
}

/** Shared consent state for /setup (choices) and /session (withdrawal). */
export function useConsent() {
  const [consent, setConsent] = useState<ConsentState>(() => loadConsent());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === STORAGE_KEY) setConsent(loadConsent());
    };
    window.addEventListener('storage', onStorage);
    const onCameraChoice = (camera: boolean) => {
      setConsent((prev) => prev.camera === camera ? prev : { ...prev, camera });
    };
    cameraChoiceListeners.add(onCameraChoice);
    return () => {
      cameraChoiceListeners.delete(onCameraChoice);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const set = useCallback((key: ConsentKey, value: boolean) => {
    setConsent((prev) => setChoice(prev, key, value));
    if (key === 'camera') {
      for (const listener of cameraChoiceListeners) listener(value);
    }
  }, []);

  const refresh = useCallback(() => {
    setConsent(loadConsent());
  }, []);

  return { consent, set, refresh };
}
