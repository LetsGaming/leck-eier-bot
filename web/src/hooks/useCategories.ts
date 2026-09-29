import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { Channel } from "../types";

/** Settings.tsx's temporary-voice-channels section needs the guild's categories, separately from `useChannels`/`useVoiceChannels`. */
export function useCategories() {
  return useFetchedResource<Channel[]>(api.categories, []);
}
