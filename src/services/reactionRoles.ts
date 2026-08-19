import {
  EmbedBuilder,
  PermissionsBitField,
  type Client,
  type Guild,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from "discord.js";
import {
  getPanel,
  listPanels,
  setPanelMessageId,
} from "../db/reactionRolesRepository.js";
import { settingsBus, SettingsEvent } from "./settingsBus.js";
import { createEmbed } from "../utils/embedUtils.js";
import logger, { errorMessage } from "../utils/logger.js";
import { EmbedColor, REACTION_SELF_ECHO_TTL_MS, ReactionRoleMode } from "../constants.js";
import type { ReactionRoleMapping, ReactionRolePanelWithMappings } from "../types.js";

// --- Panel cache -----------------------------------------------------------
// Reactions can arrive many times a second; hitting SQLite on every one of
// them is wasteful when the panel set changes rarely. Rebuilt lazily and
// invalidated whenever a panel/mapping write happens (repository emits
// SettingsEvent.ReactionRoles) or a panel is (re)posted (message id changes).

let panelCache: Map<string, ReactionRolePanelWithMappings> | null = null;

function buildPanelCache(): Map<string, ReactionRolePanelWithMappings> {
  const map = new Map<string, ReactionRolePanelWithMappings>();
  for (const panel of listPanels()) {
    if (panel.messageId) map.set(panel.messageId, panel);
  }
  return map;
}

function getCachedPanel(messageId: string): ReactionRolePanelWithMappings | undefined {
  panelCache ??= buildPanelCache();
  return panelCache.get(messageId);
}

settingsBus.on(SettingsEvent.ReactionRoles, () => {
  panelCache = null;
});

// --- Self-echo suppression --------------------------------------------------
// Removing a user's reaction on their behalf (unique-mode swaps, the
// `removeReaction` panel option) fires a real messageReactionRemove event
// for that user. We already applied whatever effect that removal should
// have as part of handling the add, so the follow-up remove must be a
// no-op — tracked here for a short window per (message, user, emoji).

const selfInitiatedRemovals = new Map<string, ReturnType<typeof setTimeout>>();

function emojiKeyOf(idOrName: { id: string | null; name: string | null }): string | null {
  return idOrName.id ?? idOrName.name;
}

function markSelfInitiatedRemoval(messageId: string, userId: string, emojiKey: string): void {
  const key = `${messageId}:${userId}:${emojiKey}`;
  const existing = selfInitiatedRemovals.get(key);
  if (existing) clearTimeout(existing);
  selfInitiatedRemovals.set(
    key,
    setTimeout(() => selfInitiatedRemovals.delete(key), REACTION_SELF_ECHO_TTL_MS),
  );
}

function consumeSelfInitiatedRemoval(messageId: string, userId: string, emojiKey: string): boolean {
  const key = `${messageId}:${userId}:${emojiKey}`;
  const timeout = selfInitiatedRemovals.get(key);
  if (!timeout) return false;
  clearTimeout(timeout);
  selfInitiatedRemovals.delete(key);
  return true;
}

// --- Per-user serialization -------------------------------------------------
// Rapid clicking (or a fast toggle-flip) can otherwise interleave two
// concurrent handlers for the same message+user and leave role state
// inconsistent with what's on screen.

const userTaskQueues = new Map<string, Promise<void>>();

async function runSerialized(messageId: string, userId: string, task: () => Promise<void>): Promise<void> {
  const key = `${messageId}:${userId}`;
  const previous = userTaskQueues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task).catch((err) => {
    logger.error(`Reaction role handler failed: ${errorMessage(err)}`);
  });
  userTaskQueues.set(key, next);
  await next;
  if (userTaskQueues.get(key) === next) userTaskQueues.delete(key);
}

// --- Permission checks -------------------------------------------------------

export interface Manageability {
  ok: boolean;
  reason?: string;
}

/** Can the bot currently grant/revoke `roleId` in `guild`? Used both when handling a reaction and by the dashboard to warn before saving a mapping. */
export function canManageRole(guild: Guild, roleId: string): Manageability {
  const me = guild.members.me;
  if (!me) return { ok: false, reason: "Bot member not cached for this guild" };
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return { ok: false, reason: "Bot is missing the Manage Roles permission" };
  }
  if (roleId === guild.id) return { ok: false, reason: "Cannot assign @everyone" };
  const role = guild.roles.cache.get(roleId);
  if (!role) return { ok: false, reason: "Role not found" };
  if (role.managed) {
    return { ok: false, reason: "Role is managed by an integration and can't be assigned manually" };
  }
  if (me.roles.highest.position <= role.position) {
    return { ok: false, reason: "Bot's highest role must be positioned above this role" };
  }
  return { ok: true };
}

