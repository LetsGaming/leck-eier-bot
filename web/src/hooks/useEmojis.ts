import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { EmojiOption } from "../types";

/** ReactionRoles.tsx's emoji picker needs the guild's custom emoji list. */
export function useEmojis() {
  return useFetchedResource<EmojiOption[]>(api.emojis, []);
}
