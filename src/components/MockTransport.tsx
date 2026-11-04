import type { ReactNode } from 'react';
import { useMockStream } from '../mock/MockStreamContext';

/** Transport for the mock replay stream. Keyboard-operable native buttons. */
export function MockTransport({ trailingActions }: { trailingActions?: ReactNode }) {
  const { status, error, player, snapshot } = useMockStream();

  if (status === 'loading') return <p>Loading mock stream…</p>;
  if (status === 'error' || player === null || snapshot === null) {
    return (
      <p role="alert">
        Mock stream failed to load{error ? `: ${error}` : ''}. Check that <code>/mock-stream.json</code> is
        served with the app.
      </p>
    );
  }

  const atEnd = snapshot.cursor >= snapshot.total && snapshot.total > 0;
  return (
    <section aria-label="Mock stream transport">
      <h2>Mock replay (demo data, not a result)</h2>
      <div className="button-row">
        <button type="button" onClick={() => player.play()} disabled={snapshot.playing || snapshot.total === 0}>
          {atEnd ? 'Replay' : 'Play'}
        </button>
        <button type="button" onClick={() => player.pause()} disabled={!snapshot.playing}>
          Pause
        </button>
        <button type="button" onClick={() => player.step()} disabled={snapshot.playing || atEnd}>
          Step one event
        </button>
        <button type="button" onClick={() => player.reset()} disabled={snapshot.cursor === 0 && !snapshot.playing}>
          Reset
        </button>
        {trailingActions && (
          <span className="transport-toggles" role="group" aria-label="Stage toggles">
            {trailingActions}
          </span>
        )}
      </div>
      <p aria-live="polite">
        Event {snapshot.cursor} of {snapshot.total}
        {snapshot.current ? ` — latest: ${snapshot.current.kind} at ${snapshot.current.at_ms} ms` : ' — nothing replayed yet'}
      </p>
    </section>
  );
}
