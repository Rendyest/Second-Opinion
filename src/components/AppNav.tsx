import { NavLink } from 'react-router-dom';

export function AppNav() {
  return (
    <header className="app-header">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="header-inner">
        <NavLink className="brand" to="/setup" aria-label="Second Opinion home">
          <svg aria-hidden="true" viewBox="0 0 40 40" width="40" height="40">
            <rect width="40" height="40" rx="11" fill="currentColor" />
            <path d="M8 22h7l4-9 4 14 4-7h5" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span><strong>Second Opinion</strong><small>Rehabilitation coaching</small></span>
        </NavLink>
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
            <li>
              <NavLink to="/review">Review</NavLink>
            </li>
            <li>
              <NavLink to="/validation">Validation</NavLink>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
