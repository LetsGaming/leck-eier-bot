import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { Status } from "../types";

export function useStatus() {
  return useFetchedResource<Status>(api.status, []);
}
