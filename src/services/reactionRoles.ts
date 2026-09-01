import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type StringSelectMenuInteraction,
  type User,
} from "discord.js";
import { getPanel, listPanels, setPanelMessageId } from "../db/reactionRolesRepository.js";
import { getSettings } from "../db/settingsRepository.js";
import { settingsBus, SettingsEvent } from "./settingsBus.js";
import { createEmbed } from "../utils/embedUtils.js";
import { applyFont } from "../utils/font.js";
import logger, { errorMessage } from "../utils/logger.js";
import {
  EmbedColor,
  MAX_BUTTONS_PER_PANEL,
  MAX_DROPDOWN_OPTIONS_PER_PANEL,
  PanelMessageType,
  REACTION_SELF_ECHO_TTL_MS,
  SelectionType,
} from "../constants.js";
import type { ReactionRoleMapping, ReactionRolePanelWithMappings } from "../types.js";

// --- Panel cache -----------------------------------------------------------
// Reactions/component interactions can arrive many times a second; hitting
// SQLite on every one of them is wasteful when the panel set changes
// rarely. Rebuilt lazily and invalidated whenever a panel/mapping write
// happens (repository emits SettingsEvent.ReactionRoles).

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

// --- Self-echo suppression (reactions only) ---------------------------------
// Removing a user's reaction on their behalf (single-role swaps, the
// `removeReaction` option) fires a real messageReactionRemove event for
// that user. We already applied whatever effect that removal should have
// as part of handling the add, so the follow-up remove must be a no-op —
// tracked here for a short window per (message, user, emoji).

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

async function runSerialized<T>(messageId: string, userId: string, task: () => Promise<T>): Promise<T | undefined> {
  const key = `${messageId}:${userId}`;
  const previous = userTaskQueues.get(key) ?? Promise.resolve();
  let result: T | undefined;
  const next = previous
    .then(async () => {
      result = await task();
    })
    .catch((err) => {
      logger.error(`Reaction role handler failed: ${errorMessage(err)}`);
    });
  userTaskQueues.set(key, next);
  await next;
  if (userTaskQueues.get(key) === next) userTaskQueues.delete(key);
  return result;
}

// --- Permission checks -------------------------------------------------------

export interface Manageability {
  ok: boolean;
  reason?: string;
}

/** Can the bot currently grant/revoke `roleId` in `guild`? Used both when handling a selection and by the dashboard to warn before saving a mapping. */
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

