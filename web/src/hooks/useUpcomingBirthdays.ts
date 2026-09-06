import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { UpcomingBirthday } from "../types";

/**
 * Birthdays.tsx used to manually re-run `api.upcomingBirthdays()` after
 * syncing the anchor message or adding/editing/deleting an entry
 * (`setUpcoming(await api.upcomingBirthdays())`); those call sites now use
 * this resource's `reload()` instead.
 */
export function useUpcomingBirthdays() {
  return useFetchedResource<UpcomingBirthday[]>(api.upcomingBirthdays, []);
}
