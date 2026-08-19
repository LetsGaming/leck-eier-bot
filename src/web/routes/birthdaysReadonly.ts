import type { FastifyInstance } from "fastify";
import { getAllBirthdaysByDate } from "../../db/birthdaysRepository.js";
import { daysUntil, getUpcomingBirthdays } from "../../services/birthdays.js";

export function registerBirthdaysReadonlyRoutes(app: FastifyInstance): void {
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
}
