import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { TemporaryGrant } from "../types";

/** The Zugriff tab's time-boxed elevation section — see `TemporaryGrant` in `src/db/temporaryGrantsRepository.ts`. */
export function useTemporaryGrants() {
  const grants = useFetchedResource<TemporaryGrant[]>(api.temporaryGrants, []);
  return { grants: grants.data ?? [], setGrants: grants.setData };
}