/** Only members holding at least one of `panel.allowedRoleIds` may use it. Empty/null means everyone. */
function isAllowedToUsePanel(member: GuildMember, panel: ReactionRolePanelWithMappings): boolean {
  if (!panel.allowedRoleIds || panel.allowedRoleIds.length === 0) return true;
  return panel.allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

// --- Reaction lookup / removal helpers (reactions only) ---------------------

function findReaction(
  message: Message,
  emojiId: string | null,
  emojiName: string | null,
): MessageReaction | undefined {
  const key = emojiId ?? emojiName;
  if (!key) return undefined;
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
  const emojiKey = mapping.emojiId ?? mapping.emojiName;
  if (!emojiKey) return;
  markSelfInitiatedRemoval(message.id, userId, emojiKey);
  await reaction.users.remove(userId).catch((err) =>
    logger.warn(`Failed to remove reaction for user ${userId}: ${errorMessage(err)}`),
  );
}

// --- Core role application ---------------------------------------------------
// Shared by reactions, buttons, and (in a different shape — see
// applyDropdownSelection) dropdowns, so the grant/revoke/allowMultiple/
// removable rules only live in one place.

interface SelectionResult {
  ok: boolean;
  message: string;
}

interface ApplyOptions {
  /** Buttons always flip; reactions only flip when `removeReaction` is set (otherwise reacting is grant-only, and un-reacting is handled separately by `revokeMappingSelection`). */
  flip: boolean;
  /** Reactions only — lets a single-role swap also clear the other reactions the member is holding. */
  message?: Message;
}

/** `<@&id>, <@&id>` — the mention list shown in a grant/revoke reply and in the panel's rendered options. */
function roleMentions(roleIds: string[]): string {
  return roleIds.map((id) => `<@&${id}>`).join(", ");
}

/**
 * Splits a mapping's configured roles into what the bot can currently
 * manage vs. can't (see `canManageRole()`). Every grant/revoke path applies
 * the change to `manageable` and reports `unmanageable` rather than
 * blocking the whole mapping over one role the bot can't currently touch —
 * confirmed during design (see the spec's "Selection logic" section).
 */
function partitionManageable(guild: Guild, roleIds: string[]): { manageable: string[]; unmanageable: string[] } {
  const manageable: string[] = [];
  const unmanageable: string[] = [];
  for (const roleId of roleIds) {
    (canManageRole(guild, roleId).ok ? manageable : unmanageable).push(roleId);
  }
  return { manageable, unmanageable };
}

async function applyMappingSelection(
  guild: Guild,
  member: GuildMember,
  panel: ReactionRolePanelWithMappings,
  mapping: ReactionRoleMapping,
  opts: ApplyOptions,
): Promise<SelectionResult> {
  const { manageable, unmanageable } = partitionManageable(guild, mapping.roleIds);
  if (manageable.length === 0) {
    logger.warn(`Reaction role skipped (panel ${panel.id}, mapping ${mapping.id}): no configured role is currently manageable.`);
    return { ok: false, message: "Entschuldigung, ich kann diese Rolle gerade nicht vergeben — ein Admin muss meine Berechtigungen überprüfen." };
  }
  const unmanageableSuffix =
    unmanageable.length > 0 ? ` Konnte dir nicht geben: ${roleMentions(unmanageable)} (frag einen Admin).` : "";

  const hasAllRoles = manageable.every((id) => member.roles.cache.has(id));

  if (hasAllRoles) {
    if (!opts.flip) return { ok: true, message: `Du hast bereits ${roleMentions(manageable)}.${unmanageableSuffix}` };
    if (!panel.removable) return { ok: true, message: `${roleMentions(manageable)} kann nicht entfernt werden.${unmanageableSuffix}` };
    if (unmanageable.length > 0) {
      logger.warn(
        `Reaction role: some roles not manageable (panel ${panel.id}, mapping ${mapping.id}): ${unmanageable.join(", ")}.`,
      );
    }
    for (const roleId of manageable) {
      await member.roles.remove(roleId).catch((err) => logger.warn(`Failed to revoke role ${roleId}: ${errorMessage(err)}`));
    }
    return { ok: true, message: `${roleMentions(manageable)} entfernt.${unmanageableSuffix}` };
  }

  if (!panel.allowMultiple) {
    for (const other of panel.mappings) {
      if (other.id === mapping.id) continue;
      const { manageable: otherManageable } = partitionManageable(guild, other.roleIds);
      const heldOtherRoles = otherManageable.filter((id) => member.roles.cache.has(id));
      for (const roleId of heldOtherRoles) {
        await member.roles.remove(roleId).catch((err) =>
          logger.warn(`Failed to revoke role ${roleId} while enforcing single-role selection: ${errorMessage(err)}`),
        );
      }
      if (heldOtherRoles.length > 0 && opts.message) await clearUserReactionForMapping(opts.message, other, member.id);
    }
  }

  const toGrant = manageable.filter((id) => !member.roles.cache.has(id));
  if (unmanageable.length > 0) {
    logger.warn(
      `Reaction role: some roles not manageable (panel ${panel.id}, mapping ${mapping.id}): ${unmanageable.join(", ")}.`,
    );
  }
  for (const roleId of toGrant) {
    await member.roles.add(roleId).catch((err) => logger.warn(`Failed to grant role ${roleId}: ${errorMessage(err)}`));
  }
  return { ok: true, message: `Dir wurde ${roleMentions(toGrant)} gegeben.${unmanageableSuffix}` };
}

/** Un-react equivalent — only meaningful when `removable`; a flip-style interaction (buttons, `removeReaction` panels) never calls this, it's handled inline by `applyMappingSelection`. */
async function revokeMappingSelection(
  guild: Guild,
  member: GuildMember,
  panel: ReactionRolePanelWithMappings,
  mapping: ReactionRoleMapping,
): Promise<void> {
  if (!panel.removable) return;
  const { manageable, unmanageable } = partitionManageable(guild, mapping.roleIds);
  const toRevoke = manageable.filter((id) => member.roles.cache.has(id));
  if (toRevoke.length > 0 && unmanageable.length > 0) {
    logger.warn(
      `Reaction role revoke skipped some roles (panel ${panel.id}, mapping ${mapping.id}): ${unmanageable.join(", ")} not manageable.`,
    );
  }
  for (const roleId of toRevoke) {
    await member.roles.remove(roleId).catch((err) => logger.warn(`Failed to revoke role ${roleId}: ${errorMessage(err)}`));
  }
}

/**
 * Dropdown selections submit the member's *complete* new set of chosen
 * options every time (not one option at a time like a reaction/button
 * click), so it's reconciled against current role membership in one pass
 * instead of reusing `applyMappingSelection`'s single-mapping flip.
 */
async function applyDropdownSelection(
  guild: Guild,
  member: GuildMember,
  panel: ReactionRolePanelWithMappings,
  selectedMappingIds: number[],
): Promise<SelectionResult> {
  const targetRoleIds = new Set(
    panel.mappings.filter((m) => selectedMappingIds.includes(m.id)).map((m) => m.roleIds[0]!),
  );

  const granted: string[] = [];
  const revoked: string[] = [];
  const kept: string[] = [];

  for (const mapping of panel.mappings) {
    const roleId = mapping.roleIds[0]!;
    if (!canManageRole(guild, roleId).ok) continue;
    const hasRole = member.roles.cache.has(roleId);
    const wantsRole = targetRoleIds.has(roleId);

    if (wantsRole && !hasRole) {
      await member.roles.add(roleId).catch((err) => logger.warn(`Failed to grant role ${roleId}: ${errorMessage(err)}`));
      granted.push(roleId);
    } else if (!wantsRole && hasRole) {
      if (panel.removable) {
        await member.roles.remove(roleId).catch((err) => logger.warn(`Failed to revoke role ${roleId}: ${errorMessage(err)}`));
        revoked.push(roleId);
      } else {
        kept.push(roleId);
      }
    }
  }

  const parts: string[] = [];
  if (granted.length) parts.push(`Dir gegeben: ${roleMentions(granted)}`);
  if (revoked.length) parts.push(`Entfernt: ${roleMentions(revoked)}`);
  if (kept.length) parts.push(`Behalten (nicht entfernbar): ${roleMentions(kept)}`);
  return { ok: true, message: parts.length ? parts.join("\n") : "Keine Änderungen." };
}

// --- Reaction event handlers ---------------------------------------------------

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
  if (!panel || panel.selectionType !== SelectionType.Reactions || !panel.sent) return;

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

    if (!isAllowedToUsePanel(member, panel)) {
      if (canRemoveReactionsIn(message)) await reaction.users.remove(user.id).catch(() => undefined);
      return;
    }

    await applyMappingSelection(guild, member, panel, mapping, { flip: panel.removeReaction, message });

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
  // removeReaction panels never expect a persisted reaction to remove — the
  // bot already stripped it as part of handling the add.
  if (!panel || panel.selectionType !== SelectionType.Reactions || panel.removeReaction || !panel.sent) return;

  const mapping = panel.mappings.find((m) => (m.emojiId ?? m.emojiName) === emojiKey);
  if (!mapping) return;

  const guild = message.guild;
  if (!guild) return;

  await runSerialized(message.id, user.id, async () => {
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    if (!isAllowedToUsePanel(member, panel)) return;
    await revokeMappingSelection(guild, member, panel, mapping);
  });
}

