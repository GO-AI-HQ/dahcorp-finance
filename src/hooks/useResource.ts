import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../services/api.js';

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  /** True while refreshing data that is already on screen. */
  refreshing: boolean;
  reload: () => void;
}

/**
 * Minimal data hook. Keeps the previous payload visible while refreshing so the
 * dashboard never flashes empty, and surfaces the error object rather than a
 * string so callers can distinguish an expired session from a real failure.
 */
export function useResource<T>(loader: () => Promise<T>, deps: unknown[] = []): ResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);
  const hasData = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (hasData.current) setRefreshing(true);
    else setLoading(true);

    loader()
      .then((result) => {
        if (!mounted.current) return;
        setData(result);
        hasData.current = true;
        setError(null);
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        setError(err instanceof ApiError ? err : new ApiError('Something went wrong.', 0, 'UNKNOWN'));
      })
      .finally(() => {
        if (!mounted.current) return;
        setLoading(false);
        setRefreshing(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, refreshing, reload };
}
