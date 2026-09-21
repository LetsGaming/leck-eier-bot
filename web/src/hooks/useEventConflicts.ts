import { useEffect, useState } from "react";
import { api } from "../api";
import type { EventConflict } from "../types";

/**
 * Debounced "does this date already have something planned?" check for
 * `PublishEventForm`'s non-blocking warning banner — see
 * `src/services/eventConflicts.ts` on the backend. Silent on failure (no
 * toast): this is an advisory hint, not a required step, so a transient
 * network error shouldn't interrupt event creation.
 */
export function useEventConflicts(startsAtIso: string | null, ignoreScheduledId?: number): EventConflict[] {
  const [conflicts, setConflicts] = useState<EventConflict[]>([]);

  useEffect(() => {
    if (!startsAtIso) {
      setConflicts([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .eventConflicts(startsAtIso, ignoreScheduledId)
        .then((result) => {
          if (!cancelled) setConflicts(result);
        })
        .catch(() => {
          if (!cancelled) setConflicts([]);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [startsAtIso, ignoreScheduledId]);

  return conflicts;
}
