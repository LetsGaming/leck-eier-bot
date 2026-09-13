import { z } from "zod";
import type { ZodFastifyInstance } from "../utils.js";
import { getEventById } from "../../db/eventAttendanceRepository.js";
import { publishEvent, editEvent, cancelEvent } from "../../services/events.js";
import { errorMessage } from "../../utils/logger.js";
import type { BotClient } from "../../types.js";

const PublishBodySchema = z.object({
  titleTemplate: z.string().min(1),
  descriptionTemplate: z.string(),
  placeholders: z.record(z.string(), z.string()),
  channelId: z.string().min(1),
  mentionRoleId: z.string().nullable(),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
});
const EditBodySchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
});
const IdParamsSchema = z.object({ id: z.string() });

function parseIdParam(id: string): number | null {
  const numericId = Number(id);
  return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
}

/** Create/edit/cancel a native event — read/list/attendance history lives in `eventAttendance.ts`. */
export function registerEventRoutes(app: ZodFastifyInstance, client: BotClient): void {
  app.post("/events/publish", { schema: { body: PublishBodySchema } }, async (request, reply) => {
    try {
      const event = await publishEvent(client, request.body);
      return reply.code(201).send(event);
    } catch (err) {
      return reply.code(502).send({ error: `Event konnte nicht veröffentlicht werden: ${errorMessage(err)}` });
    }
  });

  app.patch("/events/:id", { schema: { params: IdParamsSchema, body: EditBodySchema } }, async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ error: "Ungültige Event-ID" });

    const existing = getEventById(id);
    if (!existing) return reply.code(404).send({ error: "Event nicht gefunden." });
    if (existing.status !== "scheduled") {
      return reply.code(409).send({ error: "Nur noch nicht gestartete Events können bearbeitet werden." });
    }

    const event = await editEvent(client, id, request.body);
    return event;
  });

  app.post("/events/:id/cancel", { schema: { params: IdParamsSchema } }, async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ error: "Ungültige Event-ID" });

    const existing = getEventById(id);
    if (!existing) return reply.code(404).send({ error: "Event nicht gefunden." });
    if (existing.status !== "scheduled") {
      return reply.code(409).send({ error: "Nur noch nicht gestartete Events können storniert werden." });
    }

    await cancelEvent(client, id);
    return reply.code(204).send();
  });
}
