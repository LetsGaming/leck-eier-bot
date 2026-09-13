import { db } from "./index.js";
import type { EventTemplate } from "../types.js";

interface EventTemplateRow {
  id: number;
  name: string;
  title_template: string;
  description_template: string;
  default_channel_id: string | null;
  default_mention_role_id: string | null;
  default_voice_channel_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTemplate(row: EventTemplateRow): EventTemplate {
  return {
    id: row.id,
    name: row.name,
    titleTemplate: row.title_template,
    descriptionTemplate: row.description_template,
    defaultChannelId: row.default_channel_id,
    defaultMentionRoleId: row.default_mention_role_id,
    defaultVoiceChannelId: row.default_voice_channel_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = `id, name, title_template, description_template, default_channel_id, default_mention_role_id,
  default_voice_channel_id, created_at, updated_at`;

const selectAllStmt = db.prepare<[], EventTemplateRow>(`SELECT ${COLUMNS} FROM event_templates ORDER BY name COLLATE NOCASE`);
const selectByIdStmt = db.prepare<[number], EventTemplateRow>(`SELECT ${COLUMNS} FROM event_templates WHERE id = ?`);
const selectByNameStmt = db.prepare<[string], EventTemplateRow>(`SELECT ${COLUMNS} FROM event_templates WHERE name = ? COLLATE NOCASE`);

const insertStmt = db.prepare<{
  name: string;
  titleTemplate: string;
  descriptionTemplate: string;
  defaultChannelId: string | null;
  defaultMentionRoleId: string | null;
  defaultVoiceChannelId: string | null;
  createdAt: string;
  updatedAt: string;
}>(
  `INSERT INTO event_templates
     (name, title_template, description_template, default_channel_id, default_mention_role_id, default_voice_channel_id, created_at, updated_at)
   VALUES (@name, @titleTemplate, @descriptionTemplate, @defaultChannelId, @defaultMentionRoleId, @defaultVoiceChannelId, @createdAt, @updatedAt)`,
);
const updateStmt = db.prepare<{
  id: number;
  name: string;
  titleTemplate: string;
  descriptionTemplate: string;
  defaultChannelId: string | null;
  defaultMentionRoleId: string | null;
  defaultVoiceChannelId: string | null;
  updatedAt: string;
}>(
  `UPDATE event_templates SET
     name = @name, title_template = @titleTemplate, description_template = @descriptionTemplate,
     default_channel_id = @defaultChannelId, default_mention_role_id = @defaultMentionRoleId,
     default_voice_channel_id = @defaultVoiceChannelId, updated_at = @updatedAt
   WHERE id = @id`,
);
const deleteStmt = db.prepare<[number]>("DELETE FROM event_templates WHERE id = ?");

export function listEventTemplates(): EventTemplate[] {
  return selectAllStmt.all().map(rowToTemplate);
}

export function getEventTemplateById(id: number): EventTemplate | null {
  const row = selectByIdStmt.get(id);
  return row ? rowToTemplate(row) : null;
}

export function getEventTemplateByName(name: string): EventTemplate | null {
  const row = selectByNameStmt.get(name);
  return row ? rowToTemplate(row) : null;
}

export interface EventTemplateInput {
  name: string;
  titleTemplate: string;
  descriptionTemplate: string;
  defaultChannelId: string | null;
  defaultMentionRoleId: string | null;
  defaultVoiceChannelId: string | null;
}

export function createEventTemplate(input: EventTemplateInput): EventTemplate {
  const now = new Date().toISOString();
  const info = insertStmt.run({ ...input, createdAt: now, updatedAt: now });
  return getEventTemplateById(Number(info.lastInsertRowid))!;
}

export function updateEventTemplate(id: number, input: EventTemplateInput): EventTemplate {
  updateStmt.run({ id, ...input, updatedAt: new Date().toISOString() });
  return getEventTemplateById(id)!;
}

export function deleteEventTemplate(id: number): void {
  deleteStmt.run(id);
}
