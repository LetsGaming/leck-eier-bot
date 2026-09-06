import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { Panel } from "../types";

/**
 * ReactionRoles.tsx patches the panel list in place after every mutation
 * (create/update/delete/send/sync/mapping add-edit-remove-reorder all
 * return the affected panel and splice it into the array) rather than
 * refetching, so `setData` is exposed alongside `data`/`loading` — same
 * shape as `useCommands.ts`'s `commands` resource.
 */
export function usePanels() {
  return useFetchedResource<Panel[]>(api.panels, []);
}
