import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { Channel } from "../types";

/** Settings.tsx's "Event-Anwesenheit" section needs voice channels separately from `useChannels`'s text/category channel list. */
export function useVoiceChannels() {
  return useFetchedResource<Channel[]>(api.voiceChannels, []);
}
