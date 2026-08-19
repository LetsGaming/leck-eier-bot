import type { FastifyInstance } from "fastify";
import { getAllBirthdaysByDate } from "../../db/birthdaysRepository.js";

export function registerBirthdaysReadonlyRoutes(app: FastifyInstance): void {
  app.get("/birthdays", async () => getAllBirthdaysByDate());
}
