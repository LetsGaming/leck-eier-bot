import { useCallback } from "react";
import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { AuditLogResponse } from "../types";

const PAGE_SIZE = 50;

export function useAuditLog(page: number) {
  const fetcher = useCallback(() => api.auditLog({ limit: PAGE_SIZE, offset: page * PAGE_SIZE }), [page]);
  const resource = useFetchedResource<AuditLogResponse>(fetcher, [page]);
  return {
    entries: resource.data?.entries ?? [],
    total: resource.data?.total ?? 0,
    loading: resource.loading,
    pageSize: PAGE_SIZE,
  };
}
