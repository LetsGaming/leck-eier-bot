import { z } from "zod";
import { db } from "./index.js";
import logger from "../utils/logger.js";

/** Retries left before a scheduled publish is given up on for good — see `markPublishFailed`. */
export const MAX_ATTEMPTS = 3;

/**
 * Single source of truth for a publish payload's shape — validates the JSON
 * stored here, and is re-exported by `services/events.ts` as
 * `PublishEventInputSchema` so the API route and slash command validate
 * identically. Defined here rather than in the services layer to avoid a
 * db↔services circular import (this repository needs it to parse stored
 * JSON at load time).
 */
export const PublishEventInputSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  channelId: z.string().min(1),
  mentionRoleId: z.string().nullable(),
  voiceChannelId: z.string().nullable(),
  useFont: z.boolean(),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
});

export type PublishEventInput = z.infer<typeof PublishEventInputSchema>;

interface ScheduledPublishRow {
  id: number;
  publish_at: string;
  payload: string;
  published_event_id: number | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduledEventPublish {
  id: number;
  /** ISO UTC — when this should be posted. */
  publishAt: string;
  payload: PublishEventInput;
  /** Set once posted; null while still pending. */
  publishedEventId: number | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A stored payload that no longer parses (e.g. after a schema change) surfaces as a failed entry instead of throwing the sweep or a list request. */
function rowToScheduledPublish(row: ScheduledPublishRow): ScheduledEventPublish {
  const parsed = PublishEventInputSchema.safeParse(JSON.parse(row.payload));
  if (!parsed.success) {
    logger.error(`Geplante Veröffentlichung #${row.id} hat ungültige gespeicherte Daten: ${parsed.error.message}`);
  }
  return {
    id: row.id,
    publishAt: row.publish_at,
    payload: parsed.success ? parsed.data : (JSON.parse(row.payload) as PublishEventInput),
    publishedEventId: row.published_event_id,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = `id, publish_at, payload, published_event_id, attempts, last_error, created_at, updated_at`;

const selectByIdStmt = db.prepare<[number], ScheduledPublishRow>(
  `SELECT ${COLUMNS} FROM scheduled_event_publishes WHERE id = ?`,
);
const selectAllStmt = db.prepare<[], ScheduledPublishRow>(
  `SELECT ${COLUMNS} FROM scheduled_event_publishes ORDER BY publish_at DESC`,
);
/** Not yet posted (regardless of attempts) — includes retry-exhausted entries, unlike `selectDueStmt`. */
const selectPendingStmt = db.prepare<[], ScheduledPublishRow>(
  `SELECT ${COLUMNS} FROM scheduled_event_publishes WHERE published_event_id IS NULL ORDER BY publish_at ASC`,
);
/** Not yet posted, not yet given up on, and due — see MAX_ATTEMPTS. */
const selectDueStmt = db.prepare<[string], ScheduledPublishRow>(
  `SELECT ${COLUMNS} FROM scheduled_event_publishes
   WHERE published_event_id IS NULL AND attempts < ${MAX_ATTEMPTS} AND publish_at <= ?`,
);
const insertStmt = db.prepare<{ publishAt: string; payload: string; createdAt: string; updatedAt: string }>(
  `INSERT INTO scheduled_event_publishes (publish_at, payload, created_at, updated_at)
   VALUES (@publishAt, @payload, @createdAt, @updatedAt)`,
);
const updateStmt = db.prepare<{ id: number; publishAt: string; payload: string; updatedAt: string }>(
  `UPDATE scheduled_event_publishes SET publish_at = @publishAt, payload = @payload, updated_at = @updatedAt WHERE id = @id`,
);
const deleteStmt = db.prepare<[number]>(`DELETE FROM scheduled_event_publishes WHERE id = ?`);
const markPublishedStmt = db.prepare<{ id: number; publishedEventId: number; updatedAt: string }>(
  `UPDATE scheduled_event_publishes SET published_event_id = @publishedEventId, updated_at = @updatedAt WHERE id = @id`,
);
const markPublishFailedStmt = db.prepare<{ id: number; attempts: number; lastError: string; updatedAt: string }>(
  `UPDATE scheduled_event_publishes SET attempts = @attempts, last_error = @lastError, updated_at = @updatedAt WHERE id = @id`,
);

export function getScheduledPublish(id: number): ScheduledEventPublish | null {
  const row = selectByIdStmt.get(id);
  return row ? rowToScheduledPublish(row) : null;
}

/** Pending and already-resolved (posted/failed) entries, newest publish time first. */
export function listScheduledPublishes(): ScheduledEventPublish[] {
  return selectAllStmt.all().map(rowToScheduledPublish);
}

/**
 * Not-yet-posted entries — includes ones that have exhausted their retries
 * (`attempts >= MAX_ATTEMPTS`) and will never post, unlike `listDuePublishes`.
 * Soonest publish time first. Backs `/event planned` and, filtered to
 * `attempts < MAX_ATTEMPTS`, `services/eventConflicts.ts`'s occupied-date set.
 */
export function listPendingPublishes(): ScheduledEventPublish[] {
  return selectPendingStmt.all().map(rowToScheduledPublish);
}

export function listDuePublishes(nowIso: string): ScheduledEventPublish[] {
  return selectDueStmt.all(nowIso).map(rowToScheduledPublish);
}

export interface ScheduledPublishInput {
  /** ISO UTC. */
  publishAt: string;
  payload: PublishEventInput;
}

export function createScheduledPublish(input: ScheduledPublishInput): ScheduledEventPublish {
  const now = new Date().toISOString();
  const info = insertStmt.run({
    publishAt: input.publishAt,
    payload: JSON.stringify(input.payload),
    createdAt: now,
    updatedAt: now,
  });
  return getScheduledPublish(Number(info.lastInsertRowid))!;
}

/** Replaces a still-pending entry's publish time and payload — callers must check `publishedEventId === null` themselves (mirrors `updateEventFields`'s convention). */
export function updateScheduledPublish(id: number, input: ScheduledPublishInput): ScheduledEventPublish {
  updateStmt.run({ id, publishAt: input.publishAt, payload: JSON.stringify(input.payload), updatedAt: new Date().toISOString() });
  return getScheduledPublish(id)!;
}

export function deleteScheduledPublish(id: number): void {
  deleteStmt.run(id);
}

export function markPublished(id: number, publishedEventId: number): void {
  markPublishedStmt.run({ id, publishedEventId, updatedAt: new Date().toISOString() });
}

/** Records a failed attempt; `giveUp` skips straight to MAX_ATTEMPTS so a permanently-doomed entry (e.g. its start time already passed) stops being retried. */
export function markPublishFailed(id: number, error: string, options?: { giveUp?: boolean }): void {
  const current = getScheduledPublish(id);
  const attempts = options?.giveUp ? MAX_ATTEMPTS : (current?.attempts ?? 0) + 1;
  markPublishFailedStmt.run({ id, attempts, lastError: error, updatedAt: new Date().toISOString() });
}
