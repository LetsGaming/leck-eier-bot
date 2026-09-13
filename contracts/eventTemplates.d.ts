/**
 * A reusable event template — title/description carry `{token}` placeholders
 * resolved via the shared token engine at publish time (same engine as
 * birthdays/reaction-roles/registration). See `src/db/eventTemplatesRepository.ts`.
 */
export interface EventTemplateEntry {
  id: number;
  name: string;
  titleTemplate: string;
  descriptionTemplate: string;
  defaultChannelId: string | null;
  defaultMentionRoleId: string | null;
  defaultVoiceChannelId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Response shape of `GET /api/event-templates`. */
export interface EventTemplateListResponse {
  templates: EventTemplateEntry[];
}

/** Body of `POST`/`PUT /api/event-templates(/:id)`. */
export interface EventTemplateBody {
  name: string;
  titleTemplate: string;
  descriptionTemplate: string;
  defaultChannelId: string | null;
  defaultMentionRoleId: string | null;
  defaultVoiceChannelId: string | null;
}

/**
 * Body of `POST /api/events/publish` — `titleTemplate`/`descriptionTemplate`
 * are the (possibly template-sourced, possibly hand-typed) text with
 * `{token}` placeholders still in it; `placeholders` supplies the fill-in
 * values. The publish endpoint is the single source of truth for rendering
 * (see `renderEventText()` in `src/services/events.ts`) — a template is just
 * a convenient starting point copied into the creation form, not referenced
 * by id at publish time.
 */
export interface PublishEventBody {
  titleTemplate: string;
  descriptionTemplate: string;
  placeholders: Record<string, string>;
  channelId: string;
  mentionRoleId: string | null;
  /** ISO UTC. */
  startsAt: string;
  /** ISO UTC. */
  endsAt: string;
}

/** Body of `PATCH /api/events/:id` — only valid while the event is still `scheduled`. */
export interface EditEventBody {
  title: string;
  description: string;
  /** ISO UTC. */
  startsAt: string;
  /** ISO UTC. */
  endsAt: string;
}

/** Response shape of `POST /api/events/publish` and `PATCH /api/events/:id`. */
export interface PublishedEventEntry {
  id: number;
  messageId: string;
  channelId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "active" | "completed" | "cancelled";
  voiceChannelId: string | null;
  trackingIncomplete: boolean;
  remindedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
