import { z } from "zod";
import type { ZodFastifyInstance } from "../utils.js";
import {
  listEventTemplates,
  getEventTemplateById,
  createEventTemplate,
  updateEventTemplate,
  deleteEventTemplate,
} from "../../db/eventTemplatesRepository.js";
import { requireFeature } from "../accessControl.js";
import { occupiedEventDates } from "../../services/eventConflicts.js";
import { nextWeekdayOccurrenceUtc } from "../../utils/timezone.js";
import type { EventTemplateListResponse, EventTemplateEntry } from "../../../contracts/eventTemplates.js";
import type { EventTemplate, Config } from "../../types.js";

const TIME_HHMM_REGEX = /^\d{2}:\d{2}$/;

const TemplateBodySchema = z
  .object({
    name: z.string().min(1),
    defaultTitle: z.string().min(1),
    baseDescription: z.string(),
    defaultChannelId: z.string().nullable(),
    defaultMentionRoleId: z.string().nullable(),
    defaultVoiceChannelId: z.string().nullable(),
    defaultWeekday: z.number().int().min(0).max(6).nullable(),
    defaultStartTime: z.string().regex(TIME_HHMM_REGEX).nullable(),
    defaultEndTime: z.string().regex(TIME_HHMM_REGEX).nullable(),
    useFont: z.boolean(),
  })
  .refine((body) => (body.defaultWeekday === null) === (body.defaultStartTime === null) && (body.defaultWeekday === null) === (body.defaultEndTime === null), {
    message: "defaultWeekday/defaultStartTime/defaultEndTime must be all set or all null.",
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
export function registerEventTemplateRoutes(app: ZodFastifyInstance, config: Config): void {
  app.get("/event-templates", async () => {
    const response: EventTemplateListResponse = { templates: listEventTemplates().map(serialize) };
    return response;
  });

  // Next free occurrence of a template's recurring-time default — server-side twin of
  // `defaultOccurrence()` in src/commands/general/event.ts, so both surfaces skip a
  // date that already has an event/pending publish (see services/eventConflicts.ts)
  // instead of the dashboard's old browser-local reimplementation.
  app.get(
    "/event-templates/:id/next-occurrence",
    { schema: { params: IdParamsSchema }, preHandler: requireFeature("events.write") },
    async (request, reply) => {
      const id = parseIdParam(request.params.id);
      if (id === null) return reply.code(400).send({ error: "Ungültige Vorlagen-ID" });

      const template = getEventTemplateById(id);
      if (!template) return reply.code(404).send({ error: "Vorlage nicht gefunden." });
      if (template.defaultWeekday === null || template.defaultStartTime === null || template.defaultEndTime === null) {
        return null;
      }

      const tz = config.timezone;
      const taken = occupiedEventDates(tz);
      return nextWeekdayOccurrenceUtc(template.defaultWeekday, template.defaultStartTime, template.defaultEndTime, tz, Date.now(), {
        isDateTaken: (key) => taken.has(key),
      });
    },
  );

  app.post("/event-templates", { schema: { body: TemplateBodySchema }, preHandler: requireFeature("eventTemplates.write") }, async (request, reply) => {
    const template = createEventTemplate(request.body);
    return reply.code(201).send(serialize(template));
  });

  app.put("/event-templates/:id", { schema: { params: IdParamsSchema, body: TemplateBodySchema }, preHandler: requireFeature("eventTemplates.write") }, async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ error: "Ungültige Vorlagen-ID" });
    if (!getEventTemplateById(id)) return reply.code(404).send({ error: "Vorlage nicht gefunden." });

    return serialize(updateEventTemplate(id, request.body));
  });

  app.delete("/event-templates/:id", { schema: { params: IdParamsSchema }, preHandler: requireFeature("eventTemplates.write") }, async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ error: "Ungültige Vorlagen-ID" });

    deleteEventTemplate(id);
    return reply.code(204).send();
  });
}
