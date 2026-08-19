import { z } from "zod";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  createPanel,
  deleteMapping,
  deletePanel,
  getPanel,
  listPanels,
  reorderMappings,
  setPanelMessageId,
  setPanelSent,
  updatePanel,
  upsertMapping,
} from "../../db/reactionRolesRepository.js";
import { syncPanelMessage } from "../../services/reactionRoles.js";
import logger, { errorMessage } from "../../utils/logger.js";
import { MAX_BUTTONS_PER_PANEL, MAX_DROPDOWN_OPTIONS_PER_PANEL, PanelMessageType, SelectionType } from "../../constants.js";
import type { BotClient } from "../../types.js";

const PanelBodySchema = z.object({
  name: z.string().min(1).max(100),
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

/**
 * Reactions can only ever be identified by their emoji (there's no text on
 * a reaction), so emoji is required and label is just decorative extra
 * text. Buttons/dropdown options are the opposite: the emoji is a nice
 * touch but the label is what the member actually reads, so it's required
 * there and the emoji is optional.
 */
function validateMappingForPanel(
  selectionType: SelectionType,
  data: { emojiName: string | null; label: string | null },
): string | null {
  if (selectionType === SelectionType.Reactions) {
    return data.emojiName ? null : "An emoji is required for a reactions panel.";
  }
  return data.label?.trim() ? null : "A label is required for buttons/dropdown options.";
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

/** Best-effort delete of a message the bot posted — used both when removing a managed panel and when it's moved to a different channel (see the PATCH route). */
async function deleteDiscordMessage(client: BotClient, channelId: string, messageId: string): Promise<void> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  await message?.delete().catch((err) => logger.warn(`Failed to delete old panel message: ${errorMessage(err)}`));
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
    const before = getPanel(id);
    if (!before) return reply.code(404).send({ error: "Panel not found" });

    const body = PanelBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    // A managed panel's message lives in a specific channel — Discord
    // messages can't move between channels, so relocating the panel means
    // deleting the old one and letting the next sync post a fresh one in
    // the new channel, rather than leaving the old message orphaned.
    if (before.managed && before.messageId && body.data.channelId !== before.channelId) {
      await deleteDiscordMessage(client, before.channelId, before.messageId);
      setPanelMessageId(id, null);
    }

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
      await deleteDiscordMessage(client, panel.channelId, panel.messageId);
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
    const validationError = validateMappingForPanel(panel.selectionType, body.data);
    if (validationError) return reply.code(400).send({ error: validationError });
    if (panel.mappings.some((m) => m.roleId === body.data.roleId)) {
      return reply.code(400).send({ error: "That role is already used by another option on this panel." });
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
    const validationError = validateMappingForPanel(panel.selectionType, body.data);
    if (validationError) return reply.code(400).send({ error: validationError });
    if (panel.mappings.some((m) => m.id !== mappingId && m.roleId === body.data.roleId)) {
      return reply.code(400).send({ error: "That role is already used by another option on this panel." });
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
