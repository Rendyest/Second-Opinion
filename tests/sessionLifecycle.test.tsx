import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionPage } from '../src/pages/SessionPage';
import { SessionControls } from '../src/components/SessionControls';
import { CoachPanel } from '../src/components/CoachPanel';
import { DeleteMyClips } from '../src/components/DeleteMyClips';
import { ClipBuffer } from '../src/recording/clipBuffer';
import type { PoseFrame } from '../src/contracts';
import type { LiveStatus } from '../src/pose/useLivePose';
import { getCompletedSession, publishCompletedSession } from '../src/metrics/sessionSummary';

function hookState() {
  return {
    cursor: 0,
    slots: [] as unknown[],
    effects: [] as (() => void)[],
    cleanups: new Map<number, () => void>(),
  };
}

let hooks: ReturnType<typeof hookState>;

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useRef<T>(value: T) {
    const index = hooks.cursor++;
    return hooks.slots[index] ?? (hooks.slots[index] = { current: value });
  },
  useState<T>(value: T | (() => T)) {
    const index = hooks.cursor++;
    const state = hooks;
    if (!(index in state.slots)) state.slots[index] = typeof value === 'function' ? (value as () => T)() : value;
    return [state.slots[index], (next: T | ((prev: T) => T)) => {
      state.slots[index] = typeof next === 'function' ? (next as (prev: T) => T)(state.slots[index] as T) : next;
    }];
  },
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
    const state = hooks;
    const index = state.cursor++;
    const previous = state.slots[index] as readonly unknown[] | undefined;
    if (deps && previous?.length === deps.length && deps.every((value, i) => Object.is(value, previous[i]))) return;
    state.slots[index] = deps;
    state.effects.push(() => {
      state.cleanups.get(index)?.();
      state.cleanups.delete(index);
      const cleanup = effect();
      if (cleanup) state.cleanups.set(index, cleanup);
    });
  },
}));

let status: LiveStatus;
let frame: PoseFrame | null;
let consent: { camera: boolean; recording: boolean; cloud_summary: boolean; cloud_clips: boolean };
const start = vi.fn(() => { status = 'loading'; });
const stop = vi.fn(() => { status = 'idle'; frame = null; });
const push = vi.fn((pose: PoseFrame) => ({
  frame: pose,
  cantSee: { active: false, fixLine: null },
  system1: { state: 'struggling', score: 1, escalate: true },
}));
const resetWindow = vi.fn();
const calibration = { baseline: null, skipped: false, face: null, faceSkipped: false };

vi.mock('../src/pose/useLivePose', () => ({
  useLivePose: () => ({ status, frame, trackingLost: false, start, stop, videoRef: { current: null } }),
}));
vi.mock('../src/mock/MockStreamContext', () => ({ useMockStream: () => ({ snapshot: null }) }));
vi.mock('../src/pose/calibration', () => ({
  useCalibration: () => ({ state: calibration, refresh: vi.fn() }),
  clearCalibration: vi.fn(),
}));
vi.mock('../src/consent/consent', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/consent/consent')>(),
  useConsent: () => ({ consent, set: vi.fn() }),
}));
vi.mock('../src/pipeline/run', () => ({
  createPipeline: () => ({ push, reset: vi.fn(), resetWindow, snapshot: () => ({}) }),
}));

type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean }>;

function find(node: ReactNode, matches: (element: Element) => boolean): Element | undefined {
  if (!isValidElement<Element['props']>(node)) return;
  if (matches(node)) return node;
  for (const child of Children.toArray(node.props.children)) {
    const match = find(child, matches);
    if (match) return match;
  }
}

function button(tree: ReactNode, text: string) {
  return find(tree, (element) => element.type === 'button' && element.props.children === text);
}

function click(tree: ReactNode, text: string) {
  const control = button(tree, text);
  expect(control, text).toBeDefined();
  expect(control?.props.disabled, text).not.toBe(true);
  control?.props.onClick?.();
}

function render<T>(state: ReturnType<typeof hookState>, component: () => T): T {
  hooks = state;
  state.cursor = 0;
  const result = component();
  for (const effect of state.effects.splice(0)) effect();
  return result;
}

let pageState: ReturnType<typeof hookState>;
let controlState: ReturnType<typeof hookState>;
let controlsKey: string | null;

function unmount(state: ReturnType<typeof hookState>) {
  for (const cleanup of state.cleanups.values()) cleanup();
}

function screen() {
  const page = render(pageState, () => SessionPage({ initialSource: 'live' }));
  const controls = find(page, (element) => element.type === SessionControls)! as ReactElement<Parameters<typeof SessionControls>[0]>;
  if (controls.key !== controlsKey) {
    unmount(controlState);
    controlState = hookState();
    controlsKey = controls.key;
  }
  const panel = render(controlState, () => SessionControls(controls.props));
  const coach = find(page, (element) => element.type === CoachPanel) as ReactElement<Parameters<typeof CoachPanel>[0]> | undefined;
  return { page, panel, phase: controls.props.phase, coach: coach?.props };
}

function sample(t: number): PoseFrame {
  return {
    t, fps: 30, joints: {}, gate: { ok: true, reasons: [] },
    angles: { r_elbow_flexion: { deg: t * 10, conf: 1 } },
  };
}

function startLive() {
  click(screen().page, 'Start camera');
  expect(screen().phase).toBe('starting');
  status = 'live';
  screen(); // The successful camera transition commits the running phase.
  expect(screen().phase).toBe('running');
}

