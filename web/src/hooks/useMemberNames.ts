import { useEffect, useState } from "react";
import { api } from "../api";

/**
 * Resolves a set of Discord user ids to display names (e.g. Birthdays.tsx
 * turning an admin-entered Discord-user-ID entry — which has no `name` on
 * file, only the raw `<@id>` mention — into the same name Member Audit
 * already shows for that person). Best-effort enrichment, not a primary
 * data load: a failed lookup is swallowed rather than surfaced as an error
 * toast, since every caller already has a sane fallback (the raw mention)
 * to render while unresolved.
 *
 * Re-fetches whenever the *set* of ids changes, not on every render — the
 * sorted/joined string comparison avoids refetching when a caller passes a
 * new array instance with the same ids (e.g. recomputed from a `.filter()`
 * on every render, as Birthdays.tsx does).
 */
export function useMemberNames(userIds: string[]): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  const key = [...new Set(userIds)].sort().join(",");

  useEffect(() => {
    if (!key) {
      setNames({});
      return;
    }
    let cancelled = false;
    api
      .resolveMemberNames(key.split(","))
      .then((result) => {
        if (!cancelled) setNames(result);
      })
      .catch(() => {
        // Best-effort — callers already fall back to the raw mention.
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return names;
}
