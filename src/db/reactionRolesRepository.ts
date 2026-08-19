import { db } from "./index.js";
import { settingsBus, SettingsEvent } from "../services/settingsBus.js";
import { PanelMessageType, SelectionType } from "../constants.js";
import type { ReactionRoleMapping, ReactionRolePanel, ReactionRolePanelWithMappings } from "../types.js";

interface PanelRow {
  id: number;
  channel_id: string;
  message_id: string | null;
  managed: 0 | 1;
  selection_type: string;
  message_type: string;
  remove_reaction: 0 | 1;
  allow_multiple: 0 | 1;
  removable: 0 | 1;
  allowed_role_ids: string | null;
  sent: 0 | 1;
  title: string | null;
  description: string | null;
  created_at: string;
}

interface MappingRow {
  id: number;
  panel_id: number;
  /** Null for a buttons/dropdown mapping with no emoji — reactions always have one (there's no reacting without an emoji). */
  emoji_name: string | null;
  emoji_id: string | null;
  role_id: string;
  label: string | null;
  position: number;
}

function rowToPanel(row: PanelRow): ReactionRolePanel {
  return {
    id: row.id,
    channelId: row.channel_id,
    messageId: row.message_id,
    managed: row.managed === 1,
    selectionType: row.selection_type as SelectionType,
    messageType: row.message_type as PanelMessageType,
    removeReaction: row.remove_reaction === 1,
    allowMultiple: row.allow_multiple === 1,
    removable: row.removable === 1,
    allowedRoleIds: row.allowed_role_ids ? (JSON.parse(row.allowed_role_ids) as string[]) : null,
    sent: row.sent === 1,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
  };
}

function rowToMapping(row: MappingRow): ReactionRoleMapping {
  return {
    id: row.id,
    panelId: row.panel_id,
    emojiName: row.emoji_name,
    emojiId: row.emoji_id,
    roleId: row.role_id,
    label: row.label,
    position: row.position,
  };
}

const PANEL_COLUMNS = `id, channel_id, message_id, managed, selection_type, message_type, remove_reaction,
  allow_multiple, removable, allowed_role_ids, sent, title, description, created_at`;
const MAPPING_COLUMNS = "id, panel_id, emoji_name, emoji_id, role_id, label, position";

const selectAllPanelsStmt = db.prepare<[], PanelRow>(
  `SELECT ${PANEL_COLUMNS} FROM reaction_role_panels ORDER BY id`,
);
const selectPanelByIdStmt = db.prepare<[number], PanelRow>(
  `SELECT ${PANEL_COLUMNS} FROM reaction_role_panels WHERE id = ?`,
);
const selectPanelByMessageIdStmt = db.prepare<[string], PanelRow>(
  `SELECT ${PANEL_COLUMNS} FROM reaction_role_panels WHERE message_id = ?`,
);
const insertPanelStmt = db.prepare<{
  channelId: string;
  messageId: string | null;
  managed: 0 | 1;
  selectionType: string;
  messageType: string;
  removeReaction: 0 | 1;
  allowMultiple: 0 | 1;
  removable: 0 | 1;
  allowedRoleIds: string | null;
  title: string | null;
  description: string | null;
  createdAt: string;
}>(
  `INSERT INTO reaction_role_panels
     (channel_id, message_id, managed, selection_type, message_type, remove_reaction,
      allow_multiple, removable, allowed_role_ids, title, description, created_at)
   VALUES
     (@channelId, @messageId, @managed, @selectionType, @messageType, @removeReaction,
      @allowMultiple, @removable, @allowedRoleIds, @title, @description, @createdAt)`,
);
const updatePanelStmt = db.prepare<{
  id: number;
  channelId: string;
  messageType: string;
  removeReaction: 0 | 1;
  allowMultiple: 0 | 1;
  removable: 0 | 1;
  allowedRoleIds: string | null;
  title: string | null;
  description: string | null;
}>(
  `UPDATE reaction_role_panels SET
     channel_id = @channelId, message_type = @messageType, remove_reaction = @removeReaction,
     allow_multiple = @allowMultiple, removable = @removable, allowed_role_ids = @allowedRoleIds,
     title = @title, description = @description
   WHERE id = @id`,
);
const setPanelMessageIdStmt = db.prepare<{ id: number; messageId: string | null }>(
  "UPDATE reaction_role_panels SET message_id = @messageId WHERE id = @id",
);
const setPanelSentStmt = db.prepare<{ id: number; sent: 0 | 1 }>(
  "UPDATE reaction_role_panels SET sent = @sent WHERE id = @id",
);
const deletePanelStmt = db.prepare<[number]>("DELETE FROM reaction_role_panels WHERE id = ?");

