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

/**
 * A synthetic entry for a mention-role picker that also needs to offer
 * @everyone — which isn't a real role, so it's never in `RoleOption[]` (the
 * shared `/discord/roles` endpoint deliberately excludes it, correctly, for
 * every OTHER role picker in the app — reaction roles, gate roles, etc.).
 * `value` must match `EVERYONE_MENTION_SENTINEL` in `src/services/events.ts`.
 */
export const EVERYONE_MENTION_OPTION = { value: "everyone", label: "@everyone" };
