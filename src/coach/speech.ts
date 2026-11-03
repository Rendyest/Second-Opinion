/**
 * Spoken coaching: every shown tip is read aloud unless the person turns
 * sound off. On by default; the choice persists on this browser only.
 * Everything guards absence (server rendering, unsupported browsers) and
 * speech never throws — a silent voice never blocks coaching.
 */

const STORAGE_KEY = 'mirra.coach.speech';

/** True unless the person explicitly turned sound off. */
export function loadSpeakTips(): boolean {
  if (typeof localStorage === 'undefined') return true;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return true;
  return raw !== '0';
}

export function saveSpeakTips(on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
}

export function speechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  );
}

/** Speak one tip aloud, replacing anything currently spoken. False when silent. */
export function speakTip(text: string): boolean {
  if (!speechSupported()) return false;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    synth.speak(new SpeechSynthesisUtterance(text));
    return true;
  } catch {
    return false;
  }
}

/** Stop any spoken tip. Never throws. */
export function cancelSpeech(): void {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // A silent voice never blocks coaching.
  }
}
