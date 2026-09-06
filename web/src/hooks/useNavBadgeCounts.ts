import { useCallback } from "react";
import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";

export interface NavBadgeCounts {
  pendingRegistrationCount: number;
  unmatchedSignupCount: number;
}

/**
 * Layout's sidebar badge counts. Refetched on every navigation (`deps:
 * [pathname]`) so approving a registration or resolving an unmatched signup
 * clears the badge without a full reload. Backed by the same `api.status()`
 * call Overview.tsx's `useStatus()` hook uses, just narrowed down to the two
 * fields the nav needs and refetched far more often (once per navigation,
 * not once per mount).
 *
 * Unlike the pre-migration hand-rolled effect (which swallowed fetch errors
 * with `.catch(() => {})` since a missing badge count isn't worth
 * interrupting navigation over), this goes through the shared
 * `useFetchedResource`, so a failed refresh now surfaces the standard error
 * toast like every other resource in the app — intentional, for consistency
 * with the rest of the migrated pages, rather than an oversight.
 */
export function useNavBadgeCounts(pathname: string) {
  const fetcher = useCallback(
    (): Promise<NavBadgeCounts> =>
      api.status().then((s) => ({
        pendingRegistrationCount: s.pendingRegistrationCount,
        unmatchedSignupCount: s.unmatchedSignupCount,
      })),
    [],
  );
  return useFetchedResource<NavBadgeCounts>(fetcher, [pathname]);
}
