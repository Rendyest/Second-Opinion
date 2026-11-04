import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { MockStreamContext } from '../src/mock/MockStreamContext';
import { SessionPage } from '../src/pages/SessionPage';

vi.mock('../src/pose/useLivePose', () => ({
  useLivePose: () => ({
    videoRef: { current: null },
    status: 'live',
    error: null,
    frame: null,
    trackingLost: true,
    fps: 30,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

it('announces tracking loss, hides movement readouts, and disables the coaching trigger', () => {
  const html = renderToStaticMarkup(
    <MockStreamContext.Provider value={{ status: 'ready', snapshot: null, player: null, error: null, config: null }}>
      <SessionPage initialSource="live" />
    </MockStreamContext.Provider>,
  );
  expect(html).toContain('<p role="status">Tracking lost — please return to the camera view</p>');
  expect(html).not.toContain('aria-label="Joint angles"');
  expect(html).not.toContain('aria-label="Steadiness');
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Get a local tip/);
});
