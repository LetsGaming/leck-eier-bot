import cron from "node-cron";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getSettings, updateSettings } from "../../db/settingsRepository.js";
import {
  getBirthdayListLocation,
  renderBirthdayTemplate,
  updateBirthdayListFromMessage,
} from "../../services/birthdays.js";
import logger, { errorMessage } from "../../utils/logger.js";
import type { BotClient } from "../../types.js";

const PatchBodySchema = z.object({
  template: z.string().min(1).max(2000).optional(),
  channelId: z.string().min(1).nullable().optional(),
  messageId: z.string().min(1).nullable().optional(),
  cron: z.string().min(1).optional(),
});

const PreviewBodySchema = z.object({
  template: z.string().min(1).max(2000),
});

export function registerBirthdaySettingsRoutes(app: FastifyInstance, client: BotClient): void {
  app.get("/settings/birthday", async () => {
    const settings = getSettings();
    return {
      template: settings.birthdayTemplate,
      channelId: settings.birthdayListChannelId,
      messageId: settings.birthdayListMessageId,
      cron: settings.birthdayCron,
    };
  });

  app.patch("/settings/birthday", async (request, reply) => {
    const body = PatchBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    const { template, channelId, messageId, cron: cronExpression } = body.data;

    if (template !== undefined && (!template.includes("{userMention}") || !template.includes("{userNick}"))) {
      return reply.code(400).send({ error: "Template must include {userMention} and {userNick}." });
    }
    if (cronExpression !== undefined && !cron.validate(cronExpression)) {
      return reply.code(400).send({ error: "Invalid cron expression." });
    }

    // updateSettings emits SettingsEvent.Settings, which src/index.ts listens
    // on to reschedule the cron job if birthdayCron changed — nothing else
    // to do here for this to take effect live.
    const settings = updateSettings({
      ...(template !== undefined && { birthdayTemplate: template }),
      ...(channelId !== undefined && { birthdayListChannelId: channelId }),
      ...(messageId !== undefined && { birthdayListMessageId: messageId }),
      ...(cronExpression !== undefined && { birthdayCron: cronExpression }),
    });

    return {
      template: settings.birthdayTemplate,
      channelId: settings.birthdayListChannelId,
      messageId: settings.birthdayListMessageId,
      cron: settings.birthdayCron,
    };
  });

  app.post("/settings/birthday/preview", async (request, reply) => {
    const body = PreviewBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    const session = request.session!;
    const rendered = renderBirthdayTemplate(body.data.template, {
      mention: `<@${session.userId}>`,
      userId: session.userId,
      name: session.username,
    });
    return { rendered };
  });

  app.post("/settings/birthday/refresh", async (_request, reply) => {
    const location = getBirthdayListLocation();
    if (!location) return reply.code(400).send({ error: "Birthday list channel/message not configured yet." });

    try {
      await updateBirthdayListFromMessage(client, location.channelId, location.messageId);
    } catch (err) {
      logger.error(`Dashboard-triggered birthday refresh failed: ${errorMessage(err)}`);
      return reply.code(502).send({ error: "Failed to re-scan the birthday list message." });
    }
    return { ok: true };
  });
}
