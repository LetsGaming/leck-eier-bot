import { db } from "./index.js";
import type { EventTemplate } from "../types.js";

interface EventTemplateRow {
  id: number;
  name: string;
  default_title: string;
  base_description: string;
  default_channel_id: string | null;
  default_mention_role_id: string | null;
  default_voice_channel_id: string | null;
  default_weekday: number | null;
  default_start_time: string | null;
  default_end_time: string | null;
  use_font: 0 | 1;
  created_at: string;
  updated_at: string;
}

function rowToTemplate(row: EventTemplateRow): EventTemplate {
  return {
    id: row.id,
    name: row.name,
    defaultTitle: row.default_title,
    baseDescription: row.base_description,
    defaultChannelId: row.default_channel_id,
    defaultMentionRoleId: row.default_mention_role_id,
    defaultVoiceChannelId: row.default_voice_channel_id,
    defaultWeekday: row.default_weekday,
    defaultStartTime: row.default_start_time,
    defaultEndTime: row.default_end_time,
    useFont: row.use_font === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = `id, name, default_title, base_description, default_channel_id, default_mention_role_id,
  default_voice_channel_id, default_weekday, default_start_time, default_end_time, use_font, created_at, updated_at`;

const selectAllStmt = db.prepare<[], EventTemplateRow>(`SELECT ${COLUMNS} FROM event_templates ORDER BY name COLLATE NOCASE`);
const selectByIdStmt = db.prepare<[number], EventTemplateRow>(`SELECT ${COLUMNS} FROM event_templates WHERE id = ?`);
const selectByNameStmt = db.prepare<[string], EventTemplateRow>(`SELECT ${COLUMNS} FROM event_templates WHERE name = ? COLLATE NOCASE`);

interface EventTemplateRowInput {
  name: string;
  defaultTitle: string;
  baseDescription: string;
  defaultChannelId: string | null;
  defaultMentionRoleId: string | null;
  defaultVoiceChannelId: string | null;
  defaultWeekday: number | null;
  defaultStartTime: string | null;
  defaultEndTime: string | null;
  useFont: 0 | 1;
}

const insertStmt = db.prepare<EventTemplateRowInput & { createdAt: string; updatedAt: string }>(
  `INSERT INTO event_templates
     (name, default_title, base_description, default_channel_id, default_mention_role_id, default_voice_channel_id,
      default_weekday, default_start_time, default_end_time, use_font, created_at, updated_at)
   VALUES (@name, @defaultTitle, @baseDescription, @defaultChannelId, @defaultMentionRoleId, @defaultVoiceChannelId,
      @defaultWeekday, @defaultStartTime, @defaultEndTime, @useFont, @createdAt, @updatedAt)`,
);
const updateStmt = db.prepare<EventTemplateRowInput & { id: number; updatedAt: string }>(
  `UPDATE event_templates SET
     name = @name, default_title = @defaultTitle, base_description = @baseDescription,
     default_channel_id = @defaultChannelId, default_mention_role_id = @defaultMentionRoleId,
     default_voice_channel_id = @defaultVoiceChannelId, default_weekday = @defaultWeekday,
     default_start_time = @defaultStartTime, default_end_time = @defaultEndTime, use_font = @useFont,
     updated_at = @updatedAt
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
  defaultTitle: string;
  baseDescription: string;
  defaultChannelId: string | null;
  defaultMentionRoleId: string | null;
  defaultVoiceChannelId: string | null;
  defaultWeekday: number | null;
  defaultStartTime: string | null;
  defaultEndTime: string | null;
  useFont: boolean;
}

function toRowInput(input: EventTemplateInput): EventTemplateRowInput {
  return { ...input, useFont: input.useFont ? 1 : 0 };
}

export function createEventTemplate(input: EventTemplateInput): EventTemplate {
  const now = new Date().toISOString();
  const info = insertStmt.run({ ...toRowInput(input), createdAt: now, updatedAt: now });
  return getEventTemplateById(Number(info.lastInsertRowid))!;
}

export function updateEventTemplate(id: number, input: EventTemplateInput): EventTemplate {
  updateStmt.run({ id, ...toRowInput(input), updatedAt: new Date().toISOString() });
  return getEventTemplateById(id)!;
}

export function deleteEventTemplate(id: number): void {
  deleteStmt.run(id);
}
