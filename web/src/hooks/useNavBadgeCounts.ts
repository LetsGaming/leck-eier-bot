import { useEffect, useRef, useState } from "react";
import { api } from "../api";

export interface NavBadgeCounts {
  pendingRegistrationCount: number;
  unmatchedSignupCount: number;
}

/**
 * Layout's sidebar badge counts. Refetched on every navigation (`pathname`
 * change) so approving a registration or resolving an unmatched signup
 * clears the badge without a full reload. Backed by the same `api.status()`
 * call Overview.tsx's `useStatus()` hook uses, just narrowed down to the two
 * fields the nav needs and refetched far more often (once per navigation,
 * not once per mount).
 *
 * Deliberately NOT built on the shared `useFetchedResource` (unlike every
 * other migrated resource in the app): that hook surfaces a toast on every
 * failed fetch, but this one refires on every navigation — a flaky/down
 * status endpoint would then produce a fresh error toast on essentially
 * every click, which is far more disruptive than a stale/missing sidebar
 * count. Matches the pre-migration hand-rolled effect's `.catch(() => {})`:
 * a failed refresh just leaves the last-known counts in place, silently.
 */
export function useNavBadgeCounts(pathname: string): NavBadgeCounts | null {
  const [counts, setCounts] = useState<NavBadgeCounts | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    api
      .status()
      .then((s) => {
        if (requestId === requestIdRef.current) {
          setCounts({
            pendingRegistrationCount: s.pendingRegistrationCount,
            unmatchedSignupCount: s.unmatchedSignupCount,
          });
        }
      })
      .catch(() => {
        // Intentionally silent — see doc comment above.
      });
  }, [pathname]);

  return counts;
}
