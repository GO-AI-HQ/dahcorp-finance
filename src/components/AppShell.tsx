import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from '../hooks/useSession.js';
import { Badge } from './Badge.js';

export const ROUTES = [
  { path: '/', label: 'Overview' },
  { path: '/income', label: 'Income Engine' },
  { path: '/portfolio', label: 'Portfolio' },
  { path: '/semiconductor', label: 'Semiconductor' },
  { path: '/opportunities', label: 'Opportunities' },
  { path: '/simulator', label: 'Simulator' },
  { path: '/claude', label: 'Claude' },
  { path: '/activity', label: 'Activity' },
  { path: '/settings', label: 'Settings' },
] as const;

function countdownLabel(seconds: number | null): string | null {
  if (seconds == null) return null;
  if (seconds <= 0) return 'expired';
  const mins = Math.floor(seconds / 60);
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  if (mins >= 1) return `${mins}m`;
  return `${seconds}s`;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session, signOut, secondsRemaining } = useSession();
  const demo = session?.mode === 'public_demo';
  const countdown = countdownLabel(secondsRemaining);
  const expiringSoon = secondsRemaining != null && secondsRemaining > 0 && secondsRemaining <= 120;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="nav">
        <div className="nav__inner">
          <NavLink to="/" className="brand">
            <span className="brand__mark">DAHCorp</span>
            <span className="brand__sub">Finance</span>
          </NavLink>

          <nav className="nav__links" aria-label="Primary">
            {ROUTES.map((route) => (
              <NavLink key={route.path} to={route.path} end={route.path === '/'} className="nav__link">
                {route.label}
              </NavLink>
            ))}
          </nav>

          <div className="nav__actions">
            {demo ? (
              <Badge tone="warning" glyph="▲" title="Read-only demonstration session">
                Demo
              </Badge>
            ) : null}
            {countdown ? (
              <Badge
                tone={expiringSoon ? 'negative' : 'neutral'}
                glyph={expiringSoon ? '!' : undefined}
                title="Time remaining before this session expires"
              >
                <span className="sr-only">Session expires in </span>
                {countdown}
              </Badge>
            ) : null}
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => void signOut()}>
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="main" id="main">
        {children}
      </main>

      <footer className="footer">
        <p>
          DAHCorp Finance · Phase 1 — Observer. Live order execution is disabled in this build. Nothing here is
          investment advice.
        </p>
      </footer>
    </div>
  );
}
