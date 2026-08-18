import { db } from "./index.js";
import type { Settings } from "../types.js";

interface SettingsRow {
  birthday_template: string;
  first_birthday_message_id: string | null;
}

function rowToSettings(row: SettingsRow): Settings {
  return {
    birthdayTemplate: row.birthday_template,
    firstBirthdayMessageId: row.first_birthday_message_id,
  };
}

const selectStmt = db.prepare<[], SettingsRow>(
  "SELECT birthday_template, first_birthday_message_id FROM settings WHERE id = 1",
);
const updateStmt = db.prepare<{
  birthdayTemplate: string;
  firstBirthdayMessageId: string | null;
}>(
  "UPDATE settings SET birthday_template = @birthdayTemplate, first_birthday_message_id = @firstBirthdayMessageId WHERE id = 1",
);

/** The settings row is seeded on startup (see src/db/index.ts), so this is always present. */
export function getSettings(): Settings {
  return rowToSettings(selectStmt.get()!);
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const current = getSettings();
  const next: Settings = { ...current, ...patch };
  updateStmt.run(next);
  return next;
}
