import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { listCommandDefinitions, reloadCommands } from "../../loaders/commandLoader.js";
import { setCommandOverride } from "../../db/settingsRepository.js";
import type { BotClient, Config } from "../../types.js";

const PatchBodySchema = z.object({
  enabled: z.boolean().optional(),
  guildOnly: z.boolean().optional(),
});

export function registerCommandRoutes(app: FastifyInstance, client: BotClient, config: Config): void {
  app.get("/commands", async () => listCommandDefinitions());

  app.patch("/commands/:name", async (request, reply) => {
    const name = (request.params as { name: string }).name;
    const definitions = await listCommandDefinitions();
    const current = definitions.find((d) => d.name === name);
    if (!current) return reply.code(404).send({ error: "Unbekannter Befehl" });

    const body = PatchBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    setCommandOverride(name, {
      enabled: body.data.enabled ?? current.enabled,
      guildOnly: body.data.guildOnly ?? current.guildOnly,
    });

    // Re-register with Discord so an enable/disable takes effect immediately
    // instead of waiting for the next restart.
    await reloadCommands(client, config);

    return (await listCommandDefinitions()).find((d) => d.name === name);
  });
}
