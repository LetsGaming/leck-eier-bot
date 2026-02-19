import { updateBirthdayListFromMessage } from "../services/birthdays.js";
import logger from "../utils/logger.js";

export default function registerBirthdayWatcher(client, config) {
  const triggerUpdate = async (message) => {
    if (message.channelId === config.birthdayListChannelId) {
      logger.info(`Birthday channel activity (Msg: ${message.id})`);
      await updateBirthdayListFromMessage(
        client,
        config.birthdayListChannelId,
        config.birthdayListMessageId,
      );
    }
  };

  client.on("messageUpdate", (old, newMsg) => triggerUpdate(newMsg));
  client.on("messageCreate", (msg) => triggerUpdate(msg));
}
