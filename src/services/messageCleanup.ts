import type { Collection, DMChannel, GuildTextBasedChannel, Message, PartialMessage, Snowflake } from "discord.js";
import { DISCORD_FETCH_PAGE_SIZE } from "../constants.js";

/**
 * Channel shapes `bulkDeleteWithPagination()` can operate on: a guild text
 * channel (which exposes the batch `bulkDelete` API used by `/clear`) or a
 * DM channel (which doesn't — `/cleardm` falls back to one-by-one deletion
 * for everything).
 */
export type CleanableChannel = GuildTextBasedChannel | DMChannel;

export interface BulkDeleteOptions {
  /** How many messages to process. Pass `Infinity` for "no cap" (e.g. `/cleardm` with no `amount` option). */
  amount: number;
  /** Only messages matching this predicate count toward `amount` and get deleted. Omit to match every fetched message. */
  filter?: (message: Message) => boolean;
  /**
   * How `amount` is measured — the two modes mirror `/clear` and
   * `/cleardm`'s original (pre-refactor) loops exactly:
   * - `"deleted"` (default, `/clear`): fetches and deletes page by page.
   *   `amount` counts confirmed deletions, so a failed delete doesn't count
   *   against it — the loop just fetches further back in history to make up
   *   the difference.
   * - `"matched"` (`/cleardm`): first collects up to `amount` messages
   *   matching `filter` with no deletion yet, then deletes them one at a
   *   time. `amount` counts matches found, not successful deletions, and a
   *   fetch failure during collection aborts before anything is deleted —
   *   needed so callers can build a backup from the untouched messages
   *   before committing to delete them.
   */
  amountMode?: "deleted" | "matched";
  /** Delay awaited after each individual (non-bulk) delete attempt. */
  delayMs: number;
  /** Whether the delay above still applies after a *failed* individual delete. `/clear` always delays; `/cleardm` skips the delay on failure. Defaults to `true`. */
  delayOnFailure?: boolean;
  /** Called once per candidate message before its delete is attempted (whether via bulkDelete or individually) — lets a caller build a backup log, etc. */
  onCandidate?: (message: Message) => void;
  /** Called with the running deleted-count total whenever it changes, so a caller can report partial progress if the helper throws mid-loop. */
  onProgress?: (deletedSoFar: number) => void;
  /** Called for each message whose individual delete attempt failed. */
  onDeleteError?: (message: Message, error: unknown) => void;
  /** Called if a batch `bulkDelete` call itself throws (the batch then falls back to individual deletion). */
  onBulkDeleteError?: (error: unknown) => void;
}

export interface BulkDeleteResult {
  /** Number of messages actually deleted. */
  deletedCount: number;
  /** Number of messages that matched `filter` and were attempted, regardless of outcome. Equal to `deletedCount` in `"deleted"` mode. */
  matchedCount: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deletes `messages` one at a time, waiting `delayMs` between attempts to
 * stay under Discord's rate limit. Failures are reported via `onDeleteError`
 * and otherwise swallowed — deletion continues with the next message.
 */
async function deleteIndividually(
  messages: readonly Message[],
  delayMs: number,
  delayOnFailure: boolean,
  onDeleted: () => void,
  onDeleteError?: (message: Message, error: unknown) => void,
): Promise<void> {
  for (const message of messages) {
    try {
      await message.delete();
      onDeleted();
      await sleep(delayMs);
    } catch (err) {
      onDeleteError?.(message, err);
      if (delayOnFailure) await sleep(delayMs);
    }
  }
}

/**
 * Fetches up to `amount` messages matching `filter` (or every message if
 * omitted), paging back through history via the `before` cursor until
 * `amount` is reached or history runs out. Does not delete anything.
 */
async function collectMatchingMessages(
  channel: CleanableChannel,
  amount: number,
  filter?: (message: Message) => boolean,
): Promise<Message[]> {
  const collected: Message[] = [];
  let lastId: Snowflake | undefined;

  while (collected.length < amount) {
    const fetched = await channel.messages.fetch({ limit: DISCORD_FETCH_PAGE_SIZE, before: lastId });
    if (fetched.size === 0) break;
    lastId = fetched.last()?.id;

    const matched = filter ? [...fetched.values()].filter(filter) : [...fetched.values()];
    collected.push(...matched);

    if (fetched.size < DISCORD_FETCH_PAGE_SIZE || collected.length >= amount) break;
  }

  if (collected.length > amount) collected.length = amount;
  return collected;
}

/**
 * Paginated bulk-message deletion shared by `/clear` (a guild text channel)
 * and `/cleardm` (a DM channel) — see `BulkDeleteOptions.amountMode` for how
 * their two loop shapes are preserved exactly under one function.
 *
 * In `"deleted"` mode, prefers the batch `bulkDelete` API where the channel
 * supports it, falling back to one-by-one deletion (throttled by `delayMs`)
 * for anything bulkDelete couldn't remove (messages older than Discord's
 * 14-day bulk-delete cutoff, or the whole batch if the bulkDelete call
 * itself failed).
 */
export async function bulkDeleteWithPagination(
  channel: CleanableChannel,
  options: BulkDeleteOptions,
): Promise<BulkDeleteResult> {
  const {
    amount,
    filter,
    amountMode = "deleted",
    delayMs,
    delayOnFailure = true,
    onCandidate,
    onProgress,
    onDeleteError,
    onBulkDeleteError,
  } = options;

  let deletedCount = 0;
  const bumpDeleted = () => onProgress?.(++deletedCount);

  if (amountMode === "matched") {
    const matched = await collectMatchingMessages(channel, amount, filter);
    for (const message of matched) onCandidate?.(message);
    await deleteIndividually(matched, delayMs, delayOnFailure, bumpDeleted, onDeleteError);
    return { deletedCount, matchedCount: matched.length };
  }

  let lastId: Snowflake | undefined;

  while (deletedCount < amount) {
    const batchSize = Math.min(DISCORD_FETCH_PAGE_SIZE, amount - deletedCount);
    const fetched = await channel.messages.fetch({ limit: batchSize, before: lastId });
    if (fetched.size === 0) break;
    lastId = fetched.last()?.id;

    const candidates = filter ? [...fetched.values()].filter(filter) : [...fetched.values()];
    for (const message of candidates) onCandidate?.(message);

    let bulkDeleted: Collection<Snowflake, Message | PartialMessage | undefined> | null = null;
    if (candidates.length > 0 && "bulkDelete" in channel) {
      bulkDeleted = await channel.bulkDelete(candidates, true).catch((err: unknown) => {
        onBulkDeleteError?.(err);
        return null;
      });
    }
    if (bulkDeleted) {
      deletedCount += bulkDeleted.size;
      onProgress?.(deletedCount);
    }

    const individualTargets = bulkDeleted ? candidates.filter((m) => !bulkDeleted!.has(m.id)) : candidates;
    await deleteIndividually(individualTargets, delayMs, delayOnFailure, bumpDeleted, onDeleteError);

    if (fetched.size < batchSize) break; // ran out of channel history
  }

  return { deletedCount, matchedCount: deletedCount };
}
