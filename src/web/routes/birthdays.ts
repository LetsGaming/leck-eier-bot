import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  deleteBirthday,
  getAllBirthdaysByDate,
  insertBirthday,
  updateBirthdayEntry,
} from "../../db/birthdaysRepository.js";
import { daysUntil, getUpcomingBirthdays, isValidCalendarDate, syncAnchorMessage, toDateKey } from "../../services/birthdays.js";
import logger, { errorMessage } from "../../utils/logger.js";
import type { BotClient } from "../../types.js";

const EntryBodySchema = z
  .object({
    day: z.number().int().min(1).max(31),
    month: z.number().int().min(1).max(12),
    userId: z.string().min(1).nullable().optional(),
    name: z.string().min(1).max(100).nullable().optional(),
  })
  .refine((b) => b.userId || b.name, { message: "Provide a Discord user or a name." });

/** Now the only way birthdays get into the system besides self-registration (`/setmybirthday`, or posting a date in the birthday channel) — there's no more admin-maintained announcement message to parse. */
export function registerBirthdaysRoutes(app: FastifyInstance, client: BotClient): void {
  app.get("/birthdays", async () => getAllBirthdaysByDate());

  // Sends a pre-computed day-count rather than the Date itself — see
  // daysUntil()'s doc comment for why round-tripping a timestamp through
  // JSON to a browser in a different timezone isn't safe here.
  app.get("/birthdays/upcoming", async () =>
    getUpcomingBirthdays().map(({ dateKey, date, entries }) => ({
      dateKey,
      daysUntil: daysUntil(date),
      entries,
    })),
  );

  app.post("/birthdays", async (request, reply) => {
    const body = EntryBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });
    const { day, month, userId, name } = body.data;
    if (!isValidCalendarDate(day, month)) return reply.code(400).send({ error: "That's not a valid date." });

    const mention = userId ? `<@${userId}>` : `@${name}`;
    let id: number;
    try {
      id = insertBirthday({ date: toDateKey(day, month), mention, userId: userId ?? null, name: name ?? null });
    } catch (err) {
      // Most likely idx_birthdays_user — that Discord user already has an entry.
      return reply.code(409).send({ error: `Couldn't add that entry: ${errorMessage(err)}` });
    }

    syncAnchorMessage(client).catch((err) =>
      logger.error(`Failed to sync birthday anchor after adding an entry: ${errorMessage(err)}`),
    );
    return reply.code(201).send({ id, date: toDateKey(day, month), mention, userId: userId ?? null, name: name ?? null, source: "list" });
  });

  app.patch("/birthdays/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "Invalid birthday id" });

    const body = EntryBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });
    const { day, month, userId, name } = body.data;
    if (!isValidCalendarDate(day, month)) return reply.code(400).send({ error: "That's not a valid date." });

    const mention = userId ? `<@${userId}>` : `@${name}`;
    try {
      updateBirthdayEntry(id, { date: toDateKey(day, month), mention, userId: userId ?? null, name: name ?? null });
    } catch (err) {
      return reply.code(409).send({ error: `Couldn't update that entry: ${errorMessage(err)}` });
    }

    syncAnchorMessage(client).catch((err) =>
      logger.error(`Failed to sync birthday anchor after editing an entry: ${errorMessage(err)}`),
    );
    return { ok: true };
  });

  app.delete("/birthdays/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "Invalid birthday id" });

    deleteBirthday(id);
    syncAnchorMessage(client).catch((err) =>
      logger.error(`Failed to sync birthday anchor after deleting an entry: ${errorMessage(err)}`),
    );
    return reply.code(204).send();
  });
}
