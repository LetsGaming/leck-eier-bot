import type { Message, PartialMessage } from "discord.js";
import { upsertSelfBirthday } from "../db/birthdaysRepository.js";
import { getSettings } from "../db/settingsRepository.js";
import {
  getBirthdayListLocation,
  notifyBirthdayRegistration,
  parseSelfRegistrationDate,
  syncAnchorMessage,
  updateBirthdayListFromMessage,
} from "../services/birthdays.js";
import { BIRTHDAY_LIST_MARKER, SELF_BIRTHDAY_MESSAGE_MAX_LENGTH } from "../constants.js";
import logger, { errorMessage } from "../utils/logger.js";
import type { BotClient } from "../types.js";

export default function registerBirthdayWatcher(client: BotClient): void {
  /**
   * A plain message in the birthday channel (no `BIRTHDAY_LIST_MARKER`,
   * short enough to plausibly just be a date) is treated as the author
   * self-registering — parsed, stored, and the message deleted so the
   * channel stays clean, instead of falling through to the full list
   * re-scan below.
   */
  const tryHandleSelfRegistration = async (message: Message | PartialMessage): Promise<boolean> => {
    const content = message.content ?? "";
    if (!content || content.includes(BIRTHDAY_LIST_MARKER) || content.length > SELF_BIRTHDAY_MESSAGE_MAX_LENGTH) {
      return false;
    }
    const dateKey = parseSelfRegistrationDate(content);
    if (!dateKey) return false;

    const author = message.author;
    if (!author || author.bot) return false;

    const mention = `<@${author.id}>`;
    const name = message.member?.displayName ?? author.globalName ?? author.username;

    upsertSelfBirthday({ date: dateKey, mention, userId: author.id, name });
    logger.info(`Self-registered birthday for ${author.id}: ${dateKey}`);

    try {
      await message.delete();
    } catch (err) {
      logger.warn(`Failed to delete self-registered birthday message: ${errorMessage(err)}`);
    }

    await notifyBirthdayRegistration(client, { mention, name, dateKey }, "message");
    return true;
  };

  const triggerUpdate = async (message: Message | PartialMessage) => {
    const settings = getSettings();
    // Gated on the channel alone (not the anchor message id) so
    // self-registration works even before a bot-managed anchor message has
    // ever been posted — see syncAnchorMessage() in services/birthdays.ts.
    if (!settings.birthdayListChannelId || message.channelId !== settings.birthdayListChannelId) return;
    // Never react to the bot's own messages — relevant once the bot itself
    // is posting/editing the anchor message (birthdayBotManagesAnchor).
    if (message.author?.id === client.user?.id) return;

    if (settings.birthdaySelfRegistrationEnabled && (await tryHandleSelfRegistration(message))) {
      await syncAnchorMessage(client);
      return;
    }

    // Bot-managed mode: the bot owns the message's content entirely, so a
    // human edit elsewhere in the channel has nothing to be scanned into —
    // the next registration (or restart) just re-renders over it anyway.
    if (settings.birthdayBotManagesAnchor) return;

    const location = getBirthdayListLocation();
    if (!location) return;

    logger.info(`Birthday channel activity (Msg: ${message.id})`);
    try {
      await updateBirthdayListFromMessage(client, location.channelId, location.messageId);
    } catch (err) {
      logger.error(`Failed to update birthday list from message: ${errorMessage(err)}`);
    }
  };

  client.on("messageUpdate", (_old, newMsg) => triggerUpdate(newMsg));
  client.on("messageCreate", (msg) => triggerUpdate(msg));
}
