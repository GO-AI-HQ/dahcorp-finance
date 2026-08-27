import { useState } from 'react';
import { useSession } from '../hooks/useSession.js';
import { ApiError } from '../services/api.js';

/**
 * The gate. The whole application sits behind this — there is no public
 * dashboard. The passcode is posted once and exchanged for a signed HttpOnly
 * cookie; the browser never holds a token it could leak.
 */
export function LoginScreen() {
  const { session, signIn } = useSession();
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setupRequired = session?.setupRequired ?? false;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!passcode || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(passcode);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed. Try again.');
      setPasscode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="card login__card">
        <p className="card__label">
          <span>DAHCorp Finance</span>
        </p>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 6 }}>Private access</h1>
        <p className="meta" style={{ marginBottom: 'var(--space-5)' }}>
          Personal capital-management console. Single authorised operator.
        </p>

        {setupRequired ? (
          <div className="banner banner--risk" role="alert">
            <span className="banner__glyph" aria-hidden="true">
              ✕
            </span>
            <div>
              <span className="banner__title">Setup required</span>
              <span>
                No access passcode is configured, so the application is locked. Set <code>DAHCORP_ACCESS_PASSCODE</code>{' '}
                (and ideally <code>DAHCORP_SESSION_SECRET</code>) in the Netlify environment, then redeploy. See{' '}
                <code>docs/SECURITY.md</code>.
              </span>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="stack stack--tight" noValidate>
            <div className="field">
              <label className="field__label" htmlFor="passcode">
                Access passcode
              </label>
              <input
                id="passcode"
                name="passcode"
                type="password"
                autoComplete="current-password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                disabled={busy}
                required
                aria-describedby={error ? 'passcode-error' : undefined}
              />
            </div>

            {error ? (
              <p id="passcode-error" className="meta" role="alert" style={{ color: 'var(--negative)' }}>
                <span aria-hidden="true">✕ </span>
                {error}
              </p>
            ) : null}

            <button type="submit" className="btn btn--gold btn--block" disabled={busy || !passcode}>
              {busy ? 'Verifying…' : 'Enter'}
            </button>
            <p className="soft" style={{ fontSize: '0.76rem', marginTop: 4 }}>
              Sessions expire after {session?.sessionTtlMinutes ?? 60} minutes of validity. Repeated failed attempts are
              throttled and logged.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
