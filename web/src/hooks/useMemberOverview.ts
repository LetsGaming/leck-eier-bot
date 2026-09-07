import { useCallback } from "react";
import { api, ApiError } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { MemberOverview } from "../types";

/**
 * A single member's aggregated overview, keyed by the `:userId` route param
 * (see `MemberOverview.tsx`). `userId` is only briefly `undefined` (before
 * the router resolves it), in which case this resolves to `null` without
 * hitting the network — same convention as `useEventAttendanceDetail`.
 *
 * A 404 from the backend (no `MemberRecord` for this `userId` at all) is
 * treated as a normal, non-error resolution to `null` — MemberOverview.tsx
 * distinguishes "still loading" from "not found" via the returned `loading`
 * flag, not by throwing/toasting. Any other failure (network error, 500,
 * etc.) still propagates to `useFetchedResource`'s standard error toast.
 */
export function useMemberOverview(userId: string | undefined) {
  const fetcher = useCallback(async (): Promise<MemberOverview | null> => {
    if (!userId) return null;
    try {
      return await api.memberOverview(userId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }, [userId]);
  return useFetchedResource<MemberOverview | null>(fetcher, [userId]);
}
