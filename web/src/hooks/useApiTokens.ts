import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { ApiToken } from "../types";

/** The Zugriff tab's API-token section — see `ApiToken` in `src/db/apiTokensRepository.ts`. */
export function useApiTokens() {
  const tokens = useFetchedResource<ApiToken[]>(api.apiTokens, []);
  return { tokens: tokens.data ?? [], setTokens: tokens.setData };
}
