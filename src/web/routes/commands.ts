import { z } from "zod";
import { listCommandDefinitions } from "../../loaders/commandLoader.js";
import { setCommandOverride } from "../../db/settingsRepository.js";
import type { ZodFastifyInstance } from "../utils.js";

const PatchBodySchema = z.object({
  enabled: z.boolean().optional(),
  guildOnly: z.boolean().optional(),
});

const PatchParamsSchema = z.object({
  name: z.string().min(1),
});

export function registerCommandRoutes(app: ZodFastifyInstance): void {
  app.get("/commands", async () => listCommandDefinitions());

  app.patch(
    "/commands/:name",
    { schema: { params: PatchParamsSchema, body: PatchBodySchema } },
    async (request, reply) => {
      const { name } = request.params;
      const definitions = await listCommandDefinitions();
      const current = definitions.find((d) => d.name === name);
      if (!current) return reply.code(404).send({ error: "Unbekannter Befehl" });

      const body = request.body;

      setCommandOverride(name, {
        enabled: body.enabled ?? current.enabled,
        guildOnly: body.guildOnly ?? current.guildOnly,
      });

      // setCommandOverride() emits SettingsEvent.Commands; the settingsBus
      // listener in src/index.ts is the sole path that calls
      // reloadCommands(client, config) for this save (fire-and-forget, not
      // awaited here, and now also serialized against any other in-flight
      // reload — see that listener's comment in src/index.ts). This response
      // can therefore return slightly before the in-process reload / Discord
      // re-registration finishes — an accepted tradeoff for making this the
      // ONLY caller of reloadCommands() per save, which avoids two concurrent
      // reloadCommands() calls both racing pushCommandDefinitions()'s
      // hash-gate and double-pushing to Discord.
      //
      // KNOWN TRADEOFF: because the reload is fire-and-forget from here, this
      // route always responds 200 with the just-written override, even if the
      // subsequent reloadCommands()/Discord REST push later fails — that
      // failure only reaches the server log (see the listener's .catch in
      // src/index.ts), never this HTTP response, so the dashboard has no way
      // to know synchronously that a push failed. A fuller fix (e.g. a
      // module-level "last reload error" flag surfaced through GET /commands)
      // would need GET /commands' response shape to change from a bare array
      // to an object carrying both the list and that flag, which is a larger
      // change than this fix warrants — left as a follow-up.
      return (await listCommandDefinitions()).find((d) => d.name === name);
    },
  );
}
