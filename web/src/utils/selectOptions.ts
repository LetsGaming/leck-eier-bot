import type { Channel, RoleOption } from "../types";

export function toChannelOptions(
  channels: Channel[],
  prefix: string = "#"
): { value: string; label: string }[] {
  return channels.map((c) => ({ value: c.id, label: `${prefix}${c.name}` }));
}

export function toRoleOptions(roles: RoleOption[]): { value: string; label: string }[] {
  return roles.map((r) => ({ value: r.id, label: r.name }));
}
