import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { UserAccessOverride } from "../types";

/** The Zugriff tab's per-user grant/block section — see `UserAccessOverride` in `src/db/userAccessOverridesRepository.ts`. */
export function useUserAccessOverrides() {
  const overrides = useFetchedResource<UserAccessOverride[]>(api.userAccessOverrides, []);
  return { overrides: overrides.data ?? [], setOverrides: overrides.setData };
}