beforeEach(() => {
  pageState = hookState();
  controlState = hookState();
  controlsKey = null;
  status = 'idle';
  frame = null;
  consent = { camera: true, recording: true, cloud_summary: true, cloud_clips: true };
  vi.clearAllMocks();
  publishCompletedSession(null);
});

afterEach(() => {
  unmount(pageState);
  unmount(controlState);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('starts, pauses, resumes, finishes and restarts with independent scoring and recording', async () => {
  const append = vi.spyOn(ClipBuffer.prototype, 'append');
  const download = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-clip');
  vi.stubGlobal('document', {
    createElement: () => ({ click: vi.fn(), remove: vi.fn() }),
    body: { appendChild: vi.fn() },
  });
  expect(button(screen().panel, 'Pause')).toBeUndefined();
  startLive();
  click(screen().panel, 'Start recording');
  frame = sample(1);
  screen();
  expect(push).toHaveBeenCalledOnce();
  expect(append).toHaveBeenCalledOnce();

  click(screen().panel, 'Pause');
  frame = sample(2);
  const paused = screen();
  expect(paused.coach).toMatchObject({ active: false, paused: true });
  expect(stop).not.toHaveBeenCalled();
  expect(push).toHaveBeenCalledOnce();
  expect(append).toHaveBeenCalledOnce();

  click(paused.panel, 'Resume');
  screen();
  expect(resetWindow).toHaveBeenCalledOnce();
  expect(push).toHaveBeenCalledOnce();
  expect(append).toHaveBeenCalledOnce();
  frame = sample(3);
  screen();
  expect(push).toHaveBeenCalledTimes(2);
  expect(append).toHaveBeenCalledTimes(2);
  screen().coach?.onOutcome?.('button', 'live');
  expect(getCompletedSession()).toBeNull();

  const dialog = find(screen().panel, (element) => element.type === 'dialog');
  click(dialog, 'Finish session');
  frame = sample(4);
  const finished = screen();
  expect(finished.phase).toBe('finished');
  expect(finished.coach).toBeUndefined();
  expect(stop).toHaveBeenCalledOnce();
  expect(push).toHaveBeenCalledTimes(2);
  expect(append).toHaveBeenCalledTimes(2);
  expect(button(finished.page, 'Start camera')).toBeUndefined();
  expect(getCompletedSession()).toMatchObject({
    angles: { r_elbow_flexion: { count: 2, min: 10, max: 30 } },
    coaching: { button: { live: 1 } },
  });
  click(finished.panel, 'Download clip');
  const blob = download.mock.calls[0][0];
  expect(blob).toBeInstanceOf(Blob);
  const clip = JSON.parse(await (blob as Blob).text());
  expect(clip.frames).toHaveLength(2);

  click(finished.page, 'Restart camera');
  const restarting = screen();
  expect(restarting.phase).toBe('starting');
  expect(start).toHaveBeenCalledTimes(2);
  expect(button(restarting.panel, 'Download clip')).toBeUndefined();
  expect(restarting.coach).toMatchObject({ escalationId: 0, active: false });
  expect(getCompletedSession()).toBeNull();
});

it('cancels startup, then requires explicit restart after camera consent ends a session', () => {
  click(screen().page, 'Start camera');
  click(screen().page, 'Cancel start');
  expect(screen().phase).toBe('ready');
  expect(stop).toHaveBeenCalledOnce();
  startLive();
  click(screen().panel, 'Pause');
  consent = { ...consent, camera: false };
  stop(); // The shared camera hook stops synchronously on withdrawal.
  screen();
  expect(screen().phase).toBe('finished');
  expect(button(screen().page, 'Restart camera')?.props.disabled).toBe(true);
  consent = { ...consent, camera: true };
  expect(screen().phase).toBe('finished');
  expect(start).toHaveBeenCalledTimes(2);
});

it('deleting clips removes the finished download offer', () => {
  startLive();
  click(screen().panel, 'Start recording');
  frame = sample(1);
  screen();
  click(find(screen().panel, (element) => element.type === 'dialog'), 'Finish session');
  const finished = screen();
  expect(button(finished.panel, 'Download clip')).toBeDefined();
  expect(getCompletedSession()).not.toBeNull();
  const deletion = find(finished.page, (element) => element.type === DeleteMyClips) as
    ReactElement<Parameters<typeof DeleteMyClips>[0]>;
  const deleteTree = render(hookState(), () => DeleteMyClips(deletion.props));
  click(find(deleteTree, (element) => element.type === 'dialog'), 'Delete my clips');
  expect(button(screen().panel, 'Download clip')).toBeUndefined();
  expect(getCompletedSession()).toBeNull();
});

it('recovers from denied startup and can finish while paused with recording disabled', () => {
  click(screen().page, 'Start camera');
  status = 'denied';
  screen();
  expect(screen().phase).toBe('ready');
  consent = { ...consent, recording: false };
  startLive();
  expect(button(screen().panel, 'Start recording')?.props.disabled).toBe(true);
  click(screen().panel, 'Pause');
  click(find(screen().panel, (element) => element.type === 'dialog'), 'Finish session');
  const finished = screen();
  expect(finished.phase).toBe('finished');
  expect(stop).toHaveBeenCalledOnce();
  expect(button(finished.panel, 'Resume')).toBeUndefined();
  expect(button(finished.panel, 'Download clip')).toBeUndefined();
});
