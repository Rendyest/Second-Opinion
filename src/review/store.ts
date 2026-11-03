import type { ReviewBundle } from '../contracts';
import { isStoredReview, parseStoredReviews, type StoredReview } from './labels';

const REVIEWS_KEY = 'mirra.reviews.v1';
const REVIEWER_KEY = 'mirra.reviewer.v1';

/**
 * Autosaved reviews live here. Aggregates and labels only — joints, frames
 * and clips never reach localStorage. Everything guards storage absence.
 */

export function loadReviews(): StoredReview[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(REVIEWS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredReview);
  } catch {
    return [];
  }
}

export function saveReviews(reviews: StoredReview[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews));
    }
  } catch {
    // Private mode or quota: the in-memory reviews still work for this visit.
  }
}

export function clearReviews(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(REVIEWS_KEY);
    }
  } catch {
    // Nothing stored, nothing to clear.
  }
}

export function loadReviewer(): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(REVIEWER_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveReviewer(name: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(REVIEWER_KEY, name);
    }
  } catch {
    // Private mode or quota: the in-memory name still works for this visit.
  }
}

/** Export payload: aggregates and labels only. Never joints, frames or clips. */
export function serializeReviews(reviews: StoredReview[]): string {
  return JSON.stringify(reviews);
}

export function parseReviewsImport(text: string): StoredReview[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('That file is not a valid reviews file. It must hold an array of saved reviews.');
  }
  return parseStoredReviews(parsed);
}

/** Click a text Blob as a file download. Call only with explicit-export data. */
export function downloadTextFile(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The loaded review bundle lives here in memory (never localStorage, never
 * the repo). "Delete my clips" clears it from any route; the saved reviews
 * stay.
 */
let loadedBundle: ReviewBundle | null = null;
const bundleListeners = new Set<() => void>();

function emitBundle(): void {
  for (const fn of bundleListeners) fn();
}

export function setLoadedBundle(bundle: ReviewBundle | null): void {
  loadedBundle = bundle;
  emitBundle();
}

export function getLoadedBundle(): ReviewBundle | null {
  return loadedBundle;
}

export function clearLoadedBundle(): void {
  loadedBundle = null;
  emitBundle();
}

export function subscribeLoadedBundle(fn: () => void): () => void {
  bundleListeners.add(fn);
  return () => {
    bundleListeners.delete(fn);
  };
}
