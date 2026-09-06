import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { Channel } from "../types";

/**
 * `channels` is fetched identically (and independently) by Birthdays.tsx,
 * ReactionRoles.tsx and Settings.tsx — a shared hook avoids three copies of
 * the same `useFetchedResource<Channel[]>(api.channels, [])` call. Callers
 * default `data` to `[]` themselves (matching the pre-migration
 * `useState<Channel[]>([])` on each page) since the empty default differs
 * from `useVoiceChannels`'s (a distinct resource, not reused here).
 */
export function useChannels() {
  return useFetchedResource<Channel[]>(api.channels, []);
}
