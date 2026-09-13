import { z } from "zod";
import type { ZodFastifyInstance } from "../utils.js";
import {
  listEventTemplates,
  getEventTemplateById,
  createEventTemplate,
  updateEventTemplate,
  deleteEventTemplate,
} from "../../db/eventTemplatesRepository.js";
import type { EventTemplateListResponse, EventTemplateEntry } from "../../../contracts/eventTemplates.js";
import type { EventTemplate } from "../../types.js";

const TemplateBodySchema = z.object({
  name: z.string().min(1),
  titleTemplate: z.string().min(1),
  descriptionTemplate: z.string(),
  defaultChannelId: z.string().nullable(),
  defaultMentionRoleId: z.string().nullable(),
  defaultVoiceChannelId: z.string().nullable(),
});
const IdParamsSchema = z.object({ id: z.string() });

function serialize(template: EventTemplate): EventTemplateEntry {
  return template;
}

function parseIdParam(id: string): number | null {
  const numericId = Number(id);
  return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
}

/** CRUD for reusable event templates — filling one out and publishing it happens via `/api/events/publish` (see `events.ts`), not here. */
export function registerEventTemplateRoutes(app: ZodFastifyInstance): void {
  app.get("/event-templates", async () => {
    const response: EventTemplateListResponse = { templates: listEventTemplates().map(serialize) };
    return response;
  });

  app.post("/event-templates", { schema: { body: TemplateBodySchema } }, async (request, reply) => {
    const template = createEventTemplate(request.body);
    return reply.code(201).send(serialize(template));
  });

  app.put("/event-templates/:id", { schema: { params: IdParamsSchema, body: TemplateBodySchema } }, async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ error: "Ungültige Vorlagen-ID" });
    if (!getEventTemplateById(id)) return reply.code(404).send({ error: "Vorlage nicht gefunden." });

    return serialize(updateEventTemplate(id, request.body));
  });

  app.delete("/event-templates/:id", { schema: { params: IdParamsSchema } }, async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ error: "Ungültige Vorlagen-ID" });

    deleteEventTemplate(id);
    return reply.code(204).send();
  });
}