// --- Button / dropdown interaction handlers ---------------------------------

const COMPONENT_ID_PREFIX = "rr";

function buttonCustomId(panelId: number, mappingId: number): string {
  return `${COMPONENT_ID_PREFIX}:${panelId}:${mappingId}`;
}

function dropdownCustomId(panelId: number): string {
  return `${COMPONENT_ID_PREFIX}:${panelId}`;
}

export async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  if (parts[0] !== COMPONENT_ID_PREFIX) return;
  const panelId = Number(parts[1]);
  const mappingId = Number(parts[2]);

  const panel = getCachedPanel(interaction.message.id);
  if (!panel || panel.id !== panelId || !panel.sent) {
    await interaction.reply({ content: "Dieser Button ist nicht mehr aktiv.", flags: MessageFlags.Ephemeral });
    return;
  }
  const mapping = panel.mappings.find((m) => m.id === mappingId);
  if (!mapping) {
    await interaction.reply({ content: "Diese Option existiert nicht mehr.", flags: MessageFlags.Ephemeral });
    return;
  }

  const guild = interaction.guild;
  if (!guild) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await runSerialized(interaction.message.id, interaction.user.id, async () => {
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return interaction.editReply({ content: "Deine Mitgliedschaft auf diesem Server konnte nicht gefunden werden." });

    if (!isAllowedToUsePanel(member, panel)) {
      return interaction.editReply({ content: "Du hast keine Berechtigung, dies zu verwenden." });
    }

    const result = await applyMappingSelection(guild, member, panel, mapping, { flip: true });
    await interaction.editReply({ content: result.message }).catch(() => undefined);
  });
}

