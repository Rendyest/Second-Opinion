import type { Joint2D } from '../contracts';
import { canSendClip, type ConsentChoices } from '../consent/consent';

/** One buffered sample: clip-relative seconds plus joints. */
export interface BufferedSample {
  t: number;
  joints: Record<string, Joint2D>;
}

export interface BufferedClip {
  samples: BufferedSample[];
  labels: Array<{ start_s: number; end_s: number }>;
  marks: number[];
}

/**
 * In-memory clip buffer shared by the dev recorder and the session
 * controls: the same clip format, the same no-export rule. Register every
 * live buffer so "Delete my clips" can clear them all at once.
 */
export class ClipBuffer {
  samples: BufferedSample[] = [];
  labels: Array<{ start_s: number; end_s: number }> = [];
  marks: number[] = [];
  private openStart: number | null = null;

  append(t: number, joints: Record<string, Joint2D>): void {
    this.samples.push({ t, joints: { ...joints } });
  }

  markStart(t: number): void {
    if (this.samples.length === 0 || this.openStart !== null) return;
    this.openStart = t;
  }

  markEnd(t: number): void {
    if (this.openStart === null || this.samples.length === 0) return;
    this.labels.push({ start_s: this.openStart, end_s: t });
    this.openStart = null;
  }

  get labelOpen(): boolean {
    return this.openStart !== null;
  }

  /** A point mark (session "Mark this moment"). Only while samples exist. */
  markMoment(t: number): boolean {
    if (this.samples.length === 0) return false;
    this.marks.push(t);
    return true;
  }

  get empty(): boolean {
    return this.samples.length === 0;
  }

  /** Close any open interval and hand over the buffered clip. */
  finish(finalT: number): BufferedClip {
    if (this.openStart !== null) {
      this.labels.push({ start_s: this.openStart, end_s: finalT });
      this.openStart = null;
    }
    return { samples: this.samples, labels: this.labels, marks: this.marks };
  }

  clear(): void {
    this.samples = [];
    this.labels = [];
    this.marks = [];
    this.openStart = null;
  }
}

const REGISTRY = new Set<ClipBuffer>();

export function registerBuffer(buffer: ClipBuffer): () => void {
  REGISTRY.add(buffer);
  return () => {
    REGISTRY.delete(buffer);
  };
}

/** Discard every in-memory clip. Consent choices are a separate store. */
export function clearAllBuffers(): void {
  for (const buffer of REGISTRY) buffer.clear();
}

/**
 * The only way a clip leaves memory: returns a same-origin Blob URL for a
 * Download click when (and only when) canSendClip(consent) passes.
 * Returns null otherwise — nothing is exported, nothing is sent.
 */
export function exportClipFile(
  text: string,
  consent: ConsentChoices,
  openUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
): string | null {
  if (!canSendClip(consent)) return null;
  return openUrl(new Blob([text], { type: 'application/json' }));
}

/** Click a Blob URL as a file download. Call only with a gated exportClipFile URL. */
export function triggerBlobDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
