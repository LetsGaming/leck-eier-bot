import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { errorMessage } from "../api";
import { useToast } from "../components/ToastContext";

export interface FetchedResource<T> {
  data: T | null;
  loading: boolean;
  reload: () => void;
  setData: Dispatch<SetStateAction<T | null>>;
}

/**
 * Shared fetch/loading/error-state hook.
 *
 * Every page in this codebase used to hand-roll a `useState` + `useEffect`
 * pair around each `api.xxx()` call, each ending in its own copy of
 * `.catch((err) => showError(errorMessage(err)))`. This collapses that
 * anti-pattern into one place and reuses the existing `useToast()`
 * error-reporting convention rather than inventing a second one.
 *
 * `fetcher` runs once on mount, again whenever an entry in `deps` changes
 * (same rules as `useEffect`/`useCallback` dependency arrays — pass the
 * values `fetcher` closes over), and again whenever the returned `reload()`
 * is called. `setData` is exposed for callers that need to patch the
 * resource in place after a mutation (e.g. an optimistic update) without a
 * full refetch.
 */
export function useFetchedResource<T>(fetcher: () => Promise<T>, deps: unknown[]): FetchedResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const { showError } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    fetcher()
      .then(setData)
      .catch((err) => showError(errorMessage(err)))
      .finally(() => setLoading(false));
    // `deps` is supplied by each call site and intentionally spread here —
    // it lets every page-specific hook control exactly what re-triggers a
    // fetch without this generic hook needing to know their shape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, reload: load, setData };
}
