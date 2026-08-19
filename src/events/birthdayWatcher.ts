import type { Message, PartialMessage } from "discord.js";
import { getBirthdayListLocation, updateBirthdayListFromMessage } from "../services/birthdays.js";
import logger, { errorMessage } from "../utils/logger.js";
import type { BotClient } from "../types.js";

export default function registerBirthdayWatcher(client: BotClient): void {
  const triggerUpdate = async (message: Message | PartialMessage) => {
    const location = getBirthdayListLocation();
    if (!location || message.channelId !== location.channelId) return;

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
