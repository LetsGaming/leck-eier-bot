import { useCallback } from "react";
import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { EventAttendance, EventAttendanceListResponse, EventMonths, MemberAuditEntry } from "../types";

export interface EventAttendanceListParams {
  month?: string;
  q?: string;
  scope?: "month" | "all";
  problems?: "0" | "1";
}

/**
 * EventAttendance.tsx's month picker needs the full month/count list up
 * front — fetched once, independent of whatever filter is currently applied
 * to the list below.
 */
export function useEventAttendanceMonths() {
  return useFetchedResource<EventMonths>(api.eventAttendanceMonths, []);
}

/**
 * The filtered event list. `params` is rebuilt every render (it's derived
 * from the URL's search params), so it can't be used as a `useCallback`/
 * `useFetchedResource` dep directly — its object identity would change on
 * every render even when the underlying filter values haven't. Depending on
 * the four primitive fields individually keeps the dep array honest (no
 * eslint suppression needed) while still only refetching when a filter
 * actually changes.
 *
 * Callers are expected to pass an already-debounced `q` (see
 * `useDebouncedValue`) so free-text typing doesn't fire a request per
 * keystroke — the `useFetchedResource` request-id guard also protects
 * against a stale, slow response for an earlier `q` overwriting a newer one.
 */
export function useEventAttendanceList(params: EventAttendanceListParams) {
  const { month, q, scope, problems } = params;
  const fetcher = useCallback(
    () => api.eventAttendanceList({ month, q, scope, problems }),
    [month, q, scope, problems],
  );
  return useFetchedResource<EventAttendanceListResponse>(fetcher, [month, q, scope, problems]);
}

/**
 * A single event's full attendance detail. `eventId` comes from the route
 * param and is only briefly `undefined` (before the router has resolved
 * it), in which case this resolves to `null` without hitting the network —
 * matching the pre-migration effect's `if (!eventId) return;` guard, which
 * silently skipped the fetch rather than surfacing an error toast.
 */
export function useEventAttendanceDetail(eventId: string | undefined) {
  const fetcher = useCallback(async (): Promise<EventAttendance | null> => {
    if (!eventId) return null;
    return api.eventAttendance(Number(eventId));
  }, [eventId]);
  return useFetchedResource<EventAttendance | null>(fetcher, [eventId]);
}

/**
 * The in-guild member list backing EventAttendanceDetail's linking dropdown
 * (Task 4's lightweight, in-guild-only endpoint — never the unbounded
 * memberAudit() list). Query is always `""` here (the dropdown does its own
 * client-side filtering), so this has no params and never refetches.
 */
export function useInGuildMembers() {
  const fetcher = useCallback(() => api.inGuildMembers("").then((r) => r.inGuild), []);
  return useFetchedResource<MemberAuditEntry[]>(fetcher, []);
}
