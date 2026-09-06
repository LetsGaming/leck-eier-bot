import { api } from "../api";
import { useFetchedResource } from "./useFetchedResource";
import type { CommandDef, RoleOption } from "../types";

const NO_ROLES: RoleOption[] = [];

/**
 * Commands.tsx needs two independent resources (the command list and the
 * guild's roles, for the permission-gate role picker) that were previously
 * fetched with two separate, unrelated `useEffect`s. Each keeps its own
 * fetch/loading/error state via `useFetchedResource` — `roles` defaults to
 * `[]` (matching the pre-migration `useState<RoleOption[]>([])`) so callers
 * don't have to null-check it.
 *
 * `setCommands` is exposed because Commands.tsx patches the command list in
 * place after a mutation (`toggle()` / `updatePermissionGate()`) rather than
 * refetching — that's not a "reload" so it isn't modeled as one.
 */
export function useCommands() {
  const commands = useFetchedResource<CommandDef[]>(api.commands, []);
  const roles = useFetchedResource<RoleOption[]>(api.roles, []);

  return {
    commands: commands.data,
    setCommands: commands.setData,
    roles: roles.data ?? NO_ROLES,
  };
}
