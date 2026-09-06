import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { RoleOption } from "../types";

/**
 * Shared by ReactionRoles.tsx and Settings.tsx. Commands.tsx fetches its own
 * copy of the same resource inline inside `useCommands.ts` (predating this
 * hook) — left as-is since Commands.tsx is out of scope for this batch.
 */
export function useRoles() {
  return useFetchedResource<RoleOption[]>(api.roles, []);
}
