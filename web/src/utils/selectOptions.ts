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

/**
 * SearchableSelect's `emptyLabel` for a channel field whose "leave unset"
 * behavior falls back to a global Einstellungen default (event channel,
 * attendance voice channel) — names the actual configured channel instead
 * of a generic "aus den Einstellungen" that reads the same whether or not
 * anything is actually set there, and says plainly when nothing is.
 */
export function defaultChannelEmptyLabel(
  defaultChannelId: string | null | undefined,
  channels: Channel[],
  prefix: string = "#",
): string {
  if (!defaultChannelId) return "— kein Standard in den Einstellungen konfiguriert —";
  const channel = channels.find((c) => c.id === defaultChannelId);
  return channel ? `— Standard: ${prefix}${channel.name} —` : "— Standard aus den Einstellungen —";
}
