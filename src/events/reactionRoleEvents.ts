import {
  handleButtonInteraction,
  handleReactionAdd,
  handleReactionRemove,
  handleSelectMenuInteraction,
} from "../services/reactionRoles.js";
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

  // Separate listener from the slash-command dispatcher in src/index.ts —
  // discord.js fans interactionCreate out to every registered listener, so
  // this only needs to filter for the interaction kinds it cares about.
  client.on("interactionCreate", (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith("rr:")) {
      handleButtonInteraction(interaction).catch((err) =>
        logger.error(`Unhandled error in reaction-role button handler: ${errorMessage(err)}`),
      );
    } else if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:")) {
      handleSelectMenuInteraction(interaction).catch((err) =>
        logger.error(`Unhandled error in reaction-role dropdown handler: ${errorMessage(err)}`),
      );
    }
  });
}
