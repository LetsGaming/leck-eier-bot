import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { GeneralSettings } from "../types";

/**
 * Shared by Birthdays.tsx and ReactionRoles.tsx (both only read `fontMap`
 * off this resource) and Settings.tsx (which reads/edits the whole object).
 * Settings.tsx patches `data` in place via `setData` after each successful
 * PATCH response rather than reloading — same convention as `useCommands`'s
 * `commands` resource.
 */
export function useGeneralSettings() {
  return useFetchedResource<GeneralSettings>(api.generalSettings, []);
}
