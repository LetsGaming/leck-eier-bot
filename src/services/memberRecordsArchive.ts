import { existsSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";
import path from "path";
import { gzipSync } from "zlib";
import { DATA_DIR } from "../db/index.js";
import { deleteMemberRecords, listArchivableMemberRecords } from "../db/memberRecordsRepository.js";
import { MEMBER_RECORD_ARCHIVE_AFTER_MS } from "../constants.js";
import logger, { errorMessage } from "../utils/logger.js";

const ARCHIVE_DIR = path.join(DATA_DIR, "archives");

/**
 * Exports every `member_records` row for a member who left
 * `MEMBER_RECORD_ARCHIVE_AFTER_MS` or longer ago to a gzipped JSONL file
 * under `data/archives/`, then deletes those rows from the live table —
 * product decision: actually free the database's disk space rather than
 * keep the data live (a second DB table would cost the same space) or
 * delete it outright with no way to look it up again later.
 *
 * The file is written and durably flushed BEFORE any row is deleted, so a
 * crash between the two steps only risks re-exporting the same rows next
 * sweep (harmless — the file gets a fresh timestamped name) rather than
 * ever losing data that was deleted but never archived.
 *
 * No-ops (no file written) if nothing is old enough to archive yet — the
 * common case on every sweep at this bot's scale.
 */
export async function archiveOldMemberRecords(now: Date = new Date()): Promise<void> {
  const cutoffIso = new Date(now.getTime() - MEMBER_RECORD_ARCHIVE_AFTER_MS).toISOString();
  const records = listArchivableMemberRecords(cutoffIso);
  if (records.length === 0) return;

  if (!existsSync(ARCHIVE_DIR)) {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
  }

  const fileName = `member_records-${now.toISOString().replace(/[:.]/g, "-")}.jsonl.gz`;
  const filePath = path.join(ARCHIVE_DIR, fileName);
  const jsonl = records.map((record) => JSON.stringify(record)).join("\n") + "\n";

  try {
    await writeFile(filePath, gzipSync(jsonl));
  } catch (err) {
    logger.error(`Member-records archive: failed to write ${filePath}, skipping deletion this sweep: ${errorMessage(err)}`);
    return;
  }

  deleteMemberRecords(records.map((record) => record.userId));
  logger.info(`Member-records archive: archived and removed ${records.length} former-member record(s) to ${filePath}.`);
}
