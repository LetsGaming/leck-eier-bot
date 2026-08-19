import { handleReactionAdd, handleReactionRemove } from "../services/reactionRoles.js";
import logger, { errorMessage } from "../utils/logger.js";
import type { BotClient } from "../types.js";

export default function registerReactionRoleEvents(client: BotClient): void {
  client.on("messageReactionAdd", (reaction, user) => {
    handleReactionAdd(reaction, user).catch((err) =>
      logger.error(`Unhandled error in reaction-role add handler: ${errorMessage(err)}`),
    );
  });

  client.on("messageReactionRemove", (reaction, user) => {
    handleReactionRemove(reaction, user).catch((err) =>
      logger.error(`Unhandled error in reaction-role remove handler: ${errorMessage(err)}`),
    );
  });
}
