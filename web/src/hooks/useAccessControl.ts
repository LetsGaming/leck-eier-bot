import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { AccessControlFeature } from "../types";

/** The "Zugriff" settings tab's data source — see `FEATURES` in `src/web/accessControl.ts`. `setFeatures` lets the tab patch a single feature in place after a save instead of refetching the whole list. */
export function useAccessControl() {
  const features = useFetchedResource<AccessControlFeature[]>(api.accessControlFeatures, []);
  return { features: features.data ?? [], setFeatures: features.setData };
}
