import { ChannelType, type Message, type PartialMessage } from "discord.js";
import { getSettings } from "../db/settingsRepository.js";
import {
  savePendingRegistration,
  getMemberRecord,
  completeRegistration as dbCompleteRegistration,
  removeRegistration as dbRemoveRegistration,
  markRegistrationLeft as dbMarkRegistrationLeft,
  completeRegistrationKeepThread,
  listExpiredRegisterThreads,
  clearExpiredRegisterThread,
} from "../db/memberRecordsRepository.js";
import { sweepExpiredSessions } from "../db/sessionsRepository.js";
import { archiveOldMemberRecords } from "../services/memberRecordsArchive.js";
import { REGISTER_AUTO_THREAD_LIFETIME_MS, REGISTER_THREAD_SWEEP_INTERVAL_MS } from "../constants.js";
import { parseRegisterForm, buildRegisterNickname, renderConfirmation, shouldAutoCompleteRegistration } from "../services/registration.js";
import logger, { errorMessage } from "../utils/logger.js";
import type { BotClient } from "../types.js";

/**
 * Whether `userId` has a registration currently in flight (status 'pending'
 * *and* the Discord thread still actually exists). Self-healing: if the
 * thread was deleted out of band (e.g. manually by staff in Discord itself),
 * this returns false rather than permanently blocking a resubmission —
 * `savePendingRegistration()` unconditionally overwrites on the next
 * submission regardless of the stale thread id sitting there.
 */
async function hasActiveRegisterThread(client: BotClient, userId: string): Promise<boolean> {
  const record = getMemberRecord(userId);
  if (record?.registerStatus !== "pending" || !record.registerThreadId) return false;

  const thread = await client.channels.fetch(record.registerThreadId).catch(() => null);
  return thread?.isThread() ?? false;
}

export default function registerRegisterWatcher(client: BotClient): void {
  const tryHandleSubmission = async (message: Message | PartialMessage): Promise<void> => {
    const settings = getSettings();
    if (!settings.registerChannelId || message.channelId !== settings.registerChannelId) return;
    if (message.author?.id === client.user?.id || message.author?.bot) return;

    const fields = parseRegisterForm(message.content ?? "");
    if (!fields) return;

    const member = message.member;
    if (!member) return;

    // Already mid-registration — treat any further submission as spam
    // rather than opening a second private thread for the same member; only
    // the first submission is ever parsed and acted on.
    if (await hasActiveRegisterThread(client, member.id)) {
      try {
        await message.delete();
      } catch (err) {
        logger.warn(
          `Registrierungsformular: erneute Einreichung von ${member.id} konnte nicht gelöscht werden: ${errorMessage(err)}`,
        );
      }
      return;
    }

    const nickname = buildRegisterNickname(fields, settings.fontMap, settings.registerNicknameUseFont);
    try {
      await member.setNickname(nickname, "Selbst-Registrierung via #register-Formular");
    } catch (err) {
      logger.warn(`Registrierungsformular: Nickname für ${member.id} konnte nicht gesetzt werden: ${errorMessage(err)}`);
    }

    const channel = message.channel;
    // Private threads are only creatable on plain text channels — not
    // announcement, forum, or voice-with-text channels.
    if (channel.type !== ChannelType.GuildText) {
      logger.warn(`Registrierungsformular: Kanal ${message.channelId} unterstützt keine privaten Threads.`);
      return;
    }

    try {
      const thread = await channel.threads.create({
        name: `Registrierung – ${fields.name}`.slice(0, 100),
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: `Registrierungsformular von ${member.user.tag}`,
      });
      await thread.members.add(member.id);
      savePendingRegistration({
        userId: member.id,
        threadId: thread.id,
        submittedAt: new Date().toISOString(),
        name: fields.name,
        ssoName: fields.ssoName,
        age: fields.age,
      });

      // settings.registerAutoComplete skips the staff-review step entirely —
      // grant the tier role immediately instead of leaving the entry
      // 'pending'. The role grant is attempted (and, on success, the DB
      // status flipped) *before* posting the thread message, so the choice
      // of template below always matches what actually happened. Granting
      // the role also fires the normal guildMemberUpdate handling in
      // memberEvents.ts (register-gate role stripped, etc.) — that handler's
      // own completeRegistration() call becomes a no-op here since status is
      // already 'registered' by the time it runs (see its doc comment).
      let autoCompleted = false;
      if (shouldAutoCompleteRegistration(settings)) {
        try {
          await member.roles.add(settings.registrationTierRoleId!, "Automatische Registrierung");
          completeRegistrationKeepThread(member.id, new Date(Date.now() + REGISTER_AUTO_THREAD_LIFETIME_MS).toISOString());
          autoCompleted = true;
        } catch (err) {
          logger.warn(
            `Registrierungsformular: automatische Rollenvergabe für ${member.id} fehlgeschlagen: ${errorMessage(err)}`,
          );
        }
      }

      // Deliberately doesn't reference or link back to the register channel
      // or the original message — the thread stands on its own.
      const template = autoCompleted ? settings.autoRegisterConfirmationTemplate : settings.registerConfirmationTemplate;
      const note = renderConfirmation(template, fields.name, settings.roleSelectionChannelId);
      await thread.send({ content: note });
    } catch (err) {
      logger.warn(
        `Registrierungsformular: Privater Thread für ${member.id} konnte nicht erstellt werden: ${errorMessage(err)}`,
      );
    }
  };

  client.on("messageCreate", (msg) => {
    tryHandleSubmission(msg).catch((err) =>
      logger.error(`Registrierungsformular-Verarbeitung fehlgeschlagen: ${errorMessage(err)}`),
    );
  });

  // Catches up on anything that expired while the bot was offline, then
  // keeps sweeping periodically — see sweepExpiredRegisterThreads().
  sweepExpiredRegisterThreads(client).catch((err) =>
    logger.error(`Bereinigung abgelaufener Registrierungs-Threads fehlgeschlagen: ${errorMessage(err)}`),
  );
  // Same "catch up on startup, then keep sweeping" shape as above.
  archiveOldMemberRecords().catch((err) =>
    logger.error(`Archivierung alter Mitgliedsdatensätze fehlgeschlagen: ${errorMessage(err)}`),
  );
  setInterval(() => {
    sweepExpiredRegisterThreads(client).catch((err) =>
      logger.error(`Bereinigung abgelaufener Registrierungs-Threads fehlgeschlagen: ${errorMessage(err)}`),
    );
    // Piggybacked on this interval rather than given its own timer: a
    // long-lived process only otherwise sweeps expired dashboard sessions
    // once, at web server startup (see web/server.ts), so an abandoned
    // session (cookie never returns) would sit in web_sessions until the
    // next restart. Cheap synchronous delete — fine to run every tick here.
    sweepExpiredSessions();
    // Also piggybacked here rather than given its own timer, same
    // reasoning — a no-op query on every tick until a former member's
    // record actually crosses MEMBER_RECORD_ARCHIVE_AFTER_MS.
    archiveOldMemberRecords().catch((err) =>
      logger.error(`Archivierung alter Mitgliedsdatensätze fehlgeschlagen: ${errorMessage(err)}`),
    );
  }, REGISTER_THREAD_SWEEP_INTERVAL_MS);
}