const selectMappingsByPanelStmt = db.prepare<[number], MappingRow>(
  `SELECT ${MAPPING_COLUMNS} FROM reaction_role_mappings WHERE panel_id = ? ORDER BY position, id`,
);
const selectMappingByIdStmt = db.prepare<[number], MappingRow>(
  `SELECT ${MAPPING_COLUMNS} FROM reaction_role_mappings WHERE id = ?`,
);
const insertMappingStmt = db.prepare<{
  panelId: number;
  emojiName: string | null;
  emojiId: string | null;
  roleId: string;
  label: string | null;
  position: number;
}>(
  `INSERT INTO reaction_role_mappings (panel_id, emoji_name, emoji_id, role_id, label, position)
   VALUES (@panelId, @emojiName, @emojiId, @roleId, @label, @position)`,
);
const updateMappingStmt = db.prepare<{
  id: number;
  emojiName: string | null;
  emojiId: string | null;
  roleId: string;
  label: string | null;
  position: number;
}>(
  `UPDATE reaction_role_mappings SET
     emoji_name = @emojiName, emoji_id = @emojiId, role_id = @roleId, label = @label, position = @position
   WHERE id = @id`,
);
const deleteMappingStmt = db.prepare<[number]>("DELETE FROM reaction_role_mappings WHERE id = ?");
const reorderMappingStmt = db.prepare<{ id: number; position: number }>(
  "UPDATE reaction_role_mappings SET position = @position WHERE id = @id",
);

function withMappings(panel: ReactionRolePanel): ReactionRolePanelWithMappings {
  return { ...panel, mappings: selectMappingsByPanelStmt.all(panel.id).map(rowToMapping) };
}

export function listPanels(): ReactionRolePanelWithMappings[] {
  return selectAllPanelsStmt.all().map(rowToPanel).map(withMappings);
}

export function getPanel(id: number): ReactionRolePanelWithMappings | null {
  const row = selectPanelByIdStmt.get(id);
  return row ? withMappings(rowToPanel(row)) : null;
}

export function getPanelByMessageId(messageId: string): ReactionRolePanelWithMappings | null {
  const row = selectPanelByMessageIdStmt.get(messageId);
  return row ? withMappings(rowToPanel(row)) : null;
}

export interface CreatePanelInput {
  channelId: string;
  selectionType: SelectionType;
  messageType: PanelMessageType;
  removeReaction: boolean;
  allowMultiple: boolean;
  removable: boolean;
  allowedRoleIds: string[] | null;
  title: string | null;
  description: string | null;
  /**
   * When set, the panel attaches to this pre-existing message (e.g. a rules
   * post an admin already wrote) instead of the bot posting/managing its
   * own — see docs/REACTION_ROLES.md#attaching-to-an-existing-message.
   * Only valid with `selectionType: Reactions` (buttons/dropdowns require a
   * bot-owned message to attach components to) — callers must enforce that,
   * the repository doesn't re-validate it.
   * Immutable after creation: there's no "convert an existing panel" path,
   * only "create it this way from the start".
   */
  existingMessageId?: string | null;
}

export function createPanel(input: CreatePanelInput): ReactionRolePanel {
  const existingMessageId = input.existingMessageId ?? null;
  const info = insertPanelStmt.run({
    channelId: input.channelId,
    messageId: existingMessageId,
    managed: existingMessageId ? 0 : 1,
    selectionType: input.selectionType,
    messageType: input.messageType,
    removeReaction: input.removeReaction ? 1 : 0,
    allowMultiple: input.allowMultiple ? 1 : 0,
    removable: input.removable ? 1 : 0,
    allowedRoleIds: input.allowedRoleIds && input.allowedRoleIds.length ? JSON.stringify(input.allowedRoleIds) : null,
    // Never rendered for an unmanaged panel (the message content is the
    // admin's, untouched by us), so there's nothing meaningful to store.
    title: existingMessageId ? null : input.title,
    description: existingMessageId ? null : input.description,
    createdAt: new Date().toISOString(),
  });
  settingsBus.emit(SettingsEvent.ReactionRoles);
  return rowToPanel(selectPanelByIdStmt.get(Number(info.lastInsertRowid))!);
}

