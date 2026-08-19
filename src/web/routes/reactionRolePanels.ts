import { z } from "zod";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  createPanel,
  deleteMapping,
  deletePanel,
  getPanel,
  listPanels,
  reorderMappings,
  setPanelSent,
  updatePanel,
  upsertMapping,
} from "../../db/reactionRolesRepository.js";
import { syncPanelMessage } from "../../services/reactionRoles.js";
import logger, { errorMessage } from "../../utils/logger.js";
import { MAX_BUTTONS_PER_PANEL, MAX_DROPDOWN_OPTIONS_PER_PANEL, PanelMessageType, SelectionType } from "../../constants.js";
import type { BotClient } from "../../types.js";

const PanelBodySchema = z.object({
  channelId: z.string().min(1),
  messageType: z.enum([PanelMessageType.Text, PanelMessageType.Embed]),
  removeReaction: z.boolean(),
  allowMultiple: z.boolean(),
  removable: z.boolean(),
  allowedRoleIds: z.array(z.string().min(1)).nullable(),
  title: z.string().min(1).max(256).nullable(),
  description: z.string().max(2048).nullable(),
});

// selectionType/existingMessageId only make sense at creation — see
// CreatePanelInput's doc comment in reactionRolesRepository.ts. Once a
// panel exists, its interaction mechanism and whether it's attached to
// someone else's message are both fixed.
const CreatePanelBodySchema = PanelBodySchema.extend({
  selectionType: z.enum([SelectionType.Reactions, SelectionType.Buttons, SelectionType.Dropdown]),
  existingMessageId: z.string().min(1).nullable().optional(),
});

const MappingBodySchema = z.object({
  // Required for reactions (there's no reacting without an emoji);
  // optional for buttons/dropdown, checked against the panel's
  // selectionType in the route handler since zod alone doesn't have that
  // context.
  emojiName: z.string().min(1).nullable(),
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

function mappingCap(selectionType: SelectionType): number | null {
  switch (selectionType) {
    case SelectionType.Buttons:
      return MAX_BUTTONS_PER_PANEL;
    case SelectionType.Dropdown:
      return MAX_DROPDOWN_OPTIONS_PER_PANEL;
    case SelectionType.Reactions:
      return null;
  }
}

/**
 * Auto-resync after a write — but only once the panel has actually been
 * sent (see docs/REACTION_ROLES.md#draft-then-send). A draft panel stays
 * untouched on Discord's side no matter how many times its config changes;
 * only the explicit /send route (below) performs its first sync.
 */
async function trySync(client: BotClient, reply: FastifyReply, panelId: number): Promise<void> {
  const panel = getPanel(panelId);
  if (!panel?.sent) return;
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
    const body = CreatePanelBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    if (body.data.existingMessageId && body.data.selectionType !== SelectionType.Reactions) {
      return reply
        .code(400)
        .send({ error: "Attaching to an existing message only works with reactions — buttons and dropdowns need a bot-owned message." });
    }

    const panel = createPanel(body.data);
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

    // Only the bot's own managed messages get deleted with the panel — an
    // unmanaged panel is attached to someone else's message (e.g. an
    // admin's rules post), which removing a reaction-role config from
    // shouldn't also delete.
    if (panel.managed && panel.messageId) {
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
    const panel = getPanel(id);
    if (!panel) return reply.code(404).send({ error: "Panel not found" });
    if (!panel.sent) {
      return reply.code(400).send({ error: "This panel hasn't been sent yet — use Send instead." });
    }

    await trySync(client, reply, id);
    return getPanel(id);
  });

  /** First activation of a draft panel — posts/attaches it to Discord and marks it sent. Idempotent afterward (re-running just re-syncs). */
  app.post("/reaction-roles/panels/:id/send", async (request, reply) => {
    const id = parsePanelId(request, reply);
    if (id === null) return;
    const panel = getPanel(id);
    if (!panel) return reply.code(404).send({ error: "Panel not found" });
    if (panel.mappings.length === 0) {
      return reply.code(400).send({ error: "Add at least one role before sending." });
    }

    try {
      await syncPanelMessage(client, id);
    } catch (err) {
      logger.error(`Failed to send reaction-role panel ${id}: ${errorMessage(err)}`);
      return reply
        .code(502)
        .send({ error: "Failed to post the message to Discord. Check the bot's permissions and try again." });
    }

    setPanelSent(id, true);
    return getPanel(id);
  });

  app.post("/reaction-roles/panels/:id/mappings", async (request, reply) => {
    const id = parsePanelId(request, reply);
    if (id === null) return;
    const panel = getPanel(id);
    if (!panel) return reply.code(404).send({ error: "Panel not found" });

    const body = MappingBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });
    if (panel.selectionType === SelectionType.Reactions && !body.data.emojiName) {
      return reply.code(400).send({ error: "An emoji is required for a reactions panel." });
    }
    const cap = mappingCap(panel.selectionType);
    if (cap !== null && panel.mappings.length >= cap) {
      return reply.code(400).send({ error: `Discord allows at most ${cap} options for this selection type.` });
    }

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
    if (panel.selectionType === SelectionType.Reactions && !body.data.emojiName) {
      return reply.code(400).send({ error: "An emoji is required for a reactions panel." });
    }

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
