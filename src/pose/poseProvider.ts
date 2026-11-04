import { coco17ToBlaze, type Point2D } from './poseFrame';

/**
 * Detector abstraction replacing `@mediapipe/tasks-vision`.
 *
 * Live and import code talk only to this interface, so the model behind it
 * (localhost Detectron2 sidecar, batch import, or a test fake) can change
 * without touching the frame loop. `detect` resolves to Blaze-topology
 * points ready for `buildPoseFrame`, or `undefined` when nobody is in view
 * (the gap stays a gap, same as before).
 */
export interface PoseDetector {
  detect(video: HTMLVideoElement, timestampMs: number): Promise<Point2D[] | undefined>;
  close(): void;
}

/** Localhost Detectron2 sidecar endpoint. Frames never leave the machine. */
export const POSE_SIDECAR_URL = 'http://127.0.0.1:8788/pose';
export const POSE_SIDECAR_HEALTH_URL = 'http://127.0.0.1:8788/healthz';

/** True when the localhost sidecar answers. Never throws. */
export async function checkSidecarHealth(url: string = POSE_SIDECAR_HEALTH_URL): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

interface SidecarPoint {
  x: number;
  y: number;
  score?: number;
}

function toPoint2D(p: SidecarPoint): Point2D {
  return { x: p.x, y: p.y, visibility: typeof p.score === 'number' ? p.score : 0 };
}

/**
 * Capture the current video frame and ask the sidecar for COCO-17 points,
 * remapped client-side to the Blaze slots `buildPoseFrame` expects.
 * Any failure degrades to `undefined` rather than throwing.
 */
export function createSidecarPoseDetector(url: string = POSE_SIDECAR_URL): PoseDetector {
  let closed = false;
  let canvas: HTMLCanvasElement | null = null;
  return {
    async detect(video: HTMLVideoElement, timestampMs: number): Promise<Point2D[] | undefined> {
      if (closed) return undefined;
      try {
        if (video.readyState < 2 || video.videoWidth === 0) return undefined;
        if (!canvas) canvas = document.createElement('canvas');
        const scale = Math.min(1, 576 / video.videoWidth);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL('image/jpeg', 0.6);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ image, timestampMs }),
        });
        if (!res.ok) return undefined;
        const data = (await res.json()) as { coco?: SidecarPoint[] };
        if (!Array.isArray(data.coco) || data.coco.length === 0) return undefined;
        return coco17ToBlaze(data.coco.map(toPoint2D));
      } catch {
        return undefined;
      }
    },
    close() {
      closed = true;
      canvas = null;
    },
  };
}

/** Test and fallback detector: always reports nobody in view. */
export function createNullPoseDetector(): PoseDetector {
  return {
    async detect(): Promise<undefined> {
      return undefined;
    },
    close() {},
  };
}
