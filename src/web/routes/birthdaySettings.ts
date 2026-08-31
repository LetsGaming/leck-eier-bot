import cron from "node-cron";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getSettings, updateSettings } from "../../db/settingsRepository.js";
import {
  getBirthdayListLocation,
  renderBirthdayTemplate,
  syncAnchorMessage,
  updateBirthdayListFromMessage,
} from "../../services/birthdays.js";
import logger, { errorMessage } from "../../utils/logger.js";
import type { BotClient } from "../../types.js";

const PatchBodySchema = z.object({
  template: z.string().min(1).max(2000).optional(),
  channelId: z.string().min(1).nullable().optional(),
  messageId: z.string().min(1).nullable().optional(),
  cron: z.string().min(1).optional(),
  modChannelId: z.string().min(1).nullable().optional(),
  selfRegistrationEnabled: z.boolean().optional(),
  botManagesAnchor: z.boolean().optional(),
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
    messageId: settings.birthdayListMessageId,
    cron: settings.birthdayCron,
    modChannelId: settings.birthdayModChannelId,
    selfRegistrationEnabled: settings.birthdaySelfRegistrationEnabled,
    botManagesAnchor: settings.birthdayBotManagesAnchor,
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

    const {
      template,
      channelId,
      messageId,
      cron: cronExpression,
      modChannelId,
      selfRegistrationEnabled,
      botManagesAnchor,
      anchorTemplate,
      anchorIntro,
      anchorUseFont,
      announcementUseFont,
    } = body.data;

    if (template !== undefined && (!template.includes("{userMention}") || !template.includes("{userNick}"))) {
      return reply.code(400).send({ error: "Template must include {userMention} and {userNick}." });
    }
    if (cronExpression !== undefined && !cron.validate(cronExpression)) {
      return reply.code(400).send({ error: "Invalid cron expression." });
    }

    const current = getSettings();
    const nextSelfRegistrationEnabled = selfRegistrationEnabled ?? current.birthdaySelfRegistrationEnabled;
    const nextBotManagesAnchor = botManagesAnchor ?? current.birthdayBotManagesAnchor;
    // The two are required to move together: self-registered entries only
    // ever show up anywhere visible via the bot-rendered anchor message, so
    // self-registration active while the bot *isn't* managing that message
    // is a dead-end state (silently-collected registrations nobody sees) —
    // not something to allow and reject the other way around.
    if (nextSelfRegistrationEnabled !== nextBotManagesAnchor) {
      return reply.code(400).send({
        error: "Self-registration and the bot-managed anchor message can only be turned on and off together.",
      });
    }

    // updateSettings emits SettingsEvent.Settings, which src/index.ts listens
    // on to reschedule the cron job if birthdayCron changed — nothing else
    // to do here for this to take effect live.
    const settings = updateSettings({
      ...(template !== undefined && { birthdayTemplate: template }),
      ...(channelId !== undefined && { birthdayListChannelId: channelId }),
      ...(messageId !== undefined && { birthdayListMessageId: messageId }),
      ...(cronExpression !== undefined && { birthdayCron: cronExpression }),
      ...(modChannelId !== undefined && { birthdayModChannelId: modChannelId }),
      ...(selfRegistrationEnabled !== undefined && { birthdaySelfRegistrationEnabled: selfRegistrationEnabled }),
      ...(botManagesAnchor !== undefined && { birthdayBotManagesAnchor: botManagesAnchor }),
      ...(anchorTemplate !== undefined && { birthdayAnchorTemplate: anchorTemplate }),
      ...(anchorIntro !== undefined && { birthdayAnchorIntro: anchorIntro || null }),
      ...(anchorUseFont !== undefined && { birthdayAnchorUseFont: anchorUseFont }),
      ...(announcementUseFont !== undefined && { birthdayAnnouncementUseFont: announcementUseFont }),
    });

    // Bring the anchor message up to date immediately (e.g. bot-managed mode
    // just got turned on, or the template/font changed) rather than waiting
    // for the next registration — syncAnchorMessage no-ops if it's off.
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

  /** Manually regenerates the bot-managed anchor message — the bot-managed-mode counterpart to /refresh above. */
  app.post("/settings/birthday/sync-anchor", async (_request, reply) => {
    const settings = getSettings();
    if (!settings.birthdayBotManagesAnchor) {
      return reply.code(400).send({ error: "Bot-managed anchor messages aren't enabled." });
    }
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
