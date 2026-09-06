import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { BirthdaySettings } from "../types";

/**
 * Birthdays.tsx seeds a batch of local editable form fields from this
 * resource once it loads (via a `useEffect` keyed on `data`) rather than
 * editing it in place — the page never calls `setData`/`reload` on it, only
 * `api.updateBirthdaySettings()` directly on save.
 */
export function useBirthdaySettings() {
  return useFetchedResource<BirthdaySettings>(api.birthdaySettings, []);
}
