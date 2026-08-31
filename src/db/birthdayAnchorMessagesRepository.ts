import { db } from "./index.js";

/** One chunk of the bot-managed anchor chain — the Discord message it lives in, and which content keys (month numbers as strings, plus the literal `"intro"`) it currently renders. See `paginateAnchorParts()` in services/birthdays.ts for how these are assigned. */
export interface AnchorMessageChunk {
  messageId: string;
  months: string[];
}

interface AnchorMessageRow {
  message_id: string;
  months: string;
}

const selectAllStmt = db.prepare<[], AnchorMessageRow>(
  "SELECT message_id, months FROM birthday_anchor_messages ORDER BY position",
);
const deleteAllStmt = db.prepare("DELETE FROM birthday_anchor_messages");
const insertStmt = db.prepare<{ position: number; messageId: string; months: string }>(
  "INSERT INTO birthday_anchor_messages (position, message_id, months) VALUES (@position, @messageId, @months)",
);

function rowToChunk(row: AnchorMessageRow): AnchorMessageChunk {
  return { messageId: row.message_id, months: row.months ? row.months.split(",") : [] };
}

/** Ordered oldest-chunk-first — position 0 is the first message in the anchor chain. */
export function getAnchorMessageChunks(): AnchorMessageChunk[] {
  return selectAllStmt.all().map(rowToChunk);
}

/** Replaces the whole chain — called once per `syncAnchorMessage()` run with its final result. */
export function setAnchorMessageChunks(chunks: AnchorMessageChunk[]): void {
  db.transaction(() => {
    deleteAllStmt.run();
    chunks.forEach(({ messageId, months }, position) =>
      insertStmt.run({ position, messageId, months: months.join(",") }),
    );
  })();
}
