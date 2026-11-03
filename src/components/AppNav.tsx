import { NavLink } from 'react-router-dom';
import { useMockStream } from '../mock/MockStreamContext';
import { config } from '../config';

function streamLabel(status: string, cursor: number, total: number, playing: boolean): string {
  if (status === 'loading') return 'Mock stream: loading…';
  if (status === 'error') return 'Mock stream: error';
  return `Mock stream: ${playing ? 'playing' : 'paused'} (event ${cursor} of ${total})`;
}

export function AppNav() {
  const { status, snapshot } = useMockStream();
  const snap = snapshot ?? { cursor: 0, total: 0, playing: false };
  return (
    <header className="app-header">
      <p className="app-title">Second Opinion — coaching loop</p>
      <nav aria-label="Primary">
        <ul className="nav-list">
          <li>
            <NavLink to="/setup">Setup</NavLink>
          </li>
          <li>
            <NavLink to="/session">Session</NavLink>
          </li>
          <li>
            <NavLink to="/metrics">Metrics</NavLink>
          </li>
          {config.ui.dev_controls && (
            <li>
              <NavLink to="/review">Review</NavLink>
            </li>
          )}
          <li>
            <NavLink to="/validation">Validation</NavLink>
          </li>
        </ul>
      </nav>
      <p className="mock-chip" role="status">
        {streamLabel(status, snap.cursor, snap.total, snap.playing)}
      </p>
      <p className="audience-note">Setup and Session are for the participant. Metrics, Review, Validation are for judges and reviewers.</p>
    </header>
  );
}