function canRemoveReactionsIn(message: Message): boolean {
  const me = message.guild?.members.me;
  if (!me) return false;
  return me.permissionsIn(message.channelId).has(PermissionsBitField.Flags.ManageMessages);
}

// --- Reaction lookup / removal helpers --------------------------------------

function findReaction(
  message: Message,
  emojiId: string | null,
  emojiName: string,
): MessageReaction | undefined {
  const key = emojiId ?? emojiName;
  return message.reactions.cache.find((r) => (r.emoji.id ?? r.emoji.name) === key);
}

/** Removes `userId`'s reaction for `mapping` on `message`, if present, marking it as self-initiated first. */
async function clearUserReactionForMapping(
  message: Message,
  mapping: ReactionRoleMapping,
  userId: string,
): Promise<void> {
  const reaction = findReaction(message, mapping.emojiId, mapping.emojiName);
  if (!reaction) return;
  if (!canRemoveReactionsIn(message)) {
    logger.warn(
      `Skipping reaction cleanup on panel message ${message.id}: bot lacks Manage Messages in this channel.`,
    );
    return;
  }
  markSelfInitiatedRemoval(message.id, userId, mapping.emojiId ?? mapping.emojiName);
  await reaction.users.remove(userId).catch((err) =>
    logger.warn(`Failed to remove reaction for user ${userId}: ${errorMessage(err)}`),
  );
}

// --- Event handlers ----------------------------------------------------------

async function resolvePartials(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<{ reaction: MessageReaction; user: User; message: Message } | null> {
  try {
    const full = reaction.partial ? await reaction.fetch() : reaction;
    const fullUser = user.partial ? await user.fetch() : user;
    const message = full.message.partial ? await full.message.fetch() : full.message;
    return { reaction: full, user: fullUser, message };
  } catch (err) {
    logger.warn(`Failed to resolve partial reaction: ${errorMessage(err)}`);
    return null;
  }
}

export async function handleReactionAdd(
  rawReaction: MessageReaction | PartialMessageReaction,
  rawUser: User | PartialUser,
): Promise<void> {
  if (rawUser.bot) return;
  const resolved = await resolvePartials(rawReaction, rawUser);
  if (!resolved) return;
  const { reaction, user, message } = resolved;

  const emojiKey = emojiKeyOf(reaction.emoji);
  if (!emojiKey) return;

  const panel = getCachedPanel(message.id);
  if (!panel) return;

  const mapping = panel.mappings.find((m) => (m.emojiId ?? m.emojiName) === emojiKey);
  if (!mapping) {
    // Not a configured option on this panel — keep it tidy by removing the stray reaction.
    if (canRemoveReactionsIn(message)) {
      await reaction.users.remove(user.id).catch(() => undefined);
    }
    return;
  }

  const guild = message.guild;
  if (!guild) return;

  await runSerialized(message.id, user.id, async () => {
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    const manageability = canManageRole(guild, mapping.roleId);
    if (!manageability.ok) {
      logger.warn(
        `Reaction role skipped (panel ${panel.id}, role ${mapping.roleId}): ${manageability.reason}`,
      );
      return;
    }

    if (panel.mode === ReactionRoleMode.Unique) {
      for (const other of panel.mappings) {
        if (other.id === mapping.id) continue;
        if (member.roles.cache.has(other.roleId) && canManageRole(guild, other.roleId).ok) {
          await member.roles.remove(other.roleId).catch((err) =>
            logger.warn(`Failed to revoke role ${other.roleId} during unique-mode swap: ${errorMessage(err)}`),
          );
        }
        await clearUserReactionForMapping(message, other, user.id);
      }
    }

    const hasRole = member.roles.cache.has(mapping.roleId);
    const shouldFlip = panel.removeReaction && panel.mode !== ReactionRoleMode.Verify;

    if (shouldFlip && hasRole) {
      await member.roles.remove(mapping.roleId).catch((err) =>
        logger.warn(`Failed to revoke role ${mapping.roleId}: ${errorMessage(err)}`),
      );
    } else if (!hasRole) {
      await member.roles.add(mapping.roleId).catch((err) =>
        logger.warn(`Failed to grant role ${mapping.roleId}: ${errorMessage(err)}`),
      );
    }

    if (panel.removeReaction) {
      await clearUserReactionForMapping(message, mapping, user.id);
    }
  });
}

export async function handleReactionRemove(
  rawReaction: MessageReaction | PartialMessageReaction,
  rawUser: User | PartialUser,
): Promise<void> {
  if (rawUser.bot) return;
  const resolved = await resolvePartials(rawReaction, rawUser);
  if (!resolved) return;
  const { reaction, user, message } = resolved;

  const emojiKey = emojiKeyOf(reaction.emoji);
  if (!emojiKey) return;

  if (consumeSelfInitiatedRemoval(message.id, user.id, emojiKey)) return;

  const panel = getCachedPanel(message.id);
  if (!panel || panel.removeReaction) return; // removeReaction panels never expect a persisted reaction to remove.

  const mapping = panel.mappings.find((m) => (m.emojiId ?? m.emojiName) === emojiKey);
  if (!mapping || panel.mode === ReactionRoleMode.Verify) return;

  const guild = message.guild;
  if (!guild) return;

  await runSerialized(message.id, user.id, async () => {
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member || !member.roles.cache.has(mapping.roleId)) return;

    const manageability = canManageRole(guild, mapping.roleId);
    if (!manageability.ok) {
      logger.warn(
        `Reaction role revoke skipped (panel ${panel.id}, role ${mapping.roleId}): ${manageability.reason}`,
      );
      return;
    }

    await member.roles.remove(mapping.roleId).catch((err) =>
      logger.warn(`Failed to revoke role ${mapping.roleId}: ${errorMessage(err)}`),
    );
  });
}

