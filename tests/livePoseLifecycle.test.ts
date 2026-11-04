import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConsent } from '../src/consent/consent';
import { __setPoseDetectorFactory, useLivePose } from '../src/pose/useLivePose';

// Drive the real hook and its effect cleanup without adding a DOM dependency.
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  mounted: false,
  cleanups: [] as (() => void)[],
}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef<T>(value: T) {
    const index = hooks.cursor++;
    return hooks.slots[index] ?? (hooks.slots[index] = { current: value });
  },
  useState<T>(value: T | (() => T)) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof value === 'function' ? (value as () => T)() : value;
    return [hooks.slots[index], (next: T | ((prev: T) => T)) => {
      hooks.slots[index] = typeof next === 'function' ? (next as (prev: T) => T)(hooks.slots[index] as T) : next;
    }];
  },
  useCallback: <T>(fn: T) => fn,
  useEffect(effect: () => void | (() => void)) {
    if (!hooks.mounted) {
      const cleanup = effect();
      if (cleanup) hooks.cleanups.push(cleanup);
    }
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeStream() {
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
  return { stream, stopTrack };
}

function render() {
  hooks.cursor = 0;
  const live = useLivePose();
  const consent = useConsent();
  hooks.mounted = true;
  return { ...live, setConsent: consent.set };
}

function unmount() {
  for (const cleanup of hooks.cleanups.splice(0)) cleanup();
}

const getUserMedia = vi.fn();
const close = vi.fn();
const detectPoints = vi.fn();
const play = vi.fn();
let video: { srcObject: MediaStream | null; play: typeof play; readyState: number; currentTime: number };
let nextFrame: FrameRequestCallback;
let storage: Map<string, string>;
let now: number;

beforeEach(() => {
  vi.resetAllMocks();
  hooks.slots = [];
  hooks.mounted = false;
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    nextFrame = callback;
    return 1;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  detectPoints.mockResolvedValue(undefined);
  __setPoseDetectorFactory(() => ({ close, detect: detectPoints }));
  play.mockResolvedValue(undefined);
  video = { srcObject: null, play, readyState: 2, currentTime: 0 };
  const live = render();
  Object.assign(live.videoRef, { current: video });
  live.setConsent('camera', true);
});

afterEach(() => {
  unmount();
  __setPoseDetectorFactory(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('live camera lifecycle', () => {
  it('closes a detector that finishes loading after Stop without requesting the camera', async () => {
    const model = deferred<{ close: typeof close; detect: typeof detectPoints }>();
    const factory = vi.fn(() => model.promise);
    __setPoseDetectorFactory(factory);
    render().start();
    await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce());
    render().stop();
    model.resolve({ close, detect: detectPoints });
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(render().status).toBe('idle');
  });

  it.each(['stop', 'withdraw', 'unmount'] as const)(
    'disposes a stream returned after %s while permission is pending',
    async (action) => {
      const permission = deferred<MediaStream>();
      const { stream, stopTrack } = fakeStream();
      getUserMedia.mockReturnValueOnce(permission.promise);
      render().start();
      await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
      if (action === 'stop') render().stop();
      if (action === 'withdraw') render().setConsent('camera', false);
      if (action === 'unmount') unmount();
      expect(close).toHaveBeenCalledOnce();
      permission.resolve(stream);
      await vi.waitFor(() => expect(stopTrack).toHaveBeenCalledOnce());
      expect(play).not.toHaveBeenCalled();
      expect(video.srcObject).toBeNull();
    },
  );

  it.each(['resolves', 'rejects'] as const)('keeps a retry live when stopped playback %s late', async (outcome) => {
    const oldPlayback = deferred<void>();
    const first = fakeStream();
    const retry = fakeStream();
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(retry.stream);
    play.mockReturnValueOnce(oldPlayback.promise);
    render().start();
    await vi.waitFor(() => expect(play).toHaveBeenCalledOnce());
    render().stop();
    expect(first.stopTrack).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    render().start();
    await vi.waitFor(() => expect(render().status).toBe('live'));
    if (outcome === 'resolves') oldPlayback.resolve(undefined);
    else oldPlayback.reject(new Error('Playback interrupted'));
    await Promise.resolve();
    expect(render().status).toBe('live');
    expect(video.srcObject).toBe(retry.stream);
    expect(retry.stopTrack).not.toHaveBeenCalled();
  });

  it('stops a live camera on consent withdrawal without restarting when consent is restored', async () => {
    const { stream, stopTrack } = fakeStream();
    getUserMedia.mockResolvedValueOnce(stream);
    render().start();
    await vi.waitFor(() => expect(render().status).toBe('live'));
    render().setConsent('camera', false);
    expect(render().status).toBe('idle');
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    render().setConsent('camera', true);
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it('closes the model when camera permission is denied', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'));
    render().start();
    await vi.waitFor(() => expect(render().status).toBe('denied'));
    expect(close).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
  });

  it('stops tracks and closes the model when video playback fails', async () => {
    const { stream, stopTrack } = fakeStream();
    getUserMedia.mockResolvedValueOnce(stream);
    play.mockRejectedValueOnce(new Error('Playback failed'));
    render().start();
    await vi.waitFor(() => expect(render().status).toBe('error'));
    expect(close).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
  });

  it('invalidates the latest frame on the first empty detection and recovers on a fresh frame', async () => {
    const { stream } = fakeStream();
    getUserMedia.mockResolvedValueOnce(stream);
    const points = [{ x: 0.5, y: 0.5, visibility: 1 }];
    detectPoints.mockResolvedValueOnce(points).mockResolvedValueOnce(undefined).mockResolvedValueOnce(points);
    render().start();
    await vi.waitFor(() => expect(render().status).toBe('live'));
    nextFrame(now = 100);
    await vi.waitFor(() => expect(render().frame).not.toBeNull());
    const first = render().frame;
    expect(first).not.toBeNull();
    nextFrame(now = 200);
    await vi.waitFor(() => expect(render()).toMatchObject({ status: 'live', frame: null, trackingLost: true }));
    video.currentTime = 0.3;
    nextFrame(now = 300);
    await vi.waitFor(() => expect(render()).toMatchObject({ trackingLost: false, frame: { t: 0.3 } }));
    expect(render().frame).not.toBe(first);
  });
});
