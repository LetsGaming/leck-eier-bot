import cron from "node-cron";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getSettings, updateSettings } from "../../db/settingsRepository.js";
import { renderBirthdayTemplate, syncAnchorMessage } from "../../services/birthdays.js";
import logger, { errorMessage } from "../../utils/logger.js";
import type { BotClient } from "../../types.js";

const PatchBodySchema = z.object({
  template: z.string().min(1).max(2000).optional(),
  channelId: z.string().min(1).nullable().optional(),
  cron: z.string().min(1).optional(),
  modChannelId: z.string().min(1).nullable().optional(),
  anchorTemplate: z.string().min(1).max(500).optional(),
  anchorIntro: z.string().max(500).nullable().optional(),
  anchorUseFont: z.boolean().optional(),
  announcementUseFont: z.boolean().optional(),
});

const PreviewBodySchema = z.object({
  template: z.string().min(1).max(2000),
});

function serializeBirthdaySettings(settings: ReturnType<typeof getSettings>) {
  return {
    template: settings.birthdayTemplate,
    channelId: settings.birthdayListChannelId,
    cron: settings.birthdayCron,
    modChannelId: settings.birthdayModChannelId,
    anchorTemplate: settings.birthdayAnchorTemplate,
    anchorIntro: settings.birthdayAnchorIntro,
    anchorUseFont: settings.birthdayAnchorUseFont,
    announcementUseFont: settings.birthdayAnnouncementUseFont,
  };
}

export function registerBirthdaySettingsRoutes(app: FastifyInstance, client: BotClient): void {
  app.get("/settings/birthday", async () => serializeBirthdaySettings(getSettings()));

  app.patch("/settings/birthday", async (request, reply) => {
    const body = PatchBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    const { template, channelId, cron: cronExpression, modChannelId, anchorTemplate, anchorIntro, anchorUseFont, announcementUseFont } =
      body.data;

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
      ...(cronExpression !== undefined && { birthdayCron: cronExpression }),
      ...(modChannelId !== undefined && { birthdayModChannelId: modChannelId }),
      ...(anchorTemplate !== undefined && { birthdayAnchorTemplate: anchorTemplate }),
      ...(anchorIntro !== undefined && { birthdayAnchorIntro: anchorIntro || null }),
      ...(anchorUseFont !== undefined && { birthdayAnchorUseFont: anchorUseFont }),
      ...(announcementUseFont !== undefined && { birthdayAnnouncementUseFont: announcementUseFont }),
    });

    // Bring the anchor message up to date immediately (e.g. the channel,
    // template, or font just changed) rather than waiting for the next
    // registration.
    syncAnchorMessage(client).catch((err) =>
      logger.error(`Failed to sync birthday anchor after a settings change: ${errorMessage(err)}`),
    );

    return serializeBirthdaySettings(settings);
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

  /** Manually regenerates the bot-managed anchor message — e.g. after an admin edits a birthday entry directly. */
  app.post("/settings/birthday/sync-anchor", async (_request, reply) => {
    const settings = getSettings();
    if (!settings.birthdayListChannelId) {
      return reply.code(400).send({ error: "Pick a channel for the announcement list first." });
    }

    try {
      await syncAnchorMessage(client);
    } catch (err) {
      logger.error(`Dashboard-triggered anchor sync failed: ${errorMessage(err)}`);
      return reply.code(502).send({ error: "Failed to update the anchor message." });
    }
    return { ok: true };
  });
}
