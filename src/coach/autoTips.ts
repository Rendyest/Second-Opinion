/**
 * Whether struggle escalations fetch a tip on their own. Defaults to on:
 * coaching should arrive without pressing anything. The choice persists on
 * this browser only; everything guards storage absence.
 */

const STORAGE_KEY = 'mirra.coach.autoTips';

/** True unless the person explicitly turned automatic tips off. */
export function loadAutoTips(): boolean {
  if (typeof localStorage === 'undefined') return true;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return true;
  return raw !== '0';
}

export function saveAutoTips(on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
}
