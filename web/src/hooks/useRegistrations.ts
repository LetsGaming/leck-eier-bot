import { useCallback } from "react";
import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { Registration } from "../types";

export function useRegistrations(query: string) {
  const fetcher = useCallback(() => api.registrations(query), [query]);
  return useFetchedResource<Registration[]>(fetcher, [query]);
}
