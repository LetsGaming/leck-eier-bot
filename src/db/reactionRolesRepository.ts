import { db } from "./index.js";
import { settingsBus, SettingsEvent } from "../services/settingsBus.js";
import { ReactionRoleMode } from "../constants.js";
import type { ReactionRoleMapping, ReactionRolePanel, ReactionRolePanelWithMappings } from "../types.js";

interface PanelRow {
  id: number;
  channel_id: string;
  message_id: string | null;
  managed: 0 | 1;
  mode: string;
  remove_reaction: 0 | 1;
  title: string | null;
  description: string | null;
  created_at: string;
}

interface MappingRow {
  id: number;
  panel_id: number;
  emoji_name: string;
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
    mode: row.mode as ReactionRoleMode,
    removeReaction: row.remove_reaction === 1,
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

const PANEL_COLUMNS =
  "id, channel_id, message_id, managed, mode, remove_reaction, title, description, created_at";
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
  mode: string;
  removeReaction: 0 | 1;
  title: string | null;
  description: string | null;
  createdAt: string;
}>(
  `INSERT INTO reaction_role_panels (channel_id, mode, remove_reaction, title, description, created_at)
   VALUES (@channelId, @mode, @removeReaction, @title, @description, @createdAt)`,
);
const updatePanelStmt = db.prepare<{
  id: number;
  channelId: string;
  mode: string;
  removeReaction: 0 | 1;
  title: string | null;
  description: string | null;
}>(
  `UPDATE reaction_role_panels SET
     channel_id = @channelId, mode = @mode, remove_reaction = @removeReaction,
     title = @title, description = @description
   WHERE id = @id`,
);
const setPanelMessageIdStmt = db.prepare<{ id: number; messageId: string | null }>(
  "UPDATE reaction_role_panels SET message_id = @messageId WHERE id = @id",
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
  emojiName: string;
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
  emojiName: string;
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
  mode: ReactionRoleMode;
  removeReaction: boolean;
  title: string | null;
  description: string | null;
}

export function createPanel(input: CreatePanelInput): ReactionRolePanel {
  const info = insertPanelStmt.run({
    channelId: input.channelId,
    mode: input.mode,
    removeReaction: input.removeReaction ? 1 : 0,
    title: input.title,
    description: input.description,
    createdAt: new Date().toISOString(),
  });
  settingsBus.emit(SettingsEvent.ReactionRoles);
  return rowToPanel(selectPanelByIdStmt.get(Number(info.lastInsertRowid))!);
}

export type UpdatePanelInput = CreatePanelInput;

export function updatePanel(id: number, input: UpdatePanelInput): ReactionRolePanel {
  updatePanelStmt.run({
    id,
    channelId: input.channelId,
    mode: input.mode,
    removeReaction: input.removeReaction ? 1 : 0,
    title: input.title,
    description: input.description,
  });
  settingsBus.emit(SettingsEvent.ReactionRoles);
  return rowToPanel(selectPanelByIdStmt.get(id)!);
}

export function setPanelMessageId(id: number, messageId: string | null): void {
  setPanelMessageIdStmt.run({ id, messageId });
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
  emojiName: string;
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
