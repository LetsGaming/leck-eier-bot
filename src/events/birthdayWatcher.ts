import type { Message, PartialMessage } from "discord.js";
import { upsertSelfBirthday } from "../db/birthdaysRepository.js";
import { getSettings } from "../db/settingsRepository.js";
import { notifyBirthdayRegistration, parseSelfRegistrationDate, syncAnchorMessage } from "../services/birthdays.js";
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
    // Gated on the channel alone (not any particular message id) so
    // self-registration works even before the anchor message has ever been
    // posted — see syncAnchorMessage() in services/birthdays.ts.
    if (!settings.birthdayListChannelId || message.channelId !== settings.birthdayListChannelId) return;
    // Never react to the bot's own messages — it's the one posting/editing
    // the anchor message in this same channel.
    if (message.author?.id === client.user?.id) return;

    if (await tryHandleSelfRegistration(message)) {
      await syncAnchorMessage(client);
    }
  };

  client.on("messageUpdate", (_old, newMsg) => triggerUpdate(newMsg));
  client.on("messageCreate", (msg) => triggerUpdate(msg));
}