export async function handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  if (parts[0] !== COMPONENT_ID_PREFIX) return;
  const panelId = Number(parts[1]);

  const panel = getCachedPanel(interaction.message.id);
  if (!panel || panel.id !== panelId || !panel.sent) {
    await interaction.reply({ content: "Dieses Menü ist nicht mehr aktiv.", flags: MessageFlags.Ephemeral });
    return;
  }

  const guild = interaction.guild;
  if (!guild) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await runSerialized(interaction.message.id, interaction.user.id, async () => {
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return interaction.editReply({ content: "Deine Mitgliedschaft auf diesem Server konnte nicht gefunden werden." });

    if (!isAllowedToUsePanel(member, panel)) {
      return interaction.editReply({ content: "Du hast keine Berechtigung, dies zu verwenden." });
    }

    const selectedMappingIds = interaction.values.map(Number);
    const result = await applyDropdownSelection(guild, member, panel, selectedMappingIds);
    await interaction.editReply({ content: result.message }).catch(() => undefined);
  });
}

// --- Building the panel message ---------------------------------------------

function emojiDisplay(mapping: ReactionRoleMapping): string {
  if (mapping.emojiId) return `<:${mapping.emojiName}:${mapping.emojiId}>`;
  return mapping.emojiName ?? "";
}

function roleLabel(mapping: ReactionRoleMapping, guild: Guild): string {
  if (mapping.label) return mapping.label;
  return mapping.roleIds.map((id) => guild.roles.cache.get(id)?.name ?? "Unbekannte Rolle").join(", ");
}

/**
 * Applies the global font (`settings.fontMap`) if this panel opted into it —
 * safe to call on a fully-composed string (role mentions, emoji, and all),
 * since `applyFont` only ever substitutes plain Latin letters. See
 * utils/font.ts.
 */
function styled(panel: ReactionRolePanelWithMappings, text: string): string {
  return panel.useFont ? applyFont(text, getSettings().fontMap) : text;
}

function buildPanelEmbed(panel: ReactionRolePanelWithMappings): EmbedBuilder {
  const lines = [...panel.mappings]
    .sort((a, b) => a.position - b.position)
    .map((m) => {
      const emoji = emojiDisplay(m);
      return `${emoji ? `${emoji} — ` : ""}${roleMentions(m.roleIds)}${m.label ? ` — ${m.label}` : ""}`;
    });
  const description = [panel.description, lines.join("\n")].filter(Boolean).join("\n\n");
  return createEmbed({
    title: styled(panel, panel.title ?? panel.name),
    description: styled(panel, description || "Noch keine Rollen konfiguriert."),
    color: EmbedColor.Info,
  });
}

/** Plain-text equivalent of {@link buildPanelEmbed} — no title concept outside an embed. */
function buildPanelText(panel: ReactionRolePanelWithMappings): string {
  // Buttons/dropdown are self-describing (each option carries its own
  // label), so the option list is only spelled out in the message body for
  // reactions, where the emoji-to-role mapping isn't otherwise visible.
  const lines =
    panel.selectionType === SelectionType.Reactions
      ? [...panel.mappings]
          .sort((a, b) => a.position - b.position)
          .map((m) => {
            const emoji = emojiDisplay(m);
            return `${emoji ? `${emoji} — ` : ""}${roleMentions(m.roleIds)}${m.label ? ` — ${m.label}` : ""}`;
          })
      : [];
  return styled(panel, [panel.description, lines.join("\n")].filter(Boolean).join("\n\n") || "Reagiere, um eine Rolle zu erhalten!");
}

/** Always returns both fields explicitly (never partial) so editing a message that's switching type fully replaces the old content instead of Discord leaving stale fields in place. */
function buildPanelContent(panel: ReactionRolePanelWithMappings): { content: string | null; embeds: EmbedBuilder[] } {
  if (panel.messageType === PanelMessageType.Text) {
    return { content: buildPanelText(panel), embeds: [] };
  }
  return { content: null, embeds: [buildPanelEmbed(panel)] };
}

function buildButtonRows(panel: ReactionRolePanelWithMappings, guild: Guild): ActionRowBuilder<ButtonBuilder>[] {
  const sorted = [...panel.mappings].sort((a, b) => a.position - b.position).slice(0, MAX_BUTTONS_PER_PANEL);
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < sorted.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const mapping of sorted.slice(i, i + 5)) {
      const button = new ButtonBuilder()
        .setCustomId(buttonCustomId(panel.id, mapping.id))
        .setStyle(ButtonStyle.Secondary)
        .setLabel(styled(panel, roleLabel(mapping, guild)));
      if (mapping.emojiId) {
        button.setEmoji({ id: mapping.emojiId, name: mapping.emojiName ?? undefined });
      } else if (mapping.emojiName) {
        button.setEmoji(mapping.emojiName);
      }
      row.addComponents(button);
    }
    rows.push(row);
  }
  return rows;
}

