import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { listCommandDefinitions } from "../../loaders/commandLoader.js";
import { setCommandOverride } from "../../db/settingsRepository.js";

const PatchBodySchema = z.object({
  enabled: z.boolean().optional(),
  guildOnly: z.boolean().optional(),
});

export function registerCommandRoutes(app: FastifyInstance): void {
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

    // setCommandOverride() emits SettingsEvent.Commands; the settingsBus
    // listener in src/index.ts is the sole path that calls
    // reloadCommands(client, config) for this save (fire-and-forget, not
    // awaited here). This response can therefore return slightly before the
    // in-process reload / Discord re-registration finishes — an accepted
    // tradeoff for making this the ONLY caller of reloadCommands() per save,
    // which avoids two concurrent reloadCommands() calls both racing
    // pushCommandDefinitions()'s hash-gate and double-pushing to Discord.
    return (await listCommandDefinitions()).find((d) => d.name === name);
  });
}
