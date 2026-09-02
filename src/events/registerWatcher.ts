import { ChannelType, type Message, type PartialMessage } from "discord.js";
import { getSettings } from "../db/settingsRepository.js";
import {
  savePendingRegistration,
  getMemberRecord,
  completeRegistration as dbCompleteRegistration,
  removeRegistration as dbRemoveRegistration,
  markRegistrationLeft as dbMarkRegistrationLeft,
} from "../db/memberRecordsRepository.js";
import {
  REGISTER_FORM_NAME_REGEX,
  REGISTER_FORM_SSO_NAME_REGEX,
  REGISTER_FORM_ALTER_REGEX,
  REGISTER_NICKNAME_EMOJI,
  DISCORD_NICKNAME_MAX_LENGTH,
} from "../constants.js";
import { applyFont } from "../utils/font.js";
import logger, { errorMessage } from "../utils/logger.js";
import type { BotClient } from "../types.js";

export interface RegisterFormFields {
  name: string;
  /** Full `sso name:` field value, as submitted — shown as-is on the dashboard. */
  ssoName: string;
  /** Last whitespace-separated word of `ssoName` — see `buildRegisterNickname()`. */
  ssoLastName: string;
  /** Raw `alter:` field value. Optional — a submission missing it is still valid, since it isn't used to build the nickname. */
  age: string | null;
}

/** Extracts the `name:`, `sso name:`, and `alter:` fields from a register-form submission. Only `name:`/`sso name:` are required — returns null if either is missing, so a message without them is left alone as ordinary chat. */
export function parseRegisterForm(content: string): RegisterFormFields | null {
  const name = content.match(REGISTER_FORM_NAME_REGEX)?.[1]?.trim();
  const ssoName = content.match(REGISTER_FORM_SSO_NAME_REGEX)?.[1]?.trim();
  if (!name || !ssoName) return null;

  const ssoLastName = ssoName.split(/\s+/).pop();
  if (!ssoLastName) return null;

  const age = content.match(REGISTER_FORM_ALTER_REGEX)?.[1]?.trim() || null;

  return { name, ssoName, ssoLastName, age };
}

/** Code-point-aware truncation so a supplementary-plane styled character (see utils/font.ts) never gets split in half. */
function truncateToCodePoints(text: string, maxLength: number): string {
  const codePoints = [...text];
  return codePoints.length <= maxLength ? text : codePoints.slice(0, maxLength).join("");
}

/**
 * Builds the standard registration nickname: the first-name field in caps,
 * run through the shared global font (settings.fontMap — same one used by
 * the birthday anchor/announcement and reaction-role panels) when
 * useFont/settings.registerNicknameUseFont is on (default), then the
 * lowercase, unstyled surname from the sso-name field. E.g. name "Areum" +
 * sso name "... Shadowray" + fontMap set -> "💙𝐀𝐑𝐄𝐔𝐌 — shadowray". Falls
 * back to plain (unstyled) caps when no font is configured or useFont is
 * off, and drops the surname half (then truncates) if the styled form would
 * exceed Discord's nickname length cap.
 */
export function buildRegisterNickname(fields: RegisterFormFields, fontMap: string | null, useFont: boolean): string {
  const styledFirstName = useFont ? applyFont(fields.name.toUpperCase(), fontMap) : fields.name.toUpperCase();
  const full = `${REGISTER_NICKNAME_EMOJI}${styledFirstName} — ${fields.ssoLastName.toLowerCase()}`;
  if ([...full].length <= DISCORD_NICKNAME_MAX_LENGTH) return full;

  const nameOnly = `${REGISTER_NICKNAME_EMOJI}${styledFirstName}`;
  return truncateToCodePoints(nameOnly, DISCORD_NICKNAME_MAX_LENGTH);
}

function renderConfirmation(template: string, name: string, roleSelectionChannelId: string | null): string {
  const roleChannel = roleSelectionChannelId ? `<#${roleSelectionChannelId}>` : "dem Rollen-Kanal";
  return template.replace(/{name}/g, name).replace(/{roleChannel}/g, roleChannel);
}

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

      // Deliberately doesn't reference or link back to the register channel
      // or the original message — the thread stands on its own.
      const note = renderConfirmation(settings.registerConfirmationTemplate, fields.name, settings.roleSelectionChannelId);
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
 * `stripRegisterGateRoleIfJustRegistered` in `memberEvents.ts`) — the
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
