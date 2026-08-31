import { db } from "./index.js";

const selectAllStmt = db.prepare<[], { message_id: string }>(
  "SELECT message_id FROM birthday_anchor_messages ORDER BY position",
);
const deleteAllStmt = db.prepare("DELETE FROM birthday_anchor_messages");
const insertStmt = db.prepare<{ position: number; messageId: string }>(
  "INSERT INTO birthday_anchor_messages (position, message_id) VALUES (@position, @messageId)",
);

/** Ordered oldest-chunk-first — position 0 is the first message in the anchor chain. */
export function getAnchorMessageIds(): string[] {
  return selectAllStmt.all().map((row) => row.message_id);
}

/** Replaces the whole chain — called once per `syncAnchorMessage()` run with its final result. */
export function setAnchorMessageIds(ids: string[]): void {
  db.transaction(() => {
    deleteAllStmt.run();
    ids.forEach((messageId, position) => insertStmt.run({ position, messageId }));
  })();
}
