import type { Message, PartialMessage } from "discord.js";
import { updateBirthdayListFromMessage } from "../services/birthdays.js";
import logger from "../utils/logger.js";
import type { BotClient, Config } from "../types.js";

export default function registerBirthdayWatcher(client: BotClient, config: Config): void {
  const triggerUpdate = async (message: Message | PartialMessage) => {
    if (message.channelId === config.birthdayListChannelId) {
      logger.info(`Birthday channel activity (Msg: ${message.id})`);
      await updateBirthdayListFromMessage(
        client,
        config.birthdayListChannelId,
        config.birthdayListMessageId,
      );
    }
  };

  client.on("messageUpdate", (_old, newMsg) => triggerUpdate(newMsg));
  client.on("messageCreate", (msg) => triggerUpdate(msg));
}
