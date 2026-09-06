import { useCallback } from "react";
import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { MemberAuditResponse } from "../types";

export function useMemberAudit(query: string) {
  const fetcher = useCallback(() => api.memberAudit(query), [query]);
  return useFetchedResource<MemberAuditResponse>(fetcher, [query]);
}