// --- Posting / syncing panel messages ---------------------------------------

function emojiDisplay(mapping: ReactionRoleMapping): string {
  return mapping.emojiId ? `<:${mapping.emojiName}:${mapping.emojiId}>` : mapping.emojiName;
}

function buildPanelEmbed(panel: ReactionRolePanelWithMappings): EmbedBuilder {
  const lines = [...panel.mappings]
    .sort((a, b) => a.position - b.position)
    .map((m) => `${emojiDisplay(m)} — <@&${m.roleId}>${m.label ? ` — ${m.label}` : ""}`);
  const description = [panel.description, lines.join("\n")].filter(Boolean).join("\n\n");
  return createEmbed({
    title: panel.title ?? "Reaction Roles",
    description: description || "No roles configured yet.",
    color: EmbedColor.Info,
  });
}

async function reconcilePanelReactions(message: Message, panel: ReactionRolePanelWithMappings): Promise<void> {
  const desired = [...panel.mappings].sort((a, b) => a.position - b.position);
  const desiredKeys = new Set(desired.map((m) => m.emojiId ?? m.emojiName));

  for (const reaction of message.reactions.cache.values()) {
    const key = reaction.emoji.id ?? reaction.emoji.name;
    if (reaction.me && key && !desiredKeys.has(key)) {
      await reaction.users.remove(message.client.user.id).catch((err) =>
        logger.warn(`Failed to remove stale panel reaction: ${errorMessage(err)}`),
      );
    }
  }

  for (const mapping of desired) {
    const key = mapping.emojiId ?? mapping.emojiName;
    const already = message.reactions.cache.find((r) => r.me && (r.emoji.id ?? r.emoji.name) === key);
    if (already) continue;
    const identifier = mapping.emojiId ? `${mapping.emojiName}:${mapping.emojiId}` : mapping.emojiName;
    await message.react(identifier).catch((err) =>
      logger.warn(`Failed to add panel reaction ${identifier}: ${errorMessage(err)}`),
    );
  }
}

/** Posts the panel (first sync) or edits it in place, then reconciles its seed reactions. */
export async function syncPanelMessage(client: Client, panelId: number): Promise<void> {
  const panel = getPanel(panelId);
  if (!panel) throw new Error(`Reaction role panel ${panelId} not found`);

  const channel = await client.channels.fetch(panel.channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    throw new Error(`Channel ${panel.channelId} is not a usable guild text channel`);
  }

  const embed = buildPanelEmbed(panel);
  let message: Message | null = null;

  if (panel.messageId) {
    message = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (message) {
      message = await message.edit({ embeds: [embed] });
    }
  }

  if (!message) {
    message = await channel.send({ embeds: [embed] });
    setPanelMessageId(panel.id, message.id);
  }

  await reconcilePanelReactions(message, panel);
}

export async function syncAllPanels(client: Client): Promise<void> {
  for (const panel of listPanels()) {
    try {
      await syncPanelMessage(client, panel.id);
    } catch (err) {
      logger.error(`Failed to sync reaction-role panel ${panel.id}: ${errorMessage(err)}`);
    }
  }
}