/**
 * Deletes the private thread for every auto-completed registration
 * (settings.registerAutoComplete) whose one-hour lifetime has passed. Run
 * once at startup (to catch up on anything missed while offline) and then
 * on REGISTER_THREAD_SWEEP_INTERVAL_MS — see `registerRegisterWatcher()`.
 */
export async function sweepExpiredRegisterThreads(client: BotClient): Promise<void> {
  const expired = listExpiredRegisterThreads(new Date().toISOString());
  for (const { userId, threadId } of expired) {
    await deleteDiscordThread(client, threadId, "Automatische Registrierung — Zeitlimit erreicht");
    clearExpiredRegisterThread(userId);
  }
}

/** The private registration thread id for `userId`, but only if a registration is currently 'pending' — a terminal status never has a live thread to delete. */
function pendingThreadId(userId: string): string | null {
  const record = getMemberRecord(userId);
  return record?.registerStatus === "pending" ? record.registerThreadId : null;
}

/** Best-effort delete of a Discord thread — logs and swallows any failure (already gone, missing permissions, etc.) rather than blocking the DB status transition that always follows it. */
async function deleteDiscordThread(client: BotClient, threadId: string, reason: string): Promise<void> {
  try {
    const thread = await client.channels.fetch(threadId).catch(() => null);
    if (thread?.isThread()) {
      await thread.delete(reason);
    }
  } catch (err) {
    logger.warn(`Registrierungs-Thread ${threadId} konnte nicht gelöscht werden: ${errorMessage(err)}`);
  }
}

/**
 * Staff manually granted `registrationTierRoleId` (see
 * `stripRegisterGateRoleIfJustRegistered` in `services/registerGate.ts`) — the
 * private thread's job is done, but the submitted info stays on the
 * dashboard's Registrierungen list with status "Registriert" rather than
 * being deleted.
 */
export async function completeRegistration(client: BotClient, userId: string): Promise<void> {
  const threadId = pendingThreadId(userId);
  if (threadId) await deleteDiscordThread(client, threadId, "Registrierung abgeschlossen");
  dbCompleteRegistration(userId);
}

/** Manually reset from the dashboard's Registrierungen list — deletes the thread and flips status to "Entfernt", letting the member submit the form again. */
export async function removeRegistration(client: BotClient, userId: string): Promise<void> {
  const threadId = pendingThreadId(userId);
  if (threadId) await deleteDiscordThread(client, threadId, "Registrierung manuell zurückgesetzt");
  dbRemoveRegistration(userId);
}

/**
 * The member left/was kicked/was banned (see `guildMemberRemove` in
 * `memberEvents.ts`) while their registration was still pending — a no-op
 * (both here and at the DB layer) if they'd already completed registration,
 * since leaving afterward shouldn't overwrite that status.
 */
export async function clearRegistrationOnLeave(client: BotClient, userId: string): Promise<void> {
  const threadId = pendingThreadId(userId);
  if (threadId) await deleteDiscordThread(client, threadId, "Mitglied hat den Server verlassen");
  dbMarkRegistrationLeft(userId);
}