function buildDropdownRow(
  panel: ReactionRolePanelWithMappings,
  guild: Guild,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const sorted = [...panel.mappings].sort((a, b) => a.position - b.position).slice(0, MAX_DROPDOWN_OPTIONS_PER_PANEL);
  if (sorted.length === 0) return [];

  const menu = new StringSelectMenuBuilder()
    .setCustomId(dropdownCustomId(panel.id))
    .setPlaceholder(panel.allowMultiple ? "Wähle deine Rollen…" : "Wähle eine Rolle…")
    .setMinValues(0)
    .setMaxValues(panel.allowMultiple ? sorted.length : 1);

  for (const mapping of sorted) {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(styled(panel, roleLabel(mapping, guild)))
      .setValue(String(mapping.id));
    if (mapping.emojiId) {
      option.setEmoji({ id: mapping.emojiId, name: mapping.emojiName ?? undefined });
    } else if (mapping.emojiName) {
      option.setEmoji(mapping.emojiName);
    }
    menu.addOptions(option);
  }

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}

function buildComponents(
  panel: ReactionRolePanelWithMappings,
  guild: Guild,
): (ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>)[] {
  switch (panel.selectionType) {
    case SelectionType.Buttons:
      return buildButtonRows(panel, guild);
    case SelectionType.Dropdown:
      return buildDropdownRow(panel, guild);
    case SelectionType.Reactions:
      return [];
  }
}

async function reconcilePanelReactions(message: Message, panel: ReactionRolePanelWithMappings): Promise<void> {
  const desired = [...panel.mappings].sort((a, b) => a.position - b.position);
  const desiredKeys = new Set(desired.map((m) => m.emojiId ?? m.emojiName).filter((k): k is string => !!k));

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
    if (!key) continue;
    const already = message.reactions.cache.find((r) => r.me && (r.emoji.id ?? r.emoji.name) === key);
    if (already) continue;
    const identifier = mapping.emojiId ? `${mapping.emojiName}:${mapping.emojiId}` : key;
    await message.react(identifier).catch((err) =>
      logger.warn(`Failed to add panel reaction ${identifier}: ${errorMessage(err)}`),
    );
  }
}

/**
 * Posts the panel (first sync) or edits it in place, then reconciles its
 * seed reactions (reactions selection type only — buttons/dropdown are
 * static components, nothing to reconcile per-user). For an unmanaged panel
 * (attached to a pre-existing message) the message content is never
 * touched — it's someone else's message, not ours to overwrite.
 */
export async function syncPanelMessage(client: Client, panelId: number): Promise<void> {
  const panel = getPanel(panelId);
  if (!panel) throw new Error(`Reaction role panel ${panelId} not found`);

  const channel = await client.channels.fetch(panel.channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    throw new Error(`Channel ${panel.channelId} is not a usable guild text channel`);
  }

  let message: Message | null = null;

  if (!panel.managed) {
    if (!panel.messageId) throw new Error(`Panel ${panel.id} is unmanaged but has no attached message id`);
    message = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (!message) {
      throw new Error(
        `Attached message ${panel.messageId} not found in channel ${panel.channelId} (deleted, or the panel's channel was changed after attaching).`,
      );
    }
  } else {
    const body = buildPanelContent(panel);
    const components = buildComponents(panel, channel.guild);

    if (panel.messageId) {
      message = await channel.messages.fetch(panel.messageId).catch(() => null);
      // edit() accepts `content: null` to explicitly clear stale text when
      // switching message types; send() (below) does not, hence the split.
      if (message) message = await message.edit({ ...body, components });
    }
    if (!message) {
      message = await channel.send({ ...body, content: body.content ?? undefined, components });
      setPanelMessageId(panel.id, message.id);
    }
  }

  if (panel.selectionType === SelectionType.Reactions) {
    await reconcilePanelReactions(message, panel);
  }
}

/** Re-syncs every *sent* panel — draft panels stay untouched until explicitly sent. */
export async function syncAllPanels(client: Client): Promise<void> {
  for (const panel of listPanels()) {
    if (!panel.sent) continue;
    try {
      await syncPanelMessage(client, panel.id);
    } catch (err) {
      logger.error(`Failed to sync reaction-role panel ${panel.id}: ${errorMessage(err)}`);
    }
  }
}
