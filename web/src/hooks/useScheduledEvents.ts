import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { ScheduledEventPublish } from "../types";

/** Pending (and already-resolved) "publish later" entries for the Geplant tab. */
export function useScheduledEventPublishes() {
  return useFetchedResource<ScheduledEventPublish[]>(api.scheduledEventPublishes, []);
}
