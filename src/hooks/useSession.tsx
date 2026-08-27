import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, type SessionResponse } from '../services/api.js';

interface SessionContextValue {
  session: SessionResponse | null;
  loading: boolean;
  error: string | null;
  signIn: (passcode: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Called by data views when a request comes back unauthenticated. */
  invalidate: () => void;
  /** Seconds until the session expires, ticking down. */
  secondsRemaining: number | null;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Session state for the whole app.
 *
 * The countdown exists so an idle session ending is visible rather than
 * surprising: the shell warns before it lapses and returns to the sign-in
 * screen when it does.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.session();
      setSession(next);
      setSecondsRemaining(next.expiresInSeconds);
    } catch (err) {
      setSession(null);
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Local countdown, re-synced with the server whenever it lapses.
  useEffect(() => {
    if (secondsRemaining == null) return;
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      setSecondsRemaining((current) => {
        if (current == null) return null;
        if (current <= 1) {
          void refresh();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [secondsRemaining == null, refresh]);

  const signIn = useCallback(
    async (passcode: string) => {
      setError(null);
      await api.login(passcode);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      await refresh();
    }
  }, [refresh]);

  const value = useMemo<SessionContextValue>(
    () => ({ session, loading, error, signIn, signOut, invalidate: refresh, secondsRemaining }),
    [session, loading, error, signIn, signOut, refresh, secondsRemaining],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider.');
  return value;
}
