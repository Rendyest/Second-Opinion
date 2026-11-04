import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CoachPanel } from '../src/components/CoachPanel';
import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react';

type Effect = { deps?: readonly unknown[]; cleanup?: () => void };

const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  effects: [] as (() => void)[],
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useRef<T>(value: T) {
    const index = hooks.cursor++;
    return hooks.slots[index] ?? (hooks.slots[index] = { current: value });
  },
  useState<T>(value: T) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = value;
    return [hooks.slots[index], (next: T | ((prev: T) => T)) => {
      hooks.slots[index] = typeof next === 'function' ? (next as (prev: T) => T)(hooks.slots[index] as T) : next;
    }];
  },
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as Effect | undefined;
    if (deps && previous?.deps?.length === deps.length &&
        deps.every((value, i) => Object.is(value, previous.deps?.[i]))) return;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      hooks.slots[index] = { deps, cleanup: effect() };
    });
  },
}));

const consent = { camera: true, recording: false, cloud_summary: true, cloud_clips: false };
const props: ComponentProps<typeof CoachPanel> = {
  active: true,
  frame: {
    t: 1, fps: 30, joints: {}, gate: { ok: true, reasons: [] },
    angles: { r_elbow_flexion: { deg: 90, conf: 1 } },
  },
  systemState: 'struggling',
  topSignal: 'stall',
  cantSeeYouActive: false,
  escalationId: 0,
  statsEpoch: 'live',
  consent,
};

function renderPanel(overrides: Partial<typeof props> = {}) {
  hooks.cursor = 0;
  const panel = CoachPanel({ ...props, ...overrides });
  for (const effect of hooks.effects.splice(0)) effect();
  return panel;
}

function render(overrides: Partial<typeof props> = {}) {
  return renderToStaticMarkup(renderPanel(overrides));
}

function tipButton(node: ReactNode): (() => void) | undefined {
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return;
  if (node.type === 'button' && node.props.children === 'Get a tip') return node.props.onClick;
  for (const child of Children.toArray(node.props.children)) {
    const click = tipButton(child);
    if (click) return click;
  }
}

const fetchCoach = vi.fn<typeof fetch>();

beforeEach(() => {
  hooks.slots = [];
  fetchCoach.mockReset();
  vi.stubGlobal('fetch', fetchCoach);
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  render();
  render({ frame: { ...props.frame!, t: 2 } });
});

afterEach(() => {
  for (const slot of hooks.slots) (slot as Effect | undefined)?.cleanup?.();
  vi.unstubAllGlobals();
});

it('sends one automatic request per escalation and suppresses new pulses during cooldown', async () => {
  const onOutcome = vi.fn();
  fetchCoach.mockResolvedValueOnce(Response.json({ message: 'Take your time.' }));
  render({ escalationId: 1, onOutcome });
  render({ escalationId: 1 });
  await vi.waitFor(() => expect(render({ escalationId: 1 })).toContain('Take your time.'));
  render({ escalationId: 2 });
  expect(fetchCoach).toHaveBeenCalledOnce();
  expect(onOutcome).toHaveBeenCalledOnce();
  expect(onOutcome).toHaveBeenCalledWith('escalation', 'live');
  expect(JSON.parse(String(fetchCoach.mock.calls[0][1]?.body)).system1)
    .toEqual({ state: 'struggling', top_signal: 'stall' });
});

it('uses a labelled local tip for a struggle without cloud consent', () => {
  const onOutcome = vi.fn();
  const offline = { ...consent, cloud_summary: false };
  render({ consent: offline, escalationId: 1, onOutcome });
  expect(render({ consent: offline, escalationId: 1 })).toContain('Local tip:');
  expect(fetchCoach).not.toHaveBeenCalled();
  expect(onOutcome).toHaveBeenCalledOnce();
  expect(onOutcome).toHaveBeenCalledWith('escalation', 'local');
});

it('uses the manual request path and labels an unavailable cloud response as local', async () => {
  fetchCoach.mockResolvedValueOnce(new Response(null, { status: 429 }));
  const click = tipButton(renderPanel());
  expect(click).toBeDefined();
  click?.();
  await vi.waitFor(() => expect(render()).toContain('Local tip:'));
  expect(render()).not.toContain('Live tip from the cloud model.');
  expect(fetchCoach).toHaveBeenCalledOnce();
});

it.each([{ paused: true }, { active: false }, { cantSeeYouActive: true }, { frame: null }])(
  'consumes a blocked pulse without sending it when the session recovers (%j)',
  (blocked) => {
    render({ ...blocked, escalationId: 1 });
    render({ escalationId: 1 });
    expect(fetchCoach).not.toHaveBeenCalled();
  },
);

it.each([
  ['consent withdrawal', { consent: { ...consent, cloud_summary: false } }],
  ['pause', { paused: true }],
  ['finish', { active: false }],
  ['a new session', { statsEpoch: 'next-session' }],
] satisfies Array<[string, Partial<typeof props>]>)('aborts an in-flight tip on %s and ignores its late reply', async (_, transition) => {
  let respond!: (response: Response) => void;
  fetchCoach.mockReturnValueOnce(new Promise((resolve) => { respond = resolve; }));
  render({ escalationId: 1 });
  const signal = fetchCoach.mock.calls[0][1]?.signal;
  render({ escalationId: 1, ...transition });
  expect(signal?.aborted).toBe(true);
  respond(Response.json({ message: 'Late cue.' }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(render({ escalationId: 1 })).not.toContain('Late cue.');
});
