import { ChannelType, type Message, type PartialMessage } from "discord.js";
import { getSettings } from "../db/settingsRepository.js";
import { setRegisterThreadId, clearRegisterThreadId, getMemberRecord } from "../db/memberRecordsRepository.js";
import {
  REGISTER_FORM_NAME_REGEX,
  REGISTER_FORM_SSO_NAME_REGEX,
  REGISTER_NICKNAME_EMOJI,
  DISCORD_NICKNAME_MAX_LENGTH,
} from "../constants.js";
import { applyFont } from "../utils/font.js";
import logger, { errorMessage } from "../utils/logger.js";
import type { BotClient } from "../types.js";

export interface RegisterFormFields {
  name: string;
  /** Last whitespace-separated word of the `sso name:` field — see `buildRegisterNickname()`. */
  ssoLastName: string;
}

/** Extracts the `name:` and `sso name:` fields from a register-form submission. Both must be present — returns null otherwise, so a message missing either is left alone as ordinary chat. */
export function parseRegisterForm(content: string): RegisterFormFields | null {
  const name = content.match(REGISTER_FORM_NAME_REGEX)?.[1]?.trim();
  const ssoName = content.match(REGISTER_FORM_SSO_NAME_REGEX)?.[1]?.trim();
  if (!name || !ssoName) return null;

  const ssoLastName = ssoName.split(/\s+/).pop();
  if (!ssoLastName) return null;

  return { name, ssoLastName };
}

/** Code-point-aware truncation so a supplementary-plane styled character (see utils/font.ts) never gets split in half. */
function truncateToCodePoints(text: string, maxLength: number): string {
  const codePoints = [...text];
  return codePoints.length <= maxLength ? text : codePoints.slice(0, maxLength).join("");
}

/**
 * Builds the standard registration nickname: the first-name field in caps,
 * run through the shared global font (settings.fontMap — same one used by
 * the birthday anchor/announcement and reaction-role panels), then the
 * lowercase, unstyled surname from the sso-name field. E.g. name "Areum" +
 * sso name "... Shadowray" + fontMap set -> "💙𝐀𝐑𝐄𝐔𝐌 — shadowray". Falls
 * back to plain (unstyled) caps when no font is configured, and drops the
 * surname half (then truncates) if the styled form would exceed Discord's
 * nickname length cap.
 */
export function buildRegisterNickname(fields: RegisterFormFields, fontMap: string | null): string {
  const styledFirstName = applyFont(fields.name.toUpperCase(), fontMap);
  const full = `${REGISTER_NICKNAME_EMOJI}${styledFirstName} — ${fields.ssoLastName.toLowerCase()}`;
  if ([...full].length <= DISCORD_NICKNAME_MAX_LENGTH) return full;

  const nameOnly = `${REGISTER_NICKNAME_EMOJI}${styledFirstName}`;
  return truncateToCodePoints(nameOnly, DISCORD_NICKNAME_MAX_LENGTH);
}

function renderConfirmation(template: string, name: string, roleSelectionChannelId: string | null): string {
  const roleChannel = roleSelectionChannelId ? `<#${roleSelectionChannelId}>` : "dem Rollen-Kanal";
  return template.replace(/{name}/g, name).replace(/{roleChannel}/g, roleChannel);
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

    const nickname = buildRegisterNickname(fields, settings.fontMap);
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
      setRegisterThreadId(member.id, thread.id);

      const note = renderConfirmation(settings.registerConfirmationTemplate, fields.name, settings.roleSelectionChannelId);
      await thread.send({ content: `${note}\n\n${message.url}` });
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

/**
 * Deletes the private registration thread for `userId`, if one exists —
 * called once staff manually grant `registrationTierRoleId` (see
 * `stripRegisterGateRoleIfJustRegistered` in `memberEvents.ts`), since the
 * "you'll be registered shortly" note it holds is no longer relevant.
 */
export async function deleteRegisterThread(client: BotClient, userId: string): Promise<void> {
  const record = getMemberRecord(userId);
  const threadId = record?.registerThreadId;
  if (!threadId) return;

  try {
    const thread = await client.channels.fetch(threadId).catch(() => null);
    if (thread?.isThread()) {
      await thread.delete("Registrierung abgeschlossen");
    }
  } catch (err) {
    logger.warn(`Registrierungs-Thread ${threadId} für ${userId} konnte nicht gelöscht werden: ${errorMessage(err)}`);
  } finally {
    clearRegisterThreadId(userId);
  }
}
