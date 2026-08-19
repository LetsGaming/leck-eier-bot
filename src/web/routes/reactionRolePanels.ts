import { z } from "zod";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  createPanel,
  deleteMapping,
  deletePanel,
  getPanel,
  listPanels,
  reorderMappings,
  updatePanel,
  upsertMapping,
} from "../../db/reactionRolesRepository.js";
import { syncPanelMessage } from "../../services/reactionRoles.js";
import logger, { errorMessage } from "../../utils/logger.js";
import { ReactionRoleMode } from "../../constants.js";
import type { BotClient } from "../../types.js";

const PanelBodySchema = z.object({
  channelId: z.string().min(1),
  mode: z.enum([ReactionRoleMode.Toggle, ReactionRoleMode.Unique, ReactionRoleMode.Verify]),
  removeReaction: z.boolean(),
  title: z.string().min(1).max(256).nullable(),
  description: z.string().max(2048).nullable(),
});

const MappingBodySchema = z.object({
  emojiName: z.string().min(1),
  emojiId: z.string().min(1).nullable(),
  roleId: z.string().min(1),
  label: z.string().max(100).nullable(),
});

const ReorderBodySchema = z.object({
  orderedIds: z.array(z.number().int()),
});

function parsePanelId(request: { params: unknown }, reply: FastifyReply): number | null {
  const params = request.params as { id?: string };
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    reply.code(400).send({ error: "Invalid panel id" });
    return null;
  }
  return id;
}

/** Best-effort re-sync after a write; failures are reported but don't roll back the DB change — the dashboard can retry with the manual Sync button. */
async function trySync(client: BotClient, reply: FastifyReply, panelId: number): Promise<void> {
  try {
    await syncPanelMessage(client, panelId);
  } catch (err) {
    logger.error(`Failed to sync reaction-role panel ${panelId}: ${errorMessage(err)}`);
    reply.header("x-sync-warning", "Panel saved, but posting/updating the Discord message failed.");
  }
}

export function registerReactionRolePanelRoutes(app: FastifyInstance, client: BotClient): void {
  app.get("/reaction-roles/panels", async () => listPanels());

  app.get("/reaction-roles/panels/:id", async (request, reply) => {
    const id = parsePanelId(request, reply);
    if (id === null) return;
    const panel = getPanel(id);
    if (!panel) return reply.code(404).send({ error: "Panel not found" });
    return panel;
  });

  app.post("/reaction-roles/panels", async (request, reply) => {
    const body = PanelBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    const panel = createPanel(body.data);
    await trySync(client, reply, panel.id);
    return reply.code(201).send(getPanel(panel.id));
  });

  app.patch("/reaction-roles/panels/:id", async (request, reply) => {
    const id = parsePanelId(request, reply);
    if (id === null) return;
    if (!getPanel(id)) return reply.code(404).send({ error: "Panel not found" });

    const body = PanelBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    updatePanel(id, body.data);
    await trySync(client, reply, id);
    return getPanel(id);
  });

  app.delete("/reaction-roles/panels/:id", async (request, reply) => {
    const id = parsePanelId(request, reply);
    if (id === null) return;
    const panel = getPanel(id);
    if (!panel) return reply.code(404).send({ error: "Panel not found" });

    if (panel.messageId) {
      const channel = await client.channels.fetch(panel.channelId).catch(() => null);
      if (channel?.isTextBased() && !channel.isDMBased()) {
        const message = await channel.messages.fetch(panel.messageId).catch(() => null);
        await message?.delete().catch((err) =>
          logger.warn(`Failed to delete panel message on panel removal: ${errorMessage(err)}`),
        );
      }
    }

    deletePanel(id);
    return reply.code(204).send();
  });

  app.post("/reaction-roles/panels/:id/sync", async (request, reply) => {
    const id = parsePanelId(request, reply);
    if (id === null) return;
    if (!getPanel(id)) return reply.code(404).send({ error: "Panel not found" });

    await trySync(client, reply, id);
    return getPanel(id);
  });

  app.post("/reaction-roles/panels/:id/mappings", async (request, reply) => {
    const id = parsePanelId(request, reply);
    if (id === null) return;
    const panel = getPanel(id);
    if (!panel) return reply.code(404).send({ error: "Panel not found" });

    const body = MappingBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    upsertMapping({ panelId: id, position: panel.mappings.length, ...body.data });
    await trySync(client, reply, id);
    return reply.code(201).send(getPanel(id));
  });

  app.patch("/reaction-roles/panels/:id/mappings/:mappingId", async (request, reply) => {
    const id = parsePanelId(request, reply);
    if (id === null) return;
    const panel = getPanel(id);
    if (!panel) return reply.code(404).send({ error: "Panel not found" });

    const mappingId = Number((request.params as { mappingId?: string }).mappingId);
    const existing = panel.mappings.find((m) => m.id === mappingId);
    if (!existing) return reply.code(404).send({ error: "Mapping not found on this panel" });

    const body = MappingBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    upsertMapping({ id: mappingId, panelId: id, position: existing.position, ...body.data });
    await trySync(client, reply, id);
    return getPanel(id);
  });

  app.delete("/reaction-roles/panels/:id/mappings/:mappingId", async (request, reply) => {
    const id = parsePanelId(request, reply);
    if (id === null) return;
    const panel = getPanel(id);
    if (!panel) return reply.code(404).send({ error: "Panel not found" });

    const mappingId = Number((request.params as { mappingId?: string }).mappingId);
    if (!panel.mappings.some((m) => m.id === mappingId)) {
      return reply.code(404).send({ error: "Mapping not found on this panel" });
    }

    deleteMapping(mappingId);
    await trySync(client, reply, id);
    return getPanel(id);
  });

  app.post("/reaction-roles/panels/:id/mappings/reorder", async (request, reply) => {
    const id = parsePanelId(request, reply);
    if (id === null) return;
    const panel = getPanel(id);
    if (!panel) return reply.code(404).send({ error: "Panel not found" });

    const body = ReorderBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    const knownIds = new Set(panel.mappings.map((m) => m.id));
    if (body.data.orderedIds.length !== panel.mappings.length || !body.data.orderedIds.every((i) => knownIds.has(i))) {
      return reply.code(400).send({ error: "orderedIds must be exactly this panel's mapping ids" });
    }

    reorderMappings(body.data.orderedIds);
    await trySync(client, reply, id);
    return getPanel(id);
  });
}