export interface UpdatePanelInput {
  channelId: string;
  messageType: PanelMessageType;
  removeReaction: boolean;
  allowMultiple: boolean;
  removable: boolean;
  allowedRoleIds: string[] | null;
  title: string | null;
  description: string | null;
}

/** `selectionType`/`managed`/the attached message id are immutable — only set at creation. */
export function updatePanel(id: number, input: UpdatePanelInput): ReactionRolePanel {
  const current = selectPanelByIdStmt.get(id);
  const isManaged = current ? current.managed === 1 : true;
  updatePanelStmt.run({
    id,
    channelId: input.channelId,
    messageType: input.messageType,
    removeReaction: input.removeReaction ? 1 : 0,
    allowMultiple: input.allowMultiple ? 1 : 0,
    removable: input.removable ? 1 : 0,
    allowedRoleIds: input.allowedRoleIds && input.allowedRoleIds.length ? JSON.stringify(input.allowedRoleIds) : null,
    title: isManaged ? input.title : null,
    description: isManaged ? input.description : null,
  });
  settingsBus.emit(SettingsEvent.ReactionRoles);
  return rowToPanel(selectPanelByIdStmt.get(id)!);
}

export function setPanelMessageId(id: number, messageId: string | null): void {
  setPanelMessageIdStmt.run({ id, messageId });
  settingsBus.emit(SettingsEvent.ReactionRoles);
}

/** Flips a draft panel to "sent" (or back, though nothing currently does that) — see docs/REACTION_ROLES.md#draft-then-send. */
export function setPanelSent(id: number, sent: boolean): void {
  setPanelSentStmt.run({ id, sent: sent ? 1 : 0 });
  settingsBus.emit(SettingsEvent.ReactionRoles);
}

/** Cascades to the panel's mappings via the FK's ON DELETE CASCADE. */
export function deletePanel(id: number): void {
  deletePanelStmt.run(id);
  settingsBus.emit(SettingsEvent.ReactionRoles);
}

export function listMappings(panelId: number): ReactionRoleMapping[] {
  return selectMappingsByPanelStmt.all(panelId).map(rowToMapping);
}

export interface UpsertMappingInput {
  id?: number;
  panelId: number;
  emojiName: string | null;
  emojiId: string | null;
  roleId: string;
  label: string | null;
  position: number;
}

export function upsertMapping(input: UpsertMappingInput): ReactionRoleMapping {
  let mapping: ReactionRoleMapping;
  if (input.id !== undefined) {
    updateMappingStmt.run({
      id: input.id,
      emojiName: input.emojiName,
      emojiId: input.emojiId,
      roleId: input.roleId,
      label: input.label,
      position: input.position,
    });
    mapping = rowToMapping(selectMappingByIdStmt.get(input.id)!);
  } else {
    const info = insertMappingStmt.run({
      panelId: input.panelId,
      emojiName: input.emojiName,
      emojiId: input.emojiId,
      roleId: input.roleId,
      label: input.label,
      position: input.position,
    });
    mapping = rowToMapping(selectMappingByIdStmt.get(Number(info.lastInsertRowid))!);
  }
  settingsBus.emit(SettingsEvent.ReactionRoles);
  return mapping;
}

export function deleteMapping(id: number): void {
  deleteMappingStmt.run(id);
  settingsBus.emit(SettingsEvent.ReactionRoles);
}

/** Persists a full reordering — `orderedIds` is the mapping ids in their new display order. */
export const reorderMappings = db.transaction((orderedIds: number[]) => {
  orderedIds.forEach((id, index) => reorderMappingStmt.run({ id, position: index }));
  settingsBus.emit(SettingsEvent.ReactionRoles);
});
