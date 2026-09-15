import { z } from "zod";
import type { ZodFastifyInstance } from "../utils.js";
import { getEventById } from "../../db/eventAttendanceRepository.js";
import {
  createScheduledPublish,
  updateScheduledPublish,
  deleteScheduledPublish,
  getScheduledPublish,
  listScheduledPublishes,
} from "../../db/scheduledEventPublishesRepository.js";
import { publishEvent, editEvent, cancelEvent, PublishEventInputSchema } from "../../services/events.js";
import { requireFeature } from "../accessControl.js";
import { errorMessage } from "../../utils/logger.js";
import type { BotClient } from "../../types.js";

const PublishBodySchema = PublishEventInputSchema;
const EditBodySchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
});
const IdParamsSchema = z.object({ id: z.string() });
const ScheduledPublishBodySchema = PublishEventInputSchema.extend({ publishAt: z.string().min(1) }).refine(
  (body) => new Date(body.publishAt).getTime() < new Date(body.startsAt).getTime(),
  { message: "Der Veröffentlichungszeitpunkt muss vor dem Start liegen.", path: ["publishAt"] },
);

function parseIdParam(id: string): number | null {
  const numericId = Number(id);
  return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
}

/** Create/edit/cancel a native event — read/list/attendance history lives in `eventAttendance.ts`. */
export function registerEventRoutes(app: ZodFastifyInstance, client: BotClient): void {
  app.post("/events/publish", { schema: { body: PublishBodySchema }, preHandler: requireFeature("events.write") }, async (request, reply) => {
    try {
      const event = await publishEvent(client, request.body);
      return reply.code(201).send(event);
    } catch (err) {
      return reply.code(502).send({ error: `Event konnte nicht veröffentlicht werden: ${errorMessage(err)}` });
    }
  });

  app.patch("/events/:id", { schema: { params: IdParamsSchema, body: EditBodySchema }, preHandler: requireFeature("events.write") }, async (request, reply) => {
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

  app.post("/events/:id/cancel", { schema: { params: IdParamsSchema }, preHandler: requireFeature("events.write") }, async (request, reply) => {
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

  // --- Deferred publishing ---------------------------------------------
  // A pending entry isn't an event yet (see the v39 migration comment in
  // src/db/index.ts) — it's posted by publishDueScheduledEvents() on
  // eventWatcher.ts's existing sweep tick, not from here.

  app.get("/events/scheduled", { preHandler: requireFeature("events.write") }, async () => listScheduledPublishes());

  app.post(
    "/events/scheduled",
    { schema: { body: ScheduledPublishBodySchema }, preHandler: requireFeature("events.write") },
    async (request, reply) => {
      const { publishAt, ...payload } = request.body;
      const scheduled = createScheduledPublish({ publishAt, payload });
      return reply.code(201).send(scheduled);
    },
  );

  app.patch(
    "/events/scheduled/:id",
    { schema: { params: IdParamsSchema, body: ScheduledPublishBodySchema }, preHandler: requireFeature("events.write") },
    async (request, reply) => {
      const id = parseIdParam(request.params.id);
      if (id === null) return reply.code(400).send({ error: "Ungültige ID" });

      const existing = getScheduledPublish(id);
      if (!existing) return reply.code(404).send({ error: "Geplante Veröffentlichung nicht gefunden." });
      if (existing.publishedEventId !== null) {
        return reply.code(409).send({ error: "Bereits veröffentlicht — nicht mehr bearbeitbar." });
      }

      const { publishAt, ...payload } = request.body;
      return updateScheduledPublish(id, { publishAt, payload });
    },
  );

  app.delete(
    "/events/scheduled/:id",
    { schema: { params: IdParamsSchema }, preHandler: requireFeature("events.write") },
    async (request, reply) => {
      const id = parseIdParam(request.params.id);
      if (id === null) return reply.code(400).send({ error: "Ungültige ID" });
      if (!getScheduledPublish(id)) return reply.code(404).send({ error: "Geplante Veröffentlichung nicht gefunden." });

      deleteScheduledPublish(id);
      return reply.code(204).send();
    },
  );
}
